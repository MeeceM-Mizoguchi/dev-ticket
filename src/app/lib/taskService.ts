// ENHA2-032 タスク管理のデータ層。
//
// 画面（TaskWorkspace とその配下のビュー）は「何を表示するか」だけを持ち、
// Supabase とのやり取りはすべてここに閉じる。
//
// 可視性は RLS が決める（supabase/add_tasks.sql）:
//   所有者 / 共有された人 / プロジェクトメンバー
// つまり素の select がそのまま「自分に見えるタスク全部」になる。
// 「自分の / 共有された」の仕分けはクライアント側で ownerId を見て行う。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { mapTask, mapTaskShare } from "@/app/lib/mappers";
import type { Task, TaskShare, TaskStatus, Priority } from "@/app/types";

export const TASK_STATUSES: { value: TaskStatus; label: string; color: string; bg: string; border: string }[] = [
  { value: "todo",        label: "未着手", color: "#6B7280", bg: "#F3F4F6", border: "#E0DDD9" },
  { value: "in-progress", label: "進行中", color: "#D97706", bg: "#FFF7ED", border: "#FED7AA" },
  { value: "done",        label: "完了",   color: "#059669", bg: "#ECFDF5", border: "#A7F3D0" },
];

export function getTaskStatusMeta(status: TaskStatus) {
  return TASK_STATUSES.find(s => s.value === status) ?? TASK_STATUSES[0];
}

export const TASK_PRIORITIES: { value: Priority; label: string; color: string; bg: string }[] = [
  { value: "high",   label: "高", color: "#DC2626", bg: "#FEF2F2" },
  { value: "medium", label: "中", color: "#D97706", bg: "#FFFBEB" },
  { value: "low",    label: "低", color: "#0284C7", bg: "#F0F9FF" },
];

export function getTaskPriorityMeta(p: Priority) {
  return TASK_PRIORITIES.find(x => x.value === p) ?? TASK_PRIORITIES[1];
}

/** 並びの初期間隔。新規は先頭に積み、D&D は前後の中点を採る */
export const SORT_GAP = 1024;

/**
 * 落とした位置の前後から新しい sort_order を決める。
 * 前後が無ければ ±GAP。中点が縮退したら null を返し、呼び出し側に採番し直しを促す。
 */
export function computeSortOrder(prev: number | null, next: number | null): number | null {
  if (prev == null && next == null) return 0;
  if (prev == null) return next! - SORT_GAP;
  if (next == null) return prev + SORT_GAP;
  const mid = (prev + next) / 2;
  // double precision でも刻み続ければいつかは潰れる。潰れたら再採番させる
  if (Math.abs(next - prev) < 1e-6 || mid === prev || mid === next) return null;
  return mid;
}

export interface ProjectOption { id: string; slug: string; name: string; members: string[] }
export interface MemberOption { id: string; name: string }

// ── 取得 ──────────────────────────────────────────────────────

/**
 * 見えるタスクを全部取る。projectId を渡すとそのプロジェクトのぶんだけ。
 * RLS が可視範囲を絞るので、ここに組織やメンバーの条件は要らない。
 */
export async function loadTasks(projectId?: string | null): Promise<Task[]> {
  if (!isSupabaseEnabled) return [];
  let q = supabase!.from("tasks").select("*");
  if (projectId) q = q.eq("project_id", projectId);
  const { data, error } = await q
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) { console.error("[tasks] load failed:", error.message); return []; }
  return (data ?? []).map(mapTask);
}

/**
 * 自分宛の共有行だけをまとめて引く（taskId → 編集可か）。
 * 一覧で「閲覧のみ共有されたタスク」を編集不可にするために使う。
 * RLS の task_shares_select が profile_id = auth.uid() を通すので条件は要らないが、
 * 所有者として見えている行も混ざるため明示的に絞る。
 */
export async function loadMyShareFlags(profileId: string): Promise<Record<string, boolean>> {
  if (!isSupabaseEnabled || !profileId) return {};
  const { data, error } = await supabase!
    .from("task_shares").select("task_id, can_edit").eq("profile_id", profileId);
  if (error) { console.error("[task_shares] flags load failed:", error.message); return {}; }
  const out: Record<string, boolean> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (data ?? []) as any[]) out[r.task_id] = r.can_edit !== false;
  return out;
}

