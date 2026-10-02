import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

// Googleドライブ連携（ファイルボックス）
// 設計: docs/google-drive-integration-design.md
//
// ファイルボックスから Googleスプレッドシート／ドキュメント／スライド／draw.io 図を新規作成し、
// 別タブで開いて編集できるようにする。作成したファイルは project_files にも登録され、
// DevTicket の一覧・フォルダ階層にそのまま並ぶ。
//
// draw.io 図（.drawio）は Google形式ではなく、Drive 上の普通のファイル（中身は XML）。
// 編集は draw.io 側（app.diagrams.net）が Drive のファイルを直接読み書きして行い、
// DevTicket は作成・取り込み・一覧への登録だけを受け持つ（同時編集も draw.io 側の機能）。
//
// ★ スコープは drive.file のみ。
//   非センシティブスコープなので Google のアプリ審査・CASA が不要になる。
//   「アプリが作ったファイル」と「ユーザーが Picker で選んだもの」しか触れない代わりに、
//   drive / drive.readonly のような審査（数週間）が一切発生しない。
//   ここを広げると審査が必要になるので、スコープは絶対に増やさないこと。
//
// ★ drive.file では drives.list / drives.create が使えない。
//   そのため共有ドライブの一覧提示も新規作成もできず、
//   「顧客側で作成済みの共有ドライブを Google Picker で選んでもらう」形になっている。
//
// endpoints (Vercel の [action] 動的セグメント):
//   POST /api/google/oauth-start      { returnTo? }                       → { url }
//   GET  /api/google/oauth-callback   ?code=&state=                       → 302
//   POST /api/google/status           { projectId? }                      → { connected, mode, ... }
//   POST /api/google/disconnect       {}                                  → { ok }
//   POST /api/google/create           { projectId, kind, parentId? }      → { file, url }
//                                     kind: spreadsheet | document | presentation | drawio
//   POST /api/google/convert-staged   { projectId, path, kind, fileName, ... } → { file, url }
//   POST /api/google/import-files     { projectId, fileIds, parentId? }   → { imported, failed, shareFailed }
//   POST /api/google/convert-existing { fileId }                          → { file, url, fileName }
//   POST /api/google/export-office    { fileId }                          → { file, fileName }
//   POST /api/google/rename           { fileId, newName }                 → { ok }
//   POST /api/google/rename-project-folder { projectId, oldName }         → { renamed, skipped, reason }
//   POST /api/google/trash            { fileId } / { folderId }           → { trashed, failed }
//   POST /api/google/share-link       { fileId, enabled }                 → { linkShared }
//   POST /api/google/sync-names       { projectId }                       → { renamed, missing }
//   POST /api/google/sync-permissions { projectId }                       → { granted, failed }
//   POST /api/google/grant-self       {}                                  → { granted, failed }
//   POST /api/google/ensure-access    { fileId }                          → { ok, cached?, skipped?, reason? }
//   POST /api/google/resolve-folder   { folderId }                        → { id, name, driveId }
//   POST /api/google/test-connection  { folderId }                        → { ok } / 400

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

// ★ ここを広げると Google のアプリ審査が必要になる。増やさないこと（冒頭コメント参照）
const SCOPE = "https://www.googleapis.com/auth/drive.file email";

const STATE_TTL_MS = 10 * 60 * 1000;
const ROOT_FOLDER_NAME = "DevTicket";

const MIME: Record<string, string> = {
  spreadsheet: "application/vnd.google-apps.spreadsheet",
  document: "application/vnd.google-apps.document",
  presentation: "application/vnd.google-apps.presentation",
};
const FOLDER_MIME = "application/vnd.google-apps.folder";
// 別のファイルを指すだけの入れ物。中身を持たないので、指している先に読み替えて扱う
const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

const DEFAULT_NAME: Record<string, string> = {
  spreadsheet: "無題のスプレッドシート",
  document: "無題のドキュメント",
  presentation: "無題のスライド",
  drawio: "無題の図.drawio",
};

// ── draw.io 図 ──────────────────────────────────────────────
// draw.io 自身が Drive に保存するときの MIME タイプ。
// ★ src/app/lib/projectFiles.ts と api/project-files/[action].ts の DRAWIO_MIME と揃えること。
//
// MIME に入れないのは、MIME が「Google形式（変換先）」の一覧として使われているため
// （convert-staged / convert-existing が MIME[kind] を変換先に使う）。
// 入れると、Office文書を draw.io 形式へ「変換」する経路ができてしまう。
const DRAWIO_MIME = "application/vnd.jgraph.mxfile";
const DRAWIO_EXT = ".drawio";

// 新規作成時の中身。空のページが1枚だけある図。
// 0 バイトのファイルにすると、draw.io が「図のファイルではない」と判断して開けないことがある。
const EMPTY_DRAWIO =
  '<mxfile host="DevTicket"><diagram name="ページ1" id="page-1"><mxGraphModel><root>'
  + '<mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

/**
 * draw.io 図か。
 * Drive に手でアップロードされた .drawio は MIME が application/octet-stream 等になることがあるので、
 * MIME だけでなく拡張子でも判定する。
 */
function isDrawio(file: { name?: unknown; mimeType?: unknown }): boolean {
  if (String(file.mimeType ?? "") === DRAWIO_MIME) return true;
  return String(file.name ?? "").toLowerCase().endsWith(DRAWIO_EXT);
}

/** 名前の末尾に .drawio を付ける（付いていればそのまま）。Drive 上で draw.io の図だと分かるようにするため */
function withDrawioExt(name: string): string {
  return name.toLowerCase().endsWith(DRAWIO_EXT) ? name : `${name}${DRAWIO_EXT}`;
}

// アップロードしたOffice文書をGoogle形式へ変換して取り込むときの送り先。
//
// ★ ブラウザから直接ここへ送ってはいけない。
//   サーバーで作った再開可能アップロードのセッションURIにブラウザから PUT すると、
//   応答に Access-Control-Allow-Origin が付かず CORS で必ず弾かれる（本番で実測）。
//   かといってファイル本体をこの関数の body に通すと、Vercel のリクエストサイズ上限(4.5MB)に
//   引っかかる。
//   そのため、ブラウザはいったん既存の署名付きURLで Supabase Storage へ置き、
//   サーバーがそこから取り出して Drive へ中継する（convert-staged）。
//   サーバー間の通信なので CORS は関係なく、受け取る body も小さいまま済む。
const RESUMABLE_URL = "https://www.googleapis.com/upload/drive/v3/files";
const STAGING_BUCKET = "project-files";

// ── state の署名 ────────────────────────────────────────────
// oauth-start は「ログイン中のユーザーからのPOST」で受け、認可URLをJSONで返す。
// 302 でサーバーからリダイレクトさせる形にすると、誰の連携なのかを示す情報を
// クエリに載せる必要が出てURLとログに残る（GitHub連携と同じ理由）。
// 誰の連携かは、ここで署名した state だけが持つ。
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function stateSecret(): string {
  return process.env.DAV_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}
