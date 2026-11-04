// BRU6-002-1 一括操作（削除・スプリント移動）の共通ロジック
//
// 単一チケットの削除(handleDeleteTicket)・移動(handleMoveTicket, TicketDetailPanel)の
// 挙動を踏襲しつつ、複数チケット・スプリント横断で処理できるようにまとめたもの。
// UI から独立させて副作用（DB書き込み）だけを担う。

import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { purgeTicketAttachments } from "@/app/lib/ticketAttachments";
import { reserveBacklogIds } from "@/app/lib/backlogItems";
import { mapSprintTicket } from "@/app/lib/mappers";
import { TICKET_STATUSES, getStatusMeta, calcTicketActualHours } from "@/app/lib/helpers";
import type { TicketStatus } from "@/app/types";

/**
 * チケットを一括削除する。
 * - 選択された親チケットの子チケットも自動的に対象に含める（重複排除）。
 * - 単一削除に倣い ticket_comments / ticket_source_files / ticket_attachments を先に掃除する。
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
  // 添付ファイルはストレージの実体も一緒に消す
  await purgeTicketAttachments(allIds);
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
 * 戻り値: 実際に移動したルートチケット数と、採番し直した後のWBS一覧
 *         （BRU10-077: 移動先へスクロール＆強調表示するために呼び出し側が使う）。
 *         movedWbs はルート → その子 の順で、先頭が必ずルートになるよう並べる。
 */
export type BulkMoveResult = { moved: number; movedWbs: string[] };

export async function bulkMoveTickets(params: {
  ticketIds: string[];
  targetSprintId: string;
  projectId: string;
}): Promise<BulkMoveResult> {
  const { ticketIds, targetSprintId, projectId } = params;
  const empty: BulkMoveResult = { moved: 0, movedWbs: [] };
  if (!isSupabaseEnabled || ticketIds.length === 0 || !targetSprintId || !projectId) return empty;

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
  if (roots.length === 0) return empty;

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

  // 全チケット（ルート＋子）の更新を一度に組み立て、並列実行する。
  // 直列 await だと 1 件ごとに通信往復を待って数十件で数秒かかっていた。
  // 採番(nextNum)は同期的にこのループで確定するため、通信自体は順序非依存で並列化できる。
  const updates: PromiseLike<unknown>[] = [];
  const movedWbs: string[] = [];
  for (const root of roots) {
    const newWbs = `${prefix}-${String(nextNum).padStart(3, "0")}`;
    nextNum++;
    const oldWbs = root.wbs;
    movedWbs.push(newWbs);

    updates.push(
      supabase!.from("sprint_tickets")
        .update({ sprint_id: targetSprintId, wbs: newWbs })
        .eq("id", root.id),
    );

    const children = childrenByParent.get(root.id) ?? [];
    for (const child of children) {
      const suffix = child.wbs.slice(oldWbs.length);   // 例: "-01" を維持
      movedWbs.push(`${newWbs}${suffix}`);
      updates.push(
        supabase!.from("sprint_tickets")
          .update({ sprint_id: targetSprintId, wbs: `${newWbs}${suffix}` })
          .eq("id", child.id),
      );
    }
  }
  await Promise.all(updates);
  return { moved: roots.length, movedWbs };
}

// ─── BRU24-001 チケットをバックログへ戻す ──────────────────────────────
//
// チケット（子チケットごと）をバックログ項目に変換し、スプリントから外す。
//   ・本文の末尾に「移動前の状態」「移動前のコメント」を書き足す（コメントは HTML のまま差し込む）
//   ・添付ファイルは backlog_attachments へ行を付け替える（ストレージの実体は動かさない）
//   ・親チケットの子は、子のバックログ項目（parent_item_id）として親につなぐ
//   ・もともとバックログから作ったチケットは、元の項目（converted_ticket_id）を「未対応」に戻して使い回す
// 順序は「バックログ作成 → 添付の付け替え → チケット削除」。途中で失敗したらチケットは消さずに止める
// （purgeTicketAttachments はストレージの実体まで消すので、付け替え前のチケット削除は厳禁）。

/** 親を選ばずに選ばれた子チケット。戻すには「親から独立させる」確認が要る */
export interface OrphanChildTicket { id: string; wbs: string; parentId: string; parentWbs: string }

export interface MoveToBacklogSummary {
  /** バックログの親（単独）項目になるチケット数 */
  rootCount: number;
  /** 子のバックログ項目になる子チケット数 */
  childCount: number;
  commentCount: number;
  attachmentCount: number;
  /** 実績工数の合計（h、小数1桁） */
  actualHours: number;
  /** プルリクエストが紐づいているチケット数 */
  prLinkedCount: number;
  orphans: OrphanChildTicket[];
}

