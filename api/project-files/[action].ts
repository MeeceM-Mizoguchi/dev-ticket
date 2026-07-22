import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

// ENHA2-035 ファイルボックス
// project-files バケットは非公開。クライアントは storage を直接叩かず、
// 全ての操作をここ(service_role)経由に寄せている。理由は2つ:
//   1. アップロード/閲覧/削除のたびに「プロジェクトメンバーか」をサーバーで検証できる
//   2. storage.objects の RLS ポリシーが一切不要になる
//      (Supabase の SQL Editor では storage.objects にポリシーを作れないため、
//       Dashboard での手作業を前提にしない設計にしている)
//
// アップロードは署名付きアップロードURLを発行してブラウザ→ストレージへ直接送る。
// サーバーレス関数の body を経由しないので、Vercel のリクエストサイズ上限に縛られない。
//
// endpoints (Vercel の [action] 動的セグメント):
//   POST /api/project-files/upload-url  { projectId, fileName }  → { path, token }
//   POST /api/project-files/register    { projectId, path, fileName, fileSize, fileType } → { file }
//   POST /api/project-files/signed-url  { fileId, mode }         → { url, ... }
//   POST /api/project-files/delete      { fileId }               → { ok: true }

const BUCKET = "project-files";
const SIGNED_URL_TTL_SEC = 60;
const DAV_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

