// ENHA2-034 ②担当者レコメンド ─ 特徴量とスコアリングの共有コア
//
// 学習は Python(LightGBM) が ml/train.py で行い、学習結果を
// recommendation_models.model_json（LightGBM の dump_model() そのまま）に保存する。
// 推論はここ（TypeScript）で木を辿って行うので、実行時に Python は不要。
//
// ★重要★ FEATURE_NAMES の順序は ml/features.py と完全に一致させること。
//   ズレると、学習時と推論時で別の特徴量を見ることになり、静かに壊れる。
//
// import は相対パス（api/ 配下から読むため "@/..." エイリアスに依存させない）

import type { SkillLayer, DevScale, Priority } from "../types";

// ============================================================
// 特徴量
// ============================================================

/** ★ ml/features.py の FEATURE_NAMES と同じ順序で維持すること */
export const FEATURE_NAMES = [
  "skill_match",          // 必要スキルの充足度（importance重み付き、レベル/4）0〜1
  "skill_coverage",       // 必要スキルのうち何割を保有しているか 0〜1
  "skill_min_level",      // 必要スキルの中での最低レベル 0〜4
  "skill_gap",            // 保有していない必要スキルの数
  "domain_done_count",    // そのレイヤーの完了チケット数
  "domain_avg_hours",     // そのレイヤーの平均実績工数
  "domain_ontime_rate",   // そのレイヤーの納期遵守率
  "domain_review_count",  // そのレイヤーのレビュー承認件数（リーダー性）
  "workload",             // 現在の進行中チケット数
  "workload_hours",       // 進行中チケットの見積工数合計
  "scale_fit",            // 規模適合（本人が捌いてきた規模 vs このチケットの規模）
  "ticket_hours",         // チケットの見積工数
  "ticket_scale",         // チケットの規模（S=1,M=2,L=3,XL=4）
  "ticket_priority",      // 優先度（low=1,medium=2,high=3）
  "total_done",           // 全体の完了チケット数
  "total_ontime_rate",    // 全体の納期遵守率
] as const;

export interface TicketFeatureInput {
  requiredSkills: { skillId: string; layer: SkillLayer; importance: number }[];
  devScale: DevScale | null;
  estimatedHours: number;
  priority: Priority;
}

/** 推論時に必要な、あるメンバーの実績サマリ */
export interface MemberFeatureInput {
  profileId: string;
  name: string;
  skillLevels: Record<string, number>;          // skillId → level(1〜4)
  layerStats: Record<string, {                  // layer → 実績
    doneCount: number; avgHours: number; onTimeRate: number; reviewCount: number; maxScale: number;
  }>;
  workload: number;         // 進行中チケット数
  workloadHours: number;    // 進行中の見積工数合計
  totalDone: number;
  totalOnTimeRate: number;
}

const SCALE_NUM: Record<string, number> = { S: 1, M: 2, L: 3, XL: 4 };
const PRIORITY_NUM: Record<string, number> = { low: 1, medium: 2, high: 3 };

export function scaleToNum(s: DevScale | null | undefined): number {
  return s ? (SCALE_NUM[s] ?? 2) : 2;   // 未指定は M 相当
}

/** (チケット × メンバー) の1ペアを特徴量ベクトルにする */
export function buildFeatures(ticket: TicketFeatureInput, m: MemberFeatureInput): number[] {
  const req = ticket.requiredSkills;

  // ── スキル適合 ──
  let weighted = 0, weightSum = 0, have = 0, gap = 0;
  let minLevel = req.length > 0 ? 4 : 0;
  for (const r of req) {
    const lv = m.skillLevels[r.skillId] ?? 0;
    weighted += (lv / 4) * r.importance;
    weightSum += r.importance;
    if (lv > 0) have++; else gap++;
    if (lv < minLevel) minLevel = lv;
  }
  const skillMatch = weightSum > 0 ? weighted / weightSum : 0;
  const coverage = req.length > 0 ? have / req.length : 0;

  // ── 領域(レイヤー)実績 ──
  // 必要スキルが属するレイヤーの実績を合算する。
  const layers = Array.from(new Set(req.map(r => r.layer)));
  let doneCount = 0, hoursSum = 0, hoursN = 0, onTimeSum = 0, onTimeN = 0, reviewCount = 0, maxScale = 0;
  for (const l of layers) {
    const st = m.layerStats[l];
    if (!st) continue;
    doneCount += st.doneCount;
    if (st.avgHours > 0) { hoursSum += st.avgHours; hoursN++; }
    if (st.doneCount > 0) { onTimeSum += st.onTimeRate; onTimeN++; }
    reviewCount += st.reviewCount;
    if (st.maxScale > maxScale) maxScale = st.maxScale;
  }
  const domainAvgHours = hoursN > 0 ? hoursSum / hoursN : 0;
  const domainOnTime = onTimeN > 0 ? onTimeSum / onTimeN : 0;

  // ── 規模適合 ──
  // 本人が捌いてきた最大規模が、このチケットの規模に届いているか。
  // 届いていれば1、足りなければ不足分だけ下がる。
  const tScale = scaleToNum(ticket.devScale);
  const scaleFit = maxScale > 0 ? Math.min(1, maxScale / tScale) : 0.5;

  return [
    skillMatch,
    coverage,
    minLevel,
    gap,
    doneCount,
    domainAvgHours,
    domainOnTime,
    reviewCount,
    m.workload,
    m.workloadHours,
    scaleFit,
    ticket.estimatedHours || 0,
    tScale,
    PRIORITY_NUM[ticket.priority] ?? 2,
    m.totalDone,
    m.totalOnTimeRate,
  ];
}

