"""ENHA2-034 ②担当者レコメンド ─ 学習ジョブ

これが「実際に学習する」本体。毎晩 GitHub Actions から無人で走る。
ユーザーのログインは不要で、ボタンを押す必要もない。

流れ:
  1. 組織ごとに、DBから完了チケット・メンバー・スキルを取ってくる
  2. (チケット × メンバー) ＋ 正解ラベル の表に組み立てる  … features.py
  3. LightGBM に fit させる                                  … ★ここが「学習」の実体
  4. ベースライン（ルールベース）と比べて、勝っていたら本番採用（is_active=true）にする
  5. モデルを recommendation_models に保存 → 翌朝から推論に使われる

★モデルは組織ごとに1つ★
  A社のメンバーとB社のメンバーは別人なので、全組織を1つの巨大モデルで学習しても意味がない。
  「小さな学習をN回」にすることで、組織が増えてもスケールする。

★学習は毎回「全件」でやり直す★
  昨日の差分だけを追加学習すると、直近データに過剰適合してモデルが壊れる（GBDTの性質）。
  そして全件でも数秒で終わるので、差分学習する必要がそもそも無い。
  差分検知は「変更のない組織を丸ごとスキップする」ために使う。

★実行結果は必ず ml_batch_runs に残す★
  ①スキル分析が2週間ずっと素通りしていたのに緑で流れ続けた事故を受けて、
  「動いたのか / 動いて何もしなかったのか / 落ちたのか」を画面から見えるようにしている。
  ①が作った同じ batch_id の行を、ここで更新して確定させる。

使い方:
    python ml/train.py              # 全組織（変更のあった組織だけ）
    python ml/train.py --org <id>   # 指定組織のみ
    python ml/train.py --force      # 変更が無くても学習する
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import lightgbm as lgb
import numpy as np
from supabase import Client, create_client

from features import (
    DONE_STATUSES,
    FEATURE_NAMES,
    build_dataset,
    build_features,
    parse_ts,
)

LOOKBACK_MONTHS = 18
# 完了チケットがこれ未満の組織は学習しない（ルールベースで十分に機能する）。
# 無理に学習すると、少ないデータに過剰適合した使い物にならないモデルができる。
MIN_DONE_TICKETS = 50
# 学習データがこれ未満なら見送り
MIN_TRAIN_ROWS = 100


# 1回のリクエストで返る行数には上限があるので、必ず分割して全件取る。
# ここで静かに切れると、欠けたデータで学習して精度が落ちる（しかも気付けない）。
PAGE = 1000
# where in で使う id の分割単位（URLが長くなりすぎるのを防ぐ）
IN_CHUNK = 200


def sb_client() -> Client:
    url = os.environ.get("VITE_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が設定されていません")
    return create_client(url, key)


def chunked(xs: list, size: int = IN_CHUNK):
    for i in range(0, len(xs), size):
        yield xs[i : i + size]


def fetch_all(build) -> list[dict]:
    """build(start, end) が返すクエリを、全件取れるまでページングする。"""
    rows: list[dict] = []
    start = 0
    while True:
        page = build(start, start + PAGE - 1).execute().data or []
        rows += page
        if len(page) < PAGE:
            return rows
        start += PAGE


def fetch_org_data(sb: Client, org_id: str) -> dict:
    """1組織分のデータをまとめて取る"""
    since = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_MONTHS * 30)).isoformat()

    projects = sb.table("projects").select("id").eq("organization_id", org_id).execute().data
    project_ids = [p["id"] for p in projects]
    if not project_ids:
        return {"tickets": [], "profiles": [], "skills": [], "member_skills": [], "required": {}}

    sprints: list[dict] = []
    for ids in chunked(project_ids):
        sprints += sb.table("sprints").select("id").in_("project_id", ids).execute().data
    sprint_ids = [s["id"] for s in sprints]
    if not sprint_ids:
        return {"tickets": [], "profiles": [], "skills": [], "member_skills": [], "required": {}}

    tickets: list[dict] = []
    for ids in chunked(sprint_ids):
        tickets += fetch_all(
            lambda a, b, ids=ids: sb.table("sprint_tickets")
            .select(
                "id, title, description, prefixes, status, priority, assignee, reviewer_name, review_round, "
                "due_date, dev_scale, estimated_hours, actual_work_hours, is_operation_verified, "
                "started_at, released_at, uat_completed_at, stg_completed_at, review_approved_at, "
                "created_at, updated_at"
            )
            .in_("sprint_id", ids)
            .gte("created_at", since)
            .order("id")
            .range(a, b)
        )

    # ★在籍しているメンバーだけを候補にする★
    #   招待中(invited)や退職者を負例に混ぜると、実在しない候補で学習してしまう。
    profiles = [
        p
        for p in sb.table("profiles").select("id, name, status").eq("organization_id", org_id).execute().data
        if p.get("status") == "active"
    ]
    skills = sb.table("skills").select("id, name, layer").eq("organization_id", org_id).execute().data

    skill_ids = [s["id"] for s in skills]
    member_skills: list[dict] = []
    for ids in chunked(skill_ids):
        member_skills += fetch_all(
            lambda a, b, ids=ids: sb.table("member_skills")
            .select("profile_id, skill_id, level")
            .in_("skill_id", ids)
            .order("profile_id")
            .range(a, b)
        )

    ticket_ids = [t["id"] for t in tickets]
    required_rows: list[dict] = []
    for ids in chunked(ticket_ids):
        required_rows += fetch_all(
            lambda a, b, ids=ids: sb.table("ticket_required_skills")
            .select("ticket_id, skill_id, importance")
            .in_("ticket_id", ids)
            .order("ticket_id")
            .range(a, b)
        )

    required: dict[str, list[dict]] = {}
    for r in required_rows:
        required.setdefault(r["ticket_id"], []).append(
            {"skill_id": r["skill_id"], "importance": r.get("importance", 3)}
        )

    # 自動アサインのレコメンドを採用して決めたアサインのチケットID。
    # これらの正例は build_dataset で重めに学習される。
    accepted_ticket_ids: set[str] = set()
    for row in (
        sb.table("recommendation_logs")
        .select("ticket_id")
        .eq("organization_id", org_id)
        .execute()
        .data
    ):
        if row.get("ticket_id"):
            accepted_ticket_ids.add(row["ticket_id"])

    return {
        "tickets": tickets,
        "profiles": profiles,
        "skills": skills,
        "member_skills": member_skills,
        "required": required,
        "accepted_ticket_ids": accepted_ticket_ids,
    }


def baseline_score(feat: list[float]) -> float:
    """ルールベースのベースライン。

    これは「MLが越えるべき物差し」であり、同時にモデルが無い組織のフォールバックでもある。
    recommendCore.ts の baselineScore() と同じ計算をすること。
    """
    skill_match, coverage, _min_lv, gap, done, _avg_h, on_time, reviews, workload, _wh, scale_fit = feat[:11]

    experience = min(1.0, done / 20)
    leadership = min(1.0, reviews / 10)
    load = 1 / (1 + workload * 0.25)

    score = (
        (skill_match * 0.40 + coverage * 0.15)
        + (experience * 0.15 + on_time * 0.10 + leadership * 0.05)
        + (scale_fit * 0.15)
    ) * load

    if gap > 0 and coverage == 0:
        score *= 0.25
    return max(0.0, min(1.0, score))


def precision_at_1(scores: np.ndarray, y: np.ndarray, groups: list[int]) -> float:
    """チケットごとに、1位に推した人が実際に成功した担当者だったかの割合"""
    hit = total = 0
    i = 0
    for g in groups:
        s = scores[i : i + g]
        labels = y[i : i + g]
        i += g
        if labels.max() == 0:  # 正解が無いグループは評価対象外
            continue
        total += 1
        if labels[int(np.argmax(s))] == 1:
            hit += 1
    return hit / total if total else 0.0


def train_org(sb: Client, org_id: str, force: bool) -> dict:
    data = fetch_org_data(sb, org_id)
    tickets = data["tickets"]

    done_tickets = [t for t in tickets if (t.get("status") or "") in DONE_STATUSES]
    if len(done_tickets) < MIN_DONE_TICKETS:
        return {
            "org": org_id,
            "trained": False,
            "reason": f"完了チケットが{len(done_tickets)}件（{MIN_DONE_TICKETS}件未満）のためルールベースで運用",
        }

    # ── 差分検知 ──
    # 前回の学習以降にチケットが1件も動いていなければ、学習し直す意味がない。
    if not force:
        latest = (
            sb.table("recommendation_models")
            .select("created_at, version")
            .eq("organization_id", org_id)
            .order("version", desc=True)
            .limit(1)
            .execute()
            .data
        )
        if latest:
            last = parse_ts(latest[0]["created_at"])

            # updated_at（トリガで自動更新）が最も正確。
            # 移行直後などで null の行だけ、作成日時とマイルストーン日時の最大値で近似する。
            def last_activity(t: dict) -> datetime:
                if t.get("updated_at"):
                    return parse_ts(t["updated_at"])
                cands = [
                    parse_ts(t.get(k))
                    for k in ("created_at", "started_at", "review_approved_at",
                              "stg_completed_at", "uat_completed_at", "released_at")
                ]
                cands = [c for c in cands if c]
                return max(cands) if cands else datetime.min.replace(tzinfo=timezone.utc)

            changed = any(last_activity(t) > last for t in tickets)
            if not changed:
                return {"org": org_id, "trained": False, "reason": "前回学習以降に変更なし（スキップ）"}

    # ── 学習用の表を組み立てる ──
    X, y, groups, w = build_dataset(
        tickets, data["profiles"], data["skills"], data["member_skills"], data["required"],
        boosted_ticket_ids=data.get("accepted_ticket_ids"),
    )
    if len(X) < MIN_TRAIN_ROWS:
        return {
            "org": org_id,
            "trained": False,
            "reason": f"学習データが{len(X)}行（{MIN_TRAIN_ROWS}行未満）のため見送り",
        }

    Xa = np.array(X, dtype=np.float64)
    ya = np.array(y, dtype=np.int32)
    wa = np.array(w, dtype=np.float64)

    # ── 時系列split ──
    # ランダムに分割すると「未来を見て過去を当てる」ことになり、評価が甘くなる。
    # build_dataset がチケットを作成日時の昇順に並べているので、後ろ2割を検証に使う。
    cut_group = int(len(groups) * 0.8)
    cut_row = sum(groups[:cut_group])
    if cut_group < 5 or cut_row < 50 or cut_row >= len(Xa):
        return {"org": org_id, "trained": False, "reason": "検証データを分けるにはデータが不足"}

    X_tr, y_tr, w_tr = Xa[:cut_row], ya[:cut_row], wa[:cut_row]
    X_va, y_va = Xa[cut_row:], ya[cut_row:]
    g_va = groups[cut_group:]

    if y_tr.sum() == 0 or y_tr.sum() == len(y_tr):
        return {"org": org_id, "trained": False, "reason": "正例/負例のどちらかしか無い"}

    # ============================================================
    # ★ここが「学習」★
    # 「スキル適合・過去実績・負荷・規模」のどれをどれだけ重視すべきかを、
    # 成功/失敗の履歴からモデル自身が見つける。人間が重みを書かない。
    # ============================================================
    model = lgb.LGBMClassifier(
        objective="binary",
        n_estimators=200,
        learning_rate=0.05,
        num_leaves=15,        # データが小さいので木は浅く。深くすると過剰適合する
        min_child_samples=10,
        subsample=0.9,
        colsample_bytree=0.9,
        reg_lambda=1.0,
        verbose=-1,
    )
    # sample_weight で、レコメンド採用アサインの正例を重めに学習させる
    model.fit(X_tr, y_tr, sample_weight=w_tr, feature_name=FEATURE_NAMES)

    # ── 評価: ベースラインに勝てたか ──
    model_scores = model.predict_proba(X_va)[:, 1]
    base_scores = np.array([baseline_score(list(row)) for row in X_va])

    p1_model = precision_at_1(model_scores, y_va, g_va)
    p1_base = precision_at_1(base_scores, y_va, g_va)

    # ★ベースラインを超えたモデルだけを本番投入する★
    # 超えられないうちはルールベースのまま運用する。データが薄い初期は
    # 素直にベースラインの方が強いことがあり、無理にMLを使うと品質が下がる。
    is_active = p1_model > p1_base

    dump = model.booster_.dump_model()

    prev = (
        sb.table("recommendation_models")
        .select("version")
        .eq("organization_id", org_id)
        .order("version", desc=True)
        .limit(1)
        .execute()
        .data
    )
    version = (prev[0]["version"] + 1) if prev else 1

    metrics = {
        "precision_at_1_model": round(p1_model, 4),
        "precision_at_1_baseline": round(p1_base, 4),
        "train_rows": int(len(X_tr)),
        "valid_rows": int(len(X_va)),
        "valid_groups": int(len(g_va)),
        "positive_rate": round(float(ya.mean()), 4),
        "beats_baseline": bool(is_active),
    }

    # 旧モデルを非アクティブにしてから、新モデルを入れる。
    # 学習中もアプリは旧モデルで動き続け、ここで一瞬で切り替わる（無停止）。
    if is_active:
        sb.table("recommendation_models").update({"is_active": False}).eq("organization_id", org_id).execute()

    sb.table("recommendation_models").insert(
        {
            "organization_id": org_id,
            "version": version,
            "model_json": json.loads(json.dumps(dump)),
            "feature_names": FEATURE_NAMES,
            "metrics": metrics,
            "train_rows": int(len(X_tr)),
            "is_active": is_active,
        }
    ).execute()

    return {"org": org_id, "trained": True, "version": version, "active": is_active, "metrics": metrics}


# ============================================================
# 学習ログ（ml_batch_runs）
#
# ①スキル分析が作った同じ batch_id の行に②の結果を書き足し、総合判定を確定させる。
# 画面の「学習ログ」タブはこの result / summary をそのまま表示する。
#
# 総合判定:
#   問題あり(failed)    … ①か②が落ちた            → エラー内容を出す
#   完了(completed)     … ②がモデルを学習した       → スキル修正あり/なし＋モデル情報を出す
#   未実行(not_run)     … ②が学習条件を満たさなかった → その理由を出す
# ============================================================
def record_train_phase(sb: Client, batch_id: str, trigger: str, org_id: str, r: dict) -> None:
    if not batch_id:
        return

    train = {
        "status": "failed" if r.get("error") else ("done" if r.get("trained") else "skipped"),
        "version": r.get("version"),
        "active": r.get("active"),
        "metrics": r.get("metrics"),
        "reason": r.get("reason"),
        "error": r.get("error"),
    }

    # ①が書いた内容（スキル修正の件数など）を読み、消さずにマージする
    analyze: dict = {}
    row_id = None
    try:
        rows = (
            sb.table("ml_batch_runs")
            .select("id, detail")
            .eq("organization_id", org_id)
            .eq("batch_id", batch_id)
            .limit(1)
            .execute()
            .data
        )
        if rows:
            row_id = rows[0]["id"]
            analyze = (rows[0].get("detail") or {}).get("analyze") or {}
    except Exception:
        pass

    changed = analyze.get("changed") or 0
    changed_members = analyze.get("changedMembers") or 0
    skill_part = (
        f"スキル修正あり（{changed_members}名・{changed}件）" if changed else "スキル修正なし"
    )

    if analyze.get("status") == "failed" or train["status"] == "failed":
        result = "failed"
        summary = train.get("error") or analyze.get("error") or "エラーが発生しました"
    elif train["status"] == "done":
        result = "completed"
        model_part = (
            f"モデル学習 v{train['version']} を{'採用' if train.get('active') else '見送り'}"
        )
        summary = f"{skill_part} ／ {model_part}"
    else:
        result = "not_run"
        reason = train.get("reason") or "モデル学習は実行されませんでした"
        # スキルは直っているのに理由だけ出すと成果が見えないので、あれば併記する
        summary = f"{skill_part} ／ {reason}" if changed else reason

    payload = {
        "organization_id": org_id,
        "batch_id": batch_id,
        "trigger": trigger,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "result": result,
        "summary": summary[:2000],
        "detail": {"analyze": analyze, "train": train},
    }

    # ログを残せなくても学習そのものは成立させる（ログが欠けるだけ）
    try:
        if row_id:
            sb.table("ml_batch_runs").update(payload).eq("id", row_id).execute()
        else:
            payload["started_at"] = payload["finished_at"]
            sb.table("ml_batch_runs").upsert(payload, on_conflict="organization_id,batch_id").execute()
    except Exception as e:
        print(f"[warn] 学習ログを記録できませんでした ({org_id}): {e}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--org", help="この組織だけ学習する")
    ap.add_argument("--force", action="store_true", help="変更が無くても学習する")
    args = ap.parse_args()

    sb = sb_client()

    # ①スキル分析と同じ鍵。ワークフローが GitHub の run_id を渡してくる。
    batch_id = os.environ.get("BATCH_ID", "")
    trigger = os.environ.get("TRIGGER", "daily")

    if args.org:
        org_ids = [args.org]
    else:
        org_ids = [o["id"] for o in sb.table("organizations").select("id").execute().data]

    trained = 0
    for org_id in org_ids:
        try:
            r = train_org(sb, org_id, args.force)
        except Exception as e:  # 1組織の失敗で全体を止めない
            r = {"org": org_id, "trained": False, "error": f"モデル学習でエラーが発生しました: {e}"}
        if r.get("trained"):
            trained += 1
        print(json.dumps(r, ensure_ascii=False))
        record_train_phase(sb, batch_id, trigger, org_id, r)

    print(f"\n=== {len(org_ids)}組織中 {trained}組織を学習しました ===")

    # ワークフローの実行サマリ（ログを開かなくても結果が分かるように）
    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        with open(step_summary, "a", encoding="utf-8") as f:
            f.write(f"\n### ② モデル学習\n\n{len(org_ids)}組織中 **{trained}組織**を学習しました。\n")


if __name__ == "__main__":
    main()
