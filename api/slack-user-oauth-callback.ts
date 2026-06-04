import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/slack-user-oauth-callback?code=xxx&state=supabaseUserId
 *
 * Slack ユーザー認証のコールバック。
 * authed_user.id（SlackメンバーID）を取得し、profiles テーブルに保存する。
 * 処理後は /settings?tab=team&slackuser=success or error にリダイレクト。
 */
export default async function handler(req: any, res: any) {
  const publicUrl = process.env.PUBLIC_URL || "http://localhost:5173";
  const returnUrl = `${publicUrl}/settings?tab=team`;

  const { code, state: supabaseUserId, error: oauthError } = req.query;

  if (oauthError || !code) {
    return res.redirect(302, `${returnUrl}&slackuser=error&message=${encodeURIComponent(oauthError || "認証がキャンセルされました")}`);
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!clientId || !clientSecret || !supabaseUrl || !serviceKey) {
    return res.redirect(302, `${returnUrl}&slackuser=error&message=${encodeURIComponent("サーバー設定エラーが発生しました")}`);
  }

  const redirectUri = `${publicUrl}/api/slack-user-oauth-callback`;

  // code をトークンに交換
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
    authed_user?: { id: string; scope: string };
  };

  if (!tokenData.ok || !tokenData.authed_user?.id) {
    const msg = encodeURIComponent(tokenData.error || "SlackメンバーIDの取得に失敗しました");
    return res.redirect(302, `${returnUrl}&slackuser=error&message=${msg}`);
  }

  const slackMemberId = tokenData.authed_user.id;

  // profiles テーブルに保存
  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: dbError } = await sb
    .from("profiles")
    .update({ slack_member_id: slackMemberId })
    .eq("id", supabaseUserId as string);

  if (dbError) {
    console.error("[slack-user-oauth-callback] DB update failed:", dbError.message);
    return res.redirect(302, `${returnUrl}&slackuser=error&message=${encodeURIComponent("データの保存に失敗しました")}`);
  }

  return res.redirect(302, `${returnUrl}&slackuser=success&slackId=${encodeURIComponent(slackMemberId)}`);
}
