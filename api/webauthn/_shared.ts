// 生体認証ログイン(WebAuthn/Passkey) APIの共通ヘルパー
// チケット: ENHA2-013
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";

const RP_NAME = "Dev Ticket";
const CHALLENGE_TABLE = "webauthn_challenges";

// Service Role の Supabase クライアント（RLSバイパス）。既存 api/ と同じ規約。
export function getServiceClient(): SupabaseClient {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase service key not configured");
  return createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

// @vercel/node の関数型チェックは pnpm 配下の @supabase/auth-js(GoTrueClient) の
// 継承型を解決できず、auth.admin / auth.getUser を「存在しない」と誤検出する。
// 実行時には存在するメソッドなので、ここで型だけ明示的に緩めてアクセスする。
type AdminAuth = {
  getUser: (jwt?: string) => Promise<{ data: { user: any }; error: any }>;
  admin: {
    getUserById: (id: string) => Promise<{ data: { user: any } | null; error: any }>;
    generateLink: (params: any) => Promise<{ data: any; error: any }>;
    deleteUser: (id: string) => Promise<{ error: any }>;
  };
};
export function adminAuth(sb: SupabaseClient): AdminAuth {
  return sb.auth as unknown as AdminAuth;
}

// リクエスト元のオリジンから rpID(ホスト名) と expectedOrigin を導出する。
// 環境変数 WEBAUTHN_RP_ID で上書き可能（カスタムドメイン運用時）。
export function getRP(req: any): { rpID: string; origin: string; rpName: string } {
  const origin: string = req.headers?.origin || process.env.PUBLIC_URL || "http://localhost:5173";
  let host: string;
  try { host = new URL(origin).hostname; } catch { host = "localhost"; }
  const rpID = process.env.WEBAUTHN_RP_ID || host;
  return { rpID, origin, rpName: RP_NAME };
}

// Authorization: Bearer <access_token> を検証し、ログイン中ユーザーを返す。
export async function getBearerUser(sb: SupabaseClient, req: any) {
  const auth: string = req.headers?.authorization || req.headers?.Authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const { data, error } = await adminAuth(sb).getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

// チャレンジを発行・保存する。
export async function saveChallenge(sb: SupabaseClient, challenge: string) {
  await sb.from(CHALLENGE_TABLE).insert({ challenge });
}

// チャレンジ照合用コールバック（@simplewebauthn の expectedChallenge に渡す）。
// 一度使ったチャレンジは消費して再利用(リプレイ)を防ぐ。
export function challengeVerifier(sb: SupabaseClient) {
  return async (challenge: string): Promise<boolean> => {
    const { data } = await sb.from(CHALLENGE_TABLE).select("expires_at").eq("challenge", challenge).maybeSingle();
    // 消費（存在有無に関わらず削除）＋失効分の掃除
    await sb.from(CHALLENGE_TABLE).delete().eq("challenge", challenge);
    await sb.from(CHALLENGE_TABLE).delete().lt("expires_at", new Date().toISOString());
    if (!data) return false;
    return new Date(data.expires_at as string).getTime() >= Date.now();
  };
}

// base64url <-> Uint8Array（ArrayBuffer 裏付けの Uint8Array を返す）
export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(s, "base64url");
  const bytes = new Uint8Array(buf.byteLength);
  bytes.set(buf);
  return bytes;
}
export function bytesToB64url(b: Uint8Array): string {
  return Buffer.from(b).toString("base64url");
}

// ネイティブ端末シークレット用：生成とハッシュ化
export function generateSecret(): string {
  return randomBytes(32).toString("base64url");
}
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

// magiclink の token_hash を発行（生体認証成功後のセッション確立に使う）
export async function issueMagiclinkTokenHash(sb: SupabaseClient, userId: string): Promise<{ email: string; tokenHash: string } | { error: string }> {
  const auth = adminAuth(sb);
  const { data: userRes, error: userErr } = await auth.admin.getUserById(userId);
  if (userErr || !userRes?.user?.email) return { error: "ユーザー情報を取得できませんでした" };
  const email = userRes.user.email as string;
  const { data: linkData, error: linkErr } = await auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !linkData?.properties?.hashed_token) return { error: linkErr?.message || "セッションの発行に失敗しました" };
  return { email, tokenHash: linkData.properties.hashed_token };
}

// DBの text[] を WebAuthn の transports 型へ整える
export function asTransports(t: string[] | null | undefined): AuthenticatorTransportFuture[] | undefined {
  return (t ?? undefined) as AuthenticatorTransportFuture[] | undefined;
}