// r … 連携後に戻る画面（BRU17-028）。右上メニューやファイルボックスから連携した一般メンバーを、
//     管理者しか開けない外部連携画面ではなく元の画面へ戻すため。署名の中に入れるので書き換えられない。
type StatePayload = { u: string; o: string; e: number; r?: string };
function signState(payload: StatePayload): string {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", stateSecret()).update(body).digest());
  return `${body}.${sig}`;
}
function verifyState(token: string): StatePayload | null {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expect = b64url(crypto.createHmac("sha256", stateSecret()).update(body).digest());
  // 長さが違うと timingSafeEqual が例外を投げる
  if (sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    if (!payload?.u || typeof payload.e !== "number" || payload.e < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// @vercel/node の型チェックが auth.getUser を解決できないケースがあるため型だけ緩める
// (api/project-files/[action].ts と同じ回避)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthLike = { getUser: (jwt?: string) => Promise<{ data: { user: any }; error: any }> };

function admin(): SupabaseClient {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getProfile(sb: SupabaseClient, req: any) {
  const header: string = req.headers?.authorization || req.headers?.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const { data, error } = await (sb.auth as unknown as AuthLike).getUser(token);
  if (error || !data?.user) return null;
  const { data: profile } = await sb.from("profiles")
    .select("name, role, organization_id, google_email").eq("id", data.user.id).maybeSingle();
  return profile ? { ...profile, id: data.user.id as string } : null;
}

// api/project-files/[action].ts の isMember と同じ。RLS と同じ1本の規則を使う。
async function isMember(sb: SupabaseClient, projectId: string, profile: { id: string }) {
  const { data, error } = await sb.rpc("can_user_access_project", {
    p_user_id: profile.id,
    p_project_id: projectId,
  });
  if (error) return false;
  return data === true;
}

function publicUrl(req: any): string {
  const proto = String(req.headers?.["x-forwarded-proto"] ?? "https");
  return process.env.PUBLIC_URL || `${proto}://${req.headers?.host}`;
}
function redirectUri(req: any): string {
  return `${publicUrl(req)}/api/google/oauth-callback`;
}

const DEFAULT_RETURN = "/admin-settings?tab=google";

/**
 * 連携後に戻す画面のパス。自サイト内のパスだけを受け付ける。
 * "//evil.example" や "/\evil.example" はブラウザが別オリジンとして解釈するので弾く（オープンリダイレクト対策）。
 */
function safeReturnPath(raw: unknown): string | undefined {
  const s = String(raw ?? "");
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(s) || s.length > 1000) return undefined;
  return s;
}

// ── トークン ────────────────────────────────────────────────
/**
 * リフレッシュトークンからアクセストークンを取る。
 * アクセストークンは1時間で切れるが、都度取り直せば足りるので保存しない
 * （保存すると「どちらが新しいか」を管理する必要が出て、失効時の扱いが増える）。
 */
async function getAccessToken(sb: SupabaseClient, userId: string): Promise<string> {
  const { data: row } = await sb.from("google_drive_tokens")
    .select("refresh_token").eq("user_id", userId).maybeSingle();
  if (!row?.refresh_token) throw new HttpError(428, "Googleアカウントが連携されていません");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new HttpError(500, "Google連携が設定されていません");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: row.refresh_token, grant_type: "refresh_token",
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    // ユーザーがGoogle側でアクセス権を取り消すとここに来る。
    // 死んだトークンを残すと以後ずっと同じ失敗を繰り返すので、消して連携し直しへ誘導する。
    if (res.status === 400 || res.status === 401) {
      await sb.from("google_drive_tokens").delete().eq("user_id", userId);
      await sb.from("profiles").update({ google_email: null }).eq("id", userId);
      throw new HttpError(428, "Googleとの連携が切れています。もう一度連携してください");
    }
    throw new HttpError(502, json?.error_description || "Googleの認証に失敗しました");
  }
  return json.access_token as string;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

// ── Drive API ───────────────────────────────────────────────
// RequestInit をそのまま拡張すると body が BodyInit に固定され、
// ここで渡したいプレーンオブジェクトを受け付けない。必要な2つだけを持つ型にする。
type DriveInit = { method?: string; body?: Record<string, unknown> };

async function drive(accessToken: string, path: string, init?: DriveInit) {
  const res = await fetch(`${DRIVE_API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  if (res.status === 204) return {};
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = json?.error?.errors?.[0]?.reason || "";
    const message = json?.error?.message || `Drive API error (${res.status})`;
    throw new HttpError(res.status, driveErrorMessage(res.status, reason, message));
  }
  return json;
}

/** Drive の失敗は原因ごとに打つ手が違うので、そのまま流さず日本語に置き換える */
function driveErrorMessage(status: number, reason: string, fallback: string): string {
  if (reason === "storageQuotaExceeded") {
    return "Googleドライブの空き容量が不足しているため作成できませんでした。不要なファイルを削除するか、容量を追加してください";
  }
  if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded" || status === 429) {
    return "Googleへのリクエストが一時的に集中しています。少し待ってからもう一度お試しください";
  }
  if (reason === "sharingRateLimitExceeded") {
    return "Googleの共有処理が集中しています。少し待ってからもう一度お試しください";
  }
  if (status === 403) {
    return "Google Workspace の管理者設定により、この操作が許可されていません（外部共有の制限など）";
  }
  if (status === 404) {
    return "Googleドライブ上に対象が見つかりません。共有ドライブへのアクセス権があるか確認してください";
  }
  return fallback;
}

/** Drive の検索クエリに名前を埋めるときのエスケープ */
function q(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** 指定の親の下にある同名フォルダのIDを返す。無ければ null */
async function findFolder(
  accessToken: string, name: string, parentId: string, driveId: string | null,
): Promise<string | null> {
  const params = new URLSearchParams({
    q: `name='${q(name)}' and mimeType='${FOLDER_MIME}' and '${q(parentId)}' in parents and trashed=false`,
    fields: "files(id,name)",
    pageSize: "1",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  if (driveId) { params.set("corpora", "drive"); params.set("driveId", driveId); }

  const found = await drive(accessToken, `/files?${params}`);
  return found?.files?.[0]?.id ? String(found.files[0].id) : null;
}

/** 指定の親の下にある同名フォルダを探し、無ければ作ってIDを返す */
async function ensureFolder(
  accessToken: string, name: string, parentId: string, driveId: string | null,
): Promise<string> {
  const found = await findFolder(accessToken, name, parentId, driveId);
  if (found) return found;

  const created = await drive(accessToken, "/files?supportsAllDrives=true&fields=id", {
    method: "POST",
    body: { name, mimeType: FOLDER_MIME, parents: [parentId] },
  });
  if (!created?.id) throw new HttpError(502, `Googleドライブに「${name}」フォルダを作成できませんでした`);
  return created.id as string;
}

// ── プロジェクトの保存先フォルダ ──────────────────────────
//   shared_drive … <管理者がPickerで選んだフォルダ>/<プロジェクト名>/
//   my_drive     … マイドライブ/DevTicket/<プロジェクト名>/
//
// 共有ドライブ運用で "DevTicket" 階層を作らないのは、管理者が選んだフォルダが
// すでに「DevTicket用の置き場所」だから。ここで足すと DevTicket/DevTicket/ になる。
//
// ★ 一度見つけた／作ったフォルダは ID を google_project_folders に覚え、以後は ID で引く。
//   以前は毎回プロジェクト名で探していたため、プロジェクト名を変えると空のフォルダが新しく作られ、
//   既存のGoogleファイルが全件「Googleドライブ上で削除されています」と出て開けなくなっていた。
//   ID で引けば、プロジェクト名の変更にも Drive 側でのフォルダ名の変更にも影響されない。
//
// ★ 覚えたフォルダがゴミ箱にあるときだけ、名前で探し直して（無ければ作って）覚え直す。
//   404 のときは覚えた ID を上書きしない。drive.file スコープでは「このトークンから見えないだけ」と
//   「完全に消された」を区別できず、見えない人の操作で上書きすると、見えている人の側が壊れる。
//   404 の間は名前で探す従来の動きになる（driveActors が次の人のトークンで試し直す）。
//
// テーブルは supabase/add_google_project_folders.sql。未作成でも読み書きが失敗するだけで、
// 名前で探す従来の動きになる。

/** プロジェクトのフォルダ名。空のプロジェクト名でフォルダを作らせない（ensureFolderPath の「無題のフォルダ」と同じ考え方） */
function projectFolderName(projectName: unknown): string {
  return String(projectName ?? "").trim() || "無題のプロジェクト";
}

/**
 * フォルダIDを覚える単位。
 *   shared_drive … 組織で1つ。保存先フォルダの設定を変えたら別の置き場所として扱う（古い場所の ID を使わない）
 *   my_drive     … 人ごと。フォルダはファイルを作った人それぞれのマイドライブにある
 */
function folderScopeKey(cfg: OrgConfig, userId: string): string {
  return cfg.mode === "shared_drive" ? `shared:${cfg.sharedFolderId}` : `user:${userId}`;
}

/** プロジェクトのフォルダを置く親。create=false で my_drive の DevTicket フォルダがまだ無ければ null */
async function projectFolderParent(
  accessToken: string, cfg: OrgConfig, create: boolean,
): Promise<{ parentId: string; driveId: string | null } | null> {
  if (cfg.mode === "shared_drive") return { parentId: String(cfg.sharedFolderId), driveId: cfg.sharedDriveId };
  const root = create
    ? await ensureFolder(accessToken, ROOT_FOLDER_NAME, "root", null)
    : await findFolder(accessToken, ROOT_FOLDER_NAME, "root", null);
  return root ? { parentId: root, driveId: null } : null;
}

async function rememberedFolder(sb: SupabaseClient, projectId: string, scopeKey: string): Promise<string | null> {
  const { data, error } = await sb.from("google_project_folders")
    .select("folder_id").eq("project_id", projectId).eq("scope_key", scopeKey).maybeSingle();
  if (error || !data?.folder_id) return null;
  return String(data.folder_id);
}

async function rememberFolder(sb: SupabaseClient, projectId: string, scopeKey: string, folderId: string): Promise<void> {
  await sb.from("google_project_folders").upsert(
    { project_id: projectId, scope_key: scopeKey, folder_id: folderId, updated_at: new Date().toISOString() },
    { onConflict: "project_id,scope_key" },
  );
}

/**
 * 保存先フォルダを解決する（無ければ作る）。
 * userId は Drive を操作する本人。my_drive では代行しないので、トークンの持ち主と一致する。
 */
async function resolveTargetFolder(
  sb: SupabaseClient, accessToken: string, cfg: OrgConfig,
  project: { id: unknown; name: unknown }, userId: string,
): Promise<string> {
  const projectId = String(project.id);
  const scopeKey = folderScopeKey(cfg, userId);

  const remembered = await rememberedFolder(sb, projectId, scopeKey);
  let replace = !remembered;
  if (remembered) {
    try {
      const info = await drive(accessToken,
        `/files/${encodeURIComponent(remembered)}?supportsAllDrives=true&fields=id,trashed`);
      if (!info?.trashed) return remembered;
      replace = true;
    } catch (e) {
      // 404 は見えないだけの可能性があるので上書きしない（上のコメント参照）
      if (!(e instanceof HttpError) || e.status !== 404) throw e;
    }
  }

  const parent = await projectFolderParent(accessToken, cfg, true);
  const folderId = await ensureFolder(accessToken, projectFolderName(project.name), parent!.parentId, parent!.driveId);
  if (replace) await rememberFolder(sb, projectId, scopeKey, folderId);
  return folderId;
}

// ── Office文書 → Google形式 ──────────────────────────────
// Google形式へ変換できる拡張子と、Drive に渡す元の形式。
// ★ src/app/lib/projectFiles.ts の GOOGLE_CONVERTIBLE と揃えること（api/ から src/ は import しない）。
//   xlsm は入れない。マクロは変換で必ず失われる。
const CONVERTIBLE: Record<string, { kind: string; mime: string }> = {
  xlsx: { kind: "spreadsheet", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  xls: { kind: "spreadsheet", mime: "application/vnd.ms-excel" },
  csv: { kind: "spreadsheet", mime: "text/csv" },
  docx: { kind: "document", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  doc: { kind: "document", mime: "application/msword" },
  pptx: { kind: "presentation", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  ppt: { kind: "presentation", mime: "application/vnd.ms-powerpoint" },
};

/**
 * Office文書の中身を Drive へ送り、Google形式に変換して保存する。
 * mimeType に Google 形式を指定すると、Drive 側が送られた中身を変換してくれる。
 *
 * ★ サーバーから送ること。ブラウザから再開可能アップロードのセッションURIへ送ると
 *   CORS で必ず弾かれる（BRU17-006 で本番実測。RESUMABLE_URL のコメント参照）。
 */
async function uploadAsGoogleFormat(
  // Buffer<ArrayBuffer> にしておかないと fetch の body に渡せない（型が広がる）
  accessToken: string, bytes: Buffer<ArrayBuffer>, sourceType: string,
  name: string, kind: string, folderId: string,
): Promise<{ id: string; webViewLink: string }> {
  return uploadToDrive(accessToken, bytes, sourceType, name, MIME[kind], folderId, "Google形式への変換に失敗しました");
}

/**
 * 中身を Drive へ再開可能アップロードで送る。
 * targetMime に Google形式を渡すと変換され、元の形式を渡すとそのまま保存される。
 */
async function uploadToDrive(
  accessToken: string, bytes: Buffer<ArrayBuffer>, sourceType: string,
  name: string, targetMime: string, folderId: string, failMessage: string,
): Promise<{ id: string; webViewLink: string }> {
  // ① セッションを作る
  const params = new URLSearchParams({
    uploadType: "resumable", supportsAllDrives: "true", fields: "id,name,webViewLink",
  });
  const init = await fetch(`${RESUMABLE_URL}?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": sourceType,
      "X-Upload-Content-Length": String(bytes.length),
    },
    body: JSON.stringify({ name, mimeType: targetMime, parents: [folderId] }),
  });
  if (!init.ok) {
    const j = await init.json().catch(() => ({}));
    const reason = j?.error?.errors?.[0]?.reason || "";
    throw new HttpError(init.status,
      driveErrorMessage(init.status, reason, j?.error?.message || "Googleドライブへの送信を開始できませんでした"));
  }
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new HttpError(502, "Googleドライブの送り先を取得できませんでした");

  // ② 中身を送る
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": sourceType, "Content-Length": String(bytes.length) },
    body: bytes,
  });
  const created = await put.json().catch(() => ({}));
  if (!put.ok || !created?.id) {
    const reason = created?.error?.errors?.[0]?.reason || "";
    throw new HttpError(put.status || 502,
      driveErrorMessage(put.status, reason, created?.error?.message || failMessage));
  }
  return { id: String(created.id), webViewLink: String(created.webViewLink ?? "") };
}

// ── 別のトークンの保存先へ中継する（import-files 用） ──────────
// drive.file では「コピー元を Picker で選んだ本人」と「共有ドライブの保存先を Picker で選んだ管理者」の
// トークンが別になることがある（BRU18-013）。どちらか一方のトークンでは files.copy ができないので、
// 本人のトークンで中身を読み出し、管理者のトークンで保存先へアップロードし直す。

// 中継する1ファイルの上限。中身をいったん関数のメモリに載せるため
const RELAY_MAX_BYTES = 100 * 1024 * 1024;

// Google形式は中身を持たないので、Office形式で書き出してから Google形式へ変換し直す。
// ★ CONVERTIBLE と対になる形式（書き出し → uploadAsGoogleFormat で戻せるもの）だけを置くこと。
const GOOGLE_EXPORT: Record<string, string> = {
  spreadsheet: CONVERTIBLE.xlsx.mime,
  document: CONVERTIBLE.docx.mime,
  presentation: CONVERTIBLE.pptx.mime,
};

// GOOGLE_EXPORT で書き出したときに付ける拡張子（export-office で DevTicket に保存するときの名前用）
const GOOGLE_EXPORT_EXT: Record<string, string> = {
  spreadsheet: ".xlsx",
  document: ".docx",
  presentation: ".pptx",
};

/**
 * Drive からファイルの中身を読み出す（alt=media / export の共通処理）
 * @param doing エラー文の「〜できません」に入る操作名（relayCopy と export-office で使い分ける）
 */
async function downloadDrive(
  accessToken: string, path: string, doing = "共有ドライブの保存先へ追加",
): Promise<Buffer<ArrayBuffer>> {
  const res = await fetch(`${DRIVE_API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    const reason = j?.error?.errors?.[0]?.reason || "";
    if (reason === "exportSizeLimitExceeded") {
      throw new HttpError(res.status, `Googleファイルが大きすぎるため、${doing}できません`);
    }
    if (reason === "cannotDownloadFile" || reason === "cannotExportFile") {
      throw new HttpError(res.status, `持ち主がダウンロードを禁止しているため、${doing}できません`);
    }
    throw new HttpError(res.status,
      driveErrorMessage(res.status, reason, j?.error?.message || "ファイルの中身を読み出せませんでした"));
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > RELAY_MAX_BYTES) {
    throw new HttpError(413, `ファイルが大きすぎるため、${doing}できません（${RELAY_MAX_BYTES / 1024 / 1024} MB まで）`);
  }
  return bytes;
}

/**
 * readerToken で読めるファイルを、writerToken で見える folderId へ複製する。
 * files.copy と違い、変更履歴・コメントに加えて、Google形式では一部の書式も引き継がれない
 * （Office形式を経由するため）。
 */
async function relayCopy(
  readerToken: string, writerToken: string,
  src: { id: string; mimeType: string; size?: unknown }, name: string, drawio: boolean, folderId: string,
): Promise<{ id: string; webViewLink: string }> {
  const gid = encodeURIComponent(src.id);
  const googleKind = Object.keys(MIME).find(k => MIME[k] === src.mimeType) ?? null;
  if (googleKind) {
    const exportMime = GOOGLE_EXPORT[googleKind];
    const bytes = await downloadDrive(readerToken,
      `/files/${gid}/export?mimeType=${encodeURIComponent(exportMime)}`);
    return uploadAsGoogleFormat(writerToken, bytes, exportMime, name, googleKind, folderId);
  }
  // フォーム・図形描画などは書き出した形から元の形式へ戻せない
  if (src.mimeType.startsWith("application/vnd.google-apps.")) {
    throw new HttpError(400, "この種類のGoogleファイルは共有ドライブの保存先へ追加できません（スプレッドシート・ドキュメント・スライド・通常のファイルのみ）");
  }
  // 読み出す前に弾けるものは弾く（Drive が size を返すのは通常のファイルだけ）
  if (Number(src.size ?? 0) > RELAY_MAX_BYTES) {
    throw new HttpError(413, `ファイルが大きすぎるため、共有ドライブの保存先へ追加できません（${RELAY_MAX_BYTES / 1024 / 1024} MB まで）`);
  }
  const bytes = await downloadDrive(readerToken, `/files/${gid}?alt=media&supportsAllDrives=true`);
  // 手でアップロードされた .drawio は MIME が octet-stream 等のことがあるので、draw.io の形式に揃える
  const type = drawio ? DRAWIO_MIME : (src.mimeType || "application/octet-stream");
  return uploadToDrive(writerToken, bytes, type, name, type, folderId, "共有ドライブの保存先へ追加できませんでした");
}

/**
 * 空の draw.io 図を Drive に作る。
 * Google形式と違って中身が要るので、メタデータと中身を1回で送る multipart で作る
 * （中身は数百バイトなので、再開可能アップロードにする必要は無い）。
 */
async function createDrawioFile(
  accessToken: string, name: string, folderId: string,
): Promise<{ id: string; webViewLink: string }> {
  const boundary = `devticket-${crypto.randomUUID()}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({ name, mimeType: DRAWIO_MIME, parents: [folderId] }),
    `--${boundary}`,
    `Content-Type: ${DRAWIO_MIME}`,
    "",
    EMPTY_DRAWIO,
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const params = new URLSearchParams({
    uploadType: "multipart", supportsAllDrives: "true", fields: "id,name,webViewLink",
  });
  const res = await fetch(`${RESUMABLE_URL}?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const created = await res.json().catch(() => ({}));
  if (!res.ok || !created?.id) {
    const reason = created?.error?.errors?.[0]?.reason || "";
    throw new HttpError(res.status || 502,
      driveErrorMessage(res.status, reason, created?.error?.message || "Googleドライブ上に図を作成できませんでした"));
  }
  return { id: String(created.id), webViewLink: String(created.webViewLink ?? "") };
}

// ── メンバー ────────────────────────────────────────────────
/**
 * そのプロジェクトのファイルを見てよい人のメールアドレスを集める。
 * 判定は project_visible_to()（RLS と同じ規則）に合わせる:
 *   同じ組織 かつ（projects.members に名前がある or role が admin / project-manager）
 *
 * ★ role='owner'（DevTicket運営）は意図的に外す。
 *   全組織のプロジェクトへアクセスできる立場なので、自動で含めると
 *   全顧客のGoogleファイルに運営の権限が付いて回ることになる。
 */
async function projectMemberEmails(
  sb: SupabaseClient, project: { organization_id: string | null; members: string[] | null },
): Promise<{ email: string; name: string }[]> {
  if (!project.organization_id) return [];
  const { data: rows } = await sb.from("profiles")
    .select("name, email, google_email, role, status")
    .eq("organization_id", project.organization_id);

  const members = new Set((project.members ?? []).map(String));
  return (rows ?? [])
    .filter(r => r.role !== "owner")
    .filter(r => r.status !== "invited")
    .filter(r => members.has(String(r.name)) || r.role === "admin" || r.role === "project-manager")
    // ★ 本人が紐づけたGoogleアカウントがあれば、そちらへ配る（BRU17-028）。
    //   招待メールのアドレスがGoogleアカウントでないと、そのアドレスに権限を付けても開けないため。
    .map(r => ({ email: String(r.google_email || r.email || "").trim(), name: String(r.name || "") }))
    .filter(r => !!r.email);
}

/**
 * ファイルをメンバーへ配る。
 *
 * sendNotificationEmail=false は必須。既定(true)のままだと、ファイルを1つ作るたびに
 * メンバー全員へGoogleから共有通知メールが飛ぶ。
 *
 * 1人失敗しても他を止めない。Googleアカウントを持たない人・管理者設定で弾かれる人が
 * 混ざっていても、配れる人には配りきる（呼び出し側に結果を返す）。
 */
async function grantMembers(
  accessToken: string, fileId: string, people: { email: string; name: string }[], skipEmail: string,
): Promise<{ granted: number; failed: { name: string; reason: string }[] }> {
  let granted = 0;
  const failed: { name: string; reason: string }[] = [];
  for (const p of people) {
    if (p.email.toLowerCase() === skipEmail.toLowerCase()) continue; // 作成者本人は既に権限を持つ
    try {
      await drive(accessToken,
        `/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true&sendNotificationEmail=false`,
        { method: "POST", body: { type: "user", role: "writer", emailAddress: p.email } });
      granted++;
    } catch (e) {
      failed.push({ name: p.name, reason: e instanceof Error ? e.message : "不明なエラー" });
    }
  }
  return { granted, failed };
}

// ── 名前の重複回避 ──────────────────────────────────────────
// project_files の (parent_id, file_name) は「どのファイルか」を指す引き当てキー（版・コメント・
// 改名・削除がこれで引く）。Googleファイルにも同じ規則を通すため、登録前に空き名を探しておく。
// 重複を避けるのは同じフォルダの中だけ（別フォルダの同名は別ファイル）。
// api/project-files/[action].ts の nextFreeName と同じ規則。
async function namesInFolder(sb: SupabaseClient, projectId: string, parentId: string | null): Promise<Set<string>> {
  let q = sb.from("project_files").select("file_name").eq("project_id", projectId);
  q = parentId ? q.eq("parent_id", parentId) : q.is("parent_id", null);
  const { data } = await q;
  return new Set((data ?? []).map(r => String(r.file_name)));
}
function splitName(fileName: string): { base: string; ext: string } {
  const i = fileName.lastIndexOf(".");
  return i > 0 ? { base: fileName.slice(0, i), ext: fileName.slice(i) } : { base: fileName, ext: "" };
}
function nextFreeName(fileName: string, taken: Set<string>): string {
  if (!taken.has(fileName)) return fileName;
  const { base, ext } = splitName(fileName);
  const stem = base.replace(/ \(\d+\)$/, "");
  for (let n = 1; n <= 999; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`;
}
// eslint-disable-next-line no-control-regex
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "").trim().replace(/^\.+/, "").slice(0, 200).trim();
}

