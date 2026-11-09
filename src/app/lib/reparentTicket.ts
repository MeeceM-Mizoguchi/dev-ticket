// BRU25-005 子チケットを別の親チケットへ移す／単独の親チケットにする
//
// 採番の考え方は既存の処理にそろえる。
//   ・別の親の子にする … 移した先の親の子の、一番大きい枝番 +1（NewTicketDialog の子の採番と同じ。枝番はゼロ埋めしない）
//   ・単独の親にする   … 今のスプリントのまま、スプリント移動（bulkMoveTickets）と同じ方法で親の WBS を振る
// ステータス・実績・コメント・添付・PRの紐づけ・担当者は、チケットの ID で持っているので、そのまま残る。
// 元の親・移した先の親のステータスは変えない。

import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { TicketStatus } from "@/app/types";

export interface ParentCandidate {
  id: string;
  wbs: string;
  title: string;
  sprintId: string;
  sprintName: string;
  status: TicketStatus;
}

/** 候補の件数の上限 */
export const PARENT_CANDIDATE_LIMIT = 50;

/**
 * 移し先の親チケットを探す。プロジェクトのすべてのスプリントの親チケット（parent_id が空）を、
 * WBS・タイトル・本文の部分一致で引く。本文は HTML のまま引くので、タグをまたぐ文言は当たらないことがある。
 * @param excludeIds 候補に出さないチケット（今の親）
 */
