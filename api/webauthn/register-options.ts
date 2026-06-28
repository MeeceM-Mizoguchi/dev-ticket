// 生体認証の登録: チャレンジ&登録オプションを発行（要ログイン）
// チケット: ENHA2-013
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getServiceClient, getRP, getBearerUser, saveChallenge, asTransports } from "./_shared";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  let sb;
  try { sb = getServiceClient(); } catch { return res.status(500).json({ error: "Supabase service key not configured" }); }

  const user = await getBearerUser(sb, req);
  if (!user) return res.status(401).json({ error: "ログインが必要です" });

  const { rpID, rpName } = getRP(req);

  // 既存クレデンシャルは除外（同一端末での二重登録を防ぐ）
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
    authenticatorSelection: {
      residentKey: "required",        // usernameless ログインのため discoverable credential を要求
      userVerification: "required",   // 生体認証(またはPIN)を必須に
    },
  });

  await saveChallenge(sb, options.challenge);
  return res.json(options);
}