// ★ api/dav/[...path].ts の verifyDavToken と対になっている。
//   片方だけ変えると WebDAV 保存が 401 になるので必ず両方あわせて直すこと。
//   (api/ 配下のルートファイル同士を import し合わないよう、あえて複製している)
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function signDavToken(payload: { p: string; n: string; u: string; e: number }): string {
  const secret = process.env.DAV_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

// @vercel/node の型チェックが auth.getUser を解決できないケースがあるため型だけ緩める
// (api/webauthn/[action].ts と同じ回避)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthLike = { getUser: (jwt?: string) => Promise<{ data: { user: any }; error: any }> };

function admin(): SupabaseClient {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Authorization: Bearer <access_token> からプロフィールを引く
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getProfile(sb: SupabaseClient, req: any) {
  const header: string = req.headers?.authorization || req.headers?.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const { data, error } = await (sb.auth as unknown as AuthLike).getUser(token);
  if (error || !data?.user) return null;
  const { data: profile } = await sb.from("profiles").select("name, role").eq("id", data.user.id).maybeSingle();
  return profile ?? null;
}

// プロジェクトメンバー(または管理者)でなければ false
async function isMember(sb: SupabaseClient, projectId: string, profile: { name: string; role: string }) {
  if (profile.role === "admin" || profile.role === "owner") return true;
  const { data: project } = await sb.from("projects").select("members").eq("id", projectId).maybeSingle();
  if (!project) return false;
  const members: string[] = Array.isArray(project.members) ? project.members : [];
  return members.includes(profile.name);
}

function extOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i < 0 ? "" : fileName.slice(i + 1).toLowerCase();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const action = String(req.query?.action ?? "");
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});

  let sb: SupabaseClient;
  try { sb = admin(); } catch { return res.status(500).json({ error: "Supabase not configured" }); }

  const profile = await getProfile(sb, req);
  if (!profile) return res.status(401).json({ error: "Unauthorized" });

  // ── アップロード用の署名付きURLを発行 ──────────────────────
  if (action === "upload-url") {
    const projectId = String(body.projectId ?? "");
    const fileName = String(body.fileName ?? "");
    if (!projectId || !fileName) return res.status(400).json({ error: "projectId and fileName are required" });
    if (!(await isMember(sb, projectId, profile))) return res.status(403).json({ error: "Forbidden" });

    // 保存キーはサーバーが決める（クライアントに任意パスを書かせない）。
    // 日本語ファイル名をキーに使わないため、表示名は register 時にDBへ保存する。
    const ext = extOf(fileName);
    const path = `${projectId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext ? `.${ext}` : ""}`;

    const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) return res.status(500).json({ error: error?.message || "Failed to create upload URL" });
    return res.json({ path: data.path, token: data.token });
  }

  // ── アップロード完了後のDB登録 ─────────────────────────────
  if (action === "register") {
    const projectId = String(body.projectId ?? "");
    const path = String(body.path ?? "");
    const fileName = String(body.fileName ?? "");
    if (!projectId || !path || !fileName) return res.status(400).json({ error: "projectId, path and fileName are required" });
    if (!(await isMember(sb, projectId, profile))) return res.status(403).json({ error: "Forbidden" });
    // 他プロジェクト配下のオブジェクトを自プロジェクトの行として登録させない
    if (!path.startsWith(`${projectId}/`)) return res.status(400).json({ error: "Invalid path" });

    // 版番号はサーバーで採番する（クライアント側の一覧が古くても衝突しない）
    const { data: sameName } = await sb.from("project_files")
      .select("version").eq("project_id", projectId).eq("file_name", fileName)
      .order("version", { ascending: false }).limit(1);
    const version = (sameName?.[0]?.version ?? 0) + 1;

    const { data: inserted, error } = await sb.from("project_files").insert({
      project_id: projectId, folder_path: "", file_name: fileName,
      file_size: Number(body.fileSize) || 0, file_type: String(body.fileType ?? ""),
      file_path: path, version, uploaded_by: profile.name,
    }).select().maybeSingle();
    if (error) {
      // DB登録に失敗したらストレージ上の孤児を残さない
      await sb.storage.from(BUCKET).remove([path]);
      return res.status(500).json({ error: error.message });
    }
    return res.json({ file: inserted });
  }

  // ── 閲覧/DL用の短命な署名付きURLを発行 ──────────────────────
  if (action === "signed-url") {
    const fileId = String(body.fileId ?? "");
    const mode = body.mode === "download" ? "download" : "inline";
    if (!fileId) return res.status(400).json({ error: "fileId is required" });

    const { data: file } = await sb.from("project_files")
      .select("project_id, file_name, file_type, file_path").eq("id", fileId).maybeSingle();
    if (!file) return res.status(404).json({ error: "File not found" });
    if (!(await isMember(sb, file.project_id, profile))) return res.status(403).json({ error: "Forbidden" });

    const { data: signed, error } = await sb.storage.from(BUCKET)
      .createSignedUrl(file.file_path, SIGNED_URL_TTL_SEC,
        mode === "download" ? { download: file.file_name } : undefined);
    if (error || !signed?.signedUrl) return res.status(500).json({ error: error?.message || "Failed to sign URL" });
    return res.json({ url: signed.signedUrl, fileName: file.file_name, fileType: file.file_type, expiresIn: SIGNED_URL_TTL_SEC });
  }

  // ── アプリで開く用の WebDAV URL を発行 ──────────────────────
  // Office はアプリのログインセッションを送ってこないため、URLに署名トークンを埋める。
  // トークンは「プロジェクト+ファイル名」を指すので、保存で版が増えても失効しない。
  if (action === "dav-url") {
    const fileId = String(body.fileId ?? "");
    if (!fileId) return res.status(400).json({ error: "fileId is required" });

    const { data: file } = await sb.from("project_files")
      .select("project_id, file_name").eq("id", fileId).maybeSingle();
    if (!file) return res.status(404).json({ error: "File not found" });
    if (!(await isMember(sb, file.project_id, profile))) return res.status(403).json({ error: "Forbidden" });

    // 有効期限は固定の時間枠に丸める。毎回 Date.now()+TTL にすると
    // 「アプリで開く」のたびにトークン＝URLが変わり、Office のドキュメントキャッシュが
    // 同じファイルを別物と見なして、開くたびに更新を促してくる。
    // 枠に丸めることで、同じファイルなら同じURLになる（有効期間は 12〜24時間）。
    const slot = (Math.floor(Date.now() / DAV_TOKEN_TTL_MS) + 2) * DAV_TOKEN_TTL_MS;
    const token = signDavToken({
      p: file.project_id, n: file.file_name, u: profile.name, e: slot,
    });
    const proto = String(req.headers["x-forwarded-proto"] ?? "https");
    const base = process.env.PUBLIC_URL || `${proto}://${req.headers.host}`;
    // URL 末尾を実ファイル名にしておくと、Office のタイトルバーに正しい名前が出る
    return res.json({ url: `${base}/api/dav/${token}/${encodeURIComponent(file.file_name)}` });
  }

  // ── 削除（同名ファイルの全バージョン + ストレージ実体） ──────
  if (action === "delete") {
    const fileId = String(body.fileId ?? "");
    if (!fileId) return res.status(400).json({ error: "fileId is required" });

    const { data: file } = await sb.from("project_files")
      .select("project_id, file_name").eq("id", fileId).maybeSingle();
    if (!file) return res.status(404).json({ error: "File not found" });
    if (!(await isMember(sb, file.project_id, profile))) return res.status(403).json({ error: "Forbidden" });

    // 一覧は最新版だけを見せているので、削除も同名の全版をまとめて消す。
    // (最新版だけ消すと、画面上は古い版が復活したように見えてしまう)
    const { data: all } = await sb.from("project_files")
      .select("id, file_path").eq("project_id", file.project_id).eq("file_name", file.file_name);
    const paths = (all ?? []).map(r => r.file_path).filter(Boolean);

    const { error } = await sb.from("project_files")
      .delete().eq("project_id", file.project_id).eq("file_name", file.file_name);
    if (error) return res.status(500).json({ error: error.message });
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);
    return res.json({ ok: true, deleted: paths.length });
  }

  return res.status(404).json({ error: "Unknown action" });
}
