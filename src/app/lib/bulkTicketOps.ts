// BRU6-002-1 一括操作（削除・スプリント移動）の共通ロジック
//
// 単一チケットの削除(handleDeleteTicket)・移動(handleMoveTicket, TicketDetailPanel)の
// 挙動を踏襲しつつ、複数チケット・スプリント横断で処理できるようにまとめたもの。
// UI から独立させて副作用（DB書き込み）だけを担う。

import { supabase, isSupabaseEnabled } from "@/lib/supabase";

/**
 * チケットを一括削除する。
 * - 選択された親チケットの子チケットも自動的に対象に含める（重複排除）。
 * - 単一削除に倣い ticket_comments / ticket_source_files を先に掃除する。
 * - 単一削除では子の sprint_tickets 行がカスケード頼みで消え残る余地があったため、
 *   ここでは子の本体行も明示的に削除する。
 * 戻り値: 実際に削除したチケット行数。
 */
export async function bulkDeleteTickets(ticketIds: string[]): Promise<number> {
  if (!isSupabaseEnabled || ticketIds.length === 0) return 0;

  // 選択された親の子チケットを対象に合流させる
  const { data: childRows } = await supabase!
    .from("sprint_tickets").select("id").in("parent_id", ticketIds);
  const childIds = (childRows ?? []).map(r => r.id as string);
  const allIds = Array.from(new Set([...ticketIds, ...childIds]));

  // 関連行 → 本体行 の順で削除
  await supabase!.from("ticket_comments").delete().in("ticket_id", allIds);
  await supabase!.from("ticket_source_files").delete().in("ticket_id", allIds);
  await supabase!.from("sprint_tickets").delete().in("id", allIds);

  return allIds.length;
}

/**
 * チケットを一括で別スプリントへ移動する。
 * - 子チケットが選択されていた場合は親（ルート）に解決する。移動は親単位で行い、
 *   子は WBS 接尾辞を維持したまま追従する（単一移動 handleMoveTicket と同じ挙動）。
 * - すでに移動先スプリントにあるチケットは対象外（採番の無駄打ちを避ける）。
 * - WBS は移動先スプリントで連番採番する。複数件を一度に処理するため、
 *   現在の最大採番を一度だけ取得し、メモリ上でインクリメントして衝突を防ぐ。
 * 戻り値: 実際に移動したルートチケット数。
 */
export async function bulkMoveTickets(params: {
  ticketIds: string[];
  targetSprintId: string;
  projectId: string;
}): Promise<number> {
  const { ticketIds, targetSprintId, projectId } = params;
  if (!isSupabaseEnabled || ticketIds.length === 0 || !targetSprintId || !projectId) return 0;

  // 選択チケットの現行情報を取得（親/子・現在スプリント）
  const { data: selRows } = await supabase!
    .from("sprint_tickets").select("id, parent_id").in("id", ticketIds);
  const parentIds = new Set<string>();
  for (const r of selRows ?? []) parentIds.add((r.parent_id as string | null) ?? (r.id as string));

  // ルート（親チケット）の現行情報。すでに移動先にあるものは除外する。
  const { data: rootRows } = await supabase!
    .from("sprint_tickets").select("id, wbs, sprint_id").in("id", Array.from(parentIds));
  const roots = (rootRows ?? []).filter(r => r.sprint_id !== targetSprintId) as
    { id: string; wbs: string; sprint_id: string }[];
  if (roots.length === 0) return 0;

  // 採番用プレフィックスと、移動先スプリントを含むプロジェクト全体の現在最大番号を取得
  const [{ data: sprintRows }, { data: projectRow }, { data: targetSprint }] = await Promise.all([
    supabase!.from("sprints").select("id").eq("project_id", projectId),
    supabase!.from("projects").select("wbs_prefix").eq("id", projectId).single(),
    supabase!.from("sprints").select("identifier").eq("id", targetSprintId).single(),
  ]);
  const sprintIds = (sprintRows ?? []).map(s => s.id);
  const prefix = targetSprint?.identifier || projectRow?.wbs_prefix || "T";

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

  // ルートの子チケットをまとめて取得
  const rootIds = roots.map(r => r.id);
  const { data: childRows } = await supabase!
    .from("sprint_tickets").select("id, wbs, parent_id").in("parent_id", rootIds);
  const childrenByParent = new Map<string, { id: string; wbs: string }[]>();
  for (const c of childRows ?? []) {
    const pid = c.parent_id as string;
    const arr = childrenByParent.get(pid) ?? [];
    arr.push({ id: c.id as string, wbs: c.wbs as string });
    childrenByParent.set(pid, arr);
  }

  let moved = 0;
  for (const root of roots) {
    const newWbs = `${prefix}-${String(nextNum).padStart(3, "0")}`;
    nextNum++;
    const oldWbs = root.wbs;

    await supabase!.from("sprint_tickets")
      .update({ sprint_id: targetSprintId, wbs: newWbs })
      .eq("id", root.id);

    const children = childrenByParent.get(root.id) ?? [];
    for (const child of children) {
      const suffix = child.wbs.slice(oldWbs.length);   // 例: "-01" を維持
      await supabase!.from("sprint_tickets")
        .update({ sprint_id: targetSprintId, wbs: `${newWbs}${suffix}` })
        .eq("id", child.id);
    }
    moved++;
  }
  return moved;
}
