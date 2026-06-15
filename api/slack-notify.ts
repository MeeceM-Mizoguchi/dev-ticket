import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/slack-notify
 *
 * プロジェクトの Slack チャンネルに通知を投稿する。
 * recipientUserNames: 受信者名の配列。slack_member_id が登録済みなら <@U...> 形式でまとめてメンション。
 * 複数名まとめて1投稿にすることで、メンション数分の重複投稿を防ぐ。
 */
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { recipientUserNames, projectSlug, title, body } = req.body ?? {};
  if (!recipientUserNames?.length || !projectSlug) {
    return res.status(400).json({ error: "recipientUserNames and projectSlug are required" });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Supabase not configured" });

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // slug で検索し、見つからなければ id で再検索（URLがIDベースの場合に対応）
  let { data: project } = await sb
    .from("projects")
    .select("slack_access_token, slack_channel, slack_notifications_enabled")
    .eq("slug", projectSlug)
    .maybeSingle();
  if (!project) {
    const { data } = await sb
      .from("projects")
      .select("slack_access_token, slack_channel, slack_notifications_enabled")
      .eq("id", projectSlug)
      .maybeSingle();
    project = data;
  }

  if (!project?.slack_notifications_enabled || !project?.slack_channel || !project?.slack_access_token) {
    const reason = !project
      ? "プロジェクトが見つかりません (slug: " + projectSlug + ")"
      : !project.slack_access_token
        ? "Slack未接続（アクセストークンなし）"
        : !project.slack_channel
          ? "通知チャンネルが未設定"
          : "Slack通知が無効";
    console.warn("[slack-notify] スキップ:", reason);
    return res.json({ skipped: true, reason });
  }

  const { data: profiles } = await sb
    .from("profiles")
    .select("name, slack_member_id")
    .in("name", recipientUserNames);

  const mentions = recipientUserNames
    .map((name: string) => {
      const p = profiles?.find((r: { name: string; slack_member_id: string | null }) => r.name === name);
      return p?.slack_member_id ? `<@${p.slack_member_id}>` : name;
    })
    .join(" ");

  const text = `*${title}*\n${mentions} ${body}`;

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
