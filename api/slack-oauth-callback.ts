import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/slack-oauth-callback?code=xxx&state=projectId
 *
 * Slack OAuth コールバック。
 * code をアクセストークンに交換し、projects テーブルに保存する。
 * 処理後は /settings?tab=integrations&slack=success or slack=error にリダイレクト。
 */
export default async function handler(req: any, res: any) {
  const publicUrl = process.env.PUBLIC_URL || "http://localhost:5173";
  const returnUrl = `${publicUrl}/admin-settings?tab=slack`;

  const { code, state: projectId, error: oauthError } = req.query;

  if (oauthError || !code) {
    const msg = encodeURIComponent(oauthError || "認証がキャンセルされました");
    return res.redirect(302, `${returnUrl}&slack=error&message=${msg}`);
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const redirectUri = `${publicUrl}/api/slack-oauth-callback`;

  if (!clientId || !clientSecret || !supabaseUrl || !serviceKey) {
    const msg = encodeURIComponent("サーバー設定エラーが発生しました");
    return res.redirect(302, `${returnUrl}&slack=error&message=${msg}`);
  }

  // Slack の OAuth トークンエンドポイントで code をアクセストークンに交換
  const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: code as string,
      redirect_uri: redirectUri,
    }).toString(),
  });

  const tokenData = await tokenRes.json() as {
    ok: boolean;
    error?: string;
    access_token?: string;
    team?: { id: string; name: string };
  };

  if (!tokenData.ok || !tokenData.access_token) {
    const msg = encodeURIComponent(tokenData.error || "トークンの取得に失敗しました");
    return res.redirect(302, `${returnUrl}&slack=error&message=${msg}`);
  }

  // プロジェクトにトークンとワークスペース名を保存
  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: dbError } = await sb.from("projects").update({
    slack_access_token: tokenData.access_token,
    slack_team_name: tokenData.team?.name ?? "",
    slack_notifications_enabled: true,
  }).eq("id", projectId as string);

  if (dbError) {
    console.error("[slack-oauth-callback] DB update failed:", dbError.message);
    const msg = encodeURIComponent("データの保存に失敗しました");
    return res.redirect(302, `${returnUrl}&slack=error&message=${msg}`);
  }

  return res.redirect(302, `${returnUrl}&slack=success&projectId=${encodeURIComponent(projectId as string)}`);
}
