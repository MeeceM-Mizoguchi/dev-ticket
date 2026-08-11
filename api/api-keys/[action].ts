// ============================================================
// APIキーの発行と復号。管理画面（ApiIntegrationDialog）から呼ばれる。
//
//   POST /api/api-keys/create  { name, projectId, expiresInDays } → { plainKey, key }
//   POST /api/api-keys/reveal  { id }                             → { plainKey }
//
// 認証は「ログイン中ユーザーの Supabase アクセストークン」。
//   Authorization: Bearer <supabase access_token>
// ※ api/v1/[resource].ts は逆に「APIキー」で認証する。用途が違うのでファイルを分けている。
//
// なぜサーバー経由なのか:
//   キーの平文を AES-256-GCM で暗号化して保存するため。暗号鍵はDBではなく Vercel の
//   環境変数側から導出するので、DBのバックアップやダンプだけが漏れてもキーは復元できない。
//   ブラウザには暗号鍵を渡せないため、発行と復号はサーバーでしか行えない。
//
// ★ このファイルも自己完結させている ★
//   Vercel のサーバー関数は src/ を同梱しないため（api/ml/recommend.ts と同じ事情）。
//
// ⚠️ 暗号鍵の導出元を変えると、既存のキーが復号できなくなる（＝再発行が必要になる）。
// ============================================================
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

const KEY_PREFIX = "dvt_live_";
/** 一覧表示用に見せる、接頭辞のあとの文字数 */
const VISIBLE_CHARS = 8;
/** 暗号文の形式バージョン。将来アルゴリズムを変える余地を残す */
const CIPHER_VERSION = "v1";

// @vercel/node の型チェックが auth.getUser を解決できないケースがあるため型だけ緩める
// (api/project-files/[action].ts と同じ回避)
type AuthLike = { getUser: (jwt?: string) => Promise<{ data: { user: any }; error: any }> };

function admin(): SupabaseClient {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ── 暗号化 ────────────────────────────────────────────────────
/**
 * 暗号鍵。専用の環境変数があればそれを、無ければ service_role キーから導出する。
 * 後者にしているのは、Vercel 側に新しい環境変数を追加させないため
 * （api/project-files/[action].ts の DAV_TOKEN_SECRET と同じ考え方）。
 */
function encryptionKey(): Buffer {
  const secret = process.env.API_KEY_ENC_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!secret) throw new Error("暗号鍵を導出できません");
  return crypto.createHash("sha256").update(`dev-ticket:api-key-cipher:${secret}`).digest();
}

// export しているのは検証用（scripts から往復を確認できるようにするため）。
// ルーティングには影響しない（Vercel が見るのは default export のみ）。
export function encryptKey(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [CIPHER_VERSION, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

/** 復号できなければ null（暗号鍵を変えた／この機能の導入前に発行されたキー） */
export function decryptKey(payload: string | null): string | null {
  if (!payload) return null;
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== CIPHER_VERSION) return null;
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(parts[1], "base64url"),
    );
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    const plain = Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}

// ── 認証（ログイン中の管理者であること） ──────────────────────
interface Caller {
  id: string;
  name: string;
  role: string;
  organizationId: string | null;
}

async function getCaller(sb: SupabaseClient, req: any): Promise<Caller | null> {
  const header: string = req.headers?.authorization || req.headers?.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;

  const { data, error } = await (sb.auth as unknown as AuthLike).getUser(token);
  if (error || !data?.user) return null;

  const { data: profile } = await sb
    .from("profiles").select("name, role, organization_id").eq("id", data.user.id).maybeSingle();
  if (!profile) return null;

  return {
    id: data.user.id,
    name: (profile.name as string) ?? "",
    role: (profile.role as string) ?? "",
    organizationId: (profile.organization_id as string | null) ?? null,
  };
}

const isAdmin = (caller: Caller) => caller.role === "admin" || caller.role === "owner";

/** owner は全組織を触れる。それ以外は自分の組織のみ（NULL 同士も一致とみなす） */
function sameOrg(caller: Caller, organizationId: string | null): boolean {
  if (caller.role === "owner") return true;
  return organizationId === caller.organizationId;
}

// ── 行のマッピング（クライアントの ApiKeyRow と揃える） ────────
function mapRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    key_prefix: row.key_prefix,
    project_id: row.project_id,
    organization_id: row.organization_id,
    created_by: row.created_by,
    created_at: row.created_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    last_used_at: row.last_used_at,
  };
}

const SELECT_COLS =
  "id, name, key_prefix, project_id, organization_id, created_by, created_at, expires_at, revoked_at, last_used_at";

