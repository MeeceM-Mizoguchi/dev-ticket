import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/slack-notify
 *
 * 受信者への通知をDM優先で送信する。
 * - slack_member_id が連携済み かつ im:write スコープあり → DM送信（本人のみ受信）
 * - DM失敗（スコープ未付与など）→ チャンネルへフォールバック（@メンション付き）
 * - チャンネルも未設定 → スキップ
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

  const { data: project } = await sb
    .from("projects")
    .select("slack_access_token, slack_channel, slack_notifications_enabled")
    .eq("slug", projectSlug)
    .maybeSingle();

  if (!project?.slack_notifications_enabled || !project?.slack_access_token) {
    return res.json({ skipped: true, reason: "Slack notifications not configured for this project" });
  }

  const { data: profile } = await sb
    .from("profiles")
    .select("slack_member_id")
    .eq("name", recipientUserName)
    .maybeSingle();

  const token = project.slack_access_token;
  const text = `*${title}*\n${body}`;

  // DM優先: slack_member_id が連携済みの場合に試みる
  if (profile?.slack_member_id) {
    const openRes = await fetch("https://slack.com/api/conversations.open", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ users: profile.slack_member_id }),
    });
    const openData = await openRes.json() as { ok: boolean; channel?: { id: string }; error?: string };

    if (openData.ok && openData.channel?.id) {
      const dmRes = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel: openData.channel.id, text }),
      });
      const dmData = await dmRes.json() as { ok: boolean; error?: string };
      if (dmData.ok) return res.json({ success: true, method: "dm" });
      console.warn("[slack-notify] DM post failed, falling back to channel:", dmData.error);
    } else {
      // im:write 未付与の場合など: チャンネルにフォールバック
      console.warn("[slack-notify] conversations.open failed (im:write scope may be needed), falling back to channel:", openData.error);
    }
  }

  // フォールバック: チャンネルへ @メンション付きで送信
  if (!project.slack_channel) {
    return res.json({ skipped: true, reason: "No channel configured for fallback notification" });
  }

  const mention = profile?.slack_member_id
    ? `<@${profile.slack_member_id}>`
    : recipientUserName;
  const channelText = `*${title}*\n${mention} ${body}`;

  const chRes = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel: project.slack_channel, text: channelText }),
  });
  const chData = await chRes.json() as { ok: boolean; error?: string };
  if (!chData.ok) {
    console.error("[slack-notify] channel fallback error:", chData.error);
    return res.status(500).json({ error: chData.error });
  }

  return res.json({ success: true, method: "channel_fallback" });
}
