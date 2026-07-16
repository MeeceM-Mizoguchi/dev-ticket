// ENHA2-034 ②担当者レコメンド ─ 推論エンドポイント
//
// チケット作成/編集時に呼ばれ、候補メンバーを適任順に返す。
// 学習済みモデル（recommendation_models.is_active）があればそれを使い、
// 無ければルールベース（ベースライン）にフォールバックする。
//   → 実績が浅い組織でも初日から機能し、モデルが育ったら自動で切り替わる。

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// ★ここは src/app/lib/recommendCore.ts の内容を「そのまま複製」したもの ★
//
// Vercel のサーバー関数(api/配下)は src/ フォルダを同梱しないため、
// src から import するとデプロイ後に ERR_MODULE_NOT_FOUND でクラッシュする。
// そのため必要なロジックをこのファイル内に自己完結で持たせている。
//
// ⚠️ src/app/lib/recommendCore.ts と ml/features.py を変更したら、ここも合わせること。
//    特に FEATURE_NAMES の順序は3箇所すべてで一致させること。
// ============================================================
type SkillLayer = string;
type Priority = "low" | "medium" | "high";
type DevScale = "S" | "M" | "L" | "XL";

interface TicketFeatureInput {
  requiredSkills: { skillId: string; layer: SkillLayer; importance: number }[];
  devScale: DevScale | null;
  estimatedHours: number;
  priority: Priority;
}
interface MemberFeatureInput {
  profileId: string;
  name: string;
  skillLevels: Record<string, number>;
  layerStats: Record<string, {
    doneCount: number; avgHours: number; onTimeRate: number; reviewCount: number; maxScale: number;
  }>;
  workload: number;
  workloadHours: number;
  totalDone: number;
  totalOnTimeRate: number;
}

const SCALE_NUM_F: Record<string, number> = { S: 1, M: 2, L: 3, XL: 4 };
const PRIORITY_NUM: Record<string, number> = { low: 1, medium: 2, high: 3 };
function scaleToNum(s: DevScale | null | undefined): number {
  return s ? (SCALE_NUM_F[s] ?? 2) : 2;
}

function buildFeatures(ticket: TicketFeatureInput, m: MemberFeatureInput): number[] {
  const req = ticket.requiredSkills;
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

  const tScale = scaleToNum(ticket.devScale);
  const scaleFit = maxScale > 0 ? Math.min(1, maxScale / tScale) : 0.5;

  return [
    skillMatch, coverage, minLevel, gap,
    doneCount, domainAvgHours, domainOnTime, reviewCount,
    m.workload, m.workloadHours, scaleFit,
    ticket.estimatedHours || 0, tScale, PRIORITY_NUM[ticket.priority] ?? 2,
    m.totalDone, m.totalOnTimeRate,
  ];
}

interface LgbNode {
  split_feature?: number; threshold?: number; decision_type?: string;
  default_left?: boolean; left_child?: LgbNode; right_child?: LgbNode; leaf_value?: number;
}
interface LgbModel {
  feature_names?: string[];
  tree_info?: { tree_structure: LgbNode }[];
}
function walkTree(node: LgbNode, x: number[]): number {
  let n = node;
  while (n.leaf_value === undefined) {
    if (n.split_feature === undefined || !n.left_child || !n.right_child) return 0;
    const v = x[n.split_feature];
    const goLeft = Number.isFinite(v) ? v <= (n.threshold ?? 0) : (n.default_left ?? true);
    n = goLeft ? n.left_child : n.right_child;
  }
  return n.leaf_value;
}
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
function scoreWithModel(model: LgbModel, features: number[]): number {
  const trees = model.tree_info ?? [];
  if (trees.length === 0) return 0;
  let raw = 0;
  for (const t of trees) raw += walkTree(t.tree_structure, features);
  return sigmoid(raw);
}

