import { supabase } from "@/lib/supabase";
import type { ProjectFile } from "@/app/types";
import { stageProjectFile, registerStagedFile, type GoogleAppKind, type GoogleCreateKind } from "@/app/lib/projectFiles";
import { openPendingTab } from "@/app/lib/pendingTab";

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
export async function startGoogleOAuth(returnTo: string = currentPathForReturn()): Promise<void> {
  const { url } = await postApi<{ url: string }>("oauth-start", { returnTo });
  window.location.href = url;
}

/** 連携結果を載せるクエリ。連携後に戻ってきた画面で読み、すぐに消す */
export const GOOGLE_RESULT_PARAM = "google";
export const GOOGLE_MESSAGE_PARAM = "message";

/**
 * 連携後に戻る先＝今の画面（BRU17-028）。
 * 以前は必ず管理者向けの外部連携画面へ戻っていたため、一般メンバーは行き止まりになっていた。
 * 前回の連携結果のクエリが残っていたら落としておく（戻ったときに二重に付くため）。
 */
function currentPathForReturn(): string {
  const params = new URLSearchParams(window.location.search);
  params.delete(GOOGLE_RESULT_PARAM);
  params.delete(GOOGLE_MESSAGE_PARAM);
  const qs = params.toString();
  return `${window.location.pathname}${qs ? `?${qs}` : ""}`;
}

/**
 * 紐づけたGoogleアカウントへ、見てよい既存のGoogleファイルの権限を付け直す（BRU17-028）。
 * それまでのファイルは招待メールのアドレス宛てに配られているため、紐づけ直後に呼ぶ。
 */
export function grantGoogleToSelf(): Promise<{ granted: number; failed: { name: string; reason: string }[] }> {
  return postApi<{ granted: number; failed: { name: string; reason: string }[] }>("grant-self");
}

export function disconnectGoogle(): Promise<{ ok: boolean }> {
  return postApi<{ ok: boolean }>("disconnect");
}

