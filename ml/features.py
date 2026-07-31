"""ENHA2-034 ②担当者レコメンド ─ 学習データの組み立て

ここが「学習の準備」。DBの生の実績を、LightGBMに食わせられる
「1行 = (チケット × メンバー) の1ペア ＋ 正解ラベル」の表に変換する。

★重要★ FEATURE_NAMES の順序は src/app/lib/recommendCore.ts と完全に一致させること。
  ズレると、学習時と推論時で別の特徴量を見ることになり、静かに壊れる。

★リーク防止★ 各ペアの特徴量は「そのチケットが作成された時点」のスナップショットで作る。
  完了後の情報（そのチケット自身の結果や、その後に完了した他チケット）を混ぜてはいけない。
  混ぜるとオフラインでは高精度に見えて、本番では無力なモデルができあがる。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

# ★ recommendCore.ts の FEATURE_NAMES と同じ順序
FEATURE_NAMES = [
    "skill_match",
    "skill_coverage",
    "skill_min_level",
    "skill_gap",
    "domain_done_count",
    "domain_avg_hours",
    "domain_ontime_rate",
    "domain_review_count",
    "workload",
    "workload_hours",
    "scale_fit",
    "ticket_hours",
    "ticket_scale",
    "ticket_priority",
    "total_done",
    "total_ontime_rate",
]

DONE_STATUSES = {"done", "closed", "released", "waiting-release"}
IN_PROGRESS_STATUSES = {"in-progress", "in-review", "review-done", "stg-test", "uat"}
SCALE_NUM = {"S": 1, "M": 2, "L": 3, "XL": 4}
PRIORITY_NUM = {"low": 1, "medium": 2, "high": 3}

# 1チケットあたりに作る負例の数。全メンバーと総当たりすると行数が爆発するので絞る。
# （組織が10年使っても学習データが数万行に収まるようにするための上限）
NEGATIVES_PER_TICKET = 6


def parse_ts(v: Any) -> datetime | None:
    if not v:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None


def actual_hours(t: dict) -> float:
    """実績工数(h)。手入力があれば優先、無ければマイルストーン差分で概算。"""
    if t.get("actual_work_hours"):
        return float(t["actual_work_hours"])
    start = parse_ts(t.get("started_at"))
    end = (
        parse_ts(t.get("review_approved_at"))
        or parse_ts(t.get("stg_completed_at"))
        or parse_ts(t.get("uat_completed_at"))
        or parse_ts(t.get("released_at"))
    )
    if not start or not end:
        return float(t.get("estimated_hours") or 0)
    h = (end - start).total_seconds() / 3600
    return h if h > 0 else float(t.get("estimated_hours") or 0)


def completed_at(t: dict) -> datetime | None:
    return (
        parse_ts(t.get("released_at"))
        or parse_ts(t.get("uat_completed_at"))
        or parse_ts(t.get("stg_completed_at"))
        or parse_ts(t.get("review_approved_at"))
    )


def is_on_time(t: dict) -> bool:
    due = parse_ts(t.get("due_date"))
    if not due:
        return True
    end = completed_at(t)
    if not end:
        return True
    return end <= due + timedelta(days=1)


def outcome_label(t: dict) -> int:
    """正解ラベル: そのアサインは「成功」だったか。

    既存のマイルストーン/工数データから、成功度を合成して 1/0 にする。
      - 納期を守れたか      (released_at 等 vs due_date)
      - 見積は当たったか    (実績工数 vs estimated_hours)
      - 手戻りは無かったか  (review_round)
      - 動作確認が通ったか  (is_operation_verified)
    """
    score = 0.0

    if is_on_time(t):
        score += 0.40

    est = float(t.get("estimated_hours") or 0)
    act = actual_hours(t)
    if est > 0 and act > 0:
        ratio = act / est
        # 見積の 0.5〜1.5 倍に収まっていれば精度良しとみなす
        if 0.5 <= ratio <= 1.5:
            score += 0.30
        elif ratio <= 2.0:
            score += 0.15
    else:
        score += 0.15  # 見積が無いものは中立

    rounds = int(t.get("review_round") or 0)
    if rounds <= 1:
        score += 0.20
    elif rounds == 2:
        score += 0.10

    if t.get("is_operation_verified"):
        score += 0.10

    return 1 if score >= 0.60 else 0


@dataclass
class LayerStat:
    done: int = 0
    hours_sum: float = 0.0
    hours_n: int = 0
    on_time: int = 0
    reviews: int = 0
    max_scale: int = 0


@dataclass
class MemberState:
    """あるメンバーの「ある時点における」実績。チケットを時系列に流しながら積み上げる。"""

    layers: dict[str, LayerStat] = field(default_factory=dict)
    total_done: int = 0
    total_on_time: int = 0
    in_progress: int = 0
    in_progress_hours: float = 0.0

    def layer(self, l: str) -> LayerStat:
        if l not in self.layers:
            self.layers[l] = LayerStat()
        return self.layers[l]


def build_features(
    ticket: dict,
    required: list[dict],   # [{skill_id, layer, importance}]
    levels: dict[str, int],  # skill_id -> level(1..4)
    st: MemberState,
) -> list[float]:
    """(チケット × メンバー) の1ペアを特徴量ベクトルにする。

    recommendCore.ts の buildFeatures() と同じ計算をすること。
    """
    weighted = weight_sum = 0.0
    have = gap = 0
    min_level = 4 if required else 0

    for r in required:
        lv = levels.get(r["skill_id"], 0)
        imp = r.get("importance", 3)
        weighted += (lv / 4) * imp
        weight_sum += imp
        if lv > 0:
            have += 1
        else:
            gap += 1
        min_level = min(min_level, lv)

    skill_match = weighted / weight_sum if weight_sum > 0 else 0.0
    coverage = have / len(required) if required else 0.0

    layers = {r["layer"] for r in required}
    done = reviews = 0
    hours_sum = 0.0
    hours_n = 0
    on_time_sum = 0.0
    on_time_n = 0
    max_scale = 0
    for l in layers:
        s = st.layers.get(l)
        if not s:
            continue
        done += s.done
        if s.hours_n > 0:
            hours_sum += s.hours_sum / s.hours_n
            hours_n += 1
        if s.done > 0:
            on_time_sum += s.on_time / s.done
            on_time_n += 1
        reviews += s.reviews
        max_scale = max(max_scale, s.max_scale)

    domain_avg_hours = hours_sum / hours_n if hours_n else 0.0
    domain_on_time = on_time_sum / on_time_n if on_time_n else 0.0

    t_scale = SCALE_NUM.get(ticket.get("dev_scale") or "", 2)
    scale_fit = min(1.0, max_scale / t_scale) if max_scale > 0 else 0.5

    return [
        skill_match,
        coverage,
        float(min_level),
        float(gap),
        float(done),
        domain_avg_hours,
        domain_on_time,
        float(reviews),
        float(st.in_progress),
        st.in_progress_hours,
        scale_fit,
        float(ticket.get("estimated_hours") or 0),
        float(t_scale),
        float(PRIORITY_NUM.get(ticket.get("priority") or "medium", 2)),
        float(st.total_done),
        (st.total_on_time / st.total_done) if st.total_done else 0.0,
    ]


# レコメンドを採用して決めたアサインの正例に掛ける重み（普通の正例は1.0）
ACCEPTED_POSITIVE_WEIGHT = 2.0


def build_dataset(
    tickets: list[dict],
    profiles: list[dict],
    skills: list[dict],
    member_skills: list[dict],
    required_by_ticket: dict[str, list[dict]],
    boosted_ticket_ids: set[str] | None = None,
) -> tuple[list[list[float]], list[int], list[int], list[float]]:
    """学習用の表を作る。

    戻り値: (X, y, groups, weights)
      X       … 特徴量ベクトルの並び
      y       … 正解ラベル(1=成功アサイン / 0=失敗 or 選ばれなかった候補)
      groups  … 同一チケットのペアをまとめるためのグループサイズ（ランキング学習用）
      weights … サンプル重み。自動アサインのレコメンドを採用して決めたアサイン
                (boosted_ticket_ids に含まれる)の正例は、重めに学習する。

    ★リーク防止★
      チケットを作成日時の昇順に処理し、各ペアの特徴量は「そのチケット作成時点」の
      MemberState で作る。特徴量を作った後で、そのチケットの結果を MemberState に反映する。
      この順序を逆にすると、答えを見てから予想することになる。
    """
    boosted = boosted_ticket_ids or set()
    skill_layer = {s["id"]: s["layer"] for s in skills}
    name_to_id = {p["name"]: p["id"] for p in profiles if p.get("name")}
    all_pids = [p["id"] for p in profiles]

    levels: dict[str, dict[str, int]] = {}
    for ms in member_skills:
        levels.setdefault(ms["profile_id"], {})[ms["skill_id"]] = ms["level"]

    states: dict[str, MemberState] = {pid: MemberState() for pid in all_pids}

    ordered = sorted(
        tickets,
        key=lambda t: parse_ts(t.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
    )

    X: list[list[float]] = []
    y: list[int] = []
    groups: list[int] = []
    weights: list[float] = []

    for idx, t in enumerate(ordered):
        assignee_name = t.get("assignee") or ""
        pid = name_to_id.get(assignee_name)
        status = t.get("status") or ""

        # 完了していないチケットは「結果」が無いので学習には使えない。
        # ただし現在進行中の負荷は特徴量に効くので、状態だけ更新して次へ。
        if status not in DONE_STATUSES:
            if pid and status in IN_PROGRESS_STATUSES:
                states[pid].in_progress += 1
                states[pid].in_progress_hours += float(t.get("estimated_hours") or 0)
            continue

        required = required_by_ticket.get(t["id"], [])
        # 必要スキルが付いていないチケットは、どのスキルを問う問題なのかが定義できない。
        # （過去チケットには①スキル分析がキーワードから推定して付与している）
        if not required:
            continue

        for r in required:
            r.setdefault("layer", skill_layer.get(r["skill_id"], "other"))

        # ── ここで特徴量を作る（このチケットの結果を state に入れる「前」） ──
        pairs: list[tuple[str, list[float], int]] = []

        if pid:
            label = outcome_label(t)
            pairs.append((pid, build_features(t, required, levels.get(pid, {}), states[pid]), label))

        # 負例サンプリング: そのとき選ばれなかったメンバー。
        # 「PMがこの人を選ばなかった」は弱い負のシグナルだが、
        # 必要スキルを持たない人は明確な負例になる。
        others = [q for q in all_pids if q != pid]
        # 決定的に選ぶ（学習の再現性のため乱数を使わない）: チケットIDのハッシュで回転させる
        if others:
            offset = hash(t["id"]) % len(others)
            picked = [others[(offset + i) % len(others)] for i in range(min(NEGATIVES_PER_TICKET, len(others)))]
            for q in picked:
                pairs.append((q, build_features(t, required, levels.get(q, {}), states[q]), 0))

        if len(pairs) >= 2:
            # このチケットのアサインがレコメンド採用由来なら、その正例を重めに学習する
            boost = t["id"] in boosted
            for _, feat, lab in pairs:
                X.append(feat)
                y.append(lab)
                weights.append(ACCEPTED_POSITIVE_WEIGHT if (boost and lab == 1) else 1.0)
            groups.append(len(pairs))

        # ── 特徴量を作り終えたので、このチケットの結果を state に反映する ──
        h = actual_hours(t)
        ok = is_on_time(t)
        sc = SCALE_NUM.get(t.get("dev_scale") or "", 0)
        t_layers = {r["layer"] for r in required}

        if pid:
            s = states[pid]
            s.total_done += 1
            if ok:
                s.total_on_time += 1
            s.in_progress = max(0, s.in_progress - 1)
            s.in_progress_hours = max(0.0, s.in_progress_hours - float(t.get("estimated_hours") or 0))
            for l in t_layers:
                ls = s.layer(l)
                ls.done += 1
                if h > 0:
                    ls.hours_sum += h
                    ls.hours_n += 1
                if ok:
                    ls.on_time += 1
                ls.max_scale = max(ls.max_scale, sc)

        # レビュー承認はリーダー性のシグナル（Lv4判定と同じ考え方）
        rid = name_to_id.get(t.get("reviewer_name") or "")
        if rid and t.get("review_approved_at") and rid != pid:
            for l in t_layers:
                states[rid].layer(l).reviews += 1

    return X, y, groups, weights
