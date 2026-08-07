// ホワイトボードのオブジェクト(図形/フレーム/グループ)・コメントへのディープリンクの生成と解析。
//
// URL形式は Excalidraw ネイティブの「要素リンク」と完全互換にしてある。
//   https://<公開オリジン>/<PROJECT_SLUG>/whiteboard/<boardId>?element=<elementId|groupId>
// ・パラメータ名は element 固定。単体要素もグループも同じキーに入る（Excalidraw の仕様）。
// ・?element= が無ければ「ボードを開くだけ」のリンクとして扱う。
//
// コメント（ENHA2-039）は要素ではないので別パラメータを使う。
//   .../whiteboard/<boardId>?comment=<commentId>[&reply=<replyId>]
// ・reply は「返信のリンク」用。着地時に返信一覧を開いた状態にするだけで、飛び先はピン。
import { appOrigin, knownAppOrigins } from "./appOrigin";

export const ELEMENT_LINK_PARAM = "element";
export const COMMENT_LINK_PARAM = "comment";
export const REPLY_LINK_PARAM = "reply";

export interface WhiteboardLink {
  projectSlug: string;
  boardId: string;
  elementId: string | null;
  commentId: string | null;
  replyId: string | null;
}

// ボードID(UUID)らしさの判定。プロジェクトslugや他ページと取り違えないための最低限のガード。
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** 共有用の絶対URLを作る。elementId 省略時はボードそのもののリンク。 */
export function buildWhiteboardLink(projectSlug: string, boardId: string, elementId?: string | null): string {
  const path = `/${encodeURIComponent(projectSlug)}/whiteboard/${boardId}`
    + (elementId ? `?${ELEMENT_LINK_PARAM}=${encodeURIComponent(elementId)}` : "");
  return `${appOrigin()}${path}`;
}

/** アプリ内遷移用の相対パス（タブ遷移/navigate に渡す）。 */
export function buildWhiteboardPath(
  projectSlug: string, boardId: string, elementId?: string | null,
  commentId?: string | null, replyId?: string | null,
): string {
  const q = new URLSearchParams();
  if (elementId) q.set(ELEMENT_LINK_PARAM, elementId);
  if (commentId) q.set(COMMENT_LINK_PARAM, commentId);
  if (commentId && replyId) q.set(REPLY_LINK_PARAM, replyId);
  const qs = q.toString();
  return `/${encodeURIComponent(projectSlug)}/whiteboard/${boardId}` + (qs ? `?${qs}` : "");
}

/** コメント（または返信）を指す共有用の絶対URL。 */
export function buildWhiteboardCommentLink(
  projectSlug: string, boardId: string, commentId: string, replyId?: string | null,
): string {
  return `${appOrigin()}${buildWhiteboardPath(projectSlug, boardId, null, commentId, replyId)}`;
}

// ── 通知の飛び先（notifications.mention_context）────────────────────────
// お知らせ（ベル）の飛び先は元々「チケット」前提の作り（/{slug}/{wbs}?anchor=…）なので、
// ホワイトボードのコメント通知は mention_context に下の形で入れて Topbar に解釈させる。
const WB_MENTION_PREFIX = "whiteboard:";

export function buildWhiteboardMentionContext(boardId: string, commentId: string): string {
  return `${WB_MENTION_PREFIX}${boardId}:${commentId}`;
}

/** mention_context がホワイトボードのコメント宛てなら中身を返す。 */
export function parseWhiteboardMentionContext(context: string | null | undefined): { boardId: string; commentId: string } | null {
  if (!context || !context.startsWith(WB_MENTION_PREFIX)) return null;
  const [boardId, commentId] = context.slice(WB_MENTION_PREFIX.length).split(":");
  if (!boardId || !commentId) return null;
  return { boardId, commentId };
}

/**
 * href がホワイトボードのリンクなら中身を返す。そうでなければ null。
 * 絶対URL(公開オリジン / 現在のオリジン)と相対パスの両方を受け付ける。
 */
export function parseWhiteboardLink(href: string): WhiteboardLink | null {
  if (!href) return null;
  let url: URL;
  try {
    // 相対パスも解決できるよう base を与える（base自体は判定に使わない）
    const base = typeof window !== "undefined" ? window.location.href : "http://localhost/";
    url = new URL(href, base);
  } catch {
    return null;
  }
  // 絶対URLで来た場合は自分のアプリのオリジンに限る（外部サイトのURLを乗っ取らない）
  const isRelative = !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) && !href.startsWith("//");
  if (!isRelative && !knownAppOrigins().includes(url.origin)) return null;

  const seg = url.pathname.split("/").filter(Boolean);
  // /<projectSlug>/whiteboard/<boardId>
  if (seg.length !== 3 || seg[1] !== "whiteboard") return null;
  const projectSlug = decodeURIComponent(seg[0]);
  const boardId = seg[2];
  if (!UUID_RE.test(boardId)) return null;

  const elementId = url.searchParams.get(ELEMENT_LINK_PARAM);
  const commentId = url.searchParams.get(COMMENT_LINK_PARAM);
  const replyId = url.searchParams.get(REPLY_LINK_PARAM);
  return {
    projectSlug, boardId,
    elementId: elementId || null,
    commentId: commentId || null,
    replyId: (commentId && replyId) || null,
  };
}
