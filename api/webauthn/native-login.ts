// ネイティブ生体ログイン: 端末シークレットを照合しセッション確立用トークンを返す
// （生体認証はクライアント側のローカルゲート。ここではシークレット一致を確認する）
// チケット: ENHA2-013
import { getServiceClient, hashSecret, issueMagiclinkTokenHash } from "./_shared";

export default async function handler(req: any, res: any) {
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

  await sb.from("native_biometric_devices")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", device.id);

  const issued = await issueMagiclinkTokenHash(sb, device.user_id as string);
  if ("error" in issued) return res.status(400).json({ error: issued.error });

  return res.json({ success: true, email: issued.email, tokenHash: issued.tokenHash });
}
