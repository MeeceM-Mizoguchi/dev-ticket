// 生体認証ログイン: 認証チャレンジを発行（未ログインで呼べる / usernameless）
// チケット: ENHA2-013
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getServiceClient, getRP, saveChallenge } from "./_shared";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  let sb;
  try { sb = getServiceClient(); } catch { return res.status(500).json({ error: "Supabase service key not configured" }); }

  const { rpID } = getRP(req);

  // discoverable credential を使うため allowCredentials は空（ユーザー名不要）。
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
  });

  await saveChallenge(sb, options.challenge);
  return res.json(options);
}
