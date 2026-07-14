// ENHA2-034 ①スキル自動分析
//
// チケット実績から、各メンバーのスキルとレベル(1〜4)を判定して member_skills を更新する。
// これは「集計＋ルール判定」であって機械学習ではない（学習するのは ②レコメンド = ml/train.py）。
//
// 呼ばれる経路は3つ:
//   1. 初回セットアップ … 組織の ml_setup_done が false のとき、アプリから即時実行（AM3時を待たない）
//   2. 日次cron        … 毎日 AM3:00 JST（vercel.json の crons、UTC 18:00）
//   3. 手動            … 管理者の「今すぐ再学習」ボタン
//
// 差分検知: 前回分析以降にチケットが動いていない組織はスキップする。
//   1000組織あっても、昨日チケットが動いたのは一部だけ。ここが効いて日次でも軽い。

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  SEED_SKILLS,
  detectSkillKeywords,
  ticketSearchText,
  inferSkillLevel,
  type SkillStats,
} from "../../src/app/lib/skills";

// 完了とみなすステータス（実績として数える）
const DONE_STATUSES = ["done", "closed", "released", "waiting-release"];

// 学習・分析に使う期間。古すぎる実績は今のスキルを反映しないうえ、
// データ量が無限に膨らむのを防ぐ意味もある。
const LOOKBACK_MONTHS = 18;

