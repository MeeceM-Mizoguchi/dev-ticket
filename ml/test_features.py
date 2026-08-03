"""ENHA2-034 ②担当者レコメンド ─ 学習パイプラインのスモークテスト

★このテストが存在する理由★
  ②モデル学習は毎晩GitHub Actionsで無人実行され、結果は翌朝アプリの「学習ログ」でしか
  分からない。実際、date型の due_date が naive datetime になる不具合で全組織の学習が
  落ちていたのに、それが発覚したのは本番の夜間バッチが動いた翌朝だった。

  ここでは DB に一切繋がずに、合成データだけで
    build_dataset → LightGBM fit → precision_at_1
  まで通す。壊れていたらPRの時点で赤くなる。

実行:
    pytest ml/            # リポジトリ直下から
    cd ml && pytest       # どちらでも動く
"""

from __future__ import annotations

import os
import re
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from features import (  # noqa: E402
    FEATURE_NAMES,
    JST,
    ON_TIME_GRACE_DAYS,
    actual_hours,
    build_dataset,
    build_features,
    completed_at,
    due_deadline,
    is_on_time,
    outcome_label,
    parse_ts,
)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ============================================================
# parse_ts ─ 「必ず aware」が守られているか
# ============================================================

def test_parse_ts_timestamptz_is_aware():
    dt = parse_ts("2026-08-15T13:00:00+00:00")
    assert dt is not None and dt.tzinfo is not None


def test_parse_ts_z_suffix():
    dt = parse_ts("2026-08-15T13:00:00Z")
    assert dt == datetime(2026, 8, 15, 13, 0, tzinfo=timezone.utc)


def test_parse_ts_date_only_is_aware():
    """★回帰テスト★ due_date は date 型なのでオフセットが付かずに返ってくる。

    ここが naive のままだと、timestamptz 由来の日時と比較した瞬間に
    「can't compare offset-naive and offset-aware datetimes」で学習全体が落ちる。
    """
    dt = parse_ts("2026-08-15")
    assert dt is not None
    assert dt.tzinfo is not None, "date型の文字列が naive のまま返っている"


def test_parse_ts_naive_datetime_object_is_aware():
    dt = parse_ts(datetime(2026, 8, 15, 13, 0))
    assert dt is not None and dt.tzinfo is not None


def test_parse_ts_invalid_and_empty():
    assert parse_ts(None) is None
    assert parse_ts("") is None
    assert parse_ts("not-a-date") is None


def test_parse_ts_results_are_comparable():
    """naive/aware が混ざらないこと（この比較が本番で TypeError を投げていた）"""
    a = parse_ts("2026-08-15")
    b = parse_ts("2026-08-15T13:00:00+00:00")
    assert (a < b) or (a >= b)   # 例外を投げないことが本題


# ============================================================
# 納期判定 ─ JSTの暦日で判定する
# ============================================================

def test_is_on_time_with_date_only_due_does_not_raise():
    """★回帰テスト★ 本番の夜間バッチが落ちていたのはこの組み合わせ"""
    t = {"due_date": "2026-08-15", "released_at": "2026-08-15T13:00:00+00:00"}
    assert is_on_time(t) is True


def test_due_deadline_is_jst_midnight_of_next_day():
    dl = due_deadline("2026-08-15")
    assert dl == datetime(2026, 8, 16, 0, 0, tzinfo=JST) + timedelta(days=ON_TIME_GRACE_DAYS)


@pytest.mark.parametrize(
    "released_jst, expected",
    [
        ("2026-08-15T09:00:00+09:00", True),    # 期限当日の朝 … セーフ
        ("2026-08-15T23:59:00+09:00", True),    # 期限当日の終わり際 … セーフ
        ("2026-08-16T00:30:00+09:00", False),   # 日付をまたいだ … アウト
        ("2026-08-20T10:00:00+09:00", False),   # 大幅遅延 … アウト
    ],
)
def test_is_on_time_jst_boundary(released_jst, expected):
    """JSTの暦日で切れているか。UTC基準だと 09:00 JST でズレて判定がおかしくなる。"""
    assert is_on_time({"due_date": "2026-08-15", "released_at": released_jst}) is expected


def test_is_on_time_without_due_or_end():
    assert is_on_time({"released_at": "2026-08-15T13:00:00+00:00"}) is True   # 期限なし
    assert is_on_time({"due_date": "2026-08-15"}) is True                     # 完了日時なし


def test_completed_at_prefers_released():
    t = {
        "released_at": "2026-08-20T00:00:00+00:00",
        "review_approved_at": "2026-08-10T00:00:00+00:00",
    }
    assert completed_at(t) == datetime(2026, 8, 20, tzinfo=timezone.utc)


# ============================================================
# 工数・ラベル
# ============================================================

def test_actual_hours_prefers_manual_input():
    assert actual_hours({"actual_work_hours": 7.5, "estimated_hours": 3}) == 7.5


