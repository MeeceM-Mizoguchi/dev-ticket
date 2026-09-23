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
  /** 登録先スプリント。parentTicket を指定した場合は親のスプリントが優先される */
  sprintId: string;
  projectId: string;
  projectSlug?: string;
  createdBy: string | null;
  tickets: BulkInsertTicket[];
  /**
   * プラン上限のチェック用。max が null なら無制限。
   * current を省略すると登録先スプリントの件数をDBから数える（呼び出し側が件数を持っていない場合）。
   */
  limit?: { max: number | null; current?: number };
  /**
   * 既に登録されているチケットの配下へ、子チケットとしてまとめて足す場合の親。
   *
   * 指定すると tickets[] は全て「この親の子」になる。階層は1段までなので、
   * 各要素が持つ children は同じ階層（親の子）へ展開する。
   * 登録先スプリントは親と同じものにする（親子が別スプリントに散らばらないように）。
   */
  parentTicket?: { id: string; wbs: string };
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
 *
 * parentTicket を渡すと、新しく親を作らず「既存チケットの子」としてまとめて登録する。
 */
export async function insertBulkTickets(params: BulkInsertParams): Promise<BulkInsertResult> {
  const { sprintId, projectId, projectSlug, createdBy, limit, parentTicket } = params;

  // 既存チケットの配下へ足す場合は階層が1段しか無いので、入れ子を同じ階層へ展開しておく
  const tickets: BulkInsertTicket[] = parentTicket
    ? params.tickets.flatMap(t => [
        { ...t, children: undefined },
        ...(t.children ?? []).map(c => ({ ...c, children: undefined })),
      ])
    : params.tickets;

  const total = countBulkTickets(tickets);
  if (total === 0) return { createdWbs: [], error: "登録するチケットがありません" };

  /** プラン上限に引っかかるならエラー文、問題なければ null */
  const limitError = (current: number): string | null => {
    if (limit?.max == null) return null;
    const remaining = Math.max(0, limit.max - current);
    return total > remaining
      ? `プランの上限数（${limit.max}件）を超えるため、一括作成できません。残り作成可能件数：${remaining}件（入力：${total}件）`
      : null;
  };

  if (limit?.current != null) {
    const error = limitError(limit.current);
    if (error) return { createdWbs: [], error };
  }

  if (!isSupabaseEnabled || !projectId) {
    // モックモードでは永続化しない（既存の表からの一括作成と同じ挙動）
    return { createdWbs: [] };
  }

  // ── 登録先スプリント。既存チケットの子は必ず親と同じスプリントに入れる ──
  let targetSprintId = sprintId;
  if (parentTicket) {
    const { data: parentRow, error } = await supabase!
      .from("sprint_tickets").select("sprint_id, parent_id").eq("id", parentTicket.id).maybeSingle();
    if (error) return { createdWbs: [], error: `親チケットの取得に失敗しました: ${error.message}` };
    if (!parentRow?.sprint_id) return { createdWbs: [], error: "親チケットが見つかりません" };
    if (parentRow.parent_id) {
      return { createdWbs: [], error: "子チケットの下にさらに子チケットは作れません（階層は1段までです）" };
    }
    targetSprintId = parentRow.sprint_id as string;
  }

  // 呼び出し側が件数を持っていない場合はここで数える（子チケット追加の経路など）
  if (limit?.max != null && limit.current == null) {
    const { count } = await supabase!
      .from("sprint_tickets").select("id", { count: "exact", head: true }).eq("sprint_id", targetSprintId);
    const error = limitError(count ?? 0);
    if (error) return { createdWbs: [], error };
  }

  const rows: Record<string, unknown>[] = [];
  const createdWbs: string[] = [];
  const notifySource: { assignee: string; id: string; wbs: string; title: string }[] = [];

  const toRow = (t: BulkInsertTicket, wbs: string, id: string, parentId: string | null) => {
    // estimated_hours は int 列。小数のまま送ると 400 になるので必ず整数へ丸める。
    const rawHours = typeof t.estimatedHours === "number" && !isNaN(t.estimatedHours) ? t.estimatedHours : 0;
    const hours = Math.max(0, Math.round(rawHours));
    return {
      id, sprint_id: targetSprintId, wbs,
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

  if (parentTicket) {
    // ── 既存チケットの子として足す。枝番は既存の子の続きから ──
    const { data: childRows, error: childError } = await supabase!
      .from("sprint_tickets").select("wbs")
      .eq("parent_id", parentTicket.id)
      .like("wbs", `${parentTicket.wbs}-%`);
    if (childError) return { createdWbs: [], error: `既存の子チケットの取得に失敗しました: ${childError.message}` };

    // 枝番はゼロ埋めしていないため、DBの文字列ソートでは "…-9" > "…-10" になり10で頭打ちになる。
    // メモリ上で数値比較して最大値+1を次の番号とする（NewTicketDialog の BRU4-058 と同じ理由）。
    let nextChildNum = (childRows ?? []).reduce((max, row) => {
      const n = parseInt(String(row.wbs).slice(parentTicket.wbs.length + 1), 10);
      return Number.isNaN(n) ? max : Math.max(max, n);
    }, 0) + 1;

    for (const child of tickets) {
      const childWbs = `${parentTicket.wbs}-${nextChildNum++}`;
      const childId = newTicketId();
      rows.push(toRow(child, childWbs, childId, parentTicket.id));
      createdWbs.push(childWbs);
      if (child.assignee) notifySource.push({ assignee: child.assignee, id: childId, wbs: childWbs, title: child.title.trim() });
    }
  } else {
    // ── WBSプレフィックスと次の連番を決める ──
    const { data: sprintRows } = await supabase!
      .from("sprints").select("id, identifier").eq("project_id", projectId);
    const sprintIds = sprintRows?.map(s => s.id) ?? [];
    const prefix = sprintRows?.find(s => s.id === targetSprintId)?.identifier || "T";

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