export async function searchParentCandidates(params: {
  projectId: string;
  query: string;
  excludeIds: string[];
}): Promise<ParentCandidate[]> {
  const { projectId, query, excludeIds } = params;
  if (!isSupabaseEnabled || !projectId) return [];

  const { data: sprintRows, error: sErr } = await supabase!
    .from("sprints").select("id, name").eq("project_id", projectId);
  if (sErr) throw new Error(sErr.message);
  const sprintName = new Map((sprintRows ?? []).map(s => [s.id as string, (s.name as string) ?? ""]));
  const sprintIds = Array.from(sprintName.keys());
  if (sprintIds.length === 0) return [];

  let q = supabase!
    .from("sprint_tickets")
    .select("id, wbs, title, sprint_id, status")
    .in("sprint_id", sprintIds)
    .is("parent_id", null);
  // or() の区切り（, ( )）やワイルドカード（% *）は検索語から外す
  const term = query.replace(/[,()"\\%*:]/g, " ").trim();
  if (term) q = q.or(`wbs.ilike.%${term}%,title.ilike.%${term}%,description.ilike.%${term}%`);
  if (excludeIds.length > 0) q = q.not("id", "in", `(${excludeIds.join(",")})`);
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PARENT_CANDIDATE_LIMIT);
  if (error) throw new Error(error.message);

  return (data ?? []).map(r => ({
    id: r.id as string,
    wbs: (r.wbs as string) ?? "",
    title: (r.title as string) ?? "",
    sprintId: r.sprint_id as string,
    sprintName: sprintName.get(r.sprint_id as string) ?? "",
    status: r.status as TicketStatus,
  }));
}

/** 移した先の親の子の、一番大きい枝番 +1 で子の WBS を決める */
async function nextChildWbs(parentId: string, parentWbs: string): Promise<string> {
  const { data, error } = await supabase!
    .from("sprint_tickets").select("wbs").eq("parent_id", parentId).like("wbs", `${parentWbs}-%`);
  if (error) throw new Error(error.message);
  // 枝番はゼロ埋めしていないので、文字列ではなく数値で比べる（BRU4-058）
  const max = (data ?? []).reduce((m, row) => {
    const n = parseInt(String(row.wbs).slice(parentWbs.length + 1), 10);
    return Number.isNaN(n) ? m : Math.max(m, n);
  }, 0);
  return `${parentWbs}-${max + 1}`;
}

/** 今のスプリントで、親チケットとしての次の WBS を決める（スプリント移動と同じ採番） */
async function nextRootWbs(projectId: string, sprintId: string): Promise<string> {
  const [{ data: sprintRows }, { data: projectRow }, { data: sprintRow }] = await Promise.all([
    supabase!.from("sprints").select("id").eq("project_id", projectId),
    supabase!.from("projects").select("wbs_prefix").eq("id", projectId).single(),
    supabase!.from("sprints").select("identifier").eq("id", sprintId).single(),
  ]);
  const sprintIds = (sprintRows ?? []).map(s => s.id);
  const prefix = sprintRow?.identifier || projectRow?.wbs_prefix || "T";
  let nextNum = 1;
  if (sprintIds.length > 0) {
    const { data: maxRow } = await supabase!
      .from("sprint_tickets")
      .select("wbs")
      .in("sprint_id", sprintIds)
      .like("wbs", `${prefix}-%`)
      .not("wbs", "like", `${prefix}-%-_%`)   // 子チケット(接尾辞付き)を除外し親の最大番号を取る
      .order("wbs", { ascending: false })
      .limit(1)
      .maybeSingle();
    nextNum = (parseInt(maxRow?.wbs?.slice(prefix.length + 1) ?? "0", 10) || 0) + 1;
  }
  return `${prefix}-${String(nextNum).padStart(3, "0")}`;
}

interface TicketRow { id: string; wbs: string; title: string; sprint_id: string; parent_id: string | null; status: TicketStatus }

async function fetchRow(id: string): Promise<TicketRow> {
  const { data, error } = await supabase!
    .from("sprint_tickets").select("id, wbs, title, sprint_id, parent_id, status").eq("id", id).single();
  if (error || !data) throw new Error(error?.message ?? "チケットが見つかりません");
  return data as TicketRow;
}

export interface ReparentPlan {
  oldWbs: string;
  newWbs: string;
  /** 移したあとのスプリント */
  targetSprintId: string;
}

/** 確認に出す「移したあとの WBS」を求める（まだ何も変えない） */
export async function planReparent(params: { ticketId: string; targetParentId: string | null; projectId: string }): Promise<ReparentPlan> {
  const { ticketId, targetParentId, projectId } = params;
  const self = await fetchRow(ticketId);
  if (targetParentId) {
    const target = await fetchRow(targetParentId);
    return { oldWbs: self.wbs, newWbs: await nextChildWbs(target.id, target.wbs), targetSprintId: target.sprint_id };
  }
  return { oldWbs: self.wbs, newWbs: await nextRootWbs(projectId, self.sprint_id), targetSprintId: self.sprint_id };
}

/**
 * 移す。チケットの1行の parent_id・wbs・sprint_id を1回の更新でまとめて変え、
 * 移したチケット・元の親・移した先の親のコメント欄に記録を残す。
 * 枝番は、移す直前に移した先の親の子を読み直してから決める。
 */
export async function executeReparent(params: {
  ticketId: string;
  targetParentId: string | null;
  projectId: string;
  userName: string;
}): Promise<ReparentPlan & { oldSprintId: string }> {
  const { ticketId, targetParentId, projectId, userName } = params;
  if (!isSupabaseEnabled) throw new Error("この環境では移せません");

  const self = await fetchRow(ticketId);
  if (!self.parent_id) throw new Error("子チケットではないため移せません");
  if (targetParentId === self.parent_id) throw new Error("今の親チケットと同じです");
  const oldParent = await fetchRow(self.parent_id);
  const target = targetParentId ? await fetchRow(targetParentId) : null;
  if (target?.parent_id) throw new Error("移し先が子チケットです。親チケットを選んでください");

  const newWbs = target ? await nextChildWbs(target.id, target.wbs) : await nextRootWbs(projectId, self.sprint_id);
  const targetSprintId = target ? target.sprint_id : self.sprint_id;

  const { error } = await supabase!
    .from("sprint_tickets")
    .update({ parent_id: target?.id ?? null, wbs: newWbs, sprint_id: targetSprintId })
    .eq("id", self.id);
  if (error) throw new Error(error.message);

  // コメント欄の記録。失敗しても移動は済んでいるので、巻き戻さずに記録だけ諦める
  const content = target
    ? `<p>親チケットを ${oldParent.wbs} から ${target.wbs} へ移しました（WBS：${self.wbs} → ${newWbs}）</p>`
    : `<p>親チケット ${oldParent.wbs} から外し、単独の親チケットにしました（WBS：${self.wbs} → ${newWbs}）</p>`;
  const base = Date.now();
  const rows = [self, oldParent, ...(target ? [target] : [])].map((t, i) => ({
    id: `CMT-${base}-${i}-${Math.random().toString(36).slice(2, 6)}`,
    ticket_id: t.id, user_name: userName, content,
    ticket_status: t.status, comment_type: "status_change", images: [],
  }));
  const { error: cErr } = await supabase!.from("ticket_comments").insert(rows);
  if (cErr) console.error("[reparent] comments:", cErr.message);

  return { oldWbs: self.wbs, newWbs, targetSprintId, oldSprintId: self.sprint_id };
}