// ── POST /api/api-keys/create ────────────────────────────────
async function handleCreate(sb: SupabaseClient, caller: Caller, body: any, res: any) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
  const expiresInDays =
    body?.expiresInDays === null || body?.expiresInDays === undefined ? null : Number(body.expiresInDays);

  if (!name) return res.status(400).json({ error: "用途名を入力してください" });
  if (name.length > 120) return res.status(400).json({ error: "用途名が長すぎます（120文字まで）" });
  if (!projectId) return res.status(400).json({ error: "プロジェクトが特定できません" });
  if (expiresInDays !== null && (!isFinite(expiresInDays) || expiresInDays <= 0 || expiresInDays > 3650)) {
    return res.status(400).json({ error: "有効期限の指定が不正です" });
  }

  const { data: project } = await sb
    .from("projects").select("id, organization_id").eq("id", projectId).maybeSingle();
  if (!project) return res.status(404).json({ error: "プロジェクトが見つかりません" });

  // マルチテナント導入前のプロジェクトは organization_id が NULL のことがある。
  // その場合は発行者自身の組織で補う（クライアント側の従来実装と同じ扱い）。
  const organizationId = (project.organization_id as string | null) ?? caller.organizationId;
  if (!sameOrg(caller, (project.organization_id as string | null) ?? caller.organizationId)) {
    return res.status(403).json({ error: "他の組織のプロジェクトにはAPIキーを発行できません" });
  }

  // 32バイトの乱数を base64url にしたものを本体にする
  const plainKey = KEY_PREFIX + crypto.randomBytes(32).toString("base64url");
  const keyHash = crypto.createHash("sha256").update(plainKey).digest("hex");

  const expiresAt = expiresInDays === null
    ? null
    : new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await sb
    .from("api_keys")
    .insert({
      name,
      key_hash: keyHash,
      key_prefix: plainKey.slice(0, KEY_PREFIX.length + VISIBLE_CHARS),
      key_cipher: encryptKey(plainKey),
      project_id: projectId,
      organization_id: organizationId,
      created_by: caller.name || null,
      expires_at: expiresAt,
    })
    .select(SELECT_COLS)
    .single();

  if (error || !data) {
    const message = error?.message ?? "APIキーの発行に失敗しました";
    if (/key_cipher/.test(message)) {
      return res.status(500).json({
        error: "APIキーのテーブルが古い形式です。supabase/add_api_keys.sql を Supabase で実行し直してください",
      });
    }
    if (/relation .*api_keys.* does not exist|schema cache/i.test(message)) {
      return res.status(500).json({
        error: "APIキーのテーブルがまだありません。supabase/add_api_keys.sql を Supabase で実行してください",
      });
    }
    return res.status(500).json({ error: `APIキーの発行に失敗しました: ${message}` });
  }

  return res.status(201).json({ plainKey, key: mapRow(data) });
}

// ── POST /api/api-keys/reveal ────────────────────────────────
async function handleReveal(sb: SupabaseClient, caller: Caller, body: any, res: any) {
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) return res.status(400).json({ error: "id は必須です" });

  const { data: key } = await sb
    .from("api_keys")
    .select("id, organization_id, key_cipher, revoked_at, expires_at")
    .eq("id", id)
    .maybeSingle();

  if (!key) return res.status(404).json({ error: "APIキーが見つかりません" });
  if (!sameOrg(caller, (key.organization_id as string | null) ?? null)) {
    return res.status(403).json({ error: "このAPIキーを参照する権限がありません" });
  }

  const plainKey = decryptKey(key.key_cipher as string | null);
  if (!plainKey) {
    // この機能の導入前に発行されたキーは key_cipher を持っていない
    return res.status(409).json({
      error: "このキーは平文を復元できません（暗号化して保存する前に発行されたキーです）。新しく発行し直してください",
      code: "no_cipher",
    });
  }

  return res.status(200).json({ plainKey });
}

// ── エントリポイント ──────────────────────────────────────────
export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const action = String(req.query?.action ?? "");
  if (action !== "create" && action !== "reveal") {
    return res.status(404).json({ error: `不明なエンドポイントです: /api/api-keys/${action}` });
  }

  let sb: SupabaseClient;
  try { sb = admin(); } catch { return res.status(500).json({ error: "Supabase not configured" }); }

  const caller = await getCaller(sb, req);
  if (!caller) return res.status(401).json({ error: "ログインが必要です" });
  if (!isAdmin(caller)) return res.status(403).json({ error: "APIキーを操作する権限がありません（管理者のみ）" });

  let body: any;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
  } catch {
    return res.status(400).json({ error: "リクエストボディが JSON として読めません" });
  }

  try {
    return action === "create"
      ? await handleCreate(sb, caller, body, res)
      : await handleReveal(sb, caller, body, res);
  } catch (e: any) {
    return res.status(500).json({ error: `処理中にエラーが発生しました: ${e?.message ?? String(e)}` });
  }
}
