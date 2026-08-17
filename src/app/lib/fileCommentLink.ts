// ファイルボックスのコメント（BRU12-025）へのディープリンクの生成と解析。
//
// URL形式は、既にファイルボックスが持っている共有リンク（?file=<fileId>）にコメントの
// パラメータを足しただけ。着地処理を2系統に分けないよう、必ずこの形に寄せる。
//   https://<公開オリジン>/<PROJECT_SLUG>/files?file=<fileId>&comment=<commentId>[&reply=<replyId>]
// ・?file= だけなら従来どおり「ビューアを開くだけ」。
// ・reply は「返信のリンク」用。着地時に返信一覧を開いた状態にするだけで、飛び先はピン。
// ・fileId は挿入時点の版でよい（FileBoxPage 側が同名の最新版へ読み替える）。
import { appOrigin } from "./appOrigin";

export const FILE_PARAM = "file";
export const FILE_COMMENT_PARAM = "comment";
export const FILE_REPLY_PARAM = "reply";

/** アプリ内遷移用の相対パス（navigate に渡す）。 */
export function buildFileCommentPath(
  projectSlug: string, fileId: string, commentId?: string | null, replyId?: string | null,
): string {
  const q = new URLSearchParams();
  q.set(FILE_PARAM, fileId);
  if (commentId) q.set(FILE_COMMENT_PARAM, commentId);
  if (commentId && replyId) q.set(FILE_REPLY_PARAM, replyId);
  return `/${encodeURIComponent(projectSlug)}/files?${q.toString()}`;
}

/**
 * コメント（または返信）を指す共有用の絶対URL。
 * 公開オリジンが解決できない場合（ネイティブ＋VITE_PUBLIC_APP_ORIGIN未設定）は null。
 * capacitor://localhost 始まりのURLを渡しても相手は開けないため、呼び出し側で警告を出す。
 */
export function buildFileCommentLink(
  projectSlug: string, fileId: string, commentId: string, replyId?: string | null,
): string | null {
  const origin = appOrigin();
  if (!origin) return null;
  return `${origin}${buildFileCommentPath(projectSlug, fileId, commentId, replyId)}`;
}

// ── 通知の飛び先（notifications.mention_context）────────────────────────
// お知らせ（ベル）の飛び先は元々「チケット」前提の作り（/{slug}/{wbs}?anchor=…）なので、
// ホワイトボード（whiteboard:…）と同じ要領で、ファイルのコメントも下の形で入れて
// Topbar に解釈させる。
const FILE_MENTION_PREFIX = "file:";

export function buildFileMentionContext(fileId: string, commentId: string): string {
  return `${FILE_MENTION_PREFIX}${fileId}:${commentId}`;
}

/** mention_context がファイルのコメント宛てなら中身を返す。 */
export function parseFileMentionContext(context: string | null | undefined): { fileId: string; commentId: string } | null {
  if (!context || !context.startsWith(FILE_MENTION_PREFIX)) return null;
  const [fileId, commentId] = context.slice(FILE_MENTION_PREFIX.length).split(":");
  if (!fileId || !commentId) return null;
  return { fileId, commentId };
}
