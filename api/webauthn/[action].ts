// 生体認証ログイン: 単一の動的関数で全アクションを処理する自己完結ファイル。
// /api/webauthn/<action> の <action> が req.query.action に入る。
//
// 注意: Vercel の関数は ESM で動くため、ローカルの相対 import（拡張子無し / _始まり）は
// 実行時に解決できず ERR_MODULE_NOT_FOUND になる。そのためヘルパー・ハンドラを
// すべてこの1ファイルに内包し、import は node_modules のみに限定している。
// Serverless Functions 数を抑える目的（7→1）も兼ねる。
// チケット: ENHA2-013
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";

const RP_NAME = "Dev Ticket";
const CHALLENGE_TABLE = "webauthn_challenges";

// ── 共通ヘルパー ─────────────────────────────────────────────

// Service Role の Supabase クライアント（RLSバイパス）。既存 api/ と同じ規約。
function getServiceClient(): SupabaseClient {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase service key not configured");
  return createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

// @vercel/node の型チェックは pnpm 配下の auth-js(GoTrueClient) 継承型を解決できず
// auth.admin / auth.getUser を「存在しない」と誤検出するため、型だけ明示的に緩める。
type AdminAuth = {
  getUser: (jwt?: string) => Promise<{ data: { user: any }; error: any }>;
  admin: {
    getUserById: (id: string) => Promise<{ data: { user: any } | null; error: any }>;
    generateLink: (params: any) => Promise<{ data: any; error: any }>;
  };
};
function adminAuth(sb: SupabaseClient): AdminAuth {
  return sb.auth as unknown as AdminAuth;
}

// リクエスト元のオリジンから rpID(ホスト名) と expectedOrigin を導出する。
function getRP(req: any): { rpID: string; origin: string; rpName: string } {
  const origin: string = req.headers?.origin || process.env.PUBLIC_URL || "http://localhost:5173";
  let host: string;
  try { host = new URL(origin).hostname; } catch { host = "localhost"; }
  const rpID = process.env.WEBAUTHN_RP_ID || host;
  return { rpID, origin, rpName: RP_NAME };
}

// Authorization: Bearer <access_token> を検証し、ログイン中ユーザーを返す。
async function getBearerUser(sb: SupabaseClient, req: any) {
  const auth: string = req.headers?.authorization || req.headers?.Authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const { data, error } = await adminAuth(sb).getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function saveChallenge(sb: SupabaseClient, challenge: string) {
  await sb.from(CHALLENGE_TABLE).insert({ challenge });
}

// 一度使ったチャレンジは消費して再利用(リプレイ)を防ぐ。
function challengeVerifier(sb: SupabaseClient) {
  return async (challenge: string): Promise<boolean> => {
    const { data } = await sb.from(CHALLENGE_TABLE).select("expires_at").eq("challenge", challenge).maybeSingle();
    await sb.from(CHALLENGE_TABLE).delete().eq("challenge", challenge);
    await sb.from(CHALLENGE_TABLE).delete().lt("expires_at", new Date().toISOString());
    if (!data) return false;
    return new Date(data.expires_at as string).getTime() >= Date.now();
  };
}

function generateSecret(): string { return randomBytes(32).toString("base64url"); }
function hashSecret(secret: string): string { return createHash("sha256").update(secret).digest("base64url"); }

// magiclink の token_hash を発行（生体認証成功後のセッション確立に使う）
async function issueMagiclinkTokenHash(sb: SupabaseClient, userId: string): Promise<{ email: string; tokenHash: string } | { error: string }> {
  const auth = adminAuth(sb);
  const { data: userRes, error: userErr } = await auth.admin.getUserById(userId);
  if (userErr || !userRes?.user?.email) return { error: "ユーザー情報を取得できませんでした" };
  const email = userRes.user.email as string;
  const { data: linkData, error: linkErr } = await auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !linkData?.properties?.hashed_token) return { error: linkErr?.message || "セッションの発行に失敗しました" };
  return { email, tokenHash: linkData.properties.hashed_token };
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(s, "base64url");
  const bytes = new Uint8Array(buf.byteLength);
  bytes.set(buf);
  return bytes;
}
function bytesToB64url(b: Uint8Array): string { return Buffer.from(b).toString("base64url"); }
function asTransports(t: string[] | null | undefined): AuthenticatorTransportFuture[] | undefined {
  return (t ?? undefined) as AuthenticatorTransportFuture[] | undefined;
}

// ── アクションハンドラ ────────────────────────────────────────

// 生体認証の登録: チャレンジ&登録オプションを発行（要ログイン）
async function registerOptions(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  let sb;
  try { sb = getServiceClient(); } catch { return res.status(500).json({ error: "Supabase service key not configured" }); }

  const user = await getBearerUser(sb, req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const { rpID, rpName } = getRP(req);

  const { data: existing } = await sb.from("webauthn_credentials").select("credential_id, transports").eq("user_id", user.id);
  const excludeCredentials = (existing ?? []).map((c: any) => ({
    id: c.credential_id as string,
    transports: asTransports(c.transports as string[] | null),
  }));

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(user.id),
    userName: (user.email as string) || user.id,
    userDisplayName: (user.user_metadata?.name as string) || (user.email as string) || "User",
    attestationType: "none",
    excludeCredentials,
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });

  await saveChallenge(sb, options.challenge);
  return res.json(options);
}

