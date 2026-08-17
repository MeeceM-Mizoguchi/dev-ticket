// ファイルボックスのコメント（BRU12-025）の通知。
//
// ホワイトボードのコメント通知（whiteboardCommentNotify.ts）と同じ経路に相乗りする：
//   notifications テーブルへ insert  → ベルのお知らせ＋（DBフックで）プッシュ通知
//   /api/slack-notify へ POST        → Slack の DM/チャンネル通知
// テーブルもAPIも既存のものをそのまま使うので、追加のマイグレーションは無い。
//
// 通知からの復帰先はチケットではなくファイルビューアなので、飛び先は mention_context に
// 「file:{fileId}:{commentId}」の形で入れる（Topbar が解釈して該当ピンへ飛ばす）。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { fireSlackNotify } from "@/app/utils/slackNotify";
import { appOrigin } from "@/app/lib/appOrigin";
import { buildFileCommentLink, buildFileMentionContext } from "@/app/lib/fileCommentLink";
import { mentionedMembers } from "@/app/lib/whiteboardComments";

export interface FileNotifyBase {
  projectSlug: string;
  /** 通知の飛び先に載せる版（受け取った側で同名の最新版へ読み替えられる） */
  fileId: string;
  /** 通知本文に出すファイル名 */
  fileName: string;
  commentId: string;
  /** 返信のリンクを飛ばしたい時だけ */
  replyId?: string | null;
  fromUserName: string;
}

// Slack本文は「リンク＋本文の抜粋」。素の改行はそのまま送る（slackNotify 側で長さを丸める）。
function slackBody(base: FileNotifyBase, text: string): string {
  const url = appOrigin()
    ? buildFileCommentLink(base.projectSlug, base.fileId, base.commentId, base.replyId)
    : null;
  const head = url ? `<${url}|ファイル: ${base.fileName}>` : `ファイル: ${base.fileName}`;
  return `${head}\n${text.replace(/\s+/g, " ").trim()}`;
}

async function insertNotification(row: Record<string, unknown>): Promise<void> {
  const { error } = await supabase!.from("notifications").insert(row);
  if (error) console.error("[notifications] file comment insert failed:", error.message);
}

/**
 * 本文で新しく言及された人へメンション通知を送る。
 * 編集時は prevText を渡すと「今回増えた分」だけに絞る（同じ人へ何度も飛ばさない）。
 */
export async function notifyFileCommentMentions(
  base: FileNotifyBase, text: string, members: string[], prevText?: string,
): Promise<void> {
  if (!isSupabaseEnabled || !base.projectSlug) return;
  const now = mentionedMembers(text, members, base.fromUserName);
  const before = prevText ? mentionedMembers(prevText, members, base.fromUserName) : [];
  const targets = now.filter((n) => !before.includes(n));
  if (targets.length === 0) return;

  for (const name of targets) {
    await insertNotification({
      user_name: name,
      type: "mention",
      title: `${base.fromUserName}さんにメンションされました`,
      body: `ファイル「${base.fileName}」のコメント`,
      ticket_id: null,
      ticket_wbs: "",
      ticket_title: base.fileName,
      project_slug: base.projectSlug,
      mention_context: buildFileMentionContext(base.fileId, base.commentId),
      is_read: false,
    });
  }

  fireSlackNotify({
    recipientUserNames: targets,
    projectSlug: base.projectSlug,
    title: `${base.fromUserName}さんにメンションされました`,
    body: slackBody(base, text),
  });
}

/** 自分以外のコメントへ返信した時、その投稿者へ知らせる（ホワイトボードと同じ挙動）。 */
export async function notifyFileCommentReply(
  base: FileNotifyBase, text: string, toUserName: string,
): Promise<void> {
  if (!isSupabaseEnabled || !base.projectSlug) return;
  if (!toUserName || toUserName === base.fromUserName) return;

  await insertNotification({
    user_name: toUserName,
    type: "comment",
    title: `${base.fromUserName}さんがコメントに返信しました`,
    body: `ファイル「${base.fileName}」のコメント`,
    ticket_id: null,
    ticket_wbs: "",
    ticket_title: base.fileName,
    project_slug: base.projectSlug,
    mention_context: buildFileMentionContext(base.fileId, base.commentId),
    is_read: false,
  });

  fireSlackNotify({
    recipientUserNames: [toUserName],
    projectSlug: base.projectSlug,
    title: `${base.fromUserName}さんがコメントに返信しました`,
    body: slackBody(base, text),
  });
}
