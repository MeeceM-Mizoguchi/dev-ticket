// ENHA2-032 タスクの通知。
//
// ホワイトボードのコメント（whiteboardCommentNotify.ts）と同じ経路に相乗りする：
//   notifications テーブルへ insert  → ベルのお知らせ＋（DBフックで）プッシュ通知
//   /api/slack-notify へ POST        → Slack の DM/チャンネル通知
// テーブルもAPIも既存のものをそのまま使うので、追加のマイグレーションは無い。
//
// 飛び先はチケットではなくタスクなので、mention_context に「task:{taskId}」を入れる
// （Topbar が解釈して /tasks?task={id} へ飛ばす）。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { fireSlackNotify } from "@/app/utils/slackNotify";

const TASK_CONTEXT_PREFIX = "task:";

export function buildTaskMentionContext(taskId: string): string {
  return `${TASK_CONTEXT_PREFIX}${taskId}`;
}

/** お知らせがタスク宛てなら taskId を返す。それ以外は null */
export function parseTaskMentionContext(ctx: string | null | undefined): string | null {
  if (!ctx || !ctx.startsWith(TASK_CONTEXT_PREFIX)) return null;
  const id = ctx.slice(TASK_CONTEXT_PREFIX.length);
  return id || null;
}

interface TaskNotifyBase {
  taskId: string;
  taskTitle: string;
  fromUserName: string;
  /** プロジェクトタスクのときだけ。Slack のチャンネル選択に使われる */
  projectSlug?: string;
}

async function insertNotification(row: Record<string, unknown>): Promise<void> {
  const { error } = await supabase!.from("notifications").insert(row);
  if (error) console.error("[notifications] task insert failed:", error.message);
}

async function notify(base: TaskNotifyBase, toUserName: string, title: string, body: string): Promise<void> {
  if (!isSupabaseEnabled) return;
  if (!toUserName || toUserName === base.fromUserName) return;

  await insertNotification({
    user_name: toUserName,
    // notifications.type の check 制約を触らずに済むよう既存の 'assign' を使う
    type: "assign",
    title,
    body,
    ticket_id: null,
    ticket_wbs: "",
    ticket_title: base.taskTitle,
    project_slug: base.projectSlug ?? "",
    mention_context: buildTaskMentionContext(base.taskId),
    is_read: false,
  });

  fireSlackNotify({
    recipientUserNames: [toUserName],
    projectSlug: base.projectSlug ?? "",
    title,
    body: `タスク: ${base.taskTitle}`,
  });
}

/** 自分以外を担当者に指名したとき */
export async function notifyTaskAssigned(base: TaskNotifyBase, assignee: string): Promise<void> {
  await notify(base, assignee,
    `${base.fromUserName}さんからタスクが割り当てられました`,
    base.taskTitle);
}

/**
 * 担当ではなく「見せるだけ」で共有したとき。
 * 相手はお知らせから /tasks?task={id} へ飛べる（担当と同じ導線）。
 * 権限を後から付け替えたときは飛ばさない（同じ内容が何度も届くだけなので）。
 */
export async function notifyTaskShared(base: TaskNotifyBase, toUserName: string, canEdit: boolean): Promise<void> {
  await notify(base, toUserName,
    `${base.fromUserName}さんからタスクが共有されました（${canEdit ? "編集可" : "閲覧のみ"}）`,
    base.taskTitle);
}