type OrgConfig = {
  mode: string;
  sharedDriveId: string | null;
  sharedFolderId: string | null;
  sharedDriveName: string | null;
};

/**
 * DevTicket 側の置き場所（フォルダ）を検証する。
 * 他プロジェクトのフォルダや、フォルダでない行を親に指定させない。
 * @returns フォルダID / 指定なしは null / 不正なときは false
 */
async function resolveParent(
  sb: SupabaseClient, projectId: string, raw: unknown,
): Promise<string | null | false> {
  if (!raw) return null;
  const { data: parent } = await sb.from("project_files")
    .select("id, project_id, is_folder").eq("id", String(raw)).maybeSingle();
  if (!parent || parent.project_id !== projectId || !parent.is_folder) return false;
  return String(parent.id);
}

/** Drive 上の実体を持つ行（Googleドライブ上のファイル） */
type DriveRow = { id: string; file_name: string; external_id: string };

/**
 * フォルダ配下（入れ子のフォルダの中まで）の、Driveに実体があるファイルを集める。
 *
 * ★ project_files.parent_id は `on delete cascade`（add_project_files_folders.sql）。
 *   フォルダの行を消すと子孫の行はDBが勝手に消すので、消える前にここで拾い切らないと
 *   Drive 側に手を出す機会が二度と来ない（external_id は行にしか無い）。
 */
async function collectDriveDescendants(
  sb: SupabaseClient, projectId: string, folderId: string,
): Promise<DriveRow[]> {
  // 1回で全件引いてメモリ上で辿る。階層ごとに問い合わせると深さの分だけ往復が増える。
  // BUG-01 途中で止まっても結果が再現するよう順序を固定する。
  const { data: rows } = await sb.from("project_files")
    .select("id, file_name, parent_id, external_id, external_provider")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true }).order("id", { ascending: true });

  type Row = { id: string; file_name: string; parent_id: string | null; external_id: string | null; external_provider: string | null };
  const byParent = new Map<string, Row[]>();
  for (const r of (rows ?? []) as Row[]) {
    const key = String(r.parent_id ?? "");
    const bucket = byParent.get(key);
    if (bucket) bucket.push(r); else byParent.set(key, [r]);
  }

  const out: DriveRow[] = [];
  const visited = new Set<string>();
  const stack = [folderId];
  while (stack.length) {
    const current = stack.pop() as string;
    // 万一 parent_id に循環があっても止まるようにする
    if (visited.has(current)) continue;
    visited.add(current);
    for (const child of byParent.get(current) ?? []) {
      if (child.external_provider === "google" && child.external_id) {
        out.push({ id: String(child.id), file_name: String(child.file_name), external_id: String(child.external_id) });
      }
      stack.push(String(child.id));
    }
  }
  return out;
}

/** 組織の連携設定を引く */
async function orgConfig(sb: SupabaseClient, orgId: string | null): Promise<OrgConfig> {
  const empty: OrgConfig = { mode: "off", sharedDriveId: null, sharedFolderId: null, sharedDriveName: null };
  if (!orgId) return empty;
  const { data } = await sb.from("organizations")
    .select("google_drive_mode, google_shared_drive_id, google_shared_folder_id, google_shared_drive_name")
    .eq("id", orgId).maybeSingle();
  return {
    mode: String(data?.google_drive_mode ?? "off"),
    sharedDriveId: (data?.google_shared_drive_id as string | null) ?? null,
    sharedFolderId: (data?.google_shared_folder_id as string | null) ?? null,
    sharedDriveName: (data?.google_shared_drive_name as string | null) ?? null,
  };
}

// ── 共有ドライブの代行 ──────────────────────────────────────
// drive.file スコープでは、トークンから触れるのは「その人がこのアプリで作った／Picker で選んだ」
// ものだけ。共有ドライブの保存先フォルダを Picker で選んだのは設定した管理者なので、
// ほかのメンバーのトークンからは保存先フォルダも、その下のファイルも 404 になる
// （BRU18-003: 設定した人以外は変換アップロード・新規作成・名前の同期がすべて失敗していた）。
//
// そこで共有ドライブ運用に限り、本人のトークンで 404 になったら、組織の管理者のトークンで
// 同じ操作をやり直す。管理者のトークンも drive.file のままで、スコープは広げない。
// 代行で作ったファイルは Drive 上は管理者のアプリが作った扱いになるが、共有ドライブなので
// 所有者は組織で、DevTicket 上の追加者（uploaded_by）は操作した本人のまま残す。
//
// ★ 呼ぶ前に必ず isMember を通すこと。代行は「プロジェクトのメンバーの操作」であることが前提。
// ★ my_drive では代行しない。個人のドライブに他人のトークンで書き込むことになるため。
const MAX_DELEGATES = 5;

type DriveActor = { accessToken: string; email: string };

async function driveActors(
  sb: SupabaseClient, profile: { id: string; google_email?: string | null }, cfg: OrgConfig, orgId: string | null,
) {
  // 本人が未連携なら、ここで従来どおり 428（連携してください）を返す
  const self: DriveActor = {
    accessToken: await getAccessToken(sb, profile.id), email: String(profile.google_email ?? ""),
  };
  let candidates: { id: string; email: string }[] | null = null;
  const tokens = new Map<string, DriveActor | null>();

  // 保存先フォルダを選べるのは管理者だけ（resolve-folder / test-connection）なので、代行者も管理者に絞る
  const loadCandidates = async () => {
    if (candidates) return candidates;
    candidates = [];
    if (cfg.mode !== "shared_drive" || !orgId) return candidates;
    const { data: admins } = await sb.from("profiles")
      .select("id, role").eq("organization_id", orgId).in("role", ["admin", "owner"])
      .order("id", { ascending: true });
    const ids = (admins ?? [])
      .filter(r => String(r.id) !== profile.id)
      // 組織の管理者を先に試す（owner は運営の立場で設定していることがある）
      .sort((a, b) => (a.role === "admin" ? 0 : 1) - (b.role === "admin" ? 0 : 1))
      .map(r => String(r.id));
    if (ids.length === 0) return candidates;
    const { data: rows } = await sb.from("google_drive_tokens")
      .select("user_id, google_email").in("user_id", ids);
    const emailById = new Map((rows ?? []).map(r => [String(r.user_id), String(r.google_email ?? "")]));
    candidates = ids.filter(id => emailById.has(id)).slice(0, MAX_DELEGATES)
      .map(id => ({ id, email: emailById.get(id) as string }));
    return candidates;
  };

  const delegate = async (c: { id: string; email: string }): Promise<DriveActor | null> => {
    if (!tokens.has(c.id)) {
      // 連携が切れている管理者は飛ばす（本人の操作を管理者側の事情で止めない）
      const accessToken = await getAccessToken(sb, c.id).catch(() => "");
      tokens.set(c.id, accessToken ? { accessToken, email: c.email } : null);
    }
    return tokens.get(c.id) ?? null;
  };

  /** 本人 → 管理者 の順に fn を試す（管理者は共有ドライブ運用のときだけ）。404 以外の失敗はそのまま投げる */
  const run = async function run<T>(fn: (actor: DriveActor) => Promise<T>): Promise<T> {
    try {
      return await fn(self);
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 404 || cfg.mode !== "shared_drive") throw e;
      for (const c of await loadCandidates()) {
        const actor = await delegate(c);
        if (!actor) continue;
        try {
          return await fn(actor);
        } catch (e2) {
          if (e2 instanceof HttpError && e2.status === 404) continue;
          throw e2;
        }
      }
      throw e;
    }
  };
  // self … 本人のトークン。本人が Picker で選んだファイルは本人のトークンでしか読めない（import-files）
  return Object.assign(run, { self });
}

/** プロジェクトが属する組織の driveActors を作る（ファイル単位の操作用） */
async function driveActorsForProject(
  sb: SupabaseClient, profile: { id: string; google_email?: string | null }, projectId: string,
) {
  const { data: project } = await sb.from("projects")
    .select("organization_id").eq("id", projectId).maybeSingle();
  const orgId = project?.organization_id ? String(project.organization_id) : null;
  return driveActors(sb, profile, await orgConfig(sb, orgId), orgId);
}

// ── 紐づけたGoogleアカウントへの権限付与（grant-self / ensure-access 共通） ──
// ★ drive.file スコープでは、本人のトークンからは他人が作ったファイルに触れない（404）。
//   そのため次の順にトークンを試す。どれもスコープは drive.file のままで、広げない。
//     本人 → そのファイルの作成者 → 組織の管理者（共有ドライブ運用のみ。driveActors と同じ理由）
//   作成者のトークンを使うのは、作成時に作成者自身が行った配布（grantMembers）を
//   宛先だけ差し替えてやり直すため。マイドライブ運用でも作成者本人のファイルなので代行にならない。

type GrantContext = {
  /** そのファイルに試すトークンの持ち主（user_id）を、試す順に */
  candidatesFor: (uploadedBy: string) => string[];
  /** 連携が切れている人は "" */
  tokenOf: (userId: string) => Promise<string>;
  selfId: string;
};