/** 詳細を開いたときだけ共有相手を引く（一覧では引かない） */
export async function loadTaskShares(taskId: string): Promise<TaskShare[]> {
  if (!isSupabaseEnabled) return [];
  const { data, error } = await supabase!
    .from("task_shares")
    .select("profile_id, can_edit, profiles(name)")
    .eq("task_id", taskId);
  if (error) { console.error("[task_shares] load failed:", error.message); return []; }
  return (data ?? []).map(mapTaskShare);
}

/**
 * タスクを紐付けられるプロジェクト。
 * RLS 越しに見えるプロジェクトのうち、自分が参加しているものだけを候補にする
 * （admin/PM は projects が全件見えるが、無関係なPJを候補に並べても邪魔なだけ）。
 */
export async function loadTaskProjects(userName: string, isAdminRole: boolean): Promise<ProjectOption[]> {
  if (!isSupabaseEnabled) return [];
  const { data, error } = await supabase!
    .from("projects").select("id, slug, name, members").order("name");
  if (error) { console.error("[tasks] projects load failed:", error.message); return []; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: ProjectOption[] = (data ?? []).map((p: any) => ({
    id: p.id, slug: p.slug || "", name: p.name || "", members: Array.isArray(p.members) ? p.members : [],
  }));
  if (isAdminRole) return all;
  const mine = all.filter(p => p.members.includes(userName));
  // どこにも参加していない場合は、せめて見えるものは選べるようにしておく
  return mine.length > 0 ? mine : all;
}

export interface TicketOption { id: string; wbs: string; title: string }

/**
 * 紐付け候補のチケット。sprint_tickets は project_id を持たないので
 * スプリント経由で辿る（プロジェクト直下にチケットは無い）。
 */
export async function loadProjectTickets(projectId: string): Promise<TicketOption[]> {
  if (!isSupabaseEnabled || !projectId) return [];
  const { data: sprints } = await supabase!.from("sprints").select("id").eq("project_id", projectId);
  const ids = (sprints ?? []).map((s: { id: string }) => s.id);
  if (ids.length === 0) return [];
  const { data, error } = await supabase!
    .from("sprint_tickets").select("id, wbs, title").in("sprint_id", ids).order("wbs");
  if (error) { console.error("[tasks] tickets load failed:", error.message); return []; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((t: any) => ({ id: t.id, wbs: t.wbs || "", title: t.title || "" }));
}

/** 担当者・共有先の候補。同じ組織の在籍メンバー */
export async function loadTaskMembers(orgId: string | null): Promise<MemberOption[]> {
  if (!isSupabaseEnabled) return [];
  let q = supabase!.from("profiles").select("id, name").neq("status", "inactive");
  if (orgId) q = q.eq("organization_id", orgId);
  const { data, error } = await q.order("name");
  if (error) { console.error("[tasks] members load failed:", error.message); return []; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({ id: r.id, name: r.name || "" })).filter((m: MemberOption) => m.name);
}

// ── 作成・更新・削除 ──────────────────────────────────────────

export interface NewTaskInput {
  title: string;
  ownerId: string;
  createdBy: string;
  projectId?: string | null;
  parentId?: string | null;
  description?: string;
  category?: string;
  status?: TaskStatus;
  priority?: Priority;
  assignee?: string;
  startDate?: string;
  dueDate?: string;
  ticketId?: string | null;
  ticketWbs?: string;
  /** 同じ列の先頭に積むための基準値（その列の最小 sort_order） */
  minSortOrder?: number | null;
}

export async function createTask(input: NewTaskInput): Promise<Task | null> {
  if (!isSupabaseEnabled) return null;
  const status = input.status ?? "todo";
  const row = {
    owner_id: input.ownerId,
    created_by: input.createdBy,
    project_id: input.projectId || null,
    parent_id: input.parentId || null,
    title: input.title,
    description: input.description ?? "",
    category: input.category ?? "",
    status,
    priority: input.priority ?? "medium",
    assignee: input.assignee ?? "",
    start_date: input.startDate || null,
    due_date: input.dueDate || null,
    ticket_id: input.ticketId || null,
    ticket_wbs: input.ticketWbs ?? "",
    sort_order: (input.minSortOrder ?? 0) - SORT_GAP,
    completed_at: status === "done" ? new Date().toISOString() : null,
  };
  const { data, error } = await supabase!.from("tasks").insert(row).select().single();
  if (error) { console.error("[tasks] insert failed:", error.message); return null; }
  return mapTask(data);
}

/** 画面の Task 形（camelCase）を受け取り、変更分だけを DB 形へ移して更新する */
export async function updateTask(id: string, patch: Partial<Task>): Promise<boolean> {
  if (!isSupabaseEnabled) return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined)       row.title = patch.title;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.category !== undefined)    row.category = patch.category;
  if (patch.priority !== undefined)    row.priority = patch.priority;
  if (patch.assignee !== undefined)    row.assignee = patch.assignee;
  if (patch.startDate !== undefined)   row.start_date = patch.startDate || null;
  if (patch.dueDate !== undefined)     row.due_date = patch.dueDate || null;
  if (patch.projectId !== undefined)   row.project_id = patch.projectId || null;
  if (patch.parentId !== undefined)    row.parent_id = patch.parentId || null;
  if (patch.ticketId !== undefined)    row.ticket_id = patch.ticketId || null;
  if (patch.ticketWbs !== undefined)   row.ticket_wbs = patch.ticketWbs;
  if (patch.sortOrder !== undefined)   row.sort_order = patch.sortOrder;
  if (patch.status !== undefined) {
    row.status = patch.status;
    // 完了に入った時刻を残す。戻したら消す（ガント／振り返りで使う）
    row.completed_at = patch.status === "done" ? new Date().toISOString() : null;
  }
  const { error } = await supabase!.from("tasks").update(row).eq("id", id);
  if (error) { console.error("[tasks] update failed:", error.message); return false; }
  return true;
}

