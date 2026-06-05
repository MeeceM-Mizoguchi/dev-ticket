import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/slack-notify
 *
 * 受信者のSlack DMに直接通知を送信する。
 * チャンネル投稿ではなくDMを使うことで、指定ユーザーのみに通知が届く。
 * 受信者がslack_member_idを未連携の場合はスキップする。
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

  // プロジェクトのSlack設定を取得（チャンネルは不要になったため除外）
  const { data: project } = await sb
    .from("projects")
    .select("slack_access_token, slack_notifications_enabled")
    .eq("slug", projectSlug)
    .maybeSingle();

  if (!project?.slack_notifications_enabled || !project?.slack_access_token) {
    return res.json({ skipped: true, reason: "Slack notifications not configured for this project" });
  }

  // 受信者のSlackメンバーIDを取得（未連携はスキップ）
  const { data: profile } = await sb
    .from("profiles")
    .select("slack_member_id")
    .eq("name", recipientUserName)
    .maybeSingle();

  if (!profile?.slack_member_id) {
    return res.json({ skipped: true, reason: "Recipient has no Slack member ID linked" });
  }

  // 受信者とのDMチャンネルを開く（im:write スコープが必要）
  const openRes = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${project.slack_access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ users: profile.slack_member_id }),
  });

  const openData = await openRes.json() as { ok: boolean; channel?: { id: string }; error?: string };
  if (!openData.ok || !openData.channel?.id) {
    console.error("[slack-notify] conversations.open error:", openData.error);
    return res.status(500).json({ error: openData.error ?? "Failed to open DM channel" });
  }

  const text = `*${title}*\n${body}`;

  const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${project.slack_access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel: openData.channel.id, text }),
  });

  const slackData = await slackRes.json() as { ok: boolean; error?: string };
  if (!slackData.ok) {
    console.error("[slack-notify] Slack API error:", slackData.error);
    return res.status(500).json({ error: slackData.error });
  }

  return res.json({ success: true });
}