def test_actual_hours_from_milestones():
    t = {
        "started_at": "2026-08-15T00:00:00+00:00",
        "review_approved_at": "2026-08-15T05:00:00+00:00",
    }
    assert actual_hours(t) == pytest.approx(5.0)


def test_actual_hours_falls_back_to_estimate():
    assert actual_hours({"estimated_hours": 4}) == 4.0


def test_outcome_label_success_and_failure():
    good = {
        "due_date": "2026-08-15",
        "released_at": "2026-08-14T10:00:00+09:00",
        "estimated_hours": 8,
        "actual_work_hours": 8,
        "review_round": 1,
        "is_operation_verified": True,
    }
    bad = {
        "due_date": "2026-08-15",
        "released_at": "2026-08-30T10:00:00+09:00",
        "estimated_hours": 8,
        "actual_work_hours": 40,
        "review_round": 5,
        "is_operation_verified": False,
    }
    assert outcome_label(good) == 1
    assert outcome_label(bad) == 0


# ============================================================
# 特徴量
# ============================================================

def test_build_features_length_matches_feature_names():
    from features import MemberState

    feat = build_features(
        {"dev_scale": "M", "estimated_hours": 8, "priority": "high"},
        [{"skill_id": "s1", "layer": "backend", "importance": 3}],
        {"s1": 3},
        MemberState(),
    )
    assert len(feat) == len(FEATURE_NAMES)
    assert all(isinstance(v, float) for v in feat)


def test_build_features_reflects_skill_level():
    from features import MemberState

    args = ({"dev_scale": "M", "estimated_hours": 8, "priority": "medium"},
            [{"skill_id": "s1", "layer": "backend", "importance": 3}])
    have = build_features(*args, {"s1": 4}, MemberState())
    none = build_features(*args, {}, MemberState())
    assert have[0] > none[0]        # skill_match
    assert have[1] == 1.0 and none[1] == 0.0   # skill_coverage
    assert have[3] == 0.0 and none[3] == 1.0   # skill_gap


# ============================================================
# 合成データでの build_dataset → 学習
# ============================================================

MEMBERS = ["綾瀬", "巴", "郁人", "千歳", "灯"]
LAYERS = ["frontend", "backend", "infra"]


def make_org(n_tickets: int = 80) -> dict:
    """DBを使わずに、1組織ぶんの学習材料を合成する。"""
    profiles = [{"id": f"p{i}", "name": name} for i, name in enumerate(MEMBERS)]
    skills = [{"id": f"s{i}", "name": f"skill{i}", "layer": LAYERS[i % len(LAYERS)]}
              for i in range(6)]

    member_skills = []
    for i, p in enumerate(profiles):
        for j, s in enumerate(skills):
            if (i + j) % 2 == 0:
                member_skills.append({"profile_id": p["id"], "skill_id": s["id"],
                                      "level": 1 + (i + j) % 4})

    base = datetime(2026, 1, 5, 9, 0, tzinfo=JST)
    tickets, required = [], {}
    for i in range(n_tickets):
        created = base + timedelta(days=i)
        due = (created + timedelta(days=5)).date().isoformat()
        # 3件に1件は遅延・手戻りありにして、正例/負例の両方を作る
        late = i % 3 == 0
        end = created + timedelta(days=9 if late else 4)
        tid = f"t{i}"
        tickets.append({
            "id": tid,
            "status": "released",
            "assignee": MEMBERS[i % len(MEMBERS)],
            "reviewer_name": MEMBERS[(i + 1) % len(MEMBERS)],
            "review_round": 4 if late else 1,
            "due_date": due,                       # ★date型なので時刻もオフセットも無い
            "dev_scale": ["S", "M", "L", "XL"][i % 4],
            "priority": ["low", "medium", "high"][i % 3],
            "estimated_hours": 8,
            "actual_work_hours": 24 if late else 8,
            "is_operation_verified": not late,
            "created_at": created.isoformat(),
            "started_at": created.isoformat(),
            "released_at": end.isoformat(),
            "review_approved_at": end.isoformat(),
            "updated_at": end.isoformat(),
        })
        required[tid] = [{"skill_id": f"s{i % 6}", "importance": 3},
                         {"skill_id": f"s{(i + 1) % 6}", "importance": 2}]

    return {"tickets": tickets, "profiles": profiles, "skills": skills,
            "member_skills": member_skills, "required": required}


def build(org: dict, boosted=None):
    return build_dataset(org["tickets"], org["profiles"], org["skills"],
                         org["member_skills"], org["required"], boosted_ticket_ids=boosted)


def test_build_dataset_smoke():
    """★これが本丸★ date型の due_date を含む完了チケットで学習データが組めること"""
    X, y, groups, w = build(make_org())

    assert len(X) > 0, "学習データが1行も作れていない"
    assert len(X) == len(y) == len(w) == sum(groups)
    assert all(len(row) == len(FEATURE_NAMES) for row in X)
    assert set(y) == {0, 1}, "正例/負例の両方が必要（片方だけだと学習できない）"


