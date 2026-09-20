import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

// Googleドライブ連携（ファイルボックス）
// 設計: docs/google-drive-integration-design.md
//
// ファイルボックスから Googleスプレッドシート／ドキュメント／スライドを新規作成し、
// 別タブで開いて編集できるようにする。作成したファイルは project_files にも登録され、
// DevTicket の一覧・フォルダ階層にそのまま並ぶ。
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
//   POST /api/google/oauth-start      {}                                  → { url }
//   GET  /api/google/oauth-callback   ?code=&state=                       → 302
//   POST /api/google/status           { projectId? }                      → { connected, mode, ... }
//   POST /api/google/disconnect       {}                                  → { ok }
//   POST /api/google/create           { projectId, kind, parentId? }      → { file, url }
//   POST /api/google/rename           { fileId, newName }                 → { ok }
//   POST /api/google/share-link       { fileId, enabled }                 → { linkShared }
//   POST /api/google/sync-permissions { projectId }                       → { granted, failed }
//   POST /api/google/test-connection  { sharedDriveId }                   → { ok } / 400

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

const DEFAULT_NAME: Record<string, string> = {
  spreadsheet: "無題のスプレッドシート",
  document: "無題のドキュメント",
  presentation: "無題のスライド",
};

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
function signState(payload: { u: string; o: string; e: number }): string {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", stateSecret()).update(body).digest());
  return `${body}.${sig}`;
}
function verifyState(token: string): { u: string; o: string; e: number } | null {
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

/**
 * 指定の親の下にある同名フォルダを探し、無ければ作ってIDを返す。
 *
 * 毎回 files.list で名前引きしているのは、フォルダIDをDBに覚えるとその
 * フォルダがDrive側で消されたときに二度と作り直せなくなるため。
 * （Drive側の変更はDevTicketからは検知できない。設計書 9.1）
 */
async function ensureFolder(
  accessToken: string, name: string, parentId: string, driveId: string | null,
): Promise<string> {
  const params = new URLSearchParams({
    q: `name='${q(name)}' and mimeType='${FOLDER_MIME}' and '${q(parentId)}' in parents and trashed=false`,
    fields: "files(id,name)",
    pageSize: "1",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  if (driveId) { params.set("corpora", "drive"); params.set("driveId", driveId); }

  const found = await drive(accessToken, `/files?${params}`);
  if (found?.files?.[0]?.id) return found.files[0].id as string;

  const created = await drive(accessToken, "/files?supportsAllDrives=true&fields=id", {
    method: "POST",
    body: { name, mimeType: FOLDER_MIME, parents: [parentId] },
  });
  if (!created?.id) throw new HttpError(502, `Googleドライブに「${name}」フォルダを作成できませんでした`);
  return created.id as string;
}

/** 保存先フォルダ（<ルート>/DevTicket/<プロジェクト名>/）を解決する */
async function resolveTargetFolder(
  accessToken: string, mode: string, sharedDriveId: string | null, projectName: string,
): Promise<string> {
  const driveId = mode === "shared_drive" ? sharedDriveId : null;
  const root = mode === "shared_drive" ? String(sharedDriveId) : "root";
  const devticket = await ensureFolder(accessToken, ROOT_FOLDER_NAME, root, driveId);
  // 空のプロジェクト名でフォルダを作らせない（ensureFolderPath の「無題のフォルダ」と同じ考え方）
  const safeName = projectName.trim() || "無題のプロジェクト";
  return ensureFolder(accessToken, safeName, devticket, driveId);
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
    .select("name, email, role, status")
    .eq("organization_id", project.organization_id);

  const members = new Set((project.members ?? []).map(String));
  return (rows ?? [])
    .filter(r => r.role !== "owner")
    .filter(r => r.status !== "invited")
    .filter(r => members.has(String(r.name)) || r.role === "admin" || r.role === "project-manager")
    .map(r => ({ email: String(r.email || "").trim(), name: String(r.name || "") }))
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
// project_files の file_name は「どのファイルか」を指す引き当てキー（版・コメント・改名・削除が
// これで引く）。Googleファイルにも同じ規則を通すため、登録前に空き名を探しておく。
// api/project-files/[action].ts の nextFreeName と同じ規則。
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

/** 組織の連携設定を引く */
async function orgConfig(sb: SupabaseClient, orgId: string | null) {
  if (!orgId) return { mode: "off", sharedDriveId: null as string | null, sharedDriveName: null as string | null };
  const { data } = await sb.from("organizations")
    .select("google_drive_mode, google_shared_drive_id, google_shared_drive_name")
    .eq("id", orgId).maybeSingle();
  return {
    mode: String(data?.google_drive_mode ?? "off"),
    sharedDriveId: (data?.google_shared_drive_id as string | null) ?? null,
    sharedDriveName: (data?.google_shared_drive_name as string | null) ?? null,
  };
}

// ============================================================
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  const action = String(req.query?.action ?? "");

  let sb: SupabaseClient;
  try { sb = admin(); } catch { return res.status(500).json({ error: "Supabase not configured" }); }

  // ── OAuth コールバック（Googleからのリダイレクト。ここだけ GET かつ未認証） ──
  if (action === "oauth-callback") {
    const back = (params: Record<string, string>) =>
      res.redirect(302, `${publicUrl(req)}/admin-settings?tab=google&${new URLSearchParams(params)}`);

    const err = String(req.query?.error ?? "");
    if (err) return back({ google: "error", message: err === "access_denied" ? "連携がキャンセルされました" : err });

    const payload = verifyState(String(req.query?.state ?? ""));
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

    const { error: upsertErr } = await sb.from("google_drive_tokens").upsert({
      user_id: payload.u,
      organization_id: payload.o ?? "",
      google_email: googleEmail,
      refresh_token: token.refresh_token,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (upsertErr) return back({ google: "error", message: "連携情報の保存に失敗しました" });

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

      const state = signState({
        u: profile.id,
        o: String(profile.organization_id ?? ""),
        e: Date.now() + STATE_TTL_MS,
      });
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri(req),
        response_type: "code",
        scope: SCOPE,
        // access_type=offline + prompt=consent の両方が無いと refresh_token が返らない。
        // 2回目以降の連携でも確実に受け取るため prompt=consent を必ず付ける。
        access_type: "offline",
        prompt: "consent",
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
    if (action === "picker-token") {
      if (profile.role !== "owner" && profile.role !== "admin") {
        return res.status(403).json({ error: "管理者のみ実行できます" });
      }
      const accessToken = await getAccessToken(sb, profile.id);
      return res.json({ accessToken });
    }

    // ── 接続テスト（組織設定の保存前に必ず通す） ──────────
    // 設定だけ保存できて誰もファイルを開けない、という状態を本番で作らないための関門。
    // 実際に「作る」「配る」まで試し、後片付けまでして初めて成功と見なす。
    if (action === "test-connection") {
      const sharedDriveId = String(body.sharedDriveId ?? "");
      if (!sharedDriveId) return res.status(400).json({ error: "共有ドライブが選択されていません" });
      if (profile.role !== "owner" && profile.role !== "admin") {
        return res.status(403).json({ error: "管理者のみ実行できます" });
      }

      const accessToken = await getAccessToken(sb, profile.id);
      let fileId = "";
      try {
        const created = await drive(accessToken, "/files?supportsAllDrives=true&fields=id", {
          method: "POST",
          body: { name: "DevTicket 接続テスト", mimeType: MIME.spreadsheet, parents: [sharedDriveId] },
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
      if (!projectId || !MIME[kind]) return res.status(400).json({ error: "projectId と kind が必要です" });
      if (!(await isMember(sb, projectId, profile))) return res.status(403).json({ error: "Forbidden" });

      const { data: project } = await sb.from("projects")
        .select("id, name, organization_id, members").eq("id", projectId).maybeSingle();
      if (!project) return res.status(404).json({ error: "プロジェクトが見つかりません" });

      const cfg = await orgConfig(sb, project.organization_id ? String(project.organization_id) : null);
      if (cfg.mode === "off") return res.status(403).json({ error: "この組織ではGoogleドライブ連携が有効になっていません" });
      if (cfg.mode === "shared_drive" && !cfg.sharedDriveId) {
        return res.status(400).json({ error: "共有ドライブが設定されていません。外部連携の設定を確認してください" });
      }

      // 置き場所のフォルダ。register と同じく、他プロジェクトのフォルダや
      // フォルダでない行を親に指定させない。
      const rawParentId = body.parentId ?? null;
      let parentId: string | null = null;
      if (rawParentId) {
        const { data: parent } = await sb.from("project_files")
          .select("id, project_id, is_folder").eq("id", String(rawParentId)).maybeSingle();
        if (!parent || parent.project_id !== projectId || !parent.is_folder) {
          return res.status(400).json({ error: "保存先のフォルダが見つかりません" });
        }
        parentId = String(parent.id);
      }

      const accessToken = await getAccessToken(sb, profile.id);
      const folderId = await resolveTargetFolder(accessToken, cfg.mode, cfg.sharedDriveId, String(project.name ?? ""));

      // DevTicket 側で一意な名前を先に決める。file_name は改名・削除・コメントの
      // 引き当てキーなので、重複したまま登録すると別のファイルを巻き込む。
      const wanted = sanitizeFileName(String(body.name ?? "")) || DEFAULT_NAME[kind];
      const { data: existing } = await sb.from("project_files")
        .select("file_name").eq("project_id", projectId);
      const fileName = nextFreeName(wanted, new Set((existing ?? []).map(r => String(r.file_name))));

      const created = await drive(accessToken, "/files?supportsAllDrives=true&fields=id,webViewLink,name", {
        method: "POST",
        body: { name: fileName, mimeType: MIME[kind], parents: [folderId] },
      });
      if (!created?.id || !created?.webViewLink) {
        throw new HttpError(502, "Googleドライブ上にファイルを作成できませんでした");
      }

      // 共有ドライブなら、そのドライブのメンバーには既に見えている。
      // それでも配るのは、ドライブのメンバーではない人（プロジェクトには入っている）に届けるため。
      const people = await projectMemberEmails(sb, project as any);
      const share = await grantMembers(accessToken, String(created.id), people, String(profile.google_email ?? ""));

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

      const accessToken = await getAccessToken(sb, profile.id);
      await drive(accessToken, `/files/${encodeURIComponent(String(file.external_id))}?supportsAllDrives=true`, {
        method: "PATCH", body: { name: newName },
      });
      return res.json({ ok: true });
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

      const accessToken = await getAccessToken(sb, profile.id);
      const gid = encodeURIComponent(String(file.external_id));

      if (enabled) {
        await drive(accessToken, `/files/${gid}/permissions?supportsAllDrives=true`, {
          method: "POST",
          // allowFileDiscovery=false で検索には出さない（URLを知っている人だけ）
          body: { type: "anyone", role: "writer", allowFileDiscovery: false },
        });
      } else {
        // type=anyone の権限IDは固定で "anyone"
        await drive(accessToken, `/files/${gid}/permissions/anyone?supportsAllDrives=true`, { method: "DELETE" })
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

      const accessToken = await getAccessToken(sb, profile.id);
      const people = await projectMemberEmails(sb, project as any);

      let granted = 0;
      const failed: { name: string; reason: string }[] = [];
      for (const f of targets) {
        const r = await grantMembers(accessToken, String(f.external_id), people, String(profile.google_email ?? ""));
        granted += r.granted;
        for (const x of r.failed) failed.push({ name: `${f.file_name} / ${x.name}`, reason: x.reason });
      }
      return res.json({ granted, failed });
    }

    return res.status(404).json({ error: "Unknown action" });
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    console.error("[google] unexpected error:", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "処理に失敗しました" });
  }
}