async function grantContext(
  sb: SupabaseClient, orgId: string, cfg: OrgConfig, selfId: string,
): Promise<GrantContext> {
  // 作成者（uploaded_by は名前）→ id、と管理者の一覧。トークンを持つ人だけ候補にする
  const { data: people } = await sb.from("profiles")
    .select("id, name, role").eq("organization_id", orgId).order("id", { ascending: true });
  const { data: tokenRows } = await sb.from("google_drive_tokens")
    .select("user_id").in("user_id", (people ?? []).map(r => String(r.id)));
  const hasToken = new Set((tokenRows ?? []).map(r => String(r.user_id)));
  const idByName = new Map((people ?? []).map(r => [String(r.name), String(r.id)]));
  const admins = cfg.mode === "shared_drive"
    ? (people ?? [])
      .filter(r => (r.role === "admin" || r.role === "owner") && hasToken.has(String(r.id)))
      .sort((a, b) => (a.role === "admin" ? 0 : 1) - (b.role === "admin" ? 0 : 1))
      .slice(0, MAX_DELEGATES).map(r => String(r.id))
    : [];

  const tokens = new Map<string, string>();
  const tokenOf = async (userId: string): Promise<string> => {
    if (!tokens.has(userId)) {
      // 連携が切れている人は飛ばす（本人の操作を他人の事情で止めない）
      tokens.set(userId, await getAccessToken(sb, userId).catch(() => ""));
    }
    return tokens.get(userId) ?? "";
  };

  const candidatesFor = (uploadedBy: string) => {
    const creator = idByName.get(uploadedBy);
    return [...new Set([
      selfId,
      ...(creator && hasToken.has(creator) ? [creator] : []),
      ...admins,
    ])];
  };
  return { candidatesFor, tokenOf, selfId };
}

/**
 * 1ファイルに、紐づけたGoogleアカウントの編集権限を付ける。
 *
 * 本人のトークンでファイルが見えるなら、それは本人がこのアプリで作った／Picker で選んだファイルで、
 * 紐づけたアカウントは既に開ける。そのときは権限を足さない
 * （自分が所有者のファイルに自分の writer 権限を足そうとすると、Drive がエラーを返すことがあるため）。
 */
async function grantEmailOnFile(
  ctx: GrantContext, file: { external_id: unknown; uploaded_by: unknown }, email: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const gid = encodeURIComponent(String(file.external_id));
  let reason = "このファイルに権限を付けられるGoogleアカウントが見つかりません（作成者のGoogle連携が切れている可能性があります）";
  for (const userId of ctx.candidatesFor(String(file.uploaded_by ?? ""))) {
    const accessToken = await ctx.tokenOf(userId);
    if (!accessToken) continue;
    try {
      if (userId === ctx.selfId) {
        await drive(accessToken, `/files/${gid}?supportsAllDrives=true&fields=id`);
      } else {
        await drive(accessToken,
          `/files/${gid}/permissions?supportsAllDrives=true&sendNotificationEmail=false`,
          { method: "POST", body: { type: "user", role: "writer", emailAddress: email } });
      }
      return { ok: true };
    } catch (e) {
      // 404 はこのトークンから見えないだけ。次の候補で試す
      if (e instanceof HttpError && e.status === 404) continue;
      reason = e instanceof Error ? e.message : "権限を付けられませんでした";
      break;
    }
  }
  return { ok: false, reason };
}

// ── 権限付与の記録（ensure-access の省略用） ────────────────
// 開くたびに Drive へ権限付与を頼むと毎回1秒ほど待たされるので、付けたことを記録して2回目以降は省く。
// Google 側で手動で共有を外されても DevTicket は気づけないため、記録には期限を設けて定期的に付け直す。
// テーブルは supabase/add_google_file_grants.sql。未作成でも読み書きが失敗するだけで、毎回付与する動きになる。
const GRANT_RECORD_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function hasFreshGrant(sb: SupabaseClient, fileId: string, email: string): Promise<boolean> {
  const { data, error } = await sb.from("google_file_grants")
    .select("granted_at").eq("file_id", fileId).eq("google_email", email).maybeSingle();
  if (error || !data?.granted_at) return false;
  return Date.now() - new Date(String(data.granted_at)).getTime() < GRANT_RECORD_TTL_MS;
}

async function recordGrant(sb: SupabaseClient, fileId: string, email: string): Promise<void> {
  await sb.from("google_file_grants").upsert(
    { file_id: fileId, google_email: email, granted_at: new Date().toISOString() },
    { onConflict: "file_id,google_email" },
  );
}