/** 新規作成。別タブで開くURLを返す（開くのは呼び出し側） */
export function createGoogleFile(
  projectId: string, kind: GoogleCreateKind, parentId?: string | null, name?: string,
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
  // 変換できれば実体は Drive 側へ移り、ファイルボックスの容量は使わない。
  // 変換に失敗して「そのまま保存」になったときは、下の registerStagedFile が容量を確かめる。
  const path = await stageProjectFile(projectId, file, { skipQuotaCheck: true });

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

/**
 * ファイルボックスにある Office文書を Google形式にコピーする（「Googleスプレッドシートで開く」等）。
 * 元のファイルは残り、Google形式のコピーが同じフォルダに1行増える。
 * 呼ぶたびに、その時点の最新版から新しくコピーを作る。
 * @returns 開く先のURLと、登録された名前
 */
export function convertExistingFile(fileId: string): Promise<CreateResult> {
  return postApi<CreateResult>("convert-existing", { fileId });
}

/**
 * ファイルボックスにある Googleファイルを Office文書に変換する（convertExistingFile の逆向き）。
 * スプレッドシート → .xlsx / ドキュメント → .docx / スライド → .pptx。
 * 元の Googleファイルは残り、通常のファイルとして Office文書が同じフォルダに1行増える
 * （ビュワー・アプリで開く・画面で編集が既存のまま使える）。
 * @returns 登録された名前
 */
export function exportGoogleToOffice(fileId: string): Promise<{ file: unknown; fileName: string }> {
  return postApi<{ file: unknown; fileName: string }>("export-office", { fileId });
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
 * もともと Drive にあるファイルをファイルボックスへ取り込む。種別は問わない
 * （Google形式・Office文書・PDF・画像など、Drive にあるものは全て追加できる）。
 * fileIds は pickGoogleFiles()（Picker）で選ばれたものに限る。
 * 保存先フォルダの外にあるものは、サーバー側で保存先へコピーしてから追加される。
 */
export function importGoogleFiles(
  projectId: string, fileIds: string[], parentId?: string | null,
): Promise<ImportResult> {
  return postApi<ImportResult>("import-files", { projectId, fileIds, parentId: parentId ?? null });
}

export interface SyncAclResult {
  /** Drive の編集者から外した人数（リンク共有の解除も1件と数える） */
  removed: number;
  /** 新しく権限を付けた人数 */
  granted: number;
  /** 外せなかった・付けられなかった相手（共有ドライブのメンバーとして見えている人など） */
  failed: { name: string; reason: string }[];
  /** 組織のGoogle連携がオフで、何もしなかった */
  skipped: boolean;
}

/**
 * 限定公開の設定を Googleドライブ側の権限へ反映する。
 * DevTicket 側の変更（setFileVisibility / addFileShares / removeFileShare）の後に呼ぶ。
 * 何度呼んでも、その時点の設定に Drive を合わせるだけ。
 */
export function syncGoogleFileAcl(fileId: string): Promise<SyncAclResult> {
  return postApi<SyncAclResult>("sync-acl", { fileId });
}

/** Drive 側のファイル名も合わせる。DevTicket 側の改名(renameProjectFile)の後に呼ぶ */
export function renameGoogleFile(fileId: string, newName: string): Promise<{ ok: boolean }> {
  return postApi<{ ok: boolean }>("rename", { fileId, newName });
}

/**
 * プロジェクト名の変更を、Googleドライブ上の保存先フォルダ名へ反映する（共有ドライブ運用のみ）。
 * DevTicket 側の projects の更新の後に、変更前の名前を渡して呼ぶ。
 *
 * マイドライブ運用・Google未連携などでは何もしない（skipped）。
 * 反映できなくても、フォルダは ID で引くのでファイルは開ける。
 */
export function renameGoogleProjectFolder(
  projectId: string, oldName: string,
): Promise<{ renamed: boolean; skipped: boolean; reason: string }> {
  return postApi<{ renamed: boolean; skipped: boolean; reason: string }>(
    "rename-project-folder", { projectId, oldName });
}

export interface TrashResult {
  /** ゴミ箱へ移動できた件数 */
  trashed: number;
  /** 移動できなかったもの（他の人が追加したファイル・権限不足など） */
  failed: { name: string; reason: string }[];
}

/**
 * Googleドライブ上の実体をゴミ箱へ移動する。
 *
 * ★ DevTicket 側の削除(deleteProjectFile)より「前」に呼ぶこと。
 *   Drive の実体を指す external_id は project_files の行にしか無く、
 *   先に行を消すと、どれを消せばいいか分からなくなる。
 *
 * フォルダを渡すと、配下（入れ子のフォルダの中まで）のGoogleドライブ上のファイルを
 * まとめてゴミ箱へ入れる。DevTicket 側はフォルダの行を消せば子孫の行もDBが消すので、
 * 「消える前に Drive 側を片付ける」ための経路。
 */
export function trashGoogleFiles(target: { fileId?: string; folderId?: string }): Promise<TrashResult> {
  return postApi<TrashResult>("trash", target);
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
 * draw.io の図を開いたときの案内。
 *
 * ★ draw.io の図は app.diagrams.net/#G<ID> で直接開かず、Googleドライブのファイル画面を開く。
 *   draw.io も drive.file 相当の権限で動いており、そのファイルを一度も Googleドライブの画面から
 *   draw.io で開いたことがない人には、直接リンクだと「ファイルが見つかりません」になる
 *   （draw.io 側の既知の制約: https://github.com/jgraph/drawio/issues/3742）。
 *   DevTicket が作った・コピーしたファイルは必ずこれに当たる。
 *   Googleドライブの画面の「アプリで開く」から draw.io を選べば、その操作で権限が通る。
 */
export const DRAWIO_OPEN_HINT =
  "Googleドライブの画面上部の「アプリで開く」から「draw.io」を選ぶと編集できます（初回は draw.io への許可が必要です）";

/**
 * Drive 上の Office文書（.xlsx / .docx / .pptx など）を開いたときの案内。
 *
 * これらは Google形式ではないので、開く先は Googleドライブのプレビュー画面になる。
 * 中身を見るだけならそのままでよく、編集はその画面から Google の各アプリで開いてもらう
 * （Office形式のまま編集・保存される）。
 * @param app 「スプレッドシート」「ドキュメント」「スライド」のいずれか
 */
export function officeOnDriveHint(app: string): string {
  return `Googleドライブの画面上部の「Google${app}で開く」から編集できます（${app}で編集しても元の形式のまま保存されます）`;
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

export interface EnsureAccessResult {
  /** 紐づけたGoogleアカウントで開ける状態になった（付与した／付与済みの記録があった） */
  ok: boolean;
  /** サーバー側の記録により、Drive への問い合わせを省いた */
  cached?: boolean;
  /** 付与しなかった理由（未紐づけ・運営アカウント・連携が無効） */
  skipped?: string;
  /** 付与に失敗した理由 */
  reason?: string;
}

// このタブの中で権限を確かめ終えたファイル。2回目以降はサーバーへも問い合わせずに開く。
// （紐づけを変えると OAuth のリダイレクトで読み込み直しになり、ここも空に戻る）
const accessEnsured = new Set<string>();
// 同じファイルへの問い合わせが重なったら1本にまとめる（連打・共有リンクの effect の再実行）
const accessInFlight = new Map<string, Promise<EnsureAccessResult>>();

/**
 * 開く直前に、紐づけたGoogleアカウントへそのファイルの編集権限を付ける。
 * 後から紐づけた人・後からプロジェクトに入った人は、作成時の配布に含まれていないため。
 */
export function ensureGoogleAccess(fileId: string): Promise<EnsureAccessResult> {
  const inFlight = accessInFlight.get(fileId);
  if (inFlight) return inFlight;
  const p = postApi<EnsureAccessResult>("ensure-access", { fileId })
    .then(r => { if (r.ok) accessEnsured.add(fileId); return r; })
    .finally(() => { accessInFlight.delete(fileId); });
  accessInFlight.set(fileId, p);
  return p;
}

/**
 * 権限を確かめてから Googleファイルを別タブで開く。
 *
 * ★ クリックと同じ実行の中で呼ぶこと。権限の確認を await する前に空タブを確保し、
 *   終わってから URL を流し込む（await の後の window.open はポップアップブロックに当たる。pendingTab.ts 参照）。
 * ★ 付与に失敗しても開く。共有ドライブのメンバーなど、付与しなくても開ける人がいるため。
 *   失敗の理由は warning で返すので、呼び出し側で伝える。
 *
 * @param linked Googleアカウントを紐づけているか。false なら確認せずにそのまま開く（付ける先が無い）
 */
export async function openGoogleFileEnsuringAccess(
  file: Pick<ProjectFile, "id" | "fileName" | "externalUrl">, linked: boolean | null,
): Promise<{ opened: boolean; warning?: string }> {
  const url = file.externalUrl;
  if (!url) return { opened: false };
  if (linked === false || accessEnsured.has(file.id)) return { opened: openGoogleFile(file) };
  // BUG-05 確認中にもう一度押されても、空タブを増やさない（1回目の確認が終わればそのタブが開く）
  if (accessInFlight.has(file.id)) return { opened: true };

  const tab = openPendingTab(
    "Googleで開いています",
    `「${file.fileName}」を開けるよう、紐づけたGoogleアカウントの権限を確認しています。`,
  );
  let warning: string | undefined;
  try {
    const r = await ensureGoogleAccess(file.id);
    if (!r.ok && r.reason) warning = `紐づけたGoogleアカウントに共有できませんでした（${r.reason}）`;
  } catch (e) {
    warning = e instanceof Error ? e.message : "Googleファイルの権限を確認できませんでした";
  }
  if (!tab) return { opened: false, warning };
  tab.location.href = url;
  return { opened: true, warning };
}