export interface MovedBacklogItem { id: string; title: string; reused: boolean }

const BACKLOG_STATUS_LABEL_CHILD_CLOSED = "対応完了";

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function ticketStatusLabel(row: Row): string {
  if (row.parent_id && row.status === "closed") return BACKLOG_STATUS_LABEL_CHILD_CLOSED;
  return TICKET_STATUSES.find(s => s.value === row.status)?.label
    ?? getStatusMeta(row.status as TicketStatus).label;
}

function actualHoursOf(row: Row): number {
  return Math.round(calcTicketActualHours(mapSprintTicket(row)) * 10) / 10;
}

/** 選択を「親（単独）として戻すチケット」と「親を選ばずに選ばれた子」に分ける */
async function resolveMoveTargets(ticketIds: string[]) {
  const { data: selRows, error } = await supabase!.from("sprint_tickets").select("*").in("id", ticketIds);
  if (error) throw new Error(error.message);
  const selected = (selRows ?? []) as Row[];
  const selectedIds = new Set(selected.map(r => r.id as string));
  const parents = selected.filter(r => !r.parent_id);
  // 親と一緒に選ばれた子は親に合流させる（確認なし）
  const orphanRows = selected.filter(r => r.parent_id && !selectedIds.has(r.parent_id));

  const parentIds = parents.map(r => r.id as string);
  const { data: childRows } = parentIds.length > 0
    ? await supabase!.from("sprint_tickets").select("*").in("parent_id", parentIds)
      .order("wbs", { ascending: true }).order("id", { ascending: true })
    : { data: [] as Row[] };

  const orphanParentIds = Array.from(new Set(orphanRows.map(r => r.parent_id as string)));
  const { data: orphanParentRows } = orphanParentIds.length > 0
    ? await supabase!.from("sprint_tickets").select("id, wbs").in("id", orphanParentIds)
    : { data: [] as Row[] };
  const parentWbsById = new Map((orphanParentRows ?? []).map(r => [r.id as string, r.wbs as string]));

  const orphans: OrphanChildTicket[] = orphanRows.map(r => ({
    id: r.id, wbs: r.wbs, parentId: r.parent_id, parentWbs: parentWbsById.get(r.parent_id) ?? "",
  }));
  return { parents, children: (childRows ?? []) as Row[], orphanRows, orphans };
}

/** 確認画面に出す件数を集める */
export async function summarizeMoveToBacklog(ticketIds: string[], projectId: string): Promise<MoveToBacklogSummary> {
  const empty: MoveToBacklogSummary = { rootCount: 0, childCount: 0, commentCount: 0, attachmentCount: 0, actualHours: 0, prLinkedCount: 0, orphans: [] };
  if (!isSupabaseEnabled || ticketIds.length === 0) return empty;
  const { parents, children, orphanRows, orphans } = await resolveMoveTargets(ticketIds);
  const all = [...parents, ...children, ...orphanRows];
  const allIds = all.map(r => r.id as string);
  if (allIds.length === 0) return empty;

  const [{ count: commentCount }, { count: attachmentCount }, { data: prRows }] = await Promise.all([
    supabase!.from("ticket_comments").select("id", { count: "exact", head: true }).in("ticket_id", allIds),
    supabase!.from("ticket_attachments").select("id", { count: "exact", head: true }).in("ticket_id", allIds),
    supabase!.from("ticket_github_links").select("ticket_id").eq("project_id", projectId).eq("kind", "pull").in("ticket_id", allIds),
  ]);
  const prLinked = new Set((prRows ?? []).map(r => r.ticket_id as string));
  return {
    rootCount: parents.length + orphanRows.length,
    childCount: children.length,
    commentCount: commentCount ?? 0,
    attachmentCount: attachmentCount ?? 0,
    actualHours: Math.round(all.reduce((sum, r) => sum + actualHoursOf(r), 0) * 10) / 10,
    prLinkedCount: prLinked.size,
    orphans,
  };
}

