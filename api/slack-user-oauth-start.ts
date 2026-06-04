/**
 * GET /api/slack-user-oauth-start?userId=xxx
 *
 * 個人ユーザーのSlackアカウント連携フローを開始する。
 * user_scope=identity.basic を要求し、認証後に Slack メンバーIDを自動取得する。
 */
export default async function handler(req: any, res: any) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: "userId is required" });

  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: "SLACK_CLIENT_ID not configured" });

  const publicUrl = process.env.PUBLIC_URL || "http://localhost:5173";
  const redirectUri = `${publicUrl}/api/slack-user-oauth-callback`;

  const authUrl =
    `https://slack.com/oauth/v2/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&user_scope=${encodeURIComponent("identity.basic")}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(userId as string)}`;

  return res.redirect(302, authUrl);
}
