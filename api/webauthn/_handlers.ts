// 生体認証ログイン: 各アクションのハンドラ群（[action].ts から振り分けて呼ぶ）
// Vercel の Serverless Functions 数を抑えるため、7エンドポイントを1関数に集約している。
// ファイル名が _ 始まりなのでルート(関数)としては扱われない。
// チケット: ENHA2-013
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import {
  getServiceClient, getRP, getBearerUser, saveChallenge, challengeVerifier,
  bytesToB64url, b64urlToBytes, asTransports, generateSecret, hashSecret, issueMagiclinkTokenHash,
} from "./_shared";

// 生体認証の登録: チャレンジ&登録オプションを発行（要ログイン）
export async function registerOptions(req: any, res: any) {
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
export async function registerVerify(req: any, res: any) {
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
export async function loginOptions(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  let sb;
  try { sb = getServiceClient(); } catch { return res.status(500).json({ error: "Supabase service key not configured" }); }

  const { rpID } = getRP(req);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  await saveChallenge(sb, options.challenge);
  return res.json(options);
}

// 生体認証ログイン: assertion を検証し、セッション確立用トークンを返す
export async function loginVerify(req: any, res: any) {
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
export async function nativeRegister(req: any, res: any) {
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
export async function nativeLogin(req: any, res: any) {
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
export async function deleteCredential(req: any, res: any) {
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