/** 本文の末尾に足す「移動前の状態」「移動前のコメント」 */
function buildMoveHistoryHtml(row: Row, ctx: {
  sprintName: string; comments: Row[]; movedAt: string; movedBy: string; detachedFromWbs?: string;
}): string {
  const li = (label: string, value: string) => `<li><p>${escHtml(label)}：${escHtml(value)}</p></li>`;
  const hours = (h: unknown) => `${Number(h) || 0}h`;
  const state = [
    li("元のWBS", row.wbs || "—"),
    ...(ctx.detachedFromWbs ? [li("元の親", ctx.detachedFromWbs)] : []),
    li("スプリント", ctx.sprintName || "—"),
    li("ステータス", ticketStatusLabel(row)),
    li("進捗", `${Number(row.progress) || 0}%`),
    li("実績工数", hours(actualHoursOf(row))),
    li("見積工数", hours(row.estimated_hours)),
    li("開始日", row.start_date || "—"),
    li("期限", row.due_date || "—"),
    li("移動日時", fmtDateTime(ctx.movedAt)),
    li("移動した人", ctx.movedBy || "—"),
  ].join("");

  const comments = ctx.comments.length === 0
    ? "<p>（コメントなし）</p>"
    : ctx.comments.map(c => {
      const imgs = Array.isArray(c.images) && c.images.length > 0
        ? `<p>${(c.images as string[]).map((u, i) => `<a href="${escHtml(u)}">画像${i + 1}</a>`).join(" ")}</p>` : "";
      const body = String(c.content ?? "").trim() || "<p></p>";
      return `<p><strong>${escHtml(fmtDateTime(c.created_at))}　${escHtml(c.user_name || "")}</strong></p><blockquote>${body}${imgs}</blockquote>`;
    }).join("");

  return `<hr><h3>移動前の状態</h3><ul>${state}</ul><h3>移動前のコメント</h3>${comments}`;
}

/**
 * チケットをバックログへ戻す。
 * @param detachOrphans 親を選ばずに選ばれた子チケットを、親から独立した単独の項目として戻すか。
 *                      false のまま子だけが含まれていると Error を投げる（呼び出し側で確認してから true で呼ぶ）。
 * 戻り値: 作成（または使い回し）した親（単独）の項目。先頭が完了表示のリンク先。
 */