interface TicketRow {
  id: string;
  title: string | null;
  description: string | null;
  prefixes: string[] | null;
  status: string;
  assignee: string | null;
  reviewer_name: string | null;
  due_date: string | null;
  dev_scale: string | null;
  estimated_hours: number | null;
  actual_work_hours: number | null;
  started_at: string | null;
  released_at: string | null;
  uat_completed_at: string | null;
  stg_completed_at: string | null;
  review_approved_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** チケット1件の実績工数（h）。手入力があればそれを優先し、無ければマイルストーン差分で概算する。 */
function ticketActualHours(t: TicketRow): number {
  if (t.actual_work_hours && t.actual_work_hours > 0) return t.actual_work_hours;
  const start = t.started_at;
  const end = t.review_approved_at || t.stg_completed_at || t.uat_completed_at || t.released_at;
  if (!start || !end) return t.estimated_hours ?? 0;
  const h = (new Date(end).getTime() - new Date(start).getTime()) / 36e5;
  return h > 0 ? h : (t.estimated_hours ?? 0);
}

/** 納期内に終わったか */
function isOnTime(t: TicketRow): boolean {
  if (!t.due_date) return true;   // 期限が無いものは減点しない
  const end = t.released_at || t.uat_completed_at || t.stg_completed_at || t.review_approved_at;
  if (!end) return true;
  return new Date(end).getTime() <= new Date(t.due_date).getTime() + 24 * 36e5;
}

/**
 * 組織のスキルマスタを用意する。
 * 初期辞書(SEED_SKILLS)で過去チケットを走査し、実際にヒットしたスキルだけを登録する。
 * （辞書80個をそのまま入れると、使っていない技術まで並んで邪魔になる）
 */
async function ensureSkillMaster(sb: SupabaseClient, orgId: string, tickets: TicketRow[]) {
  const { data: existing } = await sb.from("skills").select("id, name, layer, keywords").eq("organization_id", orgId);
  if (existing && existing.length > 0) return existing;

  const corpus = tickets.map(t => ticketSearchText({
    title: t.title ?? "", description: t.description ?? "", prefixes: t.prefixes ?? [],
  })).join(" ").toLowerCase();

  const hits = SEED_SKILLS.filter(s =>
    [s.name, ...s.keywords].some(term => corpus.includes(term.toLowerCase()))
  );

  // 1件もヒットしない（＝実績が少ない/命名が独特）組織にも、最低限の器は用意しておく。
  // 手動でスキルを追加できる状態にしておくため。
  const toInsert = (hits.length > 0 ? hits : SEED_SKILLS.slice(0, 12)).map((s, i) => ({
    organization_id: orgId, layer: s.layer, name: s.name, keywords: s.keywords, sort_order: i,
  }));

  await sb.from("skills").upsert(toInsert, { onConflict: "organization_id,layer,name" });
  const { data } = await sb.from("skills").select("id, name, layer, keywords").eq("organization_id", orgId);
  return data ?? [];
}

/** 1組織を分析する */
async function analyzeOrg(sb: SupabaseClient, orgId: string, force: boolean): Promise<{
  orgId: string; skipped: boolean; members: number; skillsWritten: number;
}> {
  const { data: org } = await sb
    .from("organizations")
    .select("id, ml_last_analyzed_at")
    .eq("id", orgId)
    .maybeSingle();

  const since = new Date(Date.now() - LOOKBACK_MONTHS * 30 * 864e5).toISOString();

  // 対象チケット（この組織のプロジェクト配下、直近LOOKBACK_MONTHS）
  const { data: projects } = await sb.from("projects").select("id").eq("organization_id", orgId);
  const projectIds = (projects ?? []).map(p => p.id);
  if (projectIds.length === 0) return { orgId, skipped: true, members: 0, skillsWritten: 0 };

  const { data: sprints } = await sb.from("sprints").select("id").in("project_id", projectIds);
  const sprintIds = (sprints ?? []).map(s => s.id);
  if (sprintIds.length === 0) return { orgId, skipped: true, members: 0, skillsWritten: 0 };

  const { data: ticketsRaw } = await sb
    .from("sprint_tickets")
    .select("id, title, description, prefixes, status, assignee, reviewer_name, due_date, dev_scale, estimated_hours, actual_work_hours, started_at, released_at, uat_completed_at, stg_completed_at, review_approved_at, created_at, updated_at")
    .in("sprint_id", sprintIds)
    .gte("created_at", since);

  const tickets = (ticketsRaw ?? []) as TicketRow[];
  if (tickets.length === 0) return { orgId, skipped: true, members: 0, skillsWritten: 0 };

  // ── 差分検知 ──
  // 前回分析以降にチケットが1件も動いていなければ、分析するだけ無駄なのでスキップする。
  const lastAnalyzed = org?.ml_last_analyzed_at ? new Date(org.ml_last_analyzed_at).getTime() : 0;
  if (!force && lastAnalyzed > 0) {
    const changed = tickets.some(t => {
      const ts = new Date(t.updated_at || t.created_at || 0).getTime();
      return ts > lastAnalyzed;
    });
    if (!changed) return { orgId, skipped: true, members: 0, skillsWritten: 0 };
  }

  const skills = await ensureSkillMaster(sb, orgId, tickets);
  if (skills.length === 0) return { orgId, skipped: true, members: 0, skillsWritten: 0 };

  // ── メンバー ──
  // ★ skill_auto_update が ON のメンバーだけがスキル自動更新の対象。
  //   OFF のメンバーは手動で設定した値を守る（ただしレコメンドの対象からは外さない）。
  const { data: profiles } = await sb
    .from("profiles")
    .select("id, name, skill_auto_update")
    .eq("organization_id", orgId);

  const autoMembers = (profiles ?? []).filter(p => p.skill_auto_update !== false);
  if (autoMembers.length === 0) {
    await sb.from("organizations").update({ ml_setup_done: true, ml_last_analyzed_at: new Date().toISOString() }).eq("id", orgId);
    return { orgId, skipped: false, members: 0, skillsWritten: 0 };
  }

  // assignee は名前の文字列（UUIDではない）ので、名前 → profile の名寄せをする。
  const byName = new Map<string, { id: string; name: string }>();
  for (const p of autoMembers) if (p.name) byName.set(p.name, { id: p.id, name: p.name });

  // ── メンバー×スキルの実績を集計 ──
  const stats = new Map<string, SkillStats>();   // key: `${profileId}::${skillId}`
  const keyOf = (pid: string, sid: string) => `${pid}::${sid}`;
  const bump = (pid: string, sid: string, fn: (s: SkillStats) => void) => {
    const k = keyOf(pid, sid);
    if (!stats.has(k)) stats.set(k, { doneCount: 0, hours: [], onTimeCount: 0, reviewCount: 0, largeScaleCount: 0 });
    fn(stats.get(k)!);
  };

  for (const t of tickets) {
    if (!DONE_STATUSES.includes(t.status)) continue;

    const skillIds = detectSkillKeywords(
      ticketSearchText({ title: t.title ?? "", description: t.description ?? "", prefixes: t.prefixes ?? [] }),
      skills as { id: string; name: string; keywords: string[] }[],
    );
    if (skillIds.length === 0) continue;

    const hours = ticketActualHours(t);
    const onTime = isOnTime(t);
    const isLarge = t.dev_scale === "L" || t.dev_scale === "XL";

    // 担当者としての実績
    const assignee = t.assignee ? byName.get(t.assignee) : undefined;
    if (assignee) {
      for (const sid of skillIds) {
        bump(assignee.id, sid, s => {
          s.doneCount++;
          if (hours > 0) s.hours.push(hours);
          if (onTime) s.onTimeCount++;
          if (isLarge) s.largeScaleCount++;
        });
      }
    }

    // レビュアーとしての実績 ← Lv4(リーダークラス)判定の決め手。
    // 「他人のチケットをレビュー・承認する側にいる」は既存DBにある強力なシグナル。
    const reviewer = t.reviewer_name ? byName.get(t.reviewer_name) : undefined;
    if (reviewer && t.review_approved_at && reviewer.id !== assignee?.id) {
      for (const sid of skillIds) bump(reviewer.id, sid, s => { s.reviewCount++; });
    }
  }

  // ── レベル判定 → member_skills へ書き込み ──
  // source='manual'（人が設定した）行は上書きしない。自動判定が人の意思を潰さないため。
  const { data: manualRows } = await sb
    .from("member_skills")
    .select("profile_id, skill_id")
    .eq("source", "manual")
    .in("profile_id", autoMembers.map(m => m.id));
  const manualKeys = new Set((manualRows ?? []).map(r => keyOf(r.profile_id, r.skill_id)));

  const rows: {
    profile_id: string; skill_id: string; level: number; source: string;
    evidence: unknown; updated_at: string;
  }[] = [];
  const now = new Date().toISOString();

  for (const [k, s] of stats) {
    if (manualKeys.has(k)) continue;
    const [profileId, skillId] = k.split("::");
    const inferred = inferSkillLevel(s);
    if (!inferred) continue;
    rows.push({
      profile_id: profileId, skill_id: skillId,
      level: inferred.level, source: "auto",
      evidence: inferred.evidence, updated_at: now,
    });
  }

  if (rows.length > 0) {
    await sb.from("member_skills").upsert(rows, { onConflict: "profile_id,skill_id" });
  }

  await sb.from("organizations")
    .update({ ml_setup_done: true, ml_last_analyzed_at: now })
    .eq("id", orgId);

  return { orgId, skipped: false, members: autoMembers.length, skillsWritten: rows.length };
}

export default async function handler(req: any, res: any) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Supabase not configured" });