// ============================================================
// LightGBM モデルのスコアリング（木を辿るだけ。実行時にPython不要）
// ============================================================

interface LgbNode {
  split_feature?: number;
  threshold?: number;
  decision_type?: string;
  default_left?: boolean;
  left_child?: LgbNode;
  right_child?: LgbNode;
  leaf_value?: number;
}
export interface LgbModel {
  feature_names?: string[];
  tree_info?: { tree_structure: LgbNode }[];
}

function walkTree(node: LgbNode, x: number[]): number {
  let n = node;
  // 葉に到達するまで下る
  while (n.leaf_value === undefined) {
    if (n.split_feature === undefined || !n.left_child || !n.right_child) return 0;
    const v = x[n.split_feature];
    const goLeft = Number.isFinite(v)
      ? v <= (n.threshold ?? 0)
      : (n.default_left ?? true);   // 欠損は default_left に従う
    n = goLeft ? n.left_child : n.right_child;
  }
  return n.leaf_value;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** 学習済みモデルで「このメンバーが成功しそうな確率」を出す */
export function scoreWithModel(model: LgbModel, features: number[]): number {
  const trees = model.tree_info ?? [];
  if (trees.length === 0) return 0;
  let raw = 0;
  for (const t of trees) raw += walkTree(t.tree_structure, features);
  return sigmoid(raw);
}

// ============================================================
// ベースライン（ルールベース）
//
// モデルが無い/未成熟な組織のフォールバック。同時に「MLが超えるべき物差し」でもある。
// 完了チケットが少ない組織はここで十分に機能する。
// ============================================================
export function baselineScore(ticket: TicketFeatureInput, m: MemberFeatureInput): number {
  const f = buildFeatures(ticket, m);
  const [skillMatch, coverage, , gap, doneCount, , domainOnTime, reviewCount, workload, , scaleFit] = f;

  // スキル適合が主軸。実績で加点し、負荷で減点する。
  const experience = Math.min(1, doneCount / 20);           // 20件で頭打ち
  const leadership = Math.min(1, reviewCount / 10);
  const reliability = domainOnTime;                          // 0〜1
  const load = 1 / (1 + workload * 0.25);                    // 抱えるほど下がる

  let score =
    (skillMatch * 0.40 + coverage * 0.15) +
    (experience * 0.15 + reliability * 0.10 + leadership * 0.05) +
    (scaleFit * 0.15);

  score *= load;

  // 必須スキルを1つも持っていない場合は明確に下げる
  if (gap > 0 && coverage === 0) score *= 0.25;

  return Math.max(0, Math.min(1, score));
}

// ============================================================
// 推薦理由（なぜこの人が推されたのかを人に見せる）
// これが無いと「AIが言うから」になって現場で信用されない。
// ============================================================
export function buildReasons(
  ticket: TicketFeatureInput,
  m: MemberFeatureInput,
  skillNames: Record<string, string>,
): string[] {
  const reasons: string[] = [];
  const req = ticket.requiredSkills;

  const held = req.filter(r => (m.skillLevels[r.skillId] ?? 0) > 0);
  if (held.length > 0) {
    const txt = held
      .map(r => `${skillNames[r.skillId] ?? "?"} Lv${m.skillLevels[r.skillId]}`)
      .join(" / ");
    reasons.push(txt);
  }

  const layers = Array.from(new Set(req.map(r => r.layer)));
  const done = layers.reduce((a, l) => a + (m.layerStats[l]?.doneCount ?? 0), 0);
  const reviews = layers.reduce((a, l) => a + (m.layerStats[l]?.reviewCount ?? 0), 0);
  if (done > 0) {
    const hoursArr = layers.map(l => m.layerStats[l]?.avgHours ?? 0).filter(h => h > 0);
    const avg = hoursArr.length ? hoursArr.reduce((a, b) => a + b, 0) / hoursArr.length : 0;
    reasons.push(avg > 0 ? `この領域 ${done}件完了・平均${avg.toFixed(1)}h` : `この領域 ${done}件完了`);
  }
  if (reviews >= 3) reasons.push(`レビュー承認 ${reviews}件（リーダー実績）`);

  const missing = req.filter(r => (m.skillLevels[r.skillId] ?? 0) === 0);
  if (missing.length > 0) {
    reasons.push(`未保有: ${missing.map(r => skillNames[r.skillId] ?? "?").join(" / ")}`);
  }

  if (m.workload === 0) reasons.push("現在の負荷: 空き");
  else if (m.workload >= 5) reasons.push(`現在の負荷: 高（進行中${m.workload}件）`);
  else reasons.push(`現在の負荷: 進行中${m.workload}件`);

  return reasons;
}
