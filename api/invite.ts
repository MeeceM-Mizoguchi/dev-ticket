import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const ROLE_JA: Record<string, string> = {
  admin: "管理者", "project-manager": "プロジェクトマネージャー",
  developer: "開発者", designer: "デザイナー",
};

function inviteHtml(name: string, role: string, inviteUrl: string) {
  const roleLabel = ROLE_JA[role] || role;
  const roleColor = role === "admin" ? "#F43F5E" : role === "project-manager" ? "#059669" : role === "developer" ? "#0284C7" : "#7C3AED";
  const roleBg = role === "admin" ? "#FFF1F2" : role === "project-manager" ? "#ECFDF5" : role === "developer" ? "#F0F9FF" : "#F5F3FF";

  return `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Dev Ticket — チームへの招待</title></head>
<body style="margin:0;padding:0;background:#F0F4F0;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic UI','Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#065F46 0%,#047857 50%,#059669 100%);border-radius:20px 20px 0 0;padding:40px 48px 36px;text-align:center;position:relative;overflow:hidden;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding-bottom:20px;">
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:rgba(255,255,255,0.18);border-radius:14px;width:52px;height:52px;text-align:center;vertical-align:middle;">
              <span style="font-size:24px;line-height:52px;">🎫</span>
            </td>
            <td style="padding-left:12px;vertical-align:middle;">
              <span style="font-size:22px;font-weight:800;color:#FFFFFF;letter-spacing:-0.03em;">Dev Ticket</span>
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td align="center">
        <p style="font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:0.15em;text-transform:uppercase;margin:0 0 10px;">You're Invited</p>
        <h1 style="font-size:28px;font-weight:800;color:#FFFFFF;margin:0 0 8px;letter-spacing:-0.03em;line-height:1.2;">チームへようこそ</h1>
        <p style="font-size:14px;color:rgba(255,255,255,0.75);margin:0;">Dev Ticket であなたを待っています</p>
      </td></tr>
    </table>
  </td></tr>

  <!-- Decorative band -->
  <tr><td style="background:linear-gradient(90deg,#10B981,#059669,#047857);height:4px;"></td></tr>

  <!-- Body -->
  <tr><td style="background:#FFFFFF;padding:40px 48px 32px;border-left:1px solid #E2E8E0;border-right:1px solid #E2E8E0;">
    <p style="font-size:16px;color:#374151;margin:0 0 16px;line-height:1.7;">
      こんにちは、<strong style="color:#1A1714;">${name || "新メンバー"}</strong> さん 👋
    </p>
    <p style="font-size:14px;color:#6B7280;margin:0 0 24px;line-height:1.8;">
      Dev Ticket チームにご招待されました。<br>
      プロジェクト・スプリント・チケットを一元管理するツールです。
    </p>

    <!-- Role badge -->
    <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="padding:4px 8px 4px 4px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;vertical-align:middle;">
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:${roleBg};border-radius:7px;padding:6px 12px;">
                <span style="font-size:11px;font-weight:700;color:${roleColor};letter-spacing:0.04em;">${roleLabel}</span>
              </td>
              <td style="padding-left:10px;">
                <span style="font-size:12px;color:#9CA3AF;">として招待されました</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Steps -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border-radius:12px;padding:20px 24px;margin-bottom:32px;">
      <tr><td>
        <p style="font-size:11px;font-weight:700;color:#9CA3AF;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 14px;">参加手順</p>
        ${[
          ["1", "下のボタンをクリック"],
          ["2", "パスワードを設定"],
          ["3", "ダッシュボードにアクセス"],
        ].map(([n, text]) => `
        <table cellpadding="0" cellspacing="0" style="margin-bottom:10px;">
          <tr>
            <td style="width:26px;height:26px;background:#059669;border-radius:50%;text-align:center;vertical-align:middle;font-size:11px;font-weight:800;color:#FFFFFF;">${n}</td>
            <td style="padding-left:12px;font-size:13px;color:#374151;">${text}</td>
          </tr>
        </table>`).join("")}
      </td></tr>
    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td style="background:#FFFFFF;padding:0 48px 40px;border-left:1px solid #E2E8E0;border-right:1px solid #E2E8E0;text-align:center;">
    <a href="${inviteUrl}" style="display:inline-block;background:linear-gradient(135deg,#059669,#047857);color:#FFFFFF;font-size:16px;font-weight:700;padding:18px 48px;border-radius:14px;text-decoration:none;letter-spacing:-0.01em;box-shadow:0 4px 20px rgba(5,150,105,0.35);">
      チームに参加する &nbsp;→
    </a>
    <p style="font-size:11px;color:#D1D5DB;margin:16px 0 0;">または以下のURLをブラウザにコピー</p>
    <p style="font-size:10px;color:#9CA3AF;margin:6px 0 0;word-break:break-all;font-family:monospace;">${inviteUrl}</p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#F9FAFB;padding:24px 48px;border:1px solid #E2E8E0;border-top:none;border-radius:0 0 20px 20px;text-align:center;">
    <p style="font-size:11px;color:#9CA3AF;margin:0 0 6px;">⏱ このリンクは <strong>72時間</strong> 有効です</p>
    <p style="font-size:11px;color:#D1D5DB;margin:0;">心当たりがない場合は、このメールを無視してください</p>
    <p style="font-size:10px;color:#E5E7EB;margin:12px 0 0;">© 2026 Dev Ticket. All rights reserved.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { email, name, role, group } = req.body ?? {};
  if (!email) return res.status(400).json({ error: "email is required" });

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const publicUrl = process.env.PUBLIC_URL || "http://localhost:5173";
  const fromEmail = process.env.RESEND_FROM_EMAIL || "Dev Ticket <onboarding@resend.dev>";

  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Supabase service key not configured" });
  if (!resendKey) return res.status(500).json({ error: "Resend API key not configured" });

  const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // Generate invite link (does NOT send Supabase's default email)
  const { data, error } = await sb.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      data: { name: name || "", role: role || "developer", group_name: group || "" },
      redirectTo: `${publicUrl}/accept-invite`,
    },
  });

  if (error || !data?.properties?.action_link) {
    return res.status(400).json({ error: error?.message || "招待リンクの生成に失敗しました" });
  }

  // Pre-create profile with status='invited' so member appears immediately in the list
  if (data.user?.id) {
    await sb.from("profiles").upsert({
      id: data.user.id,
      name: name || email.split("@")[0],
      email,
      role: role || "developer",
      group_name: group || "",
      status: "invited",
    }, { onConflict: "id" });
  }

  // Send beautiful email via Resend
  const resend = new Resend(resendKey);
  const { error: mailError } = await resend.emails.send({
    from: fromEmail,
    to: email,
    subject: "【Dev Ticket】チームへの招待",
    html: inviteHtml(name || "", role || "developer", data.properties.action_link),
  });

  if (mailError) return res.status(500).json({ error: "メールの送信に失敗しました: " + mailError.message });

  res.json({ success: true });
}
