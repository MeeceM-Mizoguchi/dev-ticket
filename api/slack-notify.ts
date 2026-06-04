import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/slack-notify
 *
 * プロジェクトに紐づくSlackワークスペーストークンを使って
 * 指定チャンネルに通知を送信する。
 * メインの処理をブロックしないよう、フロントエンドからはfire-and-forgetで呼び出す。
 */
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { recipientUserName, projectSlug, title, body } = req.body ?? {};
  if (!recipientUserName || !projectSlug) {
    return res.status(400).json({ error: "recipientUserName and projectSlug are required" });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Supabase not configured" });

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // プロジェクトごとのSlack設定（ワークスペーストークン・チャンネル・ON/OFF）を取得
  const { data: project } = await sb
    .from("projects")
    .select("slack_access_token, slack_channel, slack_notifications_enabled")
    .eq("slug", projectSlug)
    .maybeSingle();

  if (!project?.slack_notifications_enabled || !project?.slack_channel || !project?.slack_access_token) {
    return res.json({ skipped: true, reason: "Slack notifications not configured for this project" });
  }

  // 受信者のSlackメンバーIDを取得し、存在すればメンション形式に変換
  const { data: profile } = await sb
    .from("profiles")
    .select("slack_member_id")
    .eq("name", recipientUserName)
    .maybeSingle();

  const mention = profile?.slack_member_id
    ? `<@${profile.slack_member_id}>`
    : recipientUserName;

  const text = `*${title}*\n${mention} ${body}`;

  const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${project.slack_access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel: project.slack_channel, text }),
  });

  const slackData = await slackRes.json() as { ok: boolean; error?: string };
  if (!slackData.ok) {
    console.error("[slack-notify] Slack API error:", slackData.error);
    return res.status(500).json({ error: slackData.error });
  }

  return res.json({ success: true });
}
