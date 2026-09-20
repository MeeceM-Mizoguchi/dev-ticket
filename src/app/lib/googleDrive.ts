import { supabase } from "@/lib/supabase";
import type { ProjectFile } from "@/app/types";
import type { GoogleAppKind } from "@/app/lib/projectFiles";

// Googleドライブ連携のクライアント側入口（設計: docs/google-drive-integration-design.md）
//
// サーバー(api/google/[action].ts)が Drive API を叩き、DevTicket 側の登録まで済ませる。
// ブラウザは Google のアクセストークンを一切持たない。

/** 個人ドライブの注意モーダルを「次回以降表示しない」の保存キー */
export function myDriveWarningKey(userId: string): string {
  return `devticket.gdrive.myDriveWarning.dismissed.${userId}`;
}

export type GoogleDriveMode = "off" | "shared_drive" | "my_drive";

export interface GoogleDriveStatus {
  /** このユーザーがGoogleアカウントを連携済みか */
  connected: boolean;
  googleEmail: string | null;
  /** サーバーに GOOGLE_CLIENT_ID が設定されているか（未設定なら機能ごと出さない） */
  configured: boolean;
  mode: GoogleDriveMode;
  /** 保存先フォルダが属する共有ドライブ */
  sharedDriveId: string | null;
  /** 管理者が Picker で選んだ保存先フォルダ */
  sharedFolderId: string | null;
  /** 表示用のフォルダ名 */
  sharedDriveName: string | null;
}

/**
 * ファイルボックスが「Googleアプリ」ボタンを出すために必要な最小限の設定。
 *
 * 画面側はこれを organizations の行から**直接**読む（/api/google/status を経由しない）。
 * サーバーを挟むと、プロジェクトの解決 → 一覧取得 → 連携状態の取得、と往復が数珠つなぎになり、
 * 一覧が描かれた後にボタンだけ遅れて生えてくる（BUG-04 と同じ見え方）。
 * 一覧と同じ Promise.all に並べることで、必ず同時に出る。
 *
 * mode が 'off' 以外なら、サーバー側の環境変数は必ず設定済み。
 * 設定画面は configured が false だとモードを選ばせず、保存にはGoogle連携の成立が要るため、
 * 「'off' 以外が保存されている」こと自体が有効化済みの証明になっている。
 */
export interface GoogleDriveProjectConfig {
  mode: Exclude<GoogleDriveMode, "off">;
  /** 共有ドライブ運用のときの保存先フォルダ名（表示用） */
  folderName: string | null;
}

export interface CreateResult {
  file: unknown;
  url: string;
  fileName: string;
  /** 権限を配れたメンバー数 */
  shared: number;
  /** 配れなかったメンバー（Googleアカウント未所持・管理者設定による制限など） */
  failed: { name: string; reason: string }[];
}

async function postApi<T>(action: string, body: unknown = {}): Promise<T> {
  const { data: { session } } = await supabase!.auth.getSession();
  if (!session?.access_token) throw new Error("未ログインです");

  const res = await fetch(`/api/google/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    const err = new Error(msg?.error || "リクエストに失敗しました") as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

/** 連携状態と、そのプロジェクトの組織の設定をまとめて取る */
export function fetchGoogleDriveStatus(projectId?: string | null): Promise<GoogleDriveStatus> {
  return postApi<GoogleDriveStatus>("status", projectId ? { projectId } : {});
}

/**
 * Googleアカウントの連携を開始する。
 * サーバーから302させず、認可URLをJSONで受けてブラウザ側で遷移する
 * （302だと誰の連携かを示す情報をクエリに載せる必要が出て、URLとログに残るため）。
 */
export async function startGoogleOAuth(): Promise<void> {
  const { url } = await postApi<{ url: string }>("oauth-start");
  window.location.href = url;
}

export function disconnectGoogle(): Promise<{ ok: boolean }> {
  return postApi<{ ok: boolean }>("disconnect");
}

/** 新規作成。別タブで開くURLを返す（開くのは呼び出し側） */
export function createGoogleFile(
  projectId: string, kind: GoogleAppKind, parentId?: string | null, name?: string,
): Promise<CreateResult> {
  return postApi<CreateResult>("create", { projectId, kind, parentId: parentId ?? null, name });
}

/** Drive 側のファイル名も合わせる。DevTicket 側の改名(renameProjectFile)の後に呼ぶ */
export function renameGoogleFile(fileId: string, newName: string): Promise<{ ok: boolean }> {
  return postApi<{ ok: boolean }>("rename", { fileId, newName });
}

/** リンクを知っている全員が編集できる状態にする / やめる */
export function setGoogleLinkShare(fileId: string, enabled: boolean): Promise<{ linkShared: boolean }> {
  return postApi<{ linkShared: boolean }>("share-link", { fileId, enabled });
}

/** プロジェクトの全Googleファイルへ、現在のメンバー全員の権限を配り直す */
export function syncGooglePermissions(projectId: string): Promise<{ granted: number; failed: { name: string; reason: string }[] }> {
  return postApi<{ granted: number; failed: { name: string; reason: string }[] }>(
    "sync-permissions", { projectId });
}

/**
 * Google Picker 用の短命アクセストークンを取る。
 * ブラウザに渡るのは drive.file スコープのアクセストークンのみ（リフレッシュトークンは渡らない）。
 */
export function fetchPickerToken(): Promise<{ accessToken: string }> {
  return postApi<{ accessToken: string }>("picker-token");
}

/**
 * Picker で選ばれたフォルダの素性をサーバーで確かめる。
 * Picker が返すのはIDと名前だけなので、フォルダかどうかと、
 * どの共有ドライブに属するかはここで解決する。
 */
export function resolveGoogleFolder(folderId: string): Promise<{ id: string; name: string; driveId: string }> {
  return postApi<{ id: string; name: string; driveId: string }>("resolve-folder", { folderId });
}

/** 選んだフォルダに実際に作成・共有できるか試す（設定の保存前の関門） */
export function testGoogleConnection(folderId: string): Promise<{ ok: boolean; sharedTo: string | null }> {
  return postApi<{ ok: boolean; sharedTo: string | null }>("test-connection", { folderId });
}

/**
 * Googleファイルを別タブで開く。
 *
 * noopener を付けるのは、開いた先から window.opener 経由で DevTicket 側を
 * 操作できないようにするため。
 */
export function openGoogleFile(file: Pick<ProjectFile, "externalUrl">): boolean {
  if (!file.externalUrl) return false;
  window.open(file.externalUrl, "_blank", "noopener,noreferrer");
  return true;
}