def test_build_dataset_is_deterministic():
    """負例サンプリングに乱数を使っていないこと（crc32で回している）"""
    a = build(make_org())
    b = build(make_org())
    assert a == b


def test_build_dataset_no_leakage_on_first_ticket():
    """1件目のペアは実績ゼロのはず（そのチケットの結果を先に state へ入れていないか）"""
    X, _, groups, _ = build(make_org())
    first = X[: groups[0]]
    for row in first:
        assert row[FEATURE_NAMES.index("total_done")] == 0.0
        assert row[FEATURE_NAMES.index("domain_done_count")] == 0.0


def test_build_dataset_skips_tickets_without_required_skills():
    org = make_org()
    org["required"] = {}
    X, y, groups, _ = build(org)
    assert X == [] and y == [] and groups == []


def test_boosted_positive_gets_extra_weight():
    org = make_org()
    boosted = {"t1"}
    _, y, _, w = build(org, boosted=boosted)
    _, _, _, w_plain = build(org)
    assert sum(w) > sum(w_plain)
    assert max(w) == 2.0
    # 重みが付くのは正例だけ
    assert all(wi == 1.0 for wi, yi in zip(w, y) if yi == 0)


def test_train_end_to_end():
    """LightGBM の fit → 評価まで到達すること。

    ライブラリのAPI変更（sklearnラッパの引数削除など）で夜間バッチだけが落ちる、
    という事故をここで先に検出する。
    """
    np = pytest.importorskip("numpy")
    pytest.importorskip("supabase")     # train.py が import している
    try:
        import lightgbm as lgb
    except Exception as e:  # macOS で libomp が無い等（CIのubuntuでは必ず動く）
        pytest.skip(f"lightgbm を読み込めない環境のためスキップ: {e}")
    from train import baseline_score, precision_at_1

    X, y, groups, w = build(make_org(120))
    Xa = np.array(X, dtype=np.float64)
    ya = np.array(y, dtype=np.int32)
    wa = np.array(w, dtype=np.float64)

    cut_group = int(len(groups) * 0.8)
    cut_row = sum(groups[:cut_group])
    assert cut_group >= 5 and 50 <= cut_row < len(Xa)

    model = lgb.LGBMClassifier(
        objective="binary", n_estimators=50, learning_rate=0.05,
        num_leaves=15, min_child_samples=10, verbose=-1,
    )
    model.fit(Xa[:cut_row], ya[:cut_row], sample_weight=wa[:cut_row], feature_name=FEATURE_NAMES)

    scores = model.predict_proba(Xa[cut_row:])[:, 1]
    p1 = precision_at_1(scores, ya[cut_row:], groups[cut_group:])
    assert 0.0 <= p1 <= 1.0

    base = np.array([baseline_score(list(r)) for r in Xa[cut_row:]])
    assert 0.0 <= precision_at_1(base, ya[cut_row:], groups[cut_group:]) <= 1.0

    # モデルをDBに入れる形（JSON）まで通ること
    import json
    dump = json.loads(json.dumps(model.booster_.dump_model()))
    assert dump["feature_names"] == FEATURE_NAMES


# ============================================================
# 学習(Python)と推論(TypeScript)の定義ズレ検出
#
# 3箇所に同じロジックが複製されている（Vercelのサーバー関数が src/ を同梱できないため）。
# 片方だけ直して静かに壊れるのを防ぐ。
# ============================================================

def read_repo_file(rel: str) -> str:
    with open(os.path.join(REPO_ROOT, rel), encoding="utf-8") as f:
        return f.read()


def test_feature_names_match_typescript():
    src = read_repo_file("src/app/lib/recommendCore.ts")
    block = re.search(r"export const FEATURE_NAMES = \[(.*?)\] as const;", src, re.S)
    assert block, "recommendCore.ts の FEATURE_NAMES が見つからない"
    ts_names = re.findall(r'"([a-z_]+)"', block.group(1))
    assert ts_names == FEATURE_NAMES, "特徴量の順序が features.py と recommendCore.ts でズレている"


@pytest.mark.parametrize("path", ["api/ml/recommend.ts", "api/ml/analyze-skills.ts"])
def test_on_time_definition_matches_typescript(path):
    src = read_repo_file(path)
    assert "T00:00:00+09:00" in src, f"{path} の納期判定がJST基準になっていない"
    m = re.search(r"const ON_TIME_GRACE_DAYS = (\d+);", src)
    assert m, f"{path} に ON_TIME_GRACE_DAYS が無い"
    assert int(m.group(1)) == ON_TIME_GRACE_DAYS, (
        f"{path} の猶予日数が features.py と違う"
    )