  // cron からの呼び出しは Vercel が Authorization: Bearer <CRON_SECRET> を付ける。
  // アプリ（初回セットアップ/手動ボタン）からは organizationId 付きで叩く。
  const cronSecret = process.env.CRON_SECRET;
  const isCron = Boolean(cronSecret) && req.headers?.authorization === `Bearer ${cronSecret}`;

  const orgId: string | undefined = req.body?.organizationId ?? req.query?.organizationId;
  const force: boolean = Boolean(req.body?.force);

  if (!isCron && !orgId) return res.status(400).json({ error: "organizationId is required" });

  const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    if (orgId) {
      const r = await analyzeOrg(sb, orgId, force);
      return res.json({ ok: true, results: [r] });
    }

    // cron: 全組織を回す。変更のない組織は差分検知でスキップされるので実質的な負荷は軽い。
    const { data: orgs } = await sb.from("organizations").select("id");
    const results = [];
    for (const o of orgs ?? []) {
      try {
        results.push(await analyzeOrg(sb, o.id, false));
      } catch (e) {
        results.push({ orgId: o.id, skipped: true, members: 0, skillsWritten: 0, error: String(e) });
      }
    }
    const analyzed = results.filter(r => !r.skipped).length;
    return res.json({ ok: true, orgs: results.length, analyzed, results });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
