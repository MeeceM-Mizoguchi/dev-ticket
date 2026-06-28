// 生体認証の登録: 署名(attestation)を検証してクレデンシャルを保存（要ログイン）
// チケット: ENHA2-013
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { getServiceClient, getRP, getBearerUser, challengeVerifier, bytesToB64url } from "./_shared";

export default async function handler(req: any, res: any) {
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
    credential_id: credential.id,                       // base64url 文字列
    public_key: bytesToB64url(credential.publicKey),    // Uint8Array → base64url
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
