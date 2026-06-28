// 生体データ削除: この端末の登録クレデンシャルを削除（要ログイン）
// Web は credentialId、ネイティブは nativeSecret で対象端末を特定する。
// どちらの指定も無ければ本ユーザーの全登録を削除する。
// チケット: ENHA2-013
import { getServiceClient, getBearerUser, hashSecret } from "./_shared";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  let sb;
  try { sb = getServiceClient(); } catch { return res.status(500).json({ error: "Supabase service key not configured" }); }

  const user = await getBearerUser(sb, req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const { credentialId, nativeSecret } = req.body ?? {};
  const scoped = Boolean(credentialId || nativeSecret);

  // Web: WebAuthnクレデンシャル削除
  if (credentialId || !scoped) {
    let q = sb.from("webauthn_credentials").delete().eq("user_id", user.id);
    if (credentialId) q = q.eq("credential_id", credentialId);
    const { error } = await q;
    if (error) return res.status(400).json({ error: error.message });
  }

  // ネイティブ: 端末シークレット削除
  if (nativeSecret || !scoped) {
    let q = sb.from("native_biometric_devices").delete().eq("user_id", user.id);
    if (nativeSecret) q = q.eq("secret_hash", hashSecret(nativeSecret));
    const { error } = await q;
    if (error) return res.status(400).json({ error: error.message });
  }

  return res.json({ success: true });
}
