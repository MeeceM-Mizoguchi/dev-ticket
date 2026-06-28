import { createClient } from "@supabase/supabase-js";
import { connect } from "node:http2";
import { sign } from "node:crypto";

/**
 * POST /api/push-send
 *
 * notifications テーブルへの INSERT を契機に Supabase Database Webhook から呼ばれ、
 * 該当ユーザー(user_name)の全デバイスへ APNs プッシュ通知を送る。
 *
 * Webhook ペイロード: { type:"INSERT", table:"notifications", record:{...行...}, ... }
 *
 * 必要な環境変数(Vercel):
 *   VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  … device_tokens 参照・無効トークン削除
 *   APNS_KEY_ID      … APNs 認証キーの Key ID
 *   APNS_TEAM_ID     … Apple Developer の Team ID
 *   APNS_BUNDLE_ID   … io.meece.devticket（apns-topic）
 *   APNS_PRIVATE_KEY … .p8 の中身(PEM)。改行は実改行 or "\n" エスケープどちらも可
 *   APNS_PRODUCTION  … "true" で本番(api.push.apple.com)。未設定/それ以外は sandbox
 *   PUSH_WEBHOOK_SECRET … (任意) 設定時は x-webhook-secret ヘッダ一致を要求
 */

// ES256 の JWT を .p8 秘密鍵で署名して返す（APNs トークン認証用）
function makeApnsJwt(): string {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const pem = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!keyId || !teamId || !pem) throw new Error("APNS_KEY_ID / APNS_TEAM_ID / APNS_PRIVATE_KEY not configured");

  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const header = b64url({ alg: "ES256", kid: keyId });
  const claims = b64url({ iss: teamId, iat: Math.floor(Date.now() / 1000) });
  const signingInput = `${header}.${claims}`;
  // dsaEncoding: "ieee-p1363" で JOSE 形式(r||s 64byte)の署名になる（DER ではない）
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: pem,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${signingInput}.${signature}`;
}

// 1トークンへ送信。戻り値 status(:status) と body を返す。
function sendToApns(
  host: string,
  jwt: string,
  topic: string,
  token: string,
  payload: unknown,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const client = connect(`https://${host}`);
    client.on("error", reject);
    const body = JSON.stringify(payload);
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    let status = 0;
    let data = "";
    req.on("response", (headers) => { status = Number(headers[":status"]) || 0; });
    req.setEncoding("utf8");
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => { client.close(); resolve({ status, body: data }); });
    req.on("error", (e) => { client.close(); reject(e); });
    req.write(body);
    req.end();
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const secret = process.env.PUSH_WEBHOOK_SECRET;
  if (secret && req.headers["x-webhook-secret"] !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const record = req.body?.record ?? req.body ?? {};
  const userName: string | undefined = record.user_name;
  if (!userName) return res.status(400).json({ error: "record.user_name is required" });

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Supabase not configured" });

  const bundleId = process.env.APNS_BUNDLE_ID;
  if (!bundleId) return res.status(500).json({ error: "APNS_BUNDLE_ID not configured" });
  const host = process.env.APNS_PRODUCTION === "true" ? "api.push.apple.com" : "api.sandbox.push.apple.com";

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 宛先ユーザーの全デバイストークンを取得
  const { data: tokens, error } = await sb
    .from("device_tokens")
    .select("token")
    .eq("user_name", userName);
  if (error) return res.status(500).json({ error: error.message });
  if (!tokens?.length) return res.status(200).json({ ok: true, sent: 0, reason: "no device tokens" });

  // APNs ペイロード（タップ時遷移用に project_slug / ticket_wbs を同梱）
  const payload = {
    aps: {
      alert: { title: record.title ?? "通知", body: record.body ?? "" },
      sound: "default",
      badge: 1,
    },
    project_slug: record.project_slug ?? "",
    ticket_wbs: record.ticket_wbs ?? "",
    ticket_id: record.ticket_id ?? "",
    notification_id: record.id ?? "",
  };

  let jwt: string;
  try {
    jwt = makeApnsJwt();
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "JWT signing failed" });
  }

  let sent = 0;
  const invalidTokens: string[] = [];
  const errors: { token: string; status: number; body: string }[] = [];

  for (const row of tokens) {
    const token = row.token as string;
    try {
      const { status, body } = await sendToApns(host, jwt, bundleId, token, payload);
      if (status === 200) sent++;
      else {
        errors.push({ token, status, body });
        // 410(Unregistered) / 400 BadDeviceToken は無効トークン → 後で削除
        if (status === 410 || body.includes("BadDeviceToken")) invalidTokens.push(token);
      }
    } catch (e: any) {
      errors.push({ token, status: 0, body: String(e?.message ?? e) });
    }
  }

  // 無効トークンを掃除
  if (invalidTokens.length) {
    await sb.from("device_tokens").delete().in("token", invalidTokens);
  }

  return res.status(200).json({ ok: true, sent, invalid: invalidTokens.length, errors });
}
