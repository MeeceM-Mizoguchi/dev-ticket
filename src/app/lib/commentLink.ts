// チケットコメントへのディープリンクの生成とアンカー解析。
//
// URL形式は既存の「アンカー付きチケットURL」規約にそのまま乗せてある。
//   https://<公開オリジン>/<PROJECT_SLUG>/<WBS>?anchor=comment:<commentId>
// ・?anchor= は全文検索（GlobalSearch）とメンション通知（Topbar）が既に発行しているキー。
//   コメントを指すURLを2系統に分けると着地処理も2重になるため、必ずここに寄せる。
// ・commentId は ticket_comments.id（`CMT-<timestamp>` 形式）。親コメントでも返信でも同じ形。
import { appOrigin } from "./appOrigin";

export const ANCHOR_PARAM = "anchor";
export const COMMENT_ANCHOR_PREFIX = "comment:";

/** 通知やURLに載せるアンカー文字列を作る。 */
export function buildCommentAnchor(commentId: string): string {
  return `${COMMENT_ANCHOR_PREFIX}${commentId}`;
}

/** アンカー文字列がコメント指定ならコメントIDを返す。そうでなければ null。 */
export function parseCommentAnchor(anchor?: string | null): string | null {
  if (!anchor || !anchor.startsWith(COMMENT_ANCHOR_PREFIX)) return null;
  return anchor.slice(COMMENT_ANCHOR_PREFIX.length) || null;
}

/** アプリ内遷移用の相対パス（navigate / タブ遷移に渡す）。 */
export function buildCommentPath(projectSlug: string, wbs: string, commentId: string): string {
  return `/${encodeURIComponent(projectSlug)}/${encodeURIComponent(wbs)}`
    + `?${ANCHOR_PARAM}=${encodeURIComponent(buildCommentAnchor(commentId))}`;
}

/**
 * 共有用の絶対URL。公開オリジンが解決できない場合（ネイティブ＋VITE_PUBLIC_APP_ORIGIN未設定）は
 * null を返す。capacitor://localhost 始まりのURLを渡しても相手は開けないため、
 * 呼び出し側でエラーを出す。
 */
export function buildCommentLink(projectSlug: string, wbs: string, commentId: string): string | null {
  const origin = appOrigin();
  if (!origin) return null;
  return `${origin}${buildCommentPath(projectSlug, wbs, commentId)}`;
}
