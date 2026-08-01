// ENHA2-034 スキル関連のデータアクセス
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { mapSkill, mapMemberSkill, mapSkillUpdateRun, mapMemberSkillChange, mapMlBatchRun } from "@/app/lib/mappers";
import type { Skill, MemberSkill, SkillLayer, SkillLevel, AssigneeRecommendation, DevScale, Priority, SkillUpdateRun, MemberSkillChange, SkillRestoreChange, MlBatchRun, MlBatchTrigger } from "@/app/types";

/** 組織のスキルマスタ */
export async function fetchSkills(orgId: string): Promise<Skill[]> {
  if (!isSupabaseEnabled || !orgId) return [];
  const { data } = await supabase!
    .from("skills").select("*").eq("organization_id", orgId)
    .order("layer").order("sort_order").order("name");
  return (data ?? []).map(mapSkill);
}

/** メンバーのスキル。profileIds を省略すると全件。 */
export async function fetchMemberSkills(profileIds?: string[]): Promise<MemberSkill[]> {
  if (!isSupabaseEnabled) return [];
  let q = supabase!.from("member_skills").select("*");
  if (profileIds && profileIds.length > 0) q = q.in("profile_id", profileIds);
  const { data } = await q;
  return (data ?? []).map(mapMemberSkill);
}

/**
 * メンバーのスキルを保存する。
 * 人が編集した行は source='manual' にする → 以降、①スキル分析（自動判定）は上書きしない。
 *
 * BRU9-041: delete と upsert を別々に投げるのをやめ、RPC 1本にした。
 *   ・差分計算 / 適用 / 履歴記録 が1トランザクションで閉じる
 *     （途中で落ちて中途半端に適用される、が無くなる）
 *   ・履歴をクライアントに書かせない
 */
export async function saveMemberSkills(
  profileId: string,
  rows: { skillId: string; level: SkillLevel }[],
  removedSkillIds: string[],
  actorProfileId?: string | null,
): Promise<void> {
  if (!isSupabaseEnabled) return;
  const { error } = await supabase!.rpc("save_member_skills", {
    p_profile_id: profileId,
    p_rows: rows.map(r => ({ skillId: r.skillId, level: r.level })),
    p_removed: removedSkillIds,
    p_actor: actorProfileId ?? null,
  });
  if (error) throw new Error(error.message);
}

/**
 * 「スキル自動更新」トグル。OFFにすると①スキル分析がこのメンバーに触らなくなる。
 *
 * ★ error を必ず見て投げる ★
 *   RLS で UPDATE が弾かれても supabase-js は例外を投げず、0行更新で静かに終わる。
 *   握りつぶすと呼び出し側は成功と誤認し、メンバー一覧の10秒ポーリングが古い値を
 *   再取得してトグルが数秒後に勝手に元へ戻る（＝「トグルが効かない」の正体）。
 */
export async function setSkillAutoUpdate(profileId: string, on: boolean): Promise<void> {
  if (!isSupabaseEnabled) return;
  const { data, error } = await supabase!
    .from("profiles").update({ skill_auto_update: on }).eq("id", profileId)
    .select("id");
  if (error) throw new Error(error.message);
  // 0行 = RLS で弾かれた（エラーにはならない）。ここも失敗として扱う。
  if (!data || data.length === 0) {
    throw new Error("スキル自動更新の設定を変更する権限がありません");
  }
}

/** スキルマスタにスキルを追加し、作成された行を返す */
export async function createSkill(
  orgId: string, layer: SkillLayer, name: string, keywords: string[],
): Promise<Skill | null> {
  if (!isSupabaseEnabled) return null;
  const { data } = await supabase!.from("skills").insert({
    organization_id: orgId, layer, name, keywords, sort_order: 999,
  }).select().maybeSingle();
  return data ? mapSkill(data) : null;
}

export async function deleteSkill(skillId: string): Promise<void> {
  if (!isSupabaseEnabled) return;
  await supabase!.from("skills").delete().eq("id", skillId);
}

/** 組織の学習セットアップ状態 */
export interface OrgMlState {
  mlSetupDone: boolean;
  mlSkillsReviewed: boolean;
  mlLastAnalyzedAt: string | null;
}

