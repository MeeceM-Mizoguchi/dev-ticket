// Wiki / 議事録 / バックログ / ファイルボックスの「リンクを発行」共通ロジック。
//
// 発行するのは既存のルーティングそのままのURLなので、受け取った相手が開けば
// その ページ / フォルダ / ファイル が選択された状態で着地する。
//   Wiki       … /<slug>/wiki/pages/<uuid>       /<slug>/wiki/folders/<uuid>
//   議事録      … /<slug>/minutes/<slug|uuid>     /<slug>/minutes/folders/<uuid>
//   バックログ   … /<slug>/backlog/<B-001>        /<slug>/backlog/folders/<BF-001>
//   ファイル     … /<slug>/files?file=<uuid>      /<slug>/files?folder=<uuid>
//
// 絶対URLのオリジンは必ず appOrigin() を通す。ネイティブ(capacitor://localhost)の
// オリジンをそのまま渡すと相手が開けないため。
import { appOrigin } from "./appOrigin";

/** ファイルボックスでフォルダを直接開くためのクエリパラメータ */
export const FILE_FOLDER_PARAM = "folder";

export type ShareTarget =
  | { kind: "wiki-page"; id: string }
  | { kind: "wiki-folder"; id: string }
  | { kind: "minute"; id: string }
  | { kind: "minute-folder"; id: string }
  | { kind: "backlog"; id: string }
  | { kind: "backlog-folder"; id: string }
  | { kind: "file"; id: string }
  | { kind: "file-folder"; id: string };

/** アプリ内遷移用の相対パス（navigate にそのまま渡せる） */
export function buildSharePath(projectSlug: string, target: ShareTarget): string {
  const s = encodeURIComponent(projectSlug);
  const id = encodeURIComponent(target.id);
  switch (target.kind) {
    case "wiki-page": return `/${s}/wiki/pages/${id}`;
    case "wiki-folder": return `/${s}/wiki/folders/${id}`;
    case "minute": return `/${s}/minutes/${id}`;
    case "minute-folder": return `/${s}/minutes/folders/${id}`;
    case "backlog": return `/${s}/backlog/${id}`;
    case "backlog-folder": return `/${s}/backlog/folders/${id}`;
    case "file": return `/${s}/files?file=${id}`;
    case "file-folder": return `/${s}/files?${FILE_FOLDER_PARAM}=${id}`;
  }
}

/**
 * 共有用の絶対URL。公開オリジンが解決できない場合
 * （ネイティブ＋VITE_PUBLIC_APP_ORIGIN未設定）は null。
 */
export function buildShareLink(projectSlug: string, target: ShareTarget): string | null {
  const origin = appOrigin();
  if (!origin || !projectSlug) return null;
  return `${origin}${buildSharePath(projectSlug, target)}`;
}
