// チケット一括登録の共通処理。
//
// 表からの一括作成（BulkTicketCreateDialog）と MDファイルからの一括作成
// （MdBulkCreateDialog）の両方がここを通る。WBS採番・通知・リンクサジェスト更新まで含む。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { getDefaultProgressForStatus } from "@/app/lib/helpers";
import { emitLinkItemsChanged } from "@/app/lib/linkSuggestSync";
import type { TicketStatus, Priority } from "@/app/types";

export interface BulkInsertTicket {
  title: string;
  status: TicketStatus;
  priority: Priority;
  assignee: string | null;
  /** "2026-08-03" 形式 */
  startDate: string | null;
  dueDate: string | null;
  estimatedHours: number;
  descriptionHtml: string | null;
  /** ticket_categories.id。分類なしは null */
  categoryId?: string | null;
  /** 子チケット。1階層のみ（子の children は見ない） */
  children?: BulkInsertTicket[];
}

export interface BulkInsertParams {
  sprintId: string;
  projectId: string;
  projectSlug?: string;
  createdBy: string | null;
  tickets: BulkInsertTicket[];
  /** プラン上限のチェック用。max が null なら無制限 */
  limit?: { max: number | null; current: number };
}

export interface BulkInsertResult {
  /** 作成したチケットのWBS。親→その子→次の親…の表示順 */
  createdWbs: string[];
  error?: string;
}

/** 親＋子の総数 */
export function countBulkTickets(tickets: BulkInsertTicket[]): number {
  return tickets.reduce((n, t) => n + 1 + (t.children?.length ?? 0), 0);
}

function newTicketId(): string {
  return `TKT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * チケットをまとめて登録する。
 *
 * 親と子は1回の insert にまとめる（id はクライアント生成なので親のIDを子の parent_id に
 * 先に入れられる）。親だけ先に見えて子が遅れて出る、という表示のちらつきを防ぐため。
 */
export async function insertBulkTickets(params: BulkInsertParams): Promise<BulkInsertResult> {
  const { sprintId, projectId, projectSlug, createdBy, tickets, limit } = params;

  const total = countBulkTickets(tickets);
  if (total === 0) return { createdWbs: [], error: "登録するチケットがありません" };

  if (limit?.max != null) {
    const remaining = limit.max - limit.current;
    if (total > remaining) {
      return {
        createdWbs: [],
        error: remaining > 0
          ? `現在のプランでは、このスプリントにあと ${remaining} 件までしか作成できません（${total} 件を作成しようとしています）`
          : "現在のプランでは、このスプリントにこれ以上チケットを作成できません",
      };
    }
  }

  if (!isSupabaseEnabled || !projectId) {
    // モックモードでは永続化しない（既存の表からの一括作成と同じ挙動）
    return { createdWbs: [] };
  }

  // ── WBSプレフィックスと次の連番を決める ──
  const { data: sprintRows } = await supabase!
    .from("sprints").select("id, identifier").eq("project_id", projectId);
  const sprintIds = sprintRows?.map(s => s.id) ?? [];
  const prefix = sprintRows?.find(s => s.id === sprintId)?.identifier || "T";

  let nextNum = 1;
  if (sprintIds.length > 0) {
    const { data: maxRow } = await supabase!
      .from("sprint_tickets").select("wbs")
      .in("sprint_id", sprintIds)
      .like("wbs", `${prefix}-%`)
      .not("wbs", "like", `${prefix}-%-_%`)   // 子チケット（T-001-1）は除く
      .order("wbs", { ascending: false }).limit(1).maybeSingle();
    nextNum = (parseInt(maxRow?.wbs?.slice(prefix.length + 1) ?? "0", 10) || 0) + 1;
  }

  const rows: Record<string, unknown>[] = [];
  const createdWbs: string[] = [];
  const notifySource: { assignee: string; id: string; wbs: string; title: string }[] = [];

  const toRow = (t: BulkInsertTicket, wbs: string, id: string, parentId: string | null) => {
    // estimated_hours は int 列。小数のまま送ると 400 になるので必ず整数へ丸める。
    const rawHours = typeof t.estimatedHours === "number" && !isNaN(t.estimatedHours) ? t.estimatedHours : 0;
    const hours = Math.max(0, Math.round(rawHours));
    return {
      id, sprint_id: sprintId, wbs,
      title: t.title.trim(),
      status: t.status,
      priority: t.priority,
      // sprint_tickets.assignee は `text not null default ''`。
      // 担当者なしは null ではなく空文字で表す（null を入れると not-null 制約で 400 になる）。
      assignee: t.assignee || "",
      start_date: t.startDate,
      due_date: t.dueDate,
      estimated_hours: hours,
      progress: getDefaultProgressForStatus(t.status),
      description: t.descriptionHtml || null,
      category_id: t.categoryId ?? null,
      created_by: createdBy || null,
      images: [], parent_id: parentId,
    };
  };

  for (const parent of tickets) {
    const parentWbs = `${prefix}-${String(nextNum++).padStart(3, "0")}`;
    const parentId = newTicketId();
    rows.push(toRow(parent, parentWbs, parentId, null));
    createdWbs.push(parentWbs);
    if (parent.assignee) notifySource.push({ assignee: parent.assignee, id: parentId, wbs: parentWbs, title: parent.title.trim() });

    // 新規作成した親なので既存の子は存在しない。枝番は1から振れる（ゼロ埋めなし＝既存仕様）
    let childNum = 1;
    for (const child of parent.children ?? []) {
      const childWbs = `${parentWbs}-${childNum++}`;
      const childId = newTicketId();
      rows.push(toRow(child, childWbs, childId, parentId));
      createdWbs.push(childWbs);
      if (child.assignee) notifySource.push({ assignee: child.assignee, id: childId, wbs: childWbs, title: child.title.trim() });
    }
  }

  const { error } = await supabase!.from("sprint_tickets").insert(rows);
  if (error) return { createdWbs: [], error: `チケットの登録に失敗しました: ${error.message}` };

  if (notifySource.length > 0) {
    await supabase!.from("notifications").insert(
      notifySource.map(t => ({
        user_name: t.assignee, type: "assign",
        title: "チケットが割り当てられました",
        body: `${t.wbs}: ${t.title}`,
        ticket_id: t.id, ticket_wbs: t.wbs, ticket_title: t.title,
        project_slug: projectSlug, is_read: false,
      })),
    );
  }

  emitLinkItemsChanged(projectId, "ticket");   // 他タブの # サジェストへ即時反映

  return { createdWbs };
}
