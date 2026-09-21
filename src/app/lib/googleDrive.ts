import { supabase } from "@/lib/supabase";
import type { ProjectFile } from "@/app/types";
import { stageProjectFile, registerStagedFile, type GoogleAppKind } from "@/app/lib/projectFiles";

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

export type GoogleUploadResult =
  | { converted: true; url: string; fileName: string; failed: { name: string; reason: string }[] }
  /** 変換に失敗したため「そのまま保存」に切り替えた。reason はその理由 */
  | { converted: false; fileName: string; reason: string };

/**
 * Office文書をGoogle形式に変換してアップロードする。
 *
 * ①ブラウザが既存の署名付きURLで Supabase Storage へ実体を置く（stageProjectFile）
 * ②サーバーがそれを取り出して Drive へ中継し、権限配布とDB登録まで行う（convert-staged）
 *
 * ★ ブラウザから Drive へ直接送る形にしてはいけない。
 *   サーバーで作った再開可能アップロードのセッションURIへブラウザから PUT すると、
 *   応答に Access-Control-Allow-Origin が付かず CORS で必ず弾かれる（本番で実測）。
 *
 * ★ ②で失敗したら、①で置いた実体を「そのまま保存」として登録し直す。
 *   変換できなかったからといって、利用者がアップロードしたファイルを失わせない。
 */
export async function uploadAsGoogleFile(
  projectId: string, file: File, kind: GoogleAppKind, parentId?: string | null,
): Promise<GoogleUploadResult> {
  const path = await stageProjectFile(projectId, file);

  try {
    const res = await postApi<CreateResult>("convert-staged", {
      projectId, path, kind, parentId: parentId ?? null,
      fileName: file.name, fileType: file.type || "",
    });
    return { converted: true, url: res.url, fileName: res.fileName, failed: res.failed };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Google形式への変換に失敗しました";
    // ここで登録にも失敗したら、それは通常のアップロード失敗と同じなので呼び出し側へ投げる
    const stored = await registerStagedFile(projectId, path, file, { uniqueName: true, parentId });
    return { converted: false, fileName: stored, reason };
  }
}

export interface ImportResult {
  /** 追加できたもの。copied=true は保存先フォルダの外にあったためコピーして追加したもの */
  imported: { fileName: string; copied: boolean }[];
  /** 追加できなかったもの（コピー禁止・形式違い・閲覧権限なし・二重登録など） */
  failed: { name: string; reason: string }[];
  /** 追加はできたが、権限を配れなかったメンバー */
  shareFailed: { name: string; reason: string }[];
}

/**
 * もともと Drive にある Googleファイルをファイルボックスへ取り込む。
 * fileIds は pickGoogleFiles()（Picker）で選ばれたものに限る。
 * 保存先フォルダの外にあるものは、サーバー側で保存先へコピーしてから追加される。
 */
export function importGoogleFiles(
  projectId: string, fileIds: string[], parentId?: string | null,
): Promise<ImportResult> {
  return postApi<ImportResult>("import-files", { projectId, fileIds, parentId: parentId ?? null });
}

/** Drive 側のファイル名も合わせる。DevTicket 側の改名(renameProjectFile)の後に呼ぶ */
export function renameGoogleFile(fileId: string, newName: string): Promise<{ ok: boolean }> {
  return postApi<{ ok: boolean }>("rename", { fileId, newName });
}

/** リンクを知っている全員が編集できる状態にする / やめる */
export function setGoogleLinkShare(fileId: string, enabled: boolean): Promise<{ linkShared: boolean }> {
  return postApi<{ linkShared: boolean }>("share-link", { fileId, enabled });
}

export interface SyncNamesResult {
  /** Drive 側の名前に合わせて変更した行 */
  renamed: { before: string; after: string }[];
  /** Drive 上に見つからなかった project_files の id（行は消さず、画面に「削除済み」と出す） */
  missing: string[];
  /** 連携が無効・Google未連携などで同期しなかった */
  skipped: boolean;
}

/**
 * Drive 側の変更（名前の変更・削除）を DevTicket へ取り込む。
 * ファイルボックスを開いたとき・タブに戻ってきたときに呼ぶ。
 */
export function syncGoogleNames(projectId: string): Promise<SyncNamesResult> {
  return postApi<SyncNamesResult>("sync-names", { projectId });
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