/**
 * サブタスクを1件足す。
 *
 * 親が誰に見えているかを子にも引き継ぐのが肝。
 *   ・project_id は親と同じ（PJタスクの子は同じPJのメンバーに見える）
 *   ・親の共有相手をそのまま子にもコピーする
 *   ・自分が親の所有者でないなら、親の所有者にも共有を張る
 * これをやらないと「共有されたタスクにサブタスクを足したら、相手から見えない」が起きる。
 */
export async function createSubtask(
  parent: Task, title: string, ownerId: string, createdBy: string, minSortOrder: number | null,
): Promise<Task | null> {
  const child = await createTask({
    title, ownerId, createdBy,
    projectId: parent.projectId,
    parentId: parent.id,
    minSortOrder,
  });
  if (!child) return null;

  const shares = await loadTaskShares(parent.id);
  await Promise.all(shares
    .filter(s => s.profileId !== ownerId)
    .map(s => addTaskShare(child.id, s.profileId, s.canEdit)));
  if (parent.ownerId && parent.ownerId !== ownerId) {
    await addTaskShare(child.id, parent.ownerId, true);
  }
  return child;
}

export async function deleteTask(id: string): Promise<boolean> {
  if (!isSupabaseEnabled) return true;
  const { error } = await supabase!.from("tasks").delete().eq("id", id);
  if (error) { console.error("[tasks] delete failed:", error.message); return false; }
  return true;
}

/** 中点が潰れた列を 1024 刻みで採番し直す */
export async function renumberColumn(tasks: Task[]): Promise<void> {
  if (!isSupabaseEnabled) return;
  await Promise.all(tasks.map((t, i) =>
    supabase!.from("tasks").update({ sort_order: i * SORT_GAP }).eq("id", t.id)
  ));
}

// ── 共有 ──────────────────────────────────────────────────────

export async function addTaskShare(taskId: string, profileId: string, canEdit = true): Promise<boolean> {
  if (!isSupabaseEnabled) return true;
  const { error } = await supabase!
    .from("task_shares")
    .upsert({ task_id: taskId, profile_id: profileId, can_edit: canEdit }, { onConflict: "task_id,profile_id" });
  if (error) { console.error("[task_shares] upsert failed:", error.message); return false; }
  return true;
}

export async function removeTaskShare(taskId: string, profileId: string): Promise<boolean> {
  if (!isSupabaseEnabled) return true;
  const { error } = await supabase!
    .from("task_shares").delete().eq("task_id", taskId).eq("profile_id", profileId);
  if (error) { console.error("[task_shares] delete failed:", error.message); return false; }
  return true;
}

/**
 * 担当者に指名した相手へ自動で共有を張る。
 * これが無いと「個人タスクを他人に振ったのに相手から見えない」が起きる。
 * 担当を外したときは共有を消さない（意図的に共有を残したい場合があるため）。
 */
export async function syncAssigneeShare(
  taskId: string, assignee: string, members: MemberOption[], ownerName: string,
): Promise<void> {
  if (!assignee || assignee === ownerName) return;
  const m = members.find(x => x.name === assignee);
  if (!m) return;
  await addTaskShare(taskId, m.id, true);
}