// ============================================================
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  const action = String(req.query?.action ?? "");

  let sb: SupabaseClient;
  try { sb = admin(); } catch { return res.status(500).json({ error: "Supabase not configured" }); }

  // ── OAuth コールバック（Googleからのリダイレクト。ここだけ GET かつ未認証） ──
  if (action === "oauth-callback") {
    // キャンセル（error=access_denied）のときも state は付いてくるので、先に読んで戻り先を決める
    const payload = verifyState(String(req.query?.state ?? ""));
    const returnTo = safeReturnPath(payload?.r) ?? DEFAULT_RETURN;
    const back = (params: Record<string, string>) =>
      res.redirect(302, `${publicUrl(req)}${returnTo}${returnTo.includes("?") ? "&" : "?"}${new URLSearchParams(params)}`);

    const err = String(req.query?.error ?? "");
    if (err) return back({ google: "error", message: err === "access_denied" ? "連携がキャンセルされました" : err });

    if (!payload) return back({ google: "error", message: "連携の有効期限が切れました。もう一度お試しください" });

    const code = String(req.query?.code ?? "");
    if (!code) return back({ google: "error", message: "認可コードを受け取れませんでした" });

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return back({ google: "error", message: "Google連携が設定されていません" });

    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri(req), grant_type: "authorization_code",
      }),
    });
    const token = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !token.refresh_token) {
      // refresh_token は prompt=consent を付けた初回にしか返らない。
      // 付け忘れ・既に許可済みのアカウントで再連携したときにここへ落ちる。
      return back({
        google: "error",
        message: token?.error_description || "リフレッシュトークンを取得できませんでした。Googleのアカウント設定から DevTicket のアクセス権を削除してから、もう一度お試しください",
      });
    }

    // どのGoogleアカウントで繋いだかを画面に出すため、メールアドレスだけ取っておく
    let googleEmail = "";
    try {
      const me = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      const meJson = await me.json().catch(() => ({}));
      googleEmail = String(meJson?.email ?? "");
    } catch { /* 表示用なので取れなくても連携は成立させる */ }

    // 別のアカウントに変更する場合に、前のアカウントのトークンを後で無効化するため先に読んでおく
    const { data: previous } = await sb.from("google_drive_tokens")
      .select("refresh_token, google_email").eq("user_id", payload.u).maybeSingle();

    const { error: upsertErr } = await sb.from("google_drive_tokens").upsert({
      user_id: payload.u,
      organization_id: payload.o ?? "",
      google_email: googleEmail,
      refresh_token: token.refresh_token,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (upsertErr) return back({ google: "error", message: "連携情報の保存に失敗しました" });

    // 別のアカウントに変更したときは、前のアカウントの許可を Google 側でも取り消す
    // （上書きで DevTicket からは消えるが、Google のアカウント設定に許可が残り続けるため。disconnect と同じ）。
    // ★ 同じアカウントで紐づけ直したときは取り消さない。取り消しはそのアカウントの許可ごと無効にするので、
    //   いま受け取ったばかりのトークンまで使えなくなる。アドレスが取れず同じか分からないときも取り消さない。
    const prevEmail = String(previous?.google_email ?? "").trim().toLowerCase();
    if (previous?.refresh_token && prevEmail && googleEmail && prevEmail !== googleEmail.trim().toLowerCase()) {
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(String(previous.refresh_token))}`, { method: "POST" })
        .catch(() => undefined);
    }

    await sb.from("profiles").update({ google_email: googleEmail || null }).eq("id", payload.u);
    return back({ google: "success" });
  }

  // ── ここから先は全て POST + ログイン必須 ──────────────────
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
  const profile = await getProfile(sb, req);
  if (!profile) return res.status(401).json({ error: "Unauthorized" });

  try {
    // ── 連携の開始 ────────────────────────────────────────
    if (action === "oauth-start") {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) return res.status(500).json({ error: "Google連携が設定されていません" });

      const returnTo = safeReturnPath(body.returnTo);
      const state = signState({
        u: profile.id,
        o: String(profile.organization_id ?? ""),
        e: Date.now() + STATE_TTL_MS,
        ...(returnTo ? { r: returnTo } : {}),
      });
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri(req),
        response_type: "code",
        scope: SCOPE,
        // access_type=offline + prompt=consent の両方が無いと refresh_token が返らない。
        // 2回目以降の連携でも確実に受け取るため prompt=consent を必ず付ける。
        // select_account は、ブラウザでログイン中のGoogleアカウントに黙って決まらないよう、
        // 毎回どのアカウントで紐づけるかを選ばせるため（右上メニューの「別のアカウントに変更」）。
        access_type: "offline",
        prompt: "select_account consent",
        include_granted_scopes: "true",
        state,
      });
      return res.json({ url: `${AUTH_URL}?${params}` });
    }

    // ── 連携状態 ──────────────────────────────────────────
    if (action === "status") {
      const { data: token } = await sb.from("google_drive_tokens")
        .select("google_email").eq("user_id", profile.id).maybeSingle();

      // プロジェクト指定があれば、その所属組織の設定を返す（別組織のPJを見ているケースがあるため）
      let orgId = String(profile.organization_id ?? "");
      const projectId = String(body.projectId ?? "");
      if (projectId) {
        const { data: p } = await sb.from("projects").select("organization_id").eq("id", projectId).maybeSingle();
        if (p?.organization_id) orgId = String(p.organization_id);
      }
      const cfg = await orgConfig(sb, orgId || null);
      return res.json({
        connected: !!token,
        googleEmail: token?.google_email ?? null,
        configured: !!process.env.GOOGLE_CLIENT_ID,
        ...cfg,
      });
    }

    // ── 連携の解除 ────────────────────────────────────────
    if (action === "disconnect") {
      const { data: row } = await sb.from("google_drive_tokens")
        .select("refresh_token").eq("user_id", profile.id).maybeSingle();
      // DevTicket側から消すだけだと Google のアカウント設定に許可が残り続けるので、
      // Google側のトークンも無効化する（失敗しても DevTicket 側の削除は進める）
      if (row?.refresh_token) {
        await fetch(`${REVOKE_URL}?token=${encodeURIComponent(row.refresh_token)}`, { method: "POST" })
          .catch(() => undefined);
      }
      await sb.from("google_drive_tokens").delete().eq("user_id", profile.id);
      await sb.from("profiles").update({ google_email: null }).eq("id", profile.id);
      return res.json({ ok: true });
    }

    // ── Google Picker 用の短命アクセストークン ────────────
    // Picker はブラウザ内で動くため、どうしてもブラウザ側にアクセストークンが要る。
    //
    // ここで渡すのは drive.file スコープのアクセストークン（約1時間で失効）だけで、
    // リフレッシュトークンは絶対に渡さない。
    // Picker で選んだ共有ドライブ／フォルダは、その時点でアプリからアクセスできるようになる
    // （drive.file の「ユーザーが Picker で選んだもの」に該当する）。
    // この一手間を踏まないと、drive.file では共有ドライブを親にファイルを作れない。
    //
    // 当初は共有ドライブの保存先フォルダ選択（管理者の設定作業）にしか使わなかったため
    // 管理者に限っていたが、既存の Googleファイルの取り込み（import-files）で一般メンバーも使う。
    // 渡るのは本人の drive.file トークン（本人が Picker で選んだものしか触れない）で、
    // 約1時間で失効するため、ログインしていれば誰にでも発行してよい。
    // （保存先フォルダの選択ボタンは、管理者だけが開ける外部連携画面にしか無い）
    if (action === "picker-token") {
      const accessToken = await getAccessToken(sb, profile.id);
      return res.json({ accessToken });
    }

    // ── Picker で選ばれたフォルダの素性を確かめる ────────────
    // Picker が返すのはIDと名前だけ。それが本当にフォルダか、どの共有ドライブに属するかは
    // ここで files.get して確かめる（driveId は files.list の corpora 指定に要る）。
    if (action === "resolve-folder") {
      const folderId = String(body.folderId ?? "");
      if (!folderId) return res.status(400).json({ error: "folderId が必要です" });
      if (profile.role !== "owner" && profile.role !== "admin") {
        return res.status(403).json({ error: "管理者のみ実行できます" });
      }

      const accessToken = await getAccessToken(sb, profile.id);
      const info = await drive(accessToken,
        `/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=id,name,mimeType,driveId`);
      if (info?.mimeType !== FOLDER_MIME) {
        return res.status(400).json({ error: "フォルダを選択してください" });
      }
      if (!info?.driveId) {
        // マイドライブのフォルダを選ばれた場合。共有ドライブ運用の意味が無くなるので弾く
        return res.status(400).json({ error: "共有ドライブの中のフォルダを選択してください（マイドライブのフォルダは使えません）" });
      }
      return res.json({ id: String(info.id), name: String(info.name), driveId: String(info.driveId) });
    }

    // ── 接続テスト（組織設定の保存前に必ず通す） ──────────
    // 設定だけ保存できて誰もファイルを開けない、という状態を本番で作らないための関門。
    // 実際に「作る」「配る」まで試し、後片付けまでして初めて成功と見なす。
    if (action === "test-connection") {
      const folderId = String(body.folderId ?? "");
      if (!folderId) return res.status(400).json({ error: "保存先フォルダが選択されていません" });
      if (profile.role !== "owner" && profile.role !== "admin") {
        return res.status(403).json({ error: "管理者のみ実行できます" });
      }

      const accessToken = await getAccessToken(sb, profile.id);
      let fileId = "";
      try {
        const created = await drive(accessToken, "/files?supportsAllDrives=true&fields=id", {
          method: "POST",
          body: { name: "DevTicket 接続テスト", mimeType: MIME.spreadsheet, parents: [folderId] },
        });
        fileId = String(created?.id ?? "");
        if (!fileId) throw new HttpError(502, "テストファイルを作成できませんでした");

        // 「作れる」だけでは不十分。外部共有が管理者設定で止められていると、
        // 作れるのに配れない＝誰も開けない状態になる。配布まで試す。
        const { data: proj } = await sb.from("projects")
          .select("organization_id, members").eq("organization_id", profile.organization_id).limit(1).maybeSingle();
        const people = proj ? await projectMemberEmails(sb, proj as any) : [];
        const other = people.find(p => p.email.toLowerCase() !== String(profile.google_email ?? "").toLowerCase());
        if (other) {
          await drive(accessToken,
            `/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true&sendNotificationEmail=false`,
            { method: "POST", body: { type: "user", role: "writer", emailAddress: other.email } });
        }
        return res.json({ ok: true, sharedTo: other?.name ?? null });
      } finally {
        // 成否に関わらずテストファイルは残さない
        if (fileId) {
          await drive(accessToken, `/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, { method: "DELETE" })
            .catch(() => undefined);
        }
      }
    }

    // ── 新規作成 ──────────────────────────────────────────
    if (action === "create") {
      const projectId = String(body.projectId ?? "");
      const kind = String(body.kind ?? "");
      const drawio = kind === "drawio";
      if (!projectId || (!MIME[kind] && !drawio)) return res.status(400).json({ error: "projectId と kind が必要です" });
      if (!(await isMember(sb, projectId, profile))) return res.status(403).json({ error: "Forbidden" });

      const { data: project } = await sb.from("projects")
        .select("id, name, organization_id, members").eq("id", projectId).maybeSingle();
      if (!project) return res.status(404).json({ error: "プロジェクトが見つかりません" });

      const cfg = await orgConfig(sb, project.organization_id ? String(project.organization_id) : null);
      if (cfg.mode === "off") return res.status(403).json({ error: "この組織ではGoogleドライブ連携が有効になっていません" });
      if (cfg.mode === "shared_drive" && !cfg.sharedFolderId) {
        return res.status(400).json({ error: "保存先フォルダが設定されていません。外部連携の設定を確認してください" });
      }

      const parentId = await resolveParent(sb, projectId, body.parentId ?? null);
      if (parentId === false) return res.status(400).json({ error: "保存先のフォルダが見つかりません" });

      const run = await driveActors(sb, profile, cfg, project.organization_id ? String(project.organization_id) : null);
      const { actor, folderId } = await run(async a =>
        ({ actor: a, folderId: await resolveTargetFolder(sb, a.accessToken, cfg, project, profile.id) }));
      const accessToken = actor.accessToken;

      // DevTicket 側で一意な名前を先に決める。file_name は改名・削除・コメントの
      // 引き当てキーなので、重複したまま登録すると別のファイルを巻き込む。
      // draw.io 図は拡張子 .drawio を持つ（Drive 上で draw.io の図だと分かるように）
      const named = sanitizeFileName(String(body.name ?? "")) || DEFAULT_NAME[kind];
      const wanted = drawio ? withDrawioExt(named) : named;
      const fileName = nextFreeName(wanted, await namesInFolder(sb, projectId, parentId));

      const created = drawio
        ? await createDrawioFile(accessToken, fileName, folderId)
        : await drive(accessToken, "/files?supportsAllDrives=true&fields=id,webViewLink,name", {
          method: "POST",
          body: { name: fileName, mimeType: MIME[kind], parents: [folderId] },
        });
      if (!created?.id || !created?.webViewLink) {
        throw new HttpError(502, "Googleドライブ上にファイルを作成できませんでした");
      }

      // 共有ドライブなら、そのドライブのメンバーには既に見えている。
      // それでも配るのは、ドライブのメンバーではない人（プロジェクトには入っている）に届けるため。
      const people = await projectMemberEmails(sb, project as any);
      const share = await grantMembers(accessToken, String(created.id), people, actor.email);

      const { data: inserted, error } = await sb.from("project_files").insert({
        project_id: projectId,
        folder_path: "",
        file_name: fileName,
        file_size: 0,
        file_type: drawio ? DRAWIO_MIME : MIME[kind],
        file_path: "",
        version: 1,
        uploaded_by: profile.name,
        external_provider: "google",
        external_id: String(created.id),
        external_url: String(created.webViewLink),
        ...(parentId ? { parent_id: parentId } : {}),
      }).select().maybeSingle();

      if (error) {
        // DB登録に失敗したらDrive上の孤児を残さない（register の storage.remove と同じ考え方）
        await drive(accessToken, `/files/${encodeURIComponent(String(created.id))}?supportsAllDrives=true`, { method: "DELETE" })
          .catch(() => undefined);
        return res.status(500).json({ error: error.message });
      }

      return res.json({
        file: inserted,
        url: String(created.webViewLink),
        fileName,
        shared: share.granted,
        failed: share.failed,
      });
    }

    // ── 変換アップロード（Storage に置いた実体を Drive へ中継） ──
    // Office文書をGoogle形式に変換して取り込む。
    // ブラウザは既存の署名付きURLで Supabase Storage へ置くだけで、Drive へは
    // このサーバーが中継する（RESUMABLE_URL のコメント参照。ブラウザ直送は CORS で弾かれる）。
    //
    // ★ 失敗したときは Storage の実体を消さずに残す。
    //   クライアントはそれを「そのまま保存」として登録し直すので、変換に失敗しても
    //   アップロードしたファイルは失われない。消すのは Drive への登録まで成功したときだけ。
    if (action === "convert-staged") {
      const projectId = String(body.projectId ?? "");
      const path = String(body.path ?? "");
      const kind = String(body.kind ?? "");
      const sourceName = String(body.fileName ?? "");
      const sourceType = String(body.fileType ?? "") || "application/octet-stream";
      if (!projectId || !path || !MIME[kind] || !sourceName) {
        return res.status(400).json({ error: "projectId / path / kind / fileName が必要です" });
      }
      if (!(await isMember(sb, projectId, profile))) return res.status(403).json({ error: "Forbidden" });
      // 他プロジェクトの置き場所を指定させない（project-files の register と同じ関門）
      if (!path.startsWith(`${projectId}/`)) return res.status(400).json({ error: "Invalid path" });

      const { data: project } = await sb.from("projects")
        .select("id, name, organization_id, members").eq("id", projectId).maybeSingle();
      if (!project) return res.status(404).json({ error: "プロジェクトが見つかりません" });

      const cfg = await orgConfig(sb, project.organization_id ? String(project.organization_id) : null);
      if (cfg.mode === "off") return res.status(403).json({ error: "この組織ではGoogleドライブ連携が有効になっていません" });
      if (cfg.mode === "shared_drive" && !cfg.sharedFolderId) {
        return res.status(400).json({ error: "保存先フォルダが設定されていません。外部連携の設定を確認してください" });
      }

      const parentId = await resolveParent(sb, projectId, body.parentId ?? null);
      if (parentId === false) return res.status(400).json({ error: "保存先のフォルダが見つかりません" });

      // Storage から実体を取り出す
      const { data: blob, error: dlErr } = await sb.storage.from(STAGING_BUCKET).download(path);
      if (dlErr || !blob) throw new HttpError(502, "アップロードしたファイルを読み出せませんでした");
      const bytes = Buffer.from(await blob.arrayBuffer());

      const run = await driveActors(sb, profile, cfg, project.organization_id ? String(project.organization_id) : null);
      const { actor, folderId } = await run(async a =>
        ({ actor: a, folderId: await resolveTargetFolder(sb, a.accessToken, cfg, project, profile.id) }));
      const accessToken = actor.accessToken;

      // Google形式に拡張子は無いので落とす。DevTicket 側で一意な名前を先に押さえる。
      const base = sanitizeFileName(splitName(sourceName).base) || DEFAULT_NAME[kind];
      const fileName = nextFreeName(base, await namesInFolder(sb, projectId, parentId));

      const { id: fileId, webViewLink } = await uploadAsGoogleFormat(
        accessToken, bytes, sourceType, fileName, kind, folderId);

      const people = await projectMemberEmails(sb, project as any);
      const share = await grantMembers(accessToken, fileId, people, actor.email);

      const { data: inserted, error } = await sb.from("project_files").insert({
        project_id: projectId,
        folder_path: "",
        file_name: fileName,
        file_size: 0,
        file_type: MIME[kind],
        file_path: "",
        version: 1,
        uploaded_by: profile.name,
        external_provider: "google",
        external_id: fileId,
        external_url: webViewLink,
        ...(parentId ? { parent_id: parentId } : {}),
      }).select().maybeSingle();

      if (error) {
        // Drive 上の孤児は消す。Storage の実体は残し、クライアントに「そのまま保存」させる
        await drive(accessToken, `/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, { method: "DELETE" })
          .catch(() => undefined);
        return res.status(500).json({ error: error.message });
      }

      // ここまで来て初めて Storage の実体を片付ける（ファイルは Drive 側の1つだけにする）
      const { error: rmErr } = await sb.storage.from(STAGING_BUCKET).remove([path]);
      if (rmErr) console.error("[google] staged object cleanup failed:", rmErr.message);

      return res.json({
        file: inserted, url: webViewLink, fileName,
        shared: share.granted, failed: share.failed,
      });
    }

    // ── ファイルボックスにある Office文書を Google形式にコピーする ──
    // 「Googleスプレッドシートで開く」等から呼ばれる。元の Office文書はそのまま残し、
    // Google形式のコピーを保存先フォルダに作って、ファイルボックスにも1行追加する。
    //
    // ★ 元の Storage の実体は消さない（convert-staged との違い）。あちらは
    //   「アップロード時に形式を選ぶ」ので元を残さないが、こちらは既にあるファイルの複製。
    // ★ 呼ぶたびに、その時点の最新版から新しくコピーを作る。以前に作ったコピーを開き直すと、
    //   その後に元の Excel が更新されていても古い中身のまま開いてしまうため。
    if (action === "convert-existing") {
      const fileId = String(body.fileId ?? "");
      if (!fileId) return res.status(400).json({ error: "fileId が必要です" });

      const { data: src } = await sb.from("project_files")
        .select("id, project_id, file_name, file_type, file_path, parent_id, is_folder, external_provider")
        .eq("id", fileId).maybeSingle();
      if (!src) return res.status(404).json({ error: "ファイルが見つかりません" });
      if (!(await isMember(sb, src.project_id, profile))) return res.status(403).json({ error: "Forbidden" });
      if (src.is_folder || src.external_provider === "google" || !src.file_path) {
        return res.status(400).json({ error: "このファイルはGoogle形式にできません" });
      }

      const ext = splitName(String(src.file_name)).ext.replace(/^\./, "").toLowerCase();
      const conv = CONVERTIBLE[ext];
      if (!conv) {
        return res.status(400).json({ error: ext === "xlsm"
          ? "マクロ付きのファイル（.xlsm）はGoogle形式にできません"
          : "Excel・Word・PowerPoint 以外のファイルはGoogle形式にできません" });
      }

      const { data: project } = await sb.from("projects")
        .select("id, name, organization_id, members").eq("id", src.project_id).maybeSingle();
      if (!project) return res.status(404).json({ error: "プロジェクトが見つかりません" });

      const cfg = await orgConfig(sb, project.organization_id ? String(project.organization_id) : null);
      if (cfg.mode === "off") return res.status(403).json({ error: "この組織ではGoogleドライブ連携が有効になっていません" });
      if (cfg.mode === "shared_drive" && !cfg.sharedFolderId) {
        return res.status(400).json({ error: "保存先フォルダが設定されていません。外部連携の設定を確認してください" });
      }

      const { data: blob, error: dlErr } = await sb.storage.from(STAGING_BUCKET).download(String(src.file_path));
      if (dlErr || !blob) throw new HttpError(502, "ファイルを読み出せませんでした");
      const bytes = Buffer.from(await blob.arrayBuffer());

      const run = await driveActors(sb, profile, cfg, project.organization_id ? String(project.organization_id) : null);
      const { actor, folderId } = await run(async a =>
        ({ actor: a, folderId: await resolveTargetFolder(sb, a.accessToken, cfg, project, profile.id) }));
      const accessToken = actor.accessToken;

      // 名前は拡張子を落としたもの。同名の Googleファイルが既にあれば「(1)」を付ける
      const base = sanitizeFileName(splitName(String(src.file_name)).base) || DEFAULT_NAME[conv.kind];
      const fileName = nextFreeName(base,
        await namesInFolder(sb, String(src.project_id), src.parent_id ? String(src.parent_id) : null));

      // 保存時の file_type が空・不正確なこともあるので、拡張子から決めた形式を優先する
      const { id: newId, webViewLink } = await uploadAsGoogleFormat(
        accessToken, bytes, conv.mime, fileName, conv.kind, folderId);

      const people = await projectMemberEmails(sb, project as any);
      const share = await grantMembers(accessToken, newId, people, actor.email);

      const { data: inserted, error } = await sb.from("project_files").insert({
        project_id: src.project_id,
        folder_path: "",
        file_name: fileName,
        file_size: 0,
        file_type: MIME[conv.kind],
        file_path: "",
        version: 1,
        uploaded_by: profile.name,
        external_provider: "google",
        external_id: newId,
        external_url: webViewLink,
        // 元のファイルと同じフォルダに並べる
        ...(src.parent_id ? { parent_id: src.parent_id } : {}),
      }).select().maybeSingle();

      if (error) {
        await drive(accessToken, `/files/${encodeURIComponent(newId)}?supportsAllDrives=true`, { method: "DELETE" })
          .catch(() => undefined);
        return res.status(500).json({ error: error.message });
      }

      return res.json({
        file: inserted, url: webViewLink, fileName,
        shared: share.granted, failed: share.failed,
      });
    }

    // ── ファイルボックスにある Googleファイルを Office文書に変換する ──
    // convert-existing の逆向き。スプレッドシート → Excel、ドキュメント → Word、スライド → PowerPoint。
    // 元の Googleファイルはそのまま残し、Office文書を同じフォルダに1行追加する。
    //
    // ★ 変換後のファイルは Drive ではなく DevTicket の Storage に置く（通常のアップロードと同じ行にする）。
    //   そうすることで、ビュワー・アプリで開く（WebDAV）・画面で編集・版管理・コメントが
    //   既存のまま使える。Google連携していないメンバーも開ける。
    // ★ 中身を読み出すトークンは「本人 → 作成者 → 組織の管理者」の順に試す（grantContext と同じ）。
    //   drive.file では他人がアプリで作ったファイルは本人のトークンから 404 になるため。
    //   Storage への保存はサーバーが行うので、本人が Google連携していなくても変換できる。
    // ★ Drive の export は 10MB までしか書き出せない（超えると exportSizeLimitExceeded）。
    if (action === "export-office") {
      const fileId = String(body.fileId ?? "");
      if (!fileId) return res.status(400).json({ error: "fileId が必要です" });

      const { data: src } = await sb.from("project_files")
        .select("id, project_id, file_name, file_type, parent_id, is_folder, external_provider, external_id, uploaded_by")
        .eq("id", fileId).maybeSingle();
      if (!src) return res.status(404).json({ error: "ファイルが見つかりません" });
      if (!(await isMember(sb, String(src.project_id), profile))) return res.status(403).json({ error: "Forbidden" });

      const kind = Object.keys(MIME).find(k => MIME[k] === src.file_type) ?? null;
      if (src.is_folder || src.external_provider !== "google" || !src.external_id || !kind) {
        return res.status(400).json({ error: "スプレッドシート・ドキュメント・スライド以外のファイルは変換できません" });
      }

      const { data: project } = await sb.from("projects")
        .select("organization_id").eq("id", String(src.project_id)).maybeSingle();
      const orgId = project?.organization_id ? String(project.organization_id) : "";
      const cfg = await orgConfig(sb, orgId || null);
      if (!orgId || cfg.mode === "off") {
        return res.status(403).json({ error: "この組織ではGoogleドライブ連携が有効になっていません" });
      }

      // 中身を読み出す。404 はそのトークンから見えないだけなので次の候補で試す
      const exportMime = GOOGLE_EXPORT[kind];
      const exportPath = `/files/${encodeURIComponent(String(src.external_id))}/export?mimeType=${encodeURIComponent(exportMime)}`;
      const ctx = await grantContext(sb, orgId, cfg, profile.id);
      let bytes: Buffer<ArrayBuffer> | null = null;
      let lastError: unknown = null;
      for (const userId of ctx.candidatesFor(String(src.uploaded_by ?? ""))) {
        const accessToken = await ctx.tokenOf(userId);
        if (!accessToken) continue;
        try {
          bytes = await downloadDrive(accessToken, exportPath, "Office形式に変換");
          break;
        } catch (e) {
          lastError = e;
          if (e instanceof HttpError && e.status === 404) continue;
          throw e;
        }
      }
      if (!bytes) {
        if (lastError instanceof HttpError) throw lastError;
        throw new HttpError(400,
          "このファイルを読み出せるGoogleアカウントが見つかりません（作成者のGoogle連携が切れている可能性があります）");
      }

      // 名前は「元の名前.xlsx」。同じフォルダに同名があれば「(1)」を付ける
      const ext = GOOGLE_EXPORT_EXT[kind];
      const base = sanitizeFileName(String(src.file_name)) || DEFAULT_NAME[kind];
      const parentId = src.parent_id ? String(src.parent_id) : null;
      const fileName = nextFreeName(`${base}${ext}`, await namesInFolder(sb, String(src.project_id), parentId));

      // 保存キーは api/project-files/[action].ts の sign-upload と同じ形（日本語名をキーに使わない）
      const path = `${src.project_id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
      const { error: upErr } = await sb.storage.from(STAGING_BUCKET)
        .upload(path, bytes, { contentType: exportMime, upsert: false });
      if (upErr) throw new HttpError(502, `変換したファイルを保存できませんでした（${upErr.message}）`);

      const { data: inserted, error } = await sb.from("project_files").insert({
        project_id: src.project_id,
        folder_path: "",
        file_name: fileName,
        file_size: bytes.length,
        file_type: exportMime,
        file_path: path,
        version: 1,
        uploaded_by: profile.name,
        // 元のファイルと同じフォルダに並べる
        ...(parentId ? { parent_id: parentId } : {}),
      }).select().maybeSingle();

      if (error) {
        // Storage 上の孤児を残さない
        await sb.storage.from(STAGING_BUCKET).remove([path]);
        return res.status(500).json({ error: error.message });
      }

      return res.json({ file: inserted, fileName });
    }

    // ── 既存の Driveファイルを取り込む ──────────────────
    // もともと Drive にあるファイルを、ファイルボックスへ追加する。
    //
    // ★ 種別は問わない。Google形式（スプシ・ドキュメント・スライド）でも、
    //   Office文書・PDF・画像・zip でも、Drive にあるものは全て追加できる。
    //   どれも storage に実体を持たず、クリックすると Drive が開く形で揃える。
    //   「DevTicket に取り込めるサイズか」で追加できるものが変わってしまうと、
    //   ファイルボックスに置けないファイルが出てしまうため、実体は持たない。
    //
    // ★ fileIds は Picker で選ばれたものに限る（URL貼り付けも、Picker で1回 Select させてから来る）。
    //   drive.file スコープでは、Picker で選ばれていないファイルは files.get が 404 になる。
    //   URL の ID だけで読めるようにするには drive / drive.readonly が必要で、Google の審査が要る。
    //
    // ★ プロジェクトの保存先フォルダの外にあるファイルは、保存先へコピーして取り込む。
    //   元の場所のままリンクすると、
    //     ・持ち主が元の人のまま（退職で開けなくなる）
    //     ・取り込んだ人に共有権限が無いと、他のメンバーに配れない
    //     ・sync-names は保存先フォルダの中しか見ないので「Driveで削除済み」と誤表示される
    //     ・DevTicket で改名すると他人のファイルの名前を書き換えてしまう
    //   という問題がまとめて出る。コピーは「アプリが作ったファイル」になるので、
    //   新規作成したファイルと全く同じに扱える。
    //   代わりに元のファイルは残り、変更履歴とコメントはコピーに引き継がれない。
    //   保存先フォルダの中に既にあるものだけは、そのまま追加する。
    //   Google形式以外（Office文書・PDF など）のコピーは Drive の容量を消費する点にも注意
    //   （Google形式は容量を消費しない）。
    //   保存先が本人のトークンから見えない共有ドライブ運用では、files.copy の代わりに
    //   中身を中継して複製する（relayCopy。Google形式は Office形式を経由するので一部の書式が変わりうる）。
    if (action === "import-files") {
      const projectId = String(body.projectId ?? "");
      const fileIds: string[] = Array.isArray(body.fileIds)
        ? [...new Set(body.fileIds.map((x: unknown) => String(x)).filter(Boolean))] as string[]
        : [];
      if (!projectId || fileIds.length === 0) {
        return res.status(400).json({ error: "projectId と fileIds が必要です" });
      }
      if (fileIds.length > 50) return res.status(400).json({ error: "一度に追加できるのは50件までです" });
      if (!(await isMember(sb, projectId, profile))) return res.status(403).json({ error: "Forbidden" });

      const { data: project } = await sb.from("projects")
        .select("id, name, organization_id, members").eq("id", projectId).maybeSingle();
      if (!project) return res.status(404).json({ error: "プロジェクトが見つかりません" });

      const cfg = await orgConfig(sb, project.organization_id ? String(project.organization_id) : null);
      if (cfg.mode === "off") return res.status(403).json({ error: "この組織ではGoogleドライブ連携が有効になっていません" });
      if (cfg.mode === "shared_drive" && !cfg.sharedFolderId) {
        return res.status(400).json({ error: "保存先フォルダが設定されていません。外部連携の設定を確認してください" });
      }

      const parentId = await resolveParent(sb, projectId, body.parentId ?? null);
      if (parentId === false) return res.status(400).json({ error: "保存先のフォルダが見つかりません" });

      // ★ トークンは2つ使い分ける（BRU18-013）。
      //   ・Picker で選ばれたコピー元 … 選んだ本人のトークンでしか見えない（self）
      //   ・共有ドライブの保存先フォルダ … 保存先を Picker で選んだ管理者のトークンでしか見えないことがある
      //     （BRU18-003 と同じ。driveActors で本人 → 管理者の順に試す）
      //   本人から保存先が見えないと、以前は保存先を探す段階の 404 で全件失敗していた。
      const run = await driveActors(sb, profile, cfg, project.organization_id ? String(project.organization_id) : null);
      const self = run.self;
      const accessToken = self.accessToken;
      const { actor: dest, folderId } = await run(async a =>
        ({ actor: a, folderId: await resolveTargetFolder(sb, a.accessToken, cfg, project, profile.id) }));
      // 保存先が本人のトークンから見えないとき。files.copy は使えず、中身を中継する
      const delegated = dest !== self;
      const people = await projectMemberEmails(sb, project as any);

      // 名前の重複判定（追加先のフォルダの中だけ）と、同じファイルの二重登録の判定（プロジェクト全体）に使う
      const { data: existing } = await sb.from("project_files")
        .select("file_name, external_id").eq("project_id", projectId);
      const taken = await namesInFolder(sb, projectId, parentId);
      const already = new Set((existing ?? []).map(r => String(r.external_id ?? "")).filter(Boolean));

      const imported: { fileName: string; copied: boolean }[] = [];
      const failed: { name: string; reason: string }[] = [];
      const shareFailed: { name: string; reason: string }[] = [];

      // 1件ぶんのメタ情報を引く。ショートカットの解決でもう一度使う
      const fields = "id,name,mimeType,size,parents,webViewLink,trashed,"
        + "shortcutDetails(targetId),capabilities(canCopy)";
      const fetchMeta = async (id: string) => {
        try {
          return await drive(accessToken,
            `/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=${fields}`);
        } catch (e) {
          // drive() の 403/404 の文言は「管理者設定」「共有ドライブへのアクセス権」向けなので、ここ用に言い直す
          const status = e instanceof HttpError ? e.status : 0;
          throw new Error(status === 404 || status === 403
            ? "このファイルを開けません（削除されたか、あなたに閲覧権限がありません）"
            : (e instanceof Error ? e.message : "ファイルを確認できませんでした"));
        }
      };

      for (const sourceId of fileIds) {
        let label = sourceId;
        try {
          let src: any = await fetchMeta(sourceId);
          label = String(src?.name ?? sourceId);

          // ショートカットは中身を持たない。そのままコピーすると「コピーされたショートカット」に
          // なってしまうので、指している先のファイルに読み替える
          if (String(src?.mimeType) === SHORTCUT_MIME) {
            const targetId = String(src?.shortcutDetails?.targetId ?? "");
            if (!targetId) throw new Error("ショートカットの参照先が見つかりません");
            src = await fetchMeta(targetId);
            label = String(src?.name ?? label);
          }

          if (src?.trashed) throw new Error("ゴミ箱に入っているファイルです");
          // フォルダは Picker で選べないが、URL貼り付けからは届きうる。
          // DevTicket 側のフォルダとは別物なので、階層ごとの取り込みは行わない
          if (String(src?.mimeType) === FOLDER_MIME) {
            throw new Error("フォルダは追加できません（中のファイルを選んでください）");
          }

          const drawio = isDrawio(src ?? {});
          const inFolder = Array.isArray(src?.parents) && src.parents.includes(folderId);
          let fileId = String(src.id);
          let webViewLink = String(src.webViewLink ?? "");
          // Google形式（スプシ・ドキュメント・スライド）だけは拡張子を持たない。
          // それ以外は Drive 上の名前をそのまま使う（.xlsx / .pdf などの拡張子ごと）
          const googleKind = Object.keys(MIME).find(k => MIME[k] === src.mimeType) ?? null;
          const named = sanitizeFileName(label)
            || DEFAULT_NAME[drawio ? "drawio" : (googleKind ?? "")] || "無題のファイル";
          // MIME だけで draw.io と判定したファイルは拡張子が無いことがあるので付ける
          // （コピーの名前にもなるので、Drive 上でも draw.io の図だと分かるようになる）
          const name = nextFreeName(drawio ? withDrawioExt(named) : named, taken);

          if (inFolder) {
            // 保存先フォルダの中にあるものはそのまま使う。二重登録だけ防ぐ
            if (already.has(fileId)) throw new Error("既にファイルボックスに追加されています");
          } else {
            // 持ち主が「閲覧者のコピーを禁止」にしていると、コピーできない
            // （中継でも同じ。この設定では閲覧者のダウンロードも禁止される）
            if (src?.capabilities?.canCopy === false) {
              throw new Error("持ち主がコピーを禁止しているため追加できません");
            }
            if (delegated) {
              const relayed = await relayCopy(accessToken, dest.accessToken,
                { id: fileId, mimeType: String(src.mimeType ?? ""), size: src.size }, name, drawio, folderId);
              fileId = relayed.id;
              webViewLink = relayed.webViewLink;
            } else {
              const copied = await drive(accessToken,
                `/files/${encodeURIComponent(fileId)}/copy?supportsAllDrives=true&fields=id,name,webViewLink`, {
                  method: "POST",
                  body: { name, parents: [folderId] },
                });
              if (!copied?.id) throw new Error("コピーを作成できませんでした");
              fileId = String(copied.id);
              webViewLink = String(copied.webViewLink ?? "");
            }
          }

          // 配るのは、そのファイルが見えるトークン。コピー・中継で作ったものは保存先側（dest）、
          // 保存先にもともとあったものは本人が Picker で選んだので本人のトークンで見える。
          // 作った人は既に権限を持つので配布から外す（中継なら管理者が外れ、本人には配られる）
          const owner = inFolder ? self : dest;
          const share = await grantMembers(owner.accessToken, fileId, people, owner.email);
          for (const x of share.failed) shareFailed.push({ name: `${name} / ${x.name}`, reason: x.reason });

          const { error } = await sb.from("project_files").insert({
            project_id: projectId,
            folder_path: "",
            file_name: name,
            // Google形式のファイルはサイズを持たない（Drive が size を返さない）ので 0 のまま。
            // Office文書・PDF などは一覧でサイズを出せるよう、Drive の値を入れておく
            file_size: Number(src.size ?? 0) || 0,
            // draw.io の図は MIME がまちまち（octet-stream 等）なので揃える。
            // 画面側は file_type で種別を見分けている（projectFiles.ts の getFileKind）
            file_type: drawio ? DRAWIO_MIME : String(src.mimeType),
            file_path: "",
            version: 1,
            uploaded_by: profile.name,
            external_provider: "google",
            external_id: fileId,
            external_url: webViewLink,
            ...(parentId ? { parent_id: parentId } : {}),
          });
          if (error) {
            // こちらで作ったコピーだけ片付ける。そのまま追加しようとした元ファイルには触らない
            if (!inFolder) {
              await drive(dest.accessToken, `/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, { method: "DELETE" })
                .catch(() => undefined);
            }
            throw new Error(error.message);
          }

          taken.add(name);
          already.add(fileId);
          imported.push({ fileName: name, copied: !inFolder });
        } catch (e) {
          failed.push({ name: label, reason: e instanceof Error ? e.message : "追加できませんでした" });
        }
      }

      return res.json({ imported, failed, shareFailed });
    }

    // ── Drive 側の変更を取り込む ──────────────────────────
    // Google の画面で名前を変えたり、ファイルを消したりしても DevTicket は気づけない。
    // ファイルボックスを開いた・タブに戻ったタイミングでここを呼び、現在の姿に合わせる。
    //
    // プロジェクトのGoogleファイルは Drive 上の同じフォルダに集まるので、
    // files.list 1回で全件の「今の名前」と「まだ在るか」がまとめて分かる。
    // 取りに行くのは名前と存在だけ。フォルダ移動は追わない
    // （Drive側の階層と DevTicket のフォルダは別物なので、追っても意味が薄い）。
    if (action === "sync-names") {
      const projectId = String(body.projectId ?? "");
      if (!projectId) return res.status(400).json({ error: "projectId が必要です" });
      if (!(await isMember(sb, projectId, profile))) return res.status(403).json({ error: "Forbidden" });

      // BUG-01 同じ順序で処理する（途中で止まっても結果が再現する）
      const { data: rows } = await sb.from("project_files")
        .select("id, file_name, file_type, parent_id, external_id")
        .eq("project_id", projectId).eq("external_provider", "google")
        .order("created_at", { ascending: true }).order("id", { ascending: true });
      const targets = (rows ?? []).filter(r => !!r.external_id);
      if (targets.length === 0) return res.json({ renamed: [], missing: [], skipped: false });

      const { data: project } = await sb.from("projects")
        .select("id, name, organization_id").eq("id", projectId).maybeSingle();
      if (!project) return res.status(404).json({ error: "プロジェクトが見つかりません" });

      const cfg = await orgConfig(sb, project.organization_id ? String(project.organization_id) : null);
      if (cfg.mode === "off") return res.json({ renamed: [], missing: [], skipped: true });

      // Googleを連携していない人が見ているときは何もしない。
      // 連携済みの誰かが開いたときに揃うので、ここで止めても実害は無い。
      const { data: token } = await sb.from("google_drive_tokens")
        .select("user_id").eq("user_id", profile.id).maybeSingle();
      if (!token) return res.json({ renamed: [], missing: [], skipped: true });

      // フォルダ内を全件引く。ページングは100件ごと（1プロジェクトでこれを超えることは稀だが、
      // 打ち切ると「消された」と誤判定するので必ず最後まで辿る）
      // 保存先フォルダが本人から見えないときは管理者のトークンで見る（driveActors 参照）
      const run = await driveActors(sb, profile, cfg, project.organization_id ? String(project.organization_id) : null);
      const live = await run(async ({ accessToken }) => {
        const folderId = await resolveTargetFolder(sb, accessToken, cfg, project, profile.id);
        const found = new Map<string, string>(); // fileId → name
        let pageToken = "";
        for (let page = 0; page < 20; page++) {
          const params = new URLSearchParams({
            q: `'${q(folderId)}' in parents and trashed=false`,
            fields: "nextPageToken,files(id,name)",
            pageSize: "100",
            supportsAllDrives: "true",
            includeItemsFromAllDrives: "true",
          });
          if (cfg.mode === "shared_drive" && cfg.sharedDriveId) {
            params.set("corpora", "drive"); params.set("driveId", cfg.sharedDriveId);
          }
          if (pageToken) params.set("pageToken", pageToken);
          const listed = await drive(accessToken, `/files?${params}`);
          for (const f of listed?.files ?? []) found.set(String(f.id), String(f.name));
          pageToken = String(listed?.nextPageToken ?? "");
          if (!pageToken) break;
        }
        return found;
      });

      // 名前の重複を避けるため、Googleファイル以外も含めた現在の名前をフォルダごとに押さえておく
      // （重複を避けるのは同じフォルダの中だけ。別フォルダの同名は別ファイル）
      const { data: allRows } = await sb.from("project_files")
        .select("id, file_name, parent_id").eq("project_id", projectId);
      const takenByFolder = new Map<string, Set<string>>();
      const takenIn = (parentId: unknown): Set<string> => {
        const key = parentId ? String(parentId) : "";
        let set = takenByFolder.get(key);
        if (!set) { set = new Set(); takenByFolder.set(key, set); }
        return set;
      };
      for (const r of allRows ?? []) takenIn(r.parent_id).add(String(r.file_name));

      const renamed: { before: string; after: string }[] = [];
      // Drive 上に見つからなかった行。★ DevTicket の行は消さない。
      //   Drive 側の誤操作や、権限の都合で一時的に見えないだけの可能性があり、
      //   こちらまで消すと巻き添えで復元できなくなる。画面に「削除済み」と出すだけにする。
      const missing: string[] = [];

      for (const row of targets) {
        const liveName = live.get(String(row.external_id));
        if (liveName === undefined) { missing.push(String(row.id)); continue; }
        // draw.io の図は DevTicket 側では必ず .drawio を付けて持つ（Drive 側で外されても付け直す）
        const current = row.file_type === DRAWIO_MIME ? withDrawioExt(liveName) : liveName;
        if (current === row.file_name) continue;

        // 自分の今の名前は解放してから、空いている名前を探す。
        // ★ file_name は DevTicket 内部の引き当てキー。重複したまま取り込むと、
        //   検索や %サジェストで別のファイルと見分けがつかなくなる。
        //   Googleと表示名がズレるのは避けられないが、安全側に倒す。
        const taken = takenIn(row.parent_id);
        taken.delete(String(row.file_name));
        const next = nextFreeName(sanitizeFileName(current) || String(row.file_name), taken);
        taken.add(next);

        const { error } = await sb.from("project_files")
          .update({ file_name: next }).eq("id", row.id);
        if (error) { console.error("[google] sync rename failed:", error.message); continue; }
        renamed.push({ before: String(row.file_name), after: next });
      }

      return res.json({ renamed, missing, skipped: false });
    }

    // ── 改名（Drive側） ──────────────────────────────────
    // DevTicket側の改名は api/project-files/rename が行う。
    // api/ 配下のルートファイル同士は import し合わない方針なので、
    // クライアントが2つを順に呼ぶ形にしている。
    if (action === "rename") {
      const fileId = String(body.fileId ?? "");
      const newName = sanitizeFileName(String(body.newName ?? ""));
      if (!fileId || !newName) return res.status(400).json({ error: "fileId と newName が必要です" });

      const { data: file } = await sb.from("project_files")
        .select("project_id, external_id, external_provider").eq("id", fileId).maybeSingle();
      if (!file) return res.status(404).json({ error: "File not found" });
      if (!(await isMember(sb, file.project_id, profile))) return res.status(403).json({ error: "Forbidden" });
      if (file.external_provider !== "google" || !file.external_id) {
        return res.status(400).json({ error: "Googleファイルではありません" });
      }

      const run = await driveActorsForProject(sb, profile, String(file.project_id));
      await run(({ accessToken }) =>
        drive(accessToken, `/files/${encodeURIComponent(String(file.external_id))}?supportsAllDrives=true`, {
          method: "PATCH", body: { name: newName },
        }));
      return res.json({ ok: true });
    }

    // ── プロジェクト名の変更を Drive のフォルダ名へ反映 ─────
    // DevTicket 側の変更（projects の update）はプロジェクト編集ダイアログが行い、その後にこれを呼ぶ。
    //
    // 1. 保存先フォルダの ID をまだ覚えていなければ、変更前の名前（oldName）で探して覚える。
    //    テーブル追加前から使っているプロジェクトは ID を覚えておらず、ここで覚えないと
    //    新しい名前で探して見つからず、既存のファイルが全件「削除済み」に見えてしまう。
    // 2. 共有ドライブ運用なら、フォルダ名を新しいプロジェクト名に変える。
    //
    // ★ マイドライブ運用ではフォルダ名を変えない。フォルダは作った人それぞれのマイドライブにあり、
    //   全員分を変えるには他人のトークンで個人のドライブを書き換えることになる（driveActors の my_drive と同じ方針）。
    //   本人の分の ID を覚えるだけにする。フォルダは ID で引くので、名前が古いままでも開ける。
    //
    // ★ 名前の反映は見た目を揃えるためのもの。失敗してもファイルは ID で引けるので、
    //   失敗は skipped / reason で返し、エラーにはしない（プロジェクト名の変更は成立している）。
    if (action === "rename-project-folder") {
      const projectId = String(body.projectId ?? "");
      if (!projectId) return res.status(400).json({ error: "projectId が必要です" });
      if (!(await isMember(sb, projectId, profile))) return res.status(403).json({ error: "Forbidden" });

      const { data: project } = await sb.from("projects")
        .select("id, name, organization_id").eq("id", projectId).maybeSingle();
      if (!project) return res.status(404).json({ error: "プロジェクトが見つかりません" });

      const orgId = project.organization_id ? String(project.organization_id) : null;
      const cfg = await orgConfig(sb, orgId);
      const skipped = (reason: string) => res.json({ renamed: false, skipped: true, reason });
      if (cfg.mode === "off") return skipped("off");
      if (cfg.mode === "shared_drive" && !cfg.sharedFolderId) return skipped("no_folder");

      const { data: token } = await sb.from("google_drive_tokens")
        .select("user_id").eq("user_id", profile.id).maybeSingle();
      if (!token) return skipped("not_linked");

      const newName = projectFolderName(project.name);
      const oldName = String(body.oldName ?? "").trim();
      const scopeKey = folderScopeKey(cfg, profile.id);

      // 変更前の名前で見つけたフォルダが、本当にこのプロジェクトのものかを確かめる。
      // oldName はクライアントから来るので、それだけを信じると別プロジェクトのフォルダを取り込みうる。
      // このプロジェクトのGoogleファイルが1件でも入っていれば、このプロジェクトのフォルダと見なす。
      const { data: ownFiles } = await sb.from("project_files")
        .select("external_id").eq("project_id", projectId).eq("external_provider", "google");
      const ownIds = new Set((ownFiles ?? []).map(r => String(r.external_id ?? "")).filter(Boolean));
      const holdsOwnFile = async (accessToken: string, folderId: string): Promise<boolean> => {
        let pageToken = "";
        for (let page = 0; page < 20; page++) {
          const params = new URLSearchParams({
            q: `'${q(folderId)}' in parents and trashed=false`,
            fields: "nextPageToken,files(id)",
            pageSize: "100",
            supportsAllDrives: "true",
            includeItemsFromAllDrives: "true",
          });
          if (cfg.mode === "shared_drive" && cfg.sharedDriveId) {
            params.set("corpora", "drive"); params.set("driveId", cfg.sharedDriveId);
          }
          if (pageToken) params.set("pageToken", pageToken);
          const listed = await drive(accessToken, `/files?${params}`);
          if ((listed?.files ?? []).some((f: { id?: unknown }) => ownIds.has(String(f.id)))) return true;
          pageToken = String(listed?.nextPageToken ?? "");
          if (!pageToken) return false;
        }
        return false;
      };

      const NOT_FOUND = "プロジェクトのフォルダが見つかりません";
      const run = await driveActors(sb, profile, cfg, orgId);
      try {
        const result = await run(async ({ accessToken }) => {
          let folderId = await rememberedFolder(sb, projectId, scopeKey);
          if (!folderId) {
            // 変更前の名前が無い・同じなら、探し直す意味が無い（フォルダはまだ作られていないか、名前で引ける）
            if (!oldName || oldName === newName || ownIds.size === 0) return { renamed: false, reason: "not_remembered" };
            const parent = await projectFolderParent(accessToken, cfg, false);
            const found = parent ? await findFolder(accessToken, oldName, parent.parentId, parent.driveId) : null;
            // 共有ドライブでは、本人のトークンからは管理者が作ったフォルダが見えない。404 にして管理者で試し直す
            if (!found || !(await holdsOwnFile(accessToken, found))) {
              if (cfg.mode === "shared_drive") throw new HttpError(404, NOT_FOUND);
              return { renamed: false, reason: "not_found" };
            }
            folderId = found;
            await rememberFolder(sb, projectId, scopeKey, folderId);
          }

          if (cfg.mode !== "shared_drive") return { renamed: false, reason: "my_drive" };

          const info = await drive(accessToken,
            `/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=id,name,trashed`);
          if (info?.trashed) return { renamed: false, reason: "trashed" };
          const currentName = String(info?.name ?? "");
          if (currentName === newName) return { renamed: false, reason: "same" };

          // 同じ組織に今のフォルダ名と同じ名前のプロジェクトが他にあるときは変えない。
          // 以前は名前でフォルダを引いていたため、同名のプロジェクトは1つのフォルダを共有していることがあり、
          // 変えると相手のプロジェクトのフォルダ名まで変わってしまう。
          const { data: sameName } = await sb.from("projects")
            .select("id").eq("organization_id", orgId).eq("name", currentName).neq("id", projectId).limit(1);
          if ((sameName ?? []).length > 0) return { renamed: false, reason: "shared_with_other_project" };
          const { data: claimed } = await sb.from("google_project_folders")
            .select("project_id").eq("folder_id", folderId).neq("project_id", projectId).limit(1);
          if ((claimed ?? []).length > 0) return { renamed: false, reason: "shared_with_other_project" };

          await drive(accessToken, `/files/${encodeURIComponent(folderId)}?supportsAllDrives=true`, {
            method: "PATCH", body: { name: newName },
          });
          return { renamed: true, reason: "" };
        });
        return res.json({ ...result, skipped: !result.renamed });
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) return skipped("not_found");
        throw e;
      }
    }

    // ── Drive 側をゴミ箱へ移動 ────────────────────────────
    // DevTicket 側の削除は api/project-files/delete が行う。改名と同じく、
    // クライアントが2本を順に呼ぶ（api/ 配下のルートファイル同士は import しない方針）。
    //
    // ★ 必ず DevTicket 側を消す前に呼ぶこと。
    //   Drive の実体を指す external_id は project_files の行にしか無く、
    //   先に行を消すと「どれを消せばいいか」が分からなくなる。
    //
    // ★ 完全削除(DELETE)ではなくゴミ箱(trashed=true)にする。
    //   取り込んだファイルが利用者の原本であることがあり
    //   （import-files は保存先フォルダの中にあったものをコピーせず原本のまま登録する）、
    //   取り違えて消しても Drive のゴミ箱から戻せるようにしておく。
    //
    // ★ 消せなかったものは失敗として返すだけで、処理は止めない。
    //   drive.file スコープでは「本人がこのアプリで作った／Pickerで選んだ」ファイルしか
    //   触れないため、他の人が作ったファイルは 404 になる。
    //   1件で止めると、消せるはずの残りまで Drive に残ってしまう。
    if (action === "trash") {
      const fileId = String(body.fileId ?? "");
      const folderId = String(body.folderId ?? "");
      if (!fileId && !folderId) return res.status(400).json({ error: "fileId または folderId が必要です" });

      const { data: origin } = await sb.from("project_files")
        .select("id, project_id, file_name, is_folder, external_id, external_provider")
        .eq("id", folderId || fileId).maybeSingle();
      if (!origin) return res.status(404).json({ error: "File not found" });
      if (!(await isMember(sb, origin.project_id, profile))) return res.status(403).json({ error: "Forbidden" });

      const targets: DriveRow[] = folderId
        ? await collectDriveDescendants(sb, String(origin.project_id), String(origin.id))
        : (origin.external_provider === "google" && origin.external_id
          ? [{ id: String(origin.id), file_name: String(origin.file_name), external_id: String(origin.external_id) }]
          : []);

      // Googleドライブ上のファイルが1件も無いなら、連携の有無を問わず何もしない。
      // （連携していない人のフォルダ削除を、ここで 428 にして止めないため）
      if (targets.length === 0) return res.json({ trashed: 0, failed: [] });

      const run = await driveActorsForProject(sb, profile, String(origin.project_id));

      let trashed = 0;
      const failed: { name: string; reason: string }[] = [];
      for (const t of targets) {
        try {
          await run(({ accessToken }) =>
            drive(accessToken, `/files/${encodeURIComponent(t.external_id)}?supportsAllDrives=true`, {
              method: "PATCH", body: { trashed: true },
            }));
          trashed++;
        } catch (e) {
          // drive() の 403/404 の文言は「管理者設定」「共有ドライブへのアクセス権」向けなので、
          // 削除の文脈に言い直す（多くは drive.file スコープで他人のファイルに触れないケース）。
          const status = e instanceof HttpError ? e.status : 0;
          failed.push({
            name: t.file_name,
            reason: status === 404 || status === 403
              ? "あなたのGoogleアカウントからは操作できません（他の人が追加したファイルなど）"
              : (e instanceof Error ? e.message : "Googleドライブ側で削除できませんでした"),
          });
        }
      }
      return res.json({ trashed, failed });
    }

    // ── リンク共有の ON/OFF ──────────────────────────────
    // 既定はオフ。URLが実質のパスワードになり、プロジェクトから外れた人も
    // URLを控えていれば開け続けられるため、ファイルごとに明示的に入れてもらう。
    if (action === "share-link") {
      const fileId = String(body.fileId ?? "");
      const enabled = !!body.enabled;
      if (!fileId) return res.status(400).json({ error: "fileId が必要です" });

      const { data: file } = await sb.from("project_files")
        .select("project_id, external_id, external_provider").eq("id", fileId).maybeSingle();
      if (!file) return res.status(404).json({ error: "File not found" });
      if (!(await isMember(sb, file.project_id, profile))) return res.status(403).json({ error: "Forbidden" });
      if (file.external_provider !== "google" || !file.external_id) {
        return res.status(400).json({ error: "Googleファイルではありません" });
      }

      const run = await driveActorsForProject(sb, profile, String(file.project_id));
      const gid = encodeURIComponent(String(file.external_id));

      if (enabled) {
        await run(({ accessToken }) =>
          drive(accessToken, `/files/${gid}/permissions?supportsAllDrives=true`, {
            method: "POST",
            // allowFileDiscovery=false で検索には出さない（URLを知っている人だけ）
            body: { type: "anyone", role: "writer", allowFileDiscovery: false },
          }));
      } else {
        // type=anyone の権限IDは固定で "anyone"
        await run(({ accessToken }) =>
          drive(accessToken, `/files/${gid}/permissions/anyone?supportsAllDrives=true`, { method: "DELETE" }))
          .catch(() => undefined); // 既に無い場合は成功扱い
      }

      await sb.from("project_files").update({
        link_shared: enabled,
        link_shared_by: enabled ? profile.name : null,
        link_shared_at: enabled ? new Date().toISOString() : null,
      }).eq("id", fileId);

      return res.json({ linkShared: enabled });
    }

    // ── 権限の配り直し ────────────────────────────────────
    // Google側の権限と DevTicket のメンバーシップは自動同期しない。
    // 後から参加した人は、それ以前に作られたファイルが見えないままなので、
    // プロジェクトの全Googleファイルへ配り直す。
    if (action === "sync-permissions") {
      const projectId = String(body.projectId ?? "");
      if (!projectId) return res.status(400).json({ error: "projectId が必要です" });
      if (!(await isMember(sb, projectId, profile))) return res.status(403).json({ error: "Forbidden" });

      const { data: project } = await sb.from("projects")
        .select("id, organization_id, members").eq("id", projectId).maybeSingle();
      if (!project) return res.status(404).json({ error: "プロジェクトが見つかりません" });

      // BUG-01 同じ順序で処理する（途中で止まったとき、どこまで終わったかが再現する）
      const { data: files } = await sb.from("project_files")
        .select("id, file_name, external_id")
        .eq("project_id", projectId).eq("external_provider", "google")
        .order("created_at", { ascending: true }).order("id", { ascending: true });

      const targets = (files ?? []).filter(f => !!f.external_id);
      if (targets.length === 0) return res.json({ granted: 0, failed: [] });

      const orgId = project.organization_id ? String(project.organization_id) : null;
      const run = await driveActors(sb, profile, await orgConfig(sb, orgId), orgId);
      const people = await projectMemberEmails(sb, project as any);

      let granted = 0;
      const failed: { name: string; reason: string }[] = [];
      for (const f of targets) {
        // grantMembers は1人ずつの失敗を握りつぶすので、先にどのトークンから触れるファイルかを確かめる
        let actor: DriveActor;
        try {
          actor = await run(async a => {
            await drive(a.accessToken,
              `/files/${encodeURIComponent(String(f.external_id))}?supportsAllDrives=true&fields=id`);
            return a;
          });
        } catch (e) {
          failed.push({ name: String(f.file_name), reason: e instanceof Error ? e.message : "ファイルを確認できませんでした" });
          continue;
        }
        const r = await grantMembers(actor.accessToken, String(f.external_id), people, actor.email);
        granted += r.granted;
        for (const x of r.failed) failed.push({ name: `${f.file_name} / ${x.name}`, reason: x.reason });
      }
      return res.json({ granted, failed });
    }

    // ── 紐づけたGoogleアカウントへ、既存ファイルの権限を付け直す（BRU17-028） ──
    // これまでのファイルは招待メールのアドレス宛てに配られている。そのアドレスがGoogleアカウントで
    // なければ開けないので、紐づけが終わった直後に画面から呼び、本人が見てよい全Googleファイルへ
    // 紐づけたアドレスの権限を足す（招待メール宛ての権限は消さない）。
    // トークンを試す順は grantEmailOnFile を参照。
    if (action === "grant-self") {
      const googleEmail = String(profile.google_email ?? "").trim();
      if (!googleEmail) return res.status(428).json({ error: "Googleアカウントが連携されていません" });
      // projectMemberEmails と同じく、運営(owner)には自動で配らない
      if (profile.role === "owner" || !profile.organization_id) return res.json({ granted: 0, failed: [] });

      const orgId = String(profile.organization_id);
      const cfg = await orgConfig(sb, orgId);
      if (cfg.mode === "off") return res.json({ granted: 0, failed: [] });

      // 本人が見てよいプロジェクトだけ（RLS と同じ規則。isMember 参照）
      const { data: projects } = await sb.from("projects")
        .select("id").eq("organization_id", orgId).order("id", { ascending: true });
      const projectIds: string[] = [];
      for (const p of projects ?? []) {
        if (await isMember(sb, String(p.id), profile)) projectIds.push(String(p.id));
      }
      if (projectIds.length === 0) return res.json({ granted: 0, failed: [] });

      // BUG-01 同じ順序で処理する（途中で止まったとき、どこまで終わったかが再現する）
      const { data: files } = await sb.from("project_files")
        .select("id, file_name, external_id, uploaded_by")
        .in("project_id", projectIds).eq("external_provider", "google")
        .order("created_at", { ascending: true }).order("id", { ascending: true });
      const targets = (files ?? []).filter(f => !!f.external_id);
      if (targets.length === 0) return res.json({ granted: 0, failed: [] });

      const ctx = await grantContext(sb, orgId, cfg, profile.id);
      const recordEmail = googleEmail.toLowerCase();

      let granted = 0;
      const failed: { name: string; reason: string }[] = [];
      for (const f of targets) {
        const r = await grantEmailOnFile(ctx, f, googleEmail);
        if (r.ok) {
          granted++;
          // 開くとき（ensure-access）に付け直しを省けるよう記録しておく
          await recordGrant(sb, String(f.id), recordEmail);
        } else failed.push({ name: String(f.file_name), reason: r.reason });
      }
      return res.json({ granted, failed });
    }

    // ── 開く直前に、紐づけたGoogleアカウントへ権限を付ける ──
    // 権限は作成時のメンバーと、紐づけ直後（grant-self）にしか配られない。そのため
    //   ・紐づけ済みの人が、後からプロジェクトに追加された
    //   ・grant-self が入る前に紐づけた／grant-self がそのファイルだけ失敗した
    // といった人は、開くと Google の「アクセス権が必要です」になる。
    // ファイルを開く直前にここを通し、足りなければその場で付ける。
    //
    // 一度付けたら google_file_grants に記録して、期限内は Drive へ問い合わせずに返す
    // （毎回だと開くまで1秒ほど待たされるため）。
    //
    // 付けられなかったときも 200 で返す（ok=false）。共有ドライブのメンバーなど、
    // 付与しなくても開ける人がいるので、画面は理由を伝えつつそのまま開く。
    if (action === "ensure-access") {
      const fileId = String(body.fileId ?? "");
      if (!fileId) return res.status(400).json({ error: "fileId が必要です" });

      const { data: file } = await sb.from("project_files")
        .select("id, project_id, file_name, external_id, external_provider, uploaded_by")
        .eq("id", fileId).maybeSingle();
      if (!file) return res.status(404).json({ error: "File not found" });
      if (!(await isMember(sb, String(file.project_id), profile))) return res.status(403).json({ error: "Forbidden" });
      if (file.external_provider !== "google" || !file.external_id) {
        return res.status(400).json({ error: "Googleファイルではありません" });
      }

      const googleEmail = String(profile.google_email ?? "").trim();
      if (!googleEmail) return res.json({ ok: false, skipped: "not-linked" });
      // projectMemberEmails / grant-self と同じく、運営(owner)には自動で配らない
      if (profile.role === "owner") return res.json({ ok: false, skipped: "owner" });

      const recordEmail = googleEmail.toLowerCase();
      if (await hasFreshGrant(sb, String(file.id), recordEmail)) return res.json({ ok: true, cached: true });

      const { data: project } = await sb.from("projects")
        .select("organization_id").eq("id", String(file.project_id)).maybeSingle();
      const orgId = project?.organization_id ? String(project.organization_id) : "";
      if (!orgId) return res.json({ ok: false, skipped: "no-org" });
      const cfg = await orgConfig(sb, orgId);
      if (cfg.mode === "off") return res.json({ ok: false, skipped: "off" });

      const ctx = await grantContext(sb, orgId, cfg, profile.id);
      const r = await grantEmailOnFile(ctx, file, googleEmail);
      if (!r.ok) return res.json({ ok: false, reason: r.reason });

      await recordGrant(sb, String(file.id), recordEmail);
      return res.json({ ok: true, cached: false });
    }

    return res.status(404).json({ error: "Unknown action" });
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    console.error("[google] unexpected error:", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "処理に失敗しました" });
  }
}
