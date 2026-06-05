import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/slack-notify
 *
 * 受信者のSlack DMに直接通知を送信する。
 * - slack_member_id 連携済み + im:write スコープあり → DM送信（本人のみ）
 * - DM失敗（im:write 未付与など）→ スキップ。チャンネルへのフォールバックは行わない。
 *
 * チャンネルフォールバックを廃止した理由:
 * チャンネルへの投稿はメンバー全員に通知が届いてしまうため。
 * DM送信には Slack アプリへの im:write スコープ追加と再接続が必要。
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
    .select("slack_access_token, slack_notifications_enabled")
    .eq("slug", projectSlug)
    .maybeSingle();

  if (!project?.slack_notifications_enabled || !project?.slack_access_token) {
    return res.json({ skipped: true, reason: "Slack notifications not configured" });
  }

  const { data: profile } = await sb
    .from("profiles")
    .select("slack_member_id")
    .eq("name", recipientUserName)
    .maybeSingle();

  if (!profile?.slack_member_id) {
    return res.json({ skipped: true, reason: "Recipient has no Slack member ID linked" });
  }

  // DMチャンネルを開く（im:write スコープが必要）
  const openRes = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: { Authorization: `Bearer ${project.slack_access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ users: profile.slack_member_id }),
  });
  const openData = await openRes.json() as { ok: boolean; channel?: { id: string }; error?: string };

  if (!openData.ok || !openData.channel?.id) {
    // im:write 未付与など: チャンネルへのフォールバックはせずスキップ
    console.warn("[slack-notify] DM open failed (im:write scope may be missing):", openData.error);
    return res.json({ skipped: true, reason: "DM unavailable: " + (openData.error ?? "unknown") });
  }

  const text = `*${title}*\n${body}`;

  const dmRes = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${project.slack_access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel: openData.channel.id, text }),
  });
  const dmData = await dmRes.json() as { ok: boolean; error?: string };

  if (!dmData.ok) {
    console.error("[slack-notify] DM post failed:", dmData.error);
    return res.status(500).json({ error: dmData.error });
  }

  return res.json({ success: true });
}
