/**
 * GET /api/slack-oauth-start?projectId=xxx
 *
 * Slack OAuth フローを開始する。
 * Slack の認証画面にリダイレクトし、ユーザーが許可すると
 * /api/slack-oauth-callback へコールバックされる。
 */
export default async function handler(req: any, res: any) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: "projectId is required" });

  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: "SLACK_CLIENT_ID not configured" });

  const publicUrl = process.env.PUBLIC_URL || "http://localhost:5173";
  const redirectUri = `${publicUrl}/api/slack-oauth-callback`;

  // im:write → ボットがユーザーとのDMを開いて送信するために必要
  const scopes = "chat:write,im:write";

  const authUrl =
    `https://slack.com/oauth/v2/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(projectId as string)}`;

  return res.redirect(302, authUrl);
}