export async function moveTicketsToBacklog(params: {
  ticketIds: string[];
  projectId: string;
  movedBy: string;
  detachOrphans: boolean;
}): Promise<MovedBacklogItem[]> {
  const { ticketIds, projectId, movedBy, detachOrphans } = params;
  if (!isSupabaseEnabled || ticketIds.length === 0 || !projectId) return [];

  const { parents, children, orphanRows } = await resolveMoveTargets(ticketIds);
  if (orphanRows.length > 0 && !detachOrphans) {
    throw new Error("親チケットからバックログへ登録してください");
  }
  const roots = [...parents, ...orphanRows];
  const all = [...roots, ...children];
  if (all.length === 0) return [];
  const allIds = all.map(r => r.id as string);

  const [{ data: sprintRows }, { data: commentRows }, { data: attachmentRows }, { data: reuseRows }, { data: orphanParentRows }] = await Promise.all([
    supabase!.from("sprints").select("id, name").in("id", Array.from(new Set(all.map(r => r.sprint_id as string)))),
    supabase!.from("ticket_comments").select("*").in("ticket_id", allIds)
      .order("created_at", { ascending: true }).order("id", { ascending: true }),
    supabase!.from("ticket_attachments").select("*").in("ticket_id", allIds)
      .order("created_at", { ascending: true }).order("id", { ascending: true }),
    supabase!.from("backlog_items").select("id, parent_id, converted_ticket_id")
      .eq("project_id", projectId).in("converted_ticket_id", allIds),
    orphanRows.length > 0
      ? supabase!.from("sprint_tickets").select("id, wbs").in("id", orphanRows.map(r => r.parent_id as string))
      : Promise.resolve({ data: [] as Row[] }),
  ]);
  const sprintName = new Map((sprintRows ?? []).map(s => [s.id as string, s.name as string]));
  const commentsByTicket = new Map<string, Row[]>();
  for (const c of commentRows ?? []) {
    const arr = commentsByTicket.get(c.ticket_id) ?? [];
    arr.push(c);
    commentsByTicket.set(c.ticket_id, arr);
  }
  const reuseByTicket = new Map((reuseRows ?? []).map(r => [r.converted_ticket_id as string, r as Row]));
  const orphanParentWbs = new Map((orphanParentRows ?? []).map(r => [r.id as string, r.wbs as string]));

  // 使い回せない分だけ新しい番号を予約する
  const needNew = all.filter(r => !reuseByTicket.has(r.id)).length;
  const newIds = await reserveBacklogIds(projectId, needNew);
  let newIdx = 0;

  const movedAt = new Date().toISOString();
  const rankBase = Date.now();
  const itemIdByTicket = new Map<string, string>();
  const folderByTicket = new Map<string, string | null>();
  const inserts: Row[] = [];
  const updates: { id: string; patch: Row }[] = [];
  const results: MovedBacklogItem[] = [];

  const toItem = (row: Row, parentItemId: string | null, folderId: string | null, idx: number) => {
    const isOrphan = !!row.parent_id && orphanRows.some(o => o.id === row.id);
    const history = buildMoveHistoryHtml(row, {
      sprintName: sprintName.get(row.sprint_id) ?? "",
      comments: commentsByTicket.get(row.id) ?? [],
      movedAt, movedBy,
      detachedFromWbs: isOrphan ? (orphanParentWbs.get(row.parent_id) || "—") : undefined,
    });
    const assignee = Array.isArray(row.assignees) && row.assignees.length > 0 ? row.assignees[0] : (row.assignee || "");
    return {
      title: row.title || "無題",
      description: `${row.description || ""}${history}`,
      priority: ["low", "medium", "high"].includes(row.priority) ? row.priority : "medium",
      assignee,
      // backlog_items.estimated_hours は int
      estimated_hours: Math.round(Number(row.estimated_hours) || 0),
      category_id: row.category_id ?? null,
      images: Array.isArray(row.images) ? row.images : [],
      status: "open",
      converted_ticket_id: null,
      converted_ticket_wbs: null,
      parent_item_id: parentItemId,
      parent_id: folderId,
      rank: rankBase + idx,
      updated_at: movedAt,
    };
  };

  let idx = 0;
  const place = (row: Row, parentItemId: string | null, parentFolder: string | null | undefined) => {
    const reuse = reuseByTicket.get(row.id);
    // 使い回す項目は元のフォルダに残す。新しい項目は親（無ければルート）に置く
    const folderId = reuse ? (parentItemId ? (parentFolder ?? null) : (reuse.parent_id ?? null)) : (parentFolder ?? null);
    const fields = toItem(row, parentItemId, folderId, idx++);
    let itemId: string;
    if (reuse) {
      itemId = reuse.id;
      updates.push({ id: itemId, patch: fields });
    } else {
      itemId = newIds[newIdx++];
      inserts.push({ ...fields, id: itemId, project_id: projectId, is_folder: false, created_by: movedBy || null });
    }
    itemIdByTicket.set(row.id, itemId);
    folderByTicket.set(row.id, folderId);
    return { itemId, reused: !!reuse, title: fields.title as string };
  };

  for (const root of roots) {
    const r = place(root, null, null);
    results.push({ id: r.itemId, title: r.title, reused: r.reused });
    for (const child of children.filter(c => c.parent_id === root.id)) {
      place(child, r.itemId, folderByTicket.get(root.id));
    }
  }

  // 1) バックログ作成（ここで失敗したらチケットには一切触れない）
  if (inserts.length > 0) {
    const { error } = await supabase!.from("backlog_items").insert(inserts);
    if (error) throw new Error(`バックログ項目の作成に失敗しました: ${error.message}`);
  }
  for (const u of updates) {
    const { error } = await supabase!.from("backlog_items").update(u.patch).eq("id", u.id).eq("project_id", projectId);
    if (error) throw new Error(`バックログ項目（${u.id}）の更新に失敗しました: ${error.message}`);
  }

  // 2) 添付の付け替え（行を写してからチケット側の行だけ消す。実体は動かさない）
  if ((attachmentRows ?? []).length > 0) {
    const { error } = await supabase!.from("backlog_attachments").insert((attachmentRows ?? []).map(a => ({
      project_id: projectId,
      item_id: itemIdByTicket.get(a.ticket_id),
      file_name: a.file_name, file_size: a.file_size, file_type: a.file_type,
      file_path: a.file_path, file_url: a.file_url, uploaded_by: a.uploaded_by, created_at: a.created_at,
    })));
    if (error) throw new Error(`添付ファイルの付け替えに失敗しました（チケットは残っています）: ${error.message}`);
    const { error: delErr } = await supabase!.from("ticket_attachments").delete().in("ticket_id", allIds);
    if (delErr) throw new Error(`添付ファイルの付け替えに失敗しました（チケットは残っています）: ${delErr.message}`);
  }

  // 3) チケット削除（子 → 親）。関連行は単一削除と同じく先に掃除する
  await supabase!.from("ticket_comments").delete().in("ticket_id", allIds);
  await supabase!.from("ticket_source_files").delete().in("ticket_id", allIds);
  const childIds = all.filter(r => r.parent_id).map(r => r.id as string);
  if (childIds.length > 0) await supabase!.from("sprint_tickets").delete().in("id", childIds);
  const parentOnlyIds = parents.map(r => r.id as string);
  if (parentOnlyIds.length > 0) await supabase!.from("sprint_tickets").delete().in("id", parentOnlyIds);

  return results;
}
