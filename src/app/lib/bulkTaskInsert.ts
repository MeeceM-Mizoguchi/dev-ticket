// タスクのMD一括登録。
//
// チケットの一括登録（bulkTicketInsert.ts）のタスク版。MDファイルからの取り込み
// （MdTaskImportDialog）だけがここを通る。1行ずつ足していく通常の追加は
// taskService.createTask のままで、こちらは「まとめて1回で入れる」ためにある。
//
// 親とサブタスクは1回の insert にまとめる（id をクライアントで採番するので、親のIDを
// 子の parent_id に先に入れられる）。親だけ先に見えて子が遅れて出る、という
// 表示のちらつきを防ぐため。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { mapTask } from "@/app/lib/mappers";
import { normalizeCategories, syncAssigneeShare, SORT_GAP, type MemberOption } from "@/app/lib/taskService";
import { notifyTaskAssigned } from "@/app/lib/taskNotify";
import type { Task, TaskStatus, Priority } from "@/app/types";

export interface BulkInsertTask {
  title: string;
  status: TaskStatus;
  priority: Priority;
  categories: string[];
  assignee: string | null;
  /** "2026-08-03" 形式 */
  startDate: string | null;
  dueDate: string | null;
  /** 詳細メモ（RichEditor の HTML） */
  descriptionHtml: string | null;
  /** サブタスク。1階層のみ（子の children は見ない） */
  children?: BulkInsertTask[];
}

export interface BulkTaskInsertParams {
  /** 作成者。全件この人の持ち物になる（profiles.id） */
  ownerId: string;
  /** 表示用の作成者名（profiles.name） */
  createdBy: string;
  /** null = 個人タスク / 値あり = プロジェクトタスク */
  projectId: string | null;
  /** お知らせのリンク用。プロジェクトタスクのときだけ */
  projectSlug?: string;
  /** 担当者に指名した相手へ共有を張るための候補 */
  members: MemberOption[];
  /** いま画面にあるタスクの最小 sort_order。取り込んだ分はこれより手前（＝先頭）に積む */
  minSortOrder: number | null;
  tasks: BulkInsertTask[];
}

export interface BulkTaskInsertResult {
  /** 作成したタスク。親→その子→次の親…の表示順 */
  created: Task[];
  error?: string;
}

/** 親＋サブタスクの総数 */
export function countBulkTasks(tasks: BulkInsertTask[]): number {
  return tasks.reduce((n, t) => n + 1 + (t.children?.length ?? 0), 0);
}

/**
 * tasks.id は uuid 列なので、形の正しい v4 を作る。
 * crypto.randomUUID は安全なコンテキスト（HTTPS / localhost）でしか使えないため、
 * 無い環境では getRandomValues（それも無ければ Math.random）から組み立てる。
 */
function newTaskId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;   // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80;   // variant
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * タスクをまとめて登録する。
 *
 * 担当者に指名した相手への共有とお知らせは、1行ずつ足すとき（TaskWorkspace）と同じく
 * 登録の後にまとめて回す。共有を張らないと「振ったのに相手から見えない」が起きる。
 */
export async function insertBulkTasks(params: BulkTaskInsertParams): Promise<BulkTaskInsertResult> {
  const { ownerId, createdBy, projectId, projectSlug, members, minSortOrder, tasks } = params;

  const total = countBulkTasks(tasks);
  if (total === 0) return { created: [], error: "登録するタスクがありません" };
  if (!isSupabaseEnabled) return { created: [], error: "デモモードではタスクを登録できません" };

  // 取り込んだ分はまとめて一覧の先頭へ。MDに書かれた順に上から並ぶよう、
  // 先頭のタスクほど小さい値を振る（一覧は sort_order の昇順）
  const base = minSortOrder ?? 0;
  let seq = 0;
  const nextSortOrder = () => base - SORT_GAP * (total - seq++);

  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];

  const toRow = (t: BulkInsertTask, id: string, parentId: string | null) => ({
    id,
    owner_id: ownerId,
    created_by: createdBy,
    project_id: projectId || null,
    parent_id: parentId,
    title: t.title.trim(),
    // description / assignee は not null 列。未記載は null ではなく空文字で表す
    description: t.descriptionHtml || "",
    categories: normalizeCategories(t.categories),
    status: t.status,
    priority: t.priority,
    assignee: t.assignee || "",
    start_date: t.startDate,
    due_date: t.dueDate,
    ticket_wbs: "",
    sort_order: nextSortOrder(),
    // 完了で取り込んだものにも完了時刻を入れる（ガント・振り返りで使う）
    completed_at: t.status === "done" ? now : null,
  });

  for (const parent of tasks) {
    const parentId = newTaskId();
    rows.push(toRow(parent, parentId, null));
    for (const child of parent.children ?? []) {
      rows.push(toRow(child, newTaskId(), parentId));
    }
  }

  const { data, error } = await supabase!.from("tasks").insert(rows).select();
  if (error) return { created: [], error: `タスクの登録に失敗しました: ${error.message}` };

  const created = (data ?? []).map(mapTask).sort((a, b) => a.sortOrder - b.sortOrder);

  // 担当者に指名した相手へ共有＋お知らせ（自分自身は syncAssigneeShare / notify 側で弾かれる）
  await Promise.all(created
    .filter(t => t.assignee)
    .map(async t => {
      await syncAssigneeShare(t.id, t.assignee, members, createdBy);
      await notifyTaskAssigned(
        { taskId: t.id, taskTitle: t.title, fromUserName: createdBy, projectSlug },
        t.assignee,
      );
    }));

  return { created };
}