function baselineScore(ticket: TicketFeatureInput, m: MemberFeatureInput): number {
  const f = buildFeatures(ticket, m);
  const [skillMatch, coverage, , gap, doneCount, , domainOnTime, reviewCount, workload, , scaleFit] = f;
  const experience = Math.min(1, doneCount / 20);
  const leadership = Math.min(1, reviewCount / 10);
  const reliability = domainOnTime;
  const load = 1 / (1 + workload * 0.25);
  let score =
    (skillMatch * 0.40 + coverage * 0.15) +
    (experience * 0.15 + reliability * 0.10 + leadership * 0.05) +
    (scaleFit * 0.15);
  score *= load;
  if (gap > 0 && coverage === 0) score *= 0.25;
  return Math.max(0, Math.min(1, score));
}

function buildReasons(
  ticket: TicketFeatureInput, m: MemberFeatureInput, skillNames: Record<string, string>, activeCount: number,
): string[] {
  const reasons: string[] = [];
  const req = ticket.requiredSkills;
  const held = req.filter(r => (m.skillLevels[r.skillId] ?? 0) > 0);
  if (held.length > 0) {
    reasons.push(held.map(r => `${skillNames[r.skillId] ?? "?"} Lv${m.skillLevels[r.skillId]}`).join(" / "));
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
  if (missing.length > 0) reasons.push(`未保有: ${missing.map(r => skillNames[r.skillId] ?? "?").join(" / ")}`);
  if (activeCount === 0) reasons.push("現在の負荷: 空き");
  else if (activeCount >= 5) reasons.push(`現在の負荷: 高（稼働中${activeCount}件）`);
  else reasons.push(`現在の負荷: 稼働中${activeCount}件`);
  return reasons;
}
// ============================================================
// 複製ここまで
// ============================================================

const DONE_STATUSES = ["done", "closed", "released", "waiting-release"];
const IN_PROGRESS_STATUSES = ["in-progress", "in-review", "review-done", "stg-test", "uat"];
// 「稼働中」= アサインされて動き出し可能 or 作業途中。クローズ/完了/リリース待ちは除外、未着手(todo)は含める。
// さらに保留(progress=-1)/取下(progress=-2)は下の集計で除外する。削除は行ごと消えるので自然に対象外。
const ACTIVE_STATUSES = ["todo", "in-progress", "in-review", "review-done", "stg-test", "uat"];
// 相対キャップ: 有資格者の中で稼働中が最少の人を基準に、+この件数を超える人は推薦対象から外す。
const CAP_MARGIN = 5;
// スキルゲート（規模別）: 必須スキルをこのLv以上で保有していないと候補にしない。
const GATE_LEVEL: Record<string, number> = { S: 1, M: 1, L: 2, XL: 3 };
const LOOKBACK_MONTHS = 18;
const SCALE_NUM: Record<string, number> = { S: 1, M: 2, L: 3, XL: 4 };

interface TRow {
  id: string; status: string; assignee: string | null; reviewer_name: string | null;
  due_date: string | null; start_date: string | null; dev_scale: string | null;
  progress: number | null; created_at: string | null;
  estimated_hours: number | null; actual_work_hours: number | null;
  started_at: string | null; released_at: string | null; uat_completed_at: string | null;
  stg_completed_at: string | null; review_approved_at: string | null;
}

// メンバーごとの空き状況。稼働中件数・稼働中チケットの期間・最終アサイン日。
type MemberAvail = { activeCount: number; ranges: { start: string | null; due: string | null }[]; lastAssignedAt: string | null };
type AvailInfo = Record<string, MemberAvail>;

function actualHours(t: TRow): number {
  if (t.actual_work_hours && t.actual_work_hours > 0) return t.actual_work_hours;
  const end = t.review_approved_at || t.stg_completed_at || t.uat_completed_at || t.released_at;
  if (!t.started_at || !end) return t.estimated_hours ?? 0;
  const h = (new Date(end).getTime() - new Date(t.started_at).getTime()) / 36e5;
  return h > 0 ? h : (t.estimated_hours ?? 0);
}
function onTime(t: TRow): boolean {
  if (!t.due_date) return true;
  const end = t.released_at || t.uat_completed_at || t.stg_completed_at || t.review_approved_at;
  if (!end) return true;
  return new Date(end).getTime() <= new Date(t.due_date).getTime() + 24 * 36e5;
}

/**
 * 組織の全メンバーについて、推論に必要な実績サマリを組み立てる。
 * ※ skill_auto_update が OFF のメンバーも候補に含める。
 *   トグルが止めるのは「①スキルの自動更新」だけで、②レコメンドの対象からは外さない。
 */
async function buildMemberFeatures(
  sb: SupabaseClient, orgId: string,
): Promise<{ members: MemberFeatureInput[]; skillLayer: Record<string, SkillLayer>; skillName: Record<string, string>; avail: AvailInfo }> {
  const [{ data: profiles }, { data: skills }, { data: memberSkills }] = await Promise.all([
    sb.from("profiles").select("id, name, status").eq("organization_id", orgId),
    sb.from("skills").select("id, name, layer").eq("organization_id", orgId),
    sb.from("member_skills").select("profile_id, skill_id, level"),
  ]);

  const skillLayer: Record<string, SkillLayer> = {};
  const skillName: Record<string, string> = {};
  for (const s of skills ?? []) { skillLayer[s.id] = s.layer as SkillLayer; skillName[s.id] = s.name; }

  const levelsByProfile: Record<string, Record<string, number>> = {};
  for (const ms of memberSkills ?? []) {
    (levelsByProfile[ms.profile_id] ??= {})[ms.skill_id] = ms.level;
  }

  // 組織のチケットを一括で引く
  const { data: projects } = await sb.from("projects").select("id").eq("organization_id", orgId);
  const projectIds = (projects ?? []).map(p => p.id);
  const { data: sprints } = projectIds.length
    ? await sb.from("sprints").select("id").in("project_id", projectIds)
    : { data: [] as { id: string }[] };
  const sprintIds = (sprints ?? []).map(s => s.id);

  const since = new Date(Date.now() - LOOKBACK_MONTHS * 30 * 864e5).toISOString();
  const { data: ticketsRaw } = sprintIds.length
    ? await sb.from("sprint_tickets")
        .select("id, status, assignee, reviewer_name, due_date, start_date, dev_scale, progress, created_at, estimated_hours, actual_work_hours, started_at, released_at, uat_completed_at, stg_completed_at, review_approved_at, sprint_id, category_id, title, description, prefixes")
        .in("sprint_id", sprintIds).gte("created_at", since)
    : { data: [] as TRow[] };
  const tickets = (ticketsRaw ?? []) as unknown as TRow[];

  // 名前 → profile の名寄せ（assignee は名前の文字列で持たれている）
  const active = (profiles ?? []).filter(p => p.status !== "inactive");
  const byName = new Map<string, string>();
  for (const p of active) if (p.name) byName.set(p.name, p.id);

  // レイヤー別の実績を集計。チケットが属するレイヤーは、そのメンバーが持つスキルではなく
  // チケット側の必要スキル（無ければ全レイヤー）で決めるべきだが、過去チケットには
  // 必要スキルが付いていないため、担当者のスキルが属するレイヤーに寄せて集計する。
  type LStat = { doneCount: number; hoursSum: number; hoursN: number; onTimeCount: number; reviewCount: number; maxScale: number };
  const layerStats: Record<string, Record<string, LStat>> = {};   // profileId → layer → stat
  const totals: Record<string, { done: number; onTime: number }> = {};
  const workload: Record<string, { count: number; hours: number }> = {};
  const avail: AvailInfo = {};

  const emptyL = (): LStat => ({ doneCount: 0, hoursSum: 0, hoursN: 0, onTimeCount: 0, reviewCount: 0, maxScale: 0 });

  for (const t of tickets) {
    const pid = t.assignee ? byName.get(t.assignee) : undefined;

    if (pid && IN_PROGRESS_STATUSES.includes(t.status)) {
      const w = (workload[pid] ??= { count: 0, hours: 0 });
      w.count++; w.hours += t.estimated_hours ?? 0;
    }

    // 稼働中(=未着手〜作業途中、クローズ/完了/保留/取下は除く)の件数・期間・最終アサイン日を集計
    if (pid) {
      const av = (avail[pid] ??= { activeCount: 0, ranges: [], lastAssignedAt: null });
      if (t.created_at && (!av.lastAssignedAt || t.created_at > av.lastAssignedAt)) av.lastAssignedAt = t.created_at;
      if (ACTIVE_STATUSES.includes(t.status) && t.progress !== -1 && t.progress !== -2) {
        av.activeCount++;
        av.ranges.push({ start: t.start_date, due: t.due_date });
      }
    }

    if (!DONE_STATUSES.includes(t.status)) continue;

    const h = actualHours(t);
    const ok = onTime(t);
    const sc = t.dev_scale ? (SCALE_NUM[t.dev_scale] ?? 0) : 0;

    if (pid) {
      const tt = (totals[pid] ??= { done: 0, onTime: 0 });
      tt.done++; if (ok) tt.onTime++;

      // 担当者が保有するスキルのレイヤーに実績を計上する
      const held = levelsByProfile[pid] ?? {};
      const layers = new Set(Object.keys(held).map(sid => skillLayer[sid]).filter(Boolean));
      for (const l of layers) {
        const st = ((layerStats[pid] ??= {})[l] ??= emptyL());
        st.doneCount++;
        if (h > 0) { st.hoursSum += h; st.hoursN++; }
        if (ok) st.onTimeCount++;
        if (sc > st.maxScale) st.maxScale = sc;
      }
    }

    // レビュー承認はリーダー性のシグナル
    const rid = t.reviewer_name ? byName.get(t.reviewer_name) : undefined;
    if (rid && t.review_approved_at && rid !== pid) {
      const held = levelsByProfile[rid] ?? {};
      const layers = new Set(Object.keys(held).map(sid => skillLayer[sid]).filter(Boolean));
      for (const l of layers) {
        const st = ((layerStats[rid] ??= {})[l] ??= emptyL());
        st.reviewCount++;
      }
    }
  }

  const members: MemberFeatureInput[] = active.map(p => {
    const ls = layerStats[p.id] ?? {};
    const tot = totals[p.id] ?? { done: 0, onTime: 0 };
    const w = workload[p.id] ?? { count: 0, hours: 0 };
    return {
      profileId: p.id,
      name: p.name,
      skillLevels: levelsByProfile[p.id] ?? {},
      layerStats: Object.fromEntries(Object.entries(ls).map(([l, s]) => [l, {
        doneCount: s.doneCount,
        avgHours: s.hoursN > 0 ? s.hoursSum / s.hoursN : 0,
        onTimeRate: s.doneCount > 0 ? s.onTimeCount / s.doneCount : 0,
        reviewCount: s.reviewCount,
        maxScale: s.maxScale,
      }])),
      workload: w.count,
      workloadHours: w.hours,
      totalDone: tot.done,
      totalOnTimeRate: tot.done > 0 ? tot.onTime / tot.done : 0,
    };
  });

  return { members, skillLayer, skillName, avail };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Supabase not configured" });

  const {
    organizationId, requiredSkillIds = [], devScale = null,
    estimatedHours = 0, priority = "medium", limit = 3,
    candidateNames, startDate = null, dueDate = null,
  } = req.body ?? {};

  if (!organizationId) return res.status(400).json({ error: "organizationId is required" });

  const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    const { members, skillLayer, skillName, avail } = await buildMemberFeatures(sb, organizationId);
    if (members.length === 0) return res.json({ candidates: [], source: "baseline" });

    // 必要スキル。{skillId, importance} でも skillId の配列でも受ける。
    const required = (requiredSkillIds as (string | { skillId: string; importance?: number })[]).map(r => {
      const skillId = typeof r === "string" ? r : r.skillId;
      const importance = typeof r === "string" ? 3 : (r.importance ?? 3);
      return { skillId, importance, layer: skillLayer[skillId] ?? ("other" as SkillLayer) };
    }).filter(r => r.skillId);

    const ticket: TicketFeatureInput = { requiredSkills: required, devScale, estimatedHours, priority };

    // プロジェクトのメンバーに絞り込む（指定があれば）
    const basePool = Array.isArray(candidateNames) && candidateNames.length > 0
      ? members.filter(m => candidateNames.includes(m.name))
      : members;
    if (basePool.length === 0) return res.json({ candidates: [], source: "baseline" });

    // ── Step0: スキルゲート（規模で可変）── 必須スキルを最低Lv以上で保有する人だけ候補にする。
    //   0人なら1段ずつ緩め、Lv1でも0なら（誰も保有せず）足切りせず全員を候補にする。
    const mustSkills = required.filter(r => r.importance >= 3);
    const passesGate = (m: MemberFeatureInput, minLv: number) =>
      mustSkills.every(r => (m.skillLevels[r.skillId] ?? 0) >= minLv);
    let qualified = basePool;
    if (mustSkills.length > 0) {
      let lv = GATE_LEVEL[devScale ?? "M"] ?? 1;
      qualified = basePool.filter(m => passesGate(m, lv));
      while (qualified.length === 0 && lv > 1) { lv -= 1; qualified = basePool.filter(m => passesGate(m, lv)); }
      if (qualified.length === 0) qualified = basePool;
    }

    // ── Step1: 相対キャップ（集中防止①）── 稼働中が最少の人 + CAP_MARGIN を超える人を外す。
    //   除外後にlimit未満なら緩める（有資格者を全員残す）。
    const activeOf = (m: MemberFeatureInput) => avail[m.profileId]?.activeCount ?? 0;
    let recommendable = qualified;
    if (qualified.length > 0) {
      const minActive = Math.min(...qualified.map(activeOf));
      const capped = qualified.filter(m => activeOf(m) <= minActive + CAP_MARGIN);
      recommendable = capped.length >= Math.min(limit, qualified.length) ? capped : qualified;
    }

    // ── Step2: 空き順ソート（先頭=推奨）──
    const hasDates = typeof startDate === "string" && startDate !== "" && typeof dueDate === "string" && dueDate !== "";
    const overlapOf = (m: MemberFeatureInput): number => {
      if (!hasDates) return 0;
      let n = 0;
      for (const r of avail[m.profileId]?.ranges ?? []) {
        if (r.start && r.due && r.start <= dueDate && startDate <= r.due) n++;   // 期間の重なり
      }
      return n;
    };
    const skillSum = (m: MemberFeatureInput) => mustSkills.reduce((a, r) => a + (m.skillLevels[r.skillId] ?? 0), 0);
    const lastMs = (m: MemberFeatureInput) => {
      const s = avail[m.profileId]?.lastAssignedAt;
      return s ? new Date(s).getTime() : 0;   // 未アサイン=最古=ローテーション最優先
    };
    const ranked = recommendable.slice().sort((a, b) =>
      (overlapOf(a) - overlapOf(b)) ||          // ①期間の重なりが少ない順
      (activeOf(a) - activeOf(b)) ||            // ②稼働中が少ない順
      (lastMs(a) - lastMs(b)) ||                // ③最終アサインが古い順（ローテーション・控えめ）
      (skillSum(b) - skillSum(a)),              // ④スキルレベル合計が高い順（品質タイブレーク）
    );

    // 学習済みモデル（オフライン評価でベースラインを超えたものだけ is_active=true）
    const { data: modelRow } = await sb
      .from("recommendation_models")
      .select("model_json, version")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const model = modelRow?.model_json as LgbModel | undefined;
    const source: "model" | "baseline" = model ? "model" : "baseline";

    // 「もっと見る」で有資格者全員を出せるよう、上位limitで切らず多めに返す（表示はフロントで制御）。
    const MAX_RETURN = 30;
    const candidates = ranked.slice(0, MAX_RETURN).map(m => {
      const active = activeOf(m);
      return {
        profileId: m.profileId,
        name: m.name,
        score: Math.round((model ? scoreWithModel(model, buildFeatures(ticket, m)) : baselineScore(ticket, m)) * 1000) / 1000,
        reasons: buildReasons(ticket, m, skillName, active),
        skillMatch: Math.round(buildFeatures(ticket, m)[0] * 1000) / 1000,
        workload: m.workload,
        activeCount: active,
        source,
      };
    });

    res.json({ candidates, source, modelVersion: modelRow?.version ?? null });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