// 生体認証の登録: attestation を検証してクレデンシャルを保存（要ログイン）
async function registerVerify(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  let sb;
  try { sb = getServiceClient(); } catch { return res.status(500).json({ error: "Supabase service key not configured" }); }

  const user = await getBearerUser(sb, req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const { response, deviceLabel } = req.body ?? {};
  if (!response) return res.status(400).json({ error: "response is required" });

  const { rpID, origin } = getRP(req);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challengeVerifier(sb),
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "登録の検証に失敗しました" });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ error: "生体認証の登録を検証できませんでした" });
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  const { error } = await sb.from("webauthn_credentials").insert({
    user_id: user.id,
    credential_id: credential.id,
    public_key: bytesToB64url(credential.publicKey),
    counter: credential.counter ?? 0,
    transports: credential.transports ?? null,
    device_label: deviceLabel || null,
  });
  if (error) {
    if (error.code === "23505") return res.status(409).json({ error: "この端末は既に登録済みです" });
    return res.status(400).json({ error: error.message });
  }

  return res.json({ success: true, credentialId: credential.id, credentialDeviceType, credentialBackedUp });
}

// 生体認証ログイン: 認証チャレンジを発行（未ログインで呼べる / usernameless）
async function loginOptions(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  let sb;
  try { sb = getServiceClient(); } catch { return res.status(500).json({ error: "Supabase service key not configured" }); }

  const { rpID } = getRP(req);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  await saveChallenge(sb, options.challenge);
  return res.json(options);
}

