// 生体認証ログイン: 署名(assertion)を検証し、Supabaseセッション確立用トークンを返す
// チケット: ENHA2-013
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { getServiceClient, getRP, challengeVerifier, b64urlToBytes, asTransports, issueMagiclinkTokenHash } from "./_shared";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  let sb;
  try { sb = getServiceClient(); } catch { return res.status(500).json({ error: "Supabase service key not configured" }); }

  const { response } = req.body ?? {};
  if (!response?.id) return res.status(400).json({ error: "response is required" });

  // 返ってきた credential_id から登録済みクレデンシャルを特定
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

  // カウンタ更新（クローン検知のため）
  await sb.from("webauthn_credentials")
    .update({ counter: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString() })
    .eq("id", cred.id);

  // magiclink の token_hash を発行。クライアント側で
  // supabase.auth.verifyOtp({ token_hash }) を呼びセッション確立する。
  const issued = await issueMagiclinkTokenHash(sb, cred.user_id as string);
  if ("error" in issued) return res.status(400).json({ error: issued.error });

  return res.json({ success: true, email: issued.email, tokenHash: issued.tokenHash });
}