export async function fetchOrgMlState(orgId: string): Promise<OrgMlState | null> {
  if (!isSupabaseEnabled || !orgId) return null;
  const { data } = await supabase!
    .from("organizations")
    .select("ml_setup_done, ml_skills_reviewed, ml_last_analyzed_at")
    .eq("id", orgId).maybeSingle();
  if (!data) return null;
  return {
    mlSetupDone: data.ml_setup_done ?? false,
    mlSkillsReviewed: data.ml_skills_reviewed ?? false,
    mlLastAnalyzedAt: data.ml_last_analyzed_at ?? null,
  };
}

export async function markSkillsReviewed(orgId: string): Promise<void> {
  if (!isSupabaseEnabled) return;
  await supabase!.from("organizations").update({ ml_skills_reviewed: true }).eq("id", orgId);
}

/** 「次回以降このお知らせを表示しない」 */
export async function dismissMlNotice(profileId: string): Promise<void> {
  if (!isSupabaseEnabled) return;
  await supabase!.from("profiles").update({ ml_notice_dismissed: true }).eq("id", profileId);
}

/**
 * ①スキル自動分析を実行する。
 * 初回セットアップ（AM3時を待たずに即実行）と、管理者の「今すぐ再分析」から呼ぶ。
 * 調査用に、止まった段階(reason)と握りつぶしていたエラー(debug)も返す。
 */
export async function runSkillAnalysis(orgId: string, force = false): Promise<{
  skillsWritten: number; reason?: string; debug?: Record<string, unknown>;
}> {
  const res = await fetch("/api/ml/analyze-skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId: orgId, force }),
  });
  if (!res.ok) throw new Error(`分析に失敗しました (${res.status})`);
  const json = await res.json();
  const first = (json.results ?? [])[0] ?? {};
  const written = (json.results ?? []).reduce((a: number, r: { skillsWritten?: number }) => a + (r.skillsWritten ?? 0), 0);
  return { skillsWritten: written, reason: first.reason, debug: first.debug };
}

// ============================================================
// BRU9-041 スキル更新の履歴・復元
// ============================================================

/** 履歴1件＝「1回の更新(run)」と、そこで起きた変更の集まり */
export interface SkillHistoryEntry {
  run: SkillUpdateRun;
  changes: MemberSkillChange[];
}

/**
 * スキル更新の履歴を新しい順に取得する。
 *   profileId を渡す … そのメンバーの変更だけ（スキル編集モーダルの「履歴」タブ）
 *   省略             … 組織全体（メンバー一覧の「スキル更新履歴」。閲覧専用）
 */
export async function fetchSkillHistory(
  orgId: string,
  opts: { profileId?: string; limit?: number } = {},
): Promise<SkillHistoryEntry[]> {
  if (!isSupabaseEnabled || !orgId) return [];
  const limit = opts.limit ?? 50;

  // 変更を先に引く。メンバー個別のときは「そのメンバーが登場する run」だけを拾いたいので、
  // run を起点にすると空振り（他人だけの run）が混ざってしまう。
  let cq = supabase!.from("member_skill_changes").select("*").eq("organization_id", orgId);
  if (opts.profileId) cq = cq.eq("profile_id", opts.profileId);
  const { data: changeRows } = await cq.order("changed_at", { ascending: false }).limit(limit * 20);

  const changes = (changeRows ?? []).map(mapMemberSkillChange);
  if (changes.length === 0) return [];

  // 登場順（＝新しい順）に run をまとめ、上位 limit 件だけ返す
  const runIds: string[] = [];
  for (const c of changes) if (!runIds.includes(c.runId)) runIds.push(c.runId);
  const targetRunIds = runIds.slice(0, limit);

  const { data: runRows } = await supabase!
    .from("skill_update_runs").select("*").in("id", targetRunIds);
  const runById = new Map((runRows ?? []).map(r => [r.id, mapSkillUpdateRun(r)]));

  return targetRunIds
    .map(id => {
      const run = runById.get(id);
      if (!run) return null;
      return { run, changes: changes.filter(c => c.runId === id) };
    })
    .filter((x): x is SkillHistoryEntry => x !== null);
}