// 生体認証ログイン: assertion を検証し、セッション確立用トークンを返す
async function loginVerify(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  let sb;
  try { sb = getServiceClient(); } catch { return res.status(500).json({ error: "Supabase service key not configured" }); }

  const { response } = req.body ?? {};
  if (!response?.id) return res.status(400).json({ error: "response is required" });

  const { data: cred } = await sb.from("webauthn_credentials")
    .select("id, user_id, credential_id, public_key, counter, transports")
    .eq("credential_id", response.id)
    .maybeSingle();
  if (!cred) return res.status(404).json({ error: "登録されていない端末です" });

  const { rpID, origin } = getRP(req);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeVerifier(sb),
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.credential_id as string,
        publicKey: b64urlToBytes(cred.public_key as string),
        counter: Number(cred.counter ?? 0),
        transports: asTransports(cred.transports as string[] | null),
      },
      requireUserVerification: true,
    });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "認証の検証に失敗しました" });
  }

  if (!verification.verified) return res.status(401).json({ error: "生体認証に失敗しました" });

  await sb.from("webauthn_credentials")
    .update({ counter: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
    .eq("id", cred.id);

  const issued = await issueMagiclinkTokenHash(sb, cred.user_id as string);
  if ("error" in issued) return res.status(400).json({ error: issued.error });

  return res.json({ success: true, email: issued.email, tokenHash: issued.tokenHash });
}

// ネイティブ生体ログインの登録: 端末シークレットを発行（要ログイン）
async function nativeRegister(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  let sb;
  try { sb = getServiceClient(); } catch { return res.status(500).json({ error: "Supabase service key not configured" }); }

  const user = await getBearerUser(sb, req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const { deviceLabel } = req.body ?? {};
  const secret = generateSecret();

  const { error } = await sb.from("native_biometric_devices").insert({
    user_id: user.id,
    secret_hash: hashSecret(secret),
    device_label: deviceLabel || null,
  });
  if (error) return res.status(400).json({ error: error.message });

  return res.json({ success: true, secret });
}

// ネイティブ生体ログイン: 端末シークレットを照合しセッション確立用トークンを返す
async function nativeLogin(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  let sb;
  try { sb = getServiceClient(); } catch { return res.status(500).json({ error: "Supabase service key not configured" }); }

  const { secret } = req.body ?? {};
  if (!secret) return res.status(400).json({ error: "secret is required" });

  const { data: device } = await sb.from("native_biometric_devices")
    .select("id, user_id")
    .eq("secret_hash", hashSecret(secret))
    .maybeSingle();
  if (!device) return res.status(404).json({ error: "登録されていない端末です" });

  await sb.from("native_biometric_devices").update({ last_used_at: new Date().toISOString() }).eq("id", device.id);

  const issued = await issueMagiclinkTokenHash(sb, device.user_id as string);
  if ("error" in issued) return res.status(400).json({ error: issued.error });

  return res.json({ success: true, email: issued.email, tokenHash: issued.tokenHash });
}

// 生体データ削除: Web は credentialId、ネイティブは nativeSecret で対象端末を特定（要ログイン）
async function deleteCredential(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  let sb;
  try { sb = getServiceClient(); } catch { return res.status(500).json({ error: "Supabase service key not configured" }); }

  const user = await getBearerUser(sb, req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const { credentialId, nativeSecret } = req.body ?? {};
  const scoped = Boolean(credentialId || nativeSecret);

  if (credentialId || !scoped) {
    let q = sb.from("webauthn_credentials").delete().eq("user_id", user.id);
    if (credentialId) q = q.eq("credential_id", credentialId);
    const { error } = await q;
    if (error) return res.status(400).json({ error: error.message });
  }

  if (nativeSecret || !scoped) {
    let q = sb.from("native_biometric_devices").delete().eq("user_id", user.id);
    if (nativeSecret) q = q.eq("secret_hash", hashSecret(nativeSecret));
    const { error } = await q;
    if (error) return res.status(400).json({ error: error.message });
  }

  return res.json({ success: true });
}

// ── ディスパッチャ（Vercel のエントリ） ──────────────────────────
const routes: Record<string, (req: any, res: any) => Promise<any>> = {
  "register-options": registerOptions,
  "register-verify": registerVerify,
  "login-options": loginOptions,
  "login-verify": loginVerify,
  "native-register": nativeRegister,
  "native-login": nativeLogin,
  "delete-credential": deleteCredential,
};

export default async function handler(req: any, res: any) {
  const raw = req.query?.action;
  const action = Array.isArray(raw) ? raw[0] : raw;
  const fn = action ? routes[action] : undefined;
  if (!fn) return res.status(404).json({ error: "Not Found" });
  return fn(req, res);
}
