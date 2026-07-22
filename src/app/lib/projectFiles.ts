import { supabase } from "@/lib/supabase";

// ENHA2-035 ファイルボックス共通ロジック
// 「ブラウザで閲覧」は全てクライアント内(自前ビューア)で完結させ、
// Microsoft/Google などの外部ビューアには一切ファイルを渡さない。

export type FileKind = "pdf" | "excel" | "word" | "powerpoint" | "image" | "text" | "other";

const EXT_KIND: Record<string, FileKind> = {
  pdf: "pdf",
  xlsx: "excel", xlsm: "excel", xls: "excel", csv: "text",
  docx: "word", doc: "word",
  pptx: "powerpoint", ppt: "powerpoint",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", bmp: "image",
  txt: "text", md: "text", json: "text", log: "text", xml: "text", yml: "text", yaml: "text",
};

// 自前ビューアで実際に描画できる拡張子。
// レガシーバイナリ形式(.xls/.doc)と pptx は対応ライブラリが無いため閲覧不可。
const PREVIEWABLE_EXT = new Set([
  "pdf",
  "xlsx", "xlsm",
  "docx",
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp",
  "txt", "md", "csv", "json", "log", "xml", "yml", "yaml",
]);

// Office のURIスキームで起動できる種別 → スキーム名
const OFFICE_SCHEME: Partial<Record<FileKind, string>> = {
  word: "ms-word",
  excel: "ms-excel",
  powerpoint: "ms-powerpoint",
};

export function getExt(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i < 0 ? "" : fileName.slice(i + 1).toLowerCase();
}

export function getFileKind(fileName: string): FileKind {
  return EXT_KIND[getExt(fileName)] ?? "other";
}

export function canPreviewInBrowser(fileName: string): boolean {
  return PREVIEWABLE_EXT.has(getExt(fileName));
}

// デスクトップアプリ起動用URI。Office系以外は null(=「アプリで開く」を出さない)。
// 注意: 署名付きURLは読み取り専用のため、アプリ側から直接上書き保存はできない。
// 編集後は「名前を付けて保存 → ファイルボックスに再アップロード」の運用になる。
export function officeProtocolUrl(fileName: string, signedUrl: string): string | null {
  const scheme = OFFICE_SCHEME[getFileKind(fileName)];
  return scheme ? `${scheme}:ofe|u|${signedUrl}` : null;
}

export function isOfficeFile(fileName: string): boolean {
  return OFFICE_SCHEME[getFileKind(fileName)] !== undefined;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// 種別ごとの表示色（一覧のアイコン用）
export const KIND_COLOR: Record<FileKind, string> = {
  pdf: "#DC2626", excel: "#059669", word: "#2563EB", powerpoint: "#EA580C",
  image: "#7C3AED", text: "#6B6458", other: "#9E9690",
};

// 全ての storage 操作は api/project-files/[action] (service_role) 経由で行う。
// クライアントから storage.objects を直接触らないため、バケットのRLSポリシー設定が不要。
async function postApi<T>(action: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase!.auth.getSession();
  if (!session?.access_token) throw new Error("未ログインです");

  const res = await fetch(`/api/project-files/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error(msg?.error || "リクエストに失敗しました");
  }
  return res.json() as Promise<T>;
}

/** 閲覧・DL用の短命な署名付きURLを取得する（サーバー側でメンバー判定） */
export async function fetchSignedUrl(fileId: string, mode: "inline" | "download" = "inline"): Promise<string> {
  const res = await postApi<{ url: string }>("signed-url", { fileId, mode });
  return res.url;
}

/**
 * ファイルをアップロードする。
 * ①サーバーが保存キーを決めて署名付きアップロードURLを発行
 * ②ブラウザ→ストレージへ直接アップロード（サーバーレス関数のサイズ上限を回避）
 * ③サーバー側でDB登録（版番号の採番も含む）
 */
export async function uploadProjectFile(projectId: string, file: File): Promise<void> {
  const fileName = file.name;
  const { path, token } = await postApi<{ path: string; token: string }>(
    "upload-url", { projectId, fileName });

  const { error } = await supabase!.storage.from("project-files")
    .uploadToSignedUrl(path, token, file, { contentType: file.type || "application/octet-stream" });
  if (error) throw new Error(error.message);

  await postApi<{ file: unknown }>("register", {
    projectId, path, fileName, fileSize: file.size, fileType: file.type || "",
  });
}

/**
 * デスクトップアプリから直接保存できる WebDAV URL を取得する。
 * Office はここへ Ctrl+S で PUT を投げ、サーバー側が新バージョンとして登録する。
 */
export async function fetchDavUrl(fileId: string): Promise<string> {
  const res = await postApi<{ url: string }>("dav-url", { fileId });
  return res.url;
}

/** DB行とストレージ実体をまとめて削除する */
export async function deleteProjectFile(fileId: string): Promise<void> {
  await postApi<{ ok: boolean }>("delete", { fileId });
}

/** ダウンロード（元のファイル名で保存される署名付きURLへ遷移する） */
export async function downloadProjectFile(fileId: string): Promise<void> {
  window.location.href = await fetchSignedUrl(fileId, "download");
}

/**
 * デスクトップの Office で開く。WebDAV URL を渡すので Ctrl+S がそのまま反映される。
 * @returns 対応形式でなければ false
 */
export async function openProjectFileInApp(fileId: string, fileName: string): Promise<boolean> {
  const proto = officeProtocolUrl(fileName, await fetchDavUrl(fileId));
  if (!proto) return false;
  window.location.href = proto;
  return true;
}
