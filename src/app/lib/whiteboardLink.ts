// ホワイトボードのオブジェクト(図形/フレーム/グループ)へのディープリンクの生成と解析。
//
// URL形式は Excalidraw ネイティブの「要素リンク」と完全互換にしてある。
//   https://<公開オリジン>/<PROJECT_SLUG>/whiteboard/<boardId>?element=<elementId|groupId>
// ・パラメータ名は element 固定。単体要素もグループも同じキーに入る（Excalidraw の仕様）。
// ・?element= が無ければ「ボードを開くだけ」のリンクとして扱う。
import { appOrigin, knownAppOrigins } from "./appOrigin";

export const ELEMENT_LINK_PARAM = "element";

export interface WhiteboardLink {
  projectSlug: string;
  boardId: string;
  elementId: string | null;
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
export function buildWhiteboardPath(projectSlug: string, boardId: string, elementId?: string | null): string {
  return `/${encodeURIComponent(projectSlug)}/whiteboard/${boardId}`
    + (elementId ? `?${ELEMENT_LINK_PARAM}=${encodeURIComponent(elementId)}` : "");
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
  return { projectSlug, boardId, elementId: elementId || null };
}
