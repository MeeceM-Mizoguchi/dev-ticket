// ホワイトボードのコメント（ENHA2-039）の通知。
//
// チケットのコメント（TicketDetailPanel.notifyMentions）と同じ経路に相乗りする：
//   notifications テーブルへ insert  → ベルのお知らせ＋（DBフックで）プッシュ通知
//   /api/slack-notify へ POST        → Slack の DM/チャンネル通知
// テーブルもAPIも既存のものをそのまま使うので、追加のマイグレーションは無い。
//
// 通知からの復帰先はチケットではなくホワイトボードなので、飛び先は mention_context に
// 「whiteboard:{boardId}:{commentId}」の形で入れる（Topbar が解釈して該当ピンへ飛ばす）。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { fireSlackNotify } from "@/app/utils/slackNotify";
import { appOrigin } from "@/app/lib/appOrigin";
import { buildWhiteboardCommentLink, buildWhiteboardMentionContext } from "@/app/lib/whiteboardLink";
import { mentionedMembers } from "@/app/lib/whiteboardComments";

export interface WbNotifyBase {
  projectSlug: string;
  boardId: string;
  boardTitle: string;
  commentId: string;
  /** 返信のリンクを飛ばしたい時だけ */
  replyId?: string | null;
  fromUserName: string;
  /**
   * プライベートモードのボードか。true の間は「そのボードを見られる人」にしか通知を飛ばさない。
   * 飛ばしても相手はボードを開けず（RLSで弾かれる）「見つかりませんでした」になるだけなので、
   * 死にリンクを配らないために入口で止める。解除後の新規コメントからは通常どおり通知される。
   */
  isPrivate?: boolean;
  /**
   * プライベート中に通知してよい相手の表示名（ボード作成者＋限定公開先）。
   * 未指定・空なら誰にも飛ばさない（＝共有先ゼロの素のプライベート）。
   */
  privateAllowedNames?: string[];
}

/** プライベート中は「ボードを見られる人」だけに絞る。公開ボードは素通し */
function allowedTargets(base: WbNotifyBase, names: string[]): string[] {
  if (!base.isPrivate) return names;
  const allowed = new Set(base.privateAllowedNames ?? []);
  return names.filter((n) => allowed.has(n));
}

// Slack本文は「リンク＋本文の抜粋」。素の改行はそのまま送る（slackNotify 側で長さを丸める）。
function slackBody(base: WbNotifyBase, text: string): string {
  const url = appOrigin() ? buildWhiteboardCommentLink(base.projectSlug, base.boardId, base.commentId, base.replyId) : "";
  const head = url ? `<${url}|ホワイトボード: ${base.boardTitle}>` : `ホワイトボード: ${base.boardTitle}`;
  return `${head}\n${text.replace(/\s+/g, " ").trim()}`;
}

async function insertNotification(row: Record<string, unknown>): Promise<void> {
  const { error } = await supabase!.from("notifications").insert(row);
  if (error) console.error("[notifications] whiteboard comment insert failed:", error.message);
}

/**
 * 本文で新しく言及された人へメンション通知を送る。
 * 編集時は prevText を渡すと「今回増えた分」だけに絞る（同じ人へ何度も飛ばさない）。
 */
export async function notifyWhiteboardMentions(
  base: WbNotifyBase, text: string, members: string[], prevText?: string,
): Promise<void> {
  if (!isSupabaseEnabled || !base.projectSlug) return;
  const now = mentionedMembers(text, members, base.fromUserName);
  const before = prevText ? mentionedMembers(prevText, members, base.fromUserName) : [];
  const targets = allowedTargets(base, now.filter((n) => !before.includes(n)));
  if (targets.length === 0) return;

  for (const name of targets) {
    await insertNotification({
      user_name: name,
      type: "mention",
      title: `${base.fromUserName}さんにメンションされました`,
      body: `ホワイトボード「${base.boardTitle}」のコメント`,
      ticket_id: null,
      ticket_wbs: "",
      ticket_title: base.boardTitle,
      project_slug: base.projectSlug,
      mention_context: buildWhiteboardMentionContext(base.boardId, base.commentId),
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

/** 自分以外のコメントへ返信した時、その投稿者へ知らせる（チケットのコメントと同じ挙動）。 */
export async function notifyWhiteboardReply(
  base: WbNotifyBase, text: string, toUserName: string,
): Promise<void> {
  if (!isSupabaseEnabled || !base.projectSlug) return;
  if (!toUserName || toUserName === base.fromUserName) return;
  if (allowedTargets(base, [toUserName]).length === 0) return;

  await insertNotification({
    user_name: toUserName,
    type: "comment",
    title: `${base.fromUserName}さんがコメントに返信しました`,
    body: `ホワイトボード「${base.boardTitle}」のコメント`,
    ticket_id: null,
    ticket_wbs: "",
    ticket_title: base.boardTitle,
    project_slug: base.projectSlug,
    mention_context: buildWhiteboardMentionContext(base.boardId, base.commentId),
    is_read: false,
  });

  fireSlackNotify({
    recipientUserNames: [toUserName],
    projectSlug: base.projectSlug,
    title: `${base.fromUserName}さんがコメントに返信しました`,
    body: slackBody(base, text),
  });
}
