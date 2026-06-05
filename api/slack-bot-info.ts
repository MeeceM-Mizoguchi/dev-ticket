import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/slack-bot-info?projectId=xxx
 *
 * 接続済みプロジェクトのSlackボット名を返す。
 * Slack auth.test を呼び出してボットのユーザー名を取得する。
 */
export default async function handler(req: any, res: any) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const { projectId } = req.query;
  if (!projectId) return res.status(400).json({ error: "projectId is required" });

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Supabase not configured" });

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: project } = await sb
    .from("projects")
    .select("slack_access_token")
    .eq("id", projectId as string)
    .maybeSingle();

  if (!project?.slack_access_token) {
    return res.status(404).json({ error: "No Slack token found for this project" });
  }

  const authRes = await fetch("https://slack.com/api/auth.test", {
    headers: { Authorization: `Bearer ${project.slack_access_token}` },
  });
  const authData = await authRes.json() as { ok: boolean; user?: string; error?: string };

  if (!authData.ok) {
    return res.status(500).json({ error: authData.error ?? "auth.test failed" });
  }

  return res.json({ botUsername: authData.user });
}