// ============================================================
// 夜間バッチの学習ログ
// ============================================================

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
/**
 * 「その日のバッチが終わっているはずの時刻」= JST 05:00。
 *
 * GitHub の schedule は best-effort で遅れる。過去17回の実測で最大 +98分だったため、
 * cron を 01:45 JST 狙いに前倒ししたうえで、判定境界には十分な余裕を取ってある。
 * これより前は「まだ動いていないだけ」なので未実行と決めつけない。
 */
const DUE_HOUR_JST = 5;

/** ISO日時 → JSTの日付キー（YYYY-MM-DD） */
function jstDateKey(iso: string): string {
  return new Date(new Date(iso).getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 夜間バッチの実行ログを新しい順に取得する。
 *
 * ★「記録が無い日」を作って返す★
 *   バッチが起動しなければDBには何も書けない。行が無いことこそが異常なので、
 *   日付の穴を検出して result='missing' の行を合成する。
 *   これが無いと「動かなかった日」が画面から消えてしまい、監視にならない。
 */
export async function fetchMlBatchLogs(
  orgId: string,
  opts: { days?: number; trigger?: MlBatchTrigger | "all" } = {},
): Promise<MlBatchRun[]> {
  if (!isSupabaseEnabled || !orgId) return [];
  const days = opts.days ?? 30;
  const trigger = opts.trigger ?? "daily";

  const since = new Date(Date.now() - days * 864e5).toISOString();
  let q = supabase!
    .from("ml_batch_runs").select("*")
    .eq("organization_id", orgId)
    .gte("started_at", since);
  if (trigger !== "all") q = q.eq("trigger", trigger);

  const { data } = await q.order("started_at", { ascending: false }).limit(200);
  const runs = (data ?? []).map(mapMlBatchRun);

  // 「起動しなかった日」を出せるのは、毎晩動くはずの daily だけ。
  // デプロイ時・手動実行は毎日あるものではないので穴埋めしない。
  if (trigger === "deploy" || trigger === "manual") return runs;

  const daily = runs.filter(r => r.trigger === "daily");
  // ★記録が始まる前まで遡って「未実行」と言わない★
  //   この機能を入れる前の期間はログが存在しないだけで、バッチ自体は動いていた。
  //   遡って一律「バッチが起動しませんでした」と出すのは事実に反するので、
  //   最初の記録より前の日付は穴埋めの対象にしない。
  if (daily.length === 0) return runs;
  const oldestKey = daily
    .map(r => jstDateKey(r.startedAt))
    .reduce((a, b) => (a < b ? a : b));

  const seen = new Set(daily.map(r => jstDateKey(r.startedAt)));

  const now = Date.now();
  const missing: MlBatchRun[] = [];
  for (let i = 0; i < days; i++) {
    const key = new Date(now + JST_OFFSET_MS - i * 864e5).toISOString().slice(0, 10);
    if (seen.has(key) || key < oldestKey) continue;
    // その日の締め（JST 05:00）をまだ迎えていないなら、未実行と決めつけない
    const dueAt = new Date(`${key}T${String(DUE_HOUR_JST).padStart(2, "0")}:00:00+09:00`).getTime();
    if (now < dueAt) continue;
    missing.push({
      id: `missing-${key}`,
      organizationId: orgId,
      batchId: "",
      trigger: "daily",
      // 並べ替え用。画面では日付だけ出して時刻は「—」にする。
      startedAt: `${key}T00:00:00+09:00`,
      finishedAt: null,
      result: "missing",
      summary: "バッチが起動しませんでした",
      detail: {},
      skillRunId: null,
    });
  }

  return [...runs, ...missing].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/**
 * 復元のプレビュー。書き込まずに「何が変わるか」だけを返す。
 * ★ 無言で戻さない ★ 必ずこれを見せてから確定させる。
 */
export async function previewSkillRestore(
  profileId: string, at: string,
): Promise<SkillRestoreChange[]> {
  if (!isSupabaseEnabled) return [];
  const { data, error } = await supabase!.rpc("restore_member_skills", {
    p_profile_id: profileId, p_at: at, p_dry_run: true,
    p_disable_auto_update: false, p_actor: null,
  });
  if (error) throw new Error(error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data?.changes ?? []) as any[]).map(c => ({
    skillId: c.skill_id,
    changeType: c.change_type,
    oldLevel: c.old_level ?? null,
    newLevel: c.new_level ?? null,
  }));
}

/**
 * メンバーのスキルを、指定時点の状態へ戻す。
 *
 * ★ 復元は「巻き戻し」ではなく「前に進む操作」として記録される ★
 *   履歴は消えないので、復元直前の時点へもう一度復元すれば元に戻せる。
 *
 * disableAutoUpdate: 復元した行は source='auto' のまま残るため、既定でこのメンバーの
 *   スキル自動更新を OFF にする。OFF にしないと今夜の自動判定でまた上書きされうる。
 */
export async function restoreMemberSkills(params: {
  profileId: string;
  at: string;
  disableAutoUpdate: boolean;
  actorProfileId: string | null;
}): Promise<{ changed: number }> {
  if (!isSupabaseEnabled) return { changed: 0 };
  const { data, error } = await supabase!.rpc("restore_member_skills", {
    p_profile_id: params.profileId,
    p_at: params.at,
    p_disable_auto_update: params.disableAutoUpdate,
    p_actor: params.actorProfileId,
    p_dry_run: false,
  });
  if (error) throw new Error(error.message);
  return { changed: data?.changed ?? 0 };
}

/**
 * 自動アサインで「レコメンド結果からこの人に決めた」を記録する。
 * ②学習の材料になる（採用されたアサインを、次の再学習で強めに学習する）。
 * 記録失敗はアサイン操作を妨げない（fire-and-forget）。
 */
export async function logRecommendationAccepted(params: {
  organizationId: string;
  ticketId?: string | null;
  candidates: AssigneeRecommendation[];
  chosen: AssigneeRecommendation;
  source: "model" | "baseline";
}): Promise<void> {
  if (!isSupabaseEnabled) return;
  const { organizationId, ticketId, candidates, chosen, source } = params;
  try {
    await supabase!.from("recommendation_logs").insert({
      organization_id: organizationId,
      ticket_id: ticketId ?? null,
      recommended: candidates.map((c, i) => ({ rank: i + 1, profileId: c.profileId, name: c.name, score: c.score })),
      chosen_profile_id: chosen.profileId,
      was_top1: candidates[0]?.profileId === chosen.profileId,
      source,
    });
  } catch {
    /* ログ失敗は無視（アサインは成立させる） */
  }
}

/** 一括アサインの1件分の結果 */
export interface BulkRecommendResult {
  ticketId: string;
  chosen: AssigneeRecommendation | null;
  candidates: AssigneeRecommendation[];
  source: "model" | "baseline";
}

/**
 * BRU6-002-2 一括アサイン。複数チケットの推奨担当者(Top1)をまとめて取得する。
 * サーバー側で組織の特徴量を1回だけ構築し、公平分散（貪欲逐次）で割り当てる。
 */
export async function fetchBulkRecommendations(params: {
  organizationId: string;
  candidateNames?: string[];
  tickets: {
    ticketId: string;
    requiredSkillIds: { skillId: string; importance: number }[];
    devScale: DevScale | null;
    estimatedHours: number;
    priority: Priority;
    startDate?: string | null;
    dueDate?: string | null;
  }[];
}): Promise<{ results: BulkRecommendResult[]; source: "model" | "baseline" }> {
  const res = await fetch("/api/ml/recommend-bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    // サーバーは本文に実エラーを返している（{ error: ... }）。status だけでなく本文も拾って表示する。
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `一括レコメンドの取得に失敗しました (${res.status})`);
  }
  return res.json();
}

/** ②担当者レコメンド。学習済みモデルがあればそれを、無ければルールベースで返す。 */
export async function fetchRecommendations(params: {
  organizationId: string;
  requiredSkillIds: { skillId: string; importance: number }[];
  devScale: DevScale | null;
  estimatedHours: number;
  priority: Priority;
  candidateNames?: string[];
  // 開始日・期限日があれば、その期間に空いている人を優先する（サーバー側で期間重なりを判定）。
  startDate?: string | null;
  dueDate?: string | null;
  limit?: number;
}): Promise<{ candidates: AssigneeRecommendation[]; source: "model" | "baseline" }> {
  const res = await fetch("/api/ml/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`レコメンドの取得に失敗しました (${res.status})`);
  return res.json();
}
