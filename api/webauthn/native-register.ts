// ネイティブ(Mac/iPad)生体ログインの登録: 端末シークレットを発行（要ログイン）
// クライアントは返却された secret を Keychain に保存する。サーバはhashのみ保持。
// チケット: ENHA2-013
import { getServiceClient, getBearerUser, generateSecret, hashSecret } from "./_shared";

export default async function handler(req: any, res: any) {
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

  // secret は平文で一度だけ返す（クライアントがKeychainへ保存）
  return res.json({ success: true, secret });
}
