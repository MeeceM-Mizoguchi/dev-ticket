// ENHA2-034 ②担当者レコメンド ─ 推論エンドポイント
//
// チケット作成/編集時に呼ばれ、候補メンバーを適任順に返す。
// 学習済みモデル（recommendation_models.is_active）があればそれを使い、
// 無ければルールベース（ベースライン）にフォールバックする。
//   → 実績が浅い組織でも初日から機能し、モデルが育ったら自動で切り替わる。

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildFeatures, scoreWithModel, baselineScore, buildReasons,
  type LgbModel, type TicketFeatureInput, type MemberFeatureInput,
} from "../../src/app/lib/recommendCore";
import type { SkillLayer } from "../../src/app/types";

const DONE_STATUSES = ["done", "closed", "released", "waiting-release"];
const IN_PROGRESS_STATUSES = ["in-progress", "in-review", "review-done", "stg-test", "uat"];
const LOOKBACK_MONTHS = 18;
const SCALE_NUM: Record<string, number> = { S: 1, M: 2, L: 3, XL: 4 };

interface TRow {
  id: string; status: string; assignee: string | null; reviewer_name: string | null;
  due_date: string | null; dev_scale: string | null;
  estimated_hours: number | null; actual_work_hours: number | null;
  started_at: string | null; released_at: string | null; uat_completed_at: string | null;
  stg_completed_at: string | null; review_approved_at: string | null;
}

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
): Promise<{ members: MemberFeatureInput[]; skillLayer: Record<string, SkillLayer>; skillName: Record<string, string> }> {
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
        .select("id, status, assignee, reviewer_name, due_date, dev_scale, estimated_hours, actual_work_hours, started_at, released_at, uat_completed_at, stg_completed_at, review_approved_at, sprint_id, category_id, title, description, prefixes")
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

  const emptyL = (): LStat => ({ doneCount: 0, hoursSum: 0, hoursN: 0, onTimeCount: 0, reviewCount: 0, maxScale: 0 });

  for (const t of tickets) {
    const pid = t.assignee ? byName.get(t.assignee) : undefined;

    if (pid && IN_PROGRESS_STATUSES.includes(t.status)) {
      const w = (workload[pid] ??= { count: 0, hours: 0 });
      w.count++; w.hours += t.estimated_hours ?? 0;
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

  return { members, skillLayer, skillName };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Supabase not configured" });

  const {
    organizationId, requiredSkillIds = [], devScale = null,
    estimatedHours = 0, priority = "medium", limit = 3,
    candidateNames,
  } = req.body ?? {};

  if (!organizationId) return res.status(400).json({ error: "organizationId is required" });

  const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    const { members, skillLayer, skillName } = await buildMemberFeatures(sb, organizationId);
    if (members.length === 0) return res.json({ candidates: [], source: "baseline" });

    // 必要スキル。{skillId, importance} でも skillId の配列でも受ける。
    const required = (requiredSkillIds as (string | { skillId: string; importance?: number })[]).map(r => {
      const skillId = typeof r === "string" ? r : r.skillId;
      const importance = typeof r === "string" ? 3 : (r.importance ?? 3);
      return { skillId, importance, layer: skillLayer[skillId] ?? ("other" as SkillLayer) };
    }).filter(r => r.skillId);

    const ticket: TicketFeatureInput = { requiredSkills: required, devScale, estimatedHours, priority };

    // プロジェクトのメンバーに絞り込む（指定があれば）
    const pool = Array.isArray(candidateNames) && candidateNames.length > 0
      ? members.filter(m => candidateNames.includes(m.name))
      : members;
    if (pool.length === 0) return res.json({ candidates: [], source: "baseline" });

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

    const scored = pool.map(m => {
      const score = model
        ? scoreWithModel(model, buildFeatures(ticket, m))
        : baselineScore(ticket, m);
      return {
        profileId: m.profileId,
        name: m.name,
        score: Math.round(score * 1000) / 1000,
        reasons: buildReasons(ticket, m, skillName),
        skillMatch: Math.round(buildFeatures(ticket, m)[0] * 1000) / 1000,
        workload: m.workload,
        source,
      };
    }).sort((a, b) => b.score - a.score).slice(0, limit);

    res.json({ candidates: scored, source, modelVersion: modelRow?.version ?? null });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
