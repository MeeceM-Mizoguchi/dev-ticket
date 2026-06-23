import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';
import { createHmac, randomBytes } from 'crypto';

// ─── 設定 ─────────────────────────────────────────────────────────────────────
const ADMIN_EMAIL  = 'info@meece.io';
const FROM_EMAIL   = process.env.RESEND_FROM_EMAIL ?? 'Dev Ticket <noreply@meece.io>';
const PUBLIC_URL   = process.env.PUBLIC_URL ?? 'https://dv-ticket.com';
const TOKEN_SECRET = process.env.DEMO_TOKEN_SECRET ?? 'demo-secret-change-me';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Candidate {
  date: string;
  preference: 'morning' | 'afternoon' | 'anytime';
}

interface BookingPayload {
  isIndividual: boolean;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  candidates: Candidate[];
  plan?: string;
}

const PLAN_LABELS: Record<string, string> = {
  starter:      'スターター',
  professional: 'プロフェッショナル',
  enterprise:   'エンタープライズ',
};

const PREF_LABELS: Record<string, string> = {
  morning:   '午前（10:00〜12:00）',
  afternoon: '午後（13:00〜17:00）',
  anytime:   'どちらでも可',
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${y}年${Number(m)}月${Number(d)}日`;
}

function candidatesHtml(candidates: Candidate[]): string {
  return candidates
    .map((c, i) =>
      `<li style="margin-bottom:6px;">第${i + 1}候補：${formatDate(c.date)}　${PREF_LABELS[c.preference] ?? ''}</li>`,
    )
    .join('');
}

// ─── 24時間限定デモトークン生成 ───────────────────────────────────────────────

function generateDemoToken(): string {
  const expiry = Date.now() + 24 * 60 * 60 * 1000; // 24時間後
  const nonce  = randomBytes(8).toString('hex');
  const payload = `${expiry}:${nonce}`;
  const sig = createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  const token = Buffer.from(`${payload}:${sig}`).toString('base64url');
  return token;
}

// ─── 予約者向け確認メール ──────────────────────────────────────────────────────

function confirmationHtml(p: BookingPayload): string {
  const name    = p.isIndividual ? p.contactName : `${p.companyName} ${p.contactName}`;
  const company = p.isIndividual ? '（個人事業主）' : p.companyName;
  return `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid #E5E7EB;">

        <!-- ヘッダー -->
        <tr><td style="background:linear-gradient(135deg,#059669,#34D399);padding:32px 40px;text-align:center;">
          <p style="margin:0 0 4px;font-size:22px;font-weight:800;color:#fff;letter-spacing:-.5px;">Dev Ticket</p>
          <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.85);">デモ商談リクエスト確認</p>
        </td></tr>

        <!-- 本文 -->
        <tr><td style="padding:40px;">
          <p style="margin:0 0 16px;font-size:16px;color:#1A1714;">${name} 様</p>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.8;color:#374151;">
            このたびは Dev Ticket のデモ商談をご希望いただき、誠にありがとうございます。<br>
            ご入力いただいた候補日時を確認後、担当者より折り返しご連絡いたします。
          </p>

          <!-- 申込内容 -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border-radius:10px;overflow:hidden;margin-bottom:24px;">
            <tr><td style="padding:20px 24px;">
              <p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#6B7280;letter-spacing:.08em;text-transform:uppercase;">お申込み内容</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:13px;color:#6B7280;padding:4px 0;width:120px;">会社名</td>
                  <td style="font-size:13px;color:#1A1714;font-weight:600;padding:4px 0;">${company}</td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:#6B7280;padding:4px 0;">担当者名</td>
                  <td style="font-size:13px;color:#1A1714;font-weight:600;padding:4px 0;">${p.contactName}</td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:#6B7280;padding:4px 0;">メール</td>
                  <td style="font-size:13px;color:#1A1714;font-weight:600;padding:4px 0;">${p.email}</td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:#6B7280;padding:4px 0;">電話番号</td>
                  <td style="font-size:13px;color:#1A1714;font-weight:600;padding:4px 0;">${p.phone}</td>
                </tr>
              </table>
            </td></tr>
          </table>

          <!-- 候補日時 -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#ECFDF5;border-radius:10px;margin-bottom:24px;">
            <tr><td style="padding:20px 24px;">
              <p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#059669;letter-spacing:.08em;">ご希望の候補日時</p>
              <ul style="margin:0;padding:0 0 0 16px;font-size:13px;color:#374151;line-height:1.8;">
                ${candidatesHtml(p.candidates)}
              </ul>
            </td></tr>
          </table>

          <!-- 注意事項 -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;margin-bottom:32px;">
            <tr><td style="padding:16px 20px;">
              <p style="margin:0;font-size:12px;color:#92400E;line-height:1.7;">
                ※こちらはご予約リクエストです。ご入力いただいた候補日時にて日程の再調整を
                お願いする場合がございます。あらかじめご了承ください。
              </p>
            </td></tr>
          </table>

          <p style="margin:0;font-size:13px;color:#6B7280;line-height:1.7;">
            ご不明な点がございましたら、本メールへご返信ください。<br>
            どうぞよろしくお願いいたします。
          </p>
        </td></tr>

        <!-- フッター -->
        <tr><td style="background:#F9FAFB;border-top:1px solid #E5E7EB;padding:20px 40px;text-align:center;">
          <p style="margin:0;font-size:11px;color:#9CA3AF;">
            Dev Ticket — チームの生産性を最大化するプロジェクト管理ツール<br>
            このメールは自動送信です。返信不要の場合はそのまま削除してください。
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── 管理者向け通知メール（24時間デモリンク付き）──────────────────────────────

function adminNotificationHtml(p: BookingPayload, demoUrl: string): string {
  const company = p.isIndividual ? `${p.contactName}（個人事業主）` : p.companyName;
  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const planLabel = p.plan ? (PLAN_LABELS[p.plan] ?? p.plan) : '未選択';
  return `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;padding:40px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid #E5E7EB;">

        <tr><td style="background:#1E293B;padding:24px 40px;">
          <p style="margin:0 0 4px;font-size:18px;font-weight:800;color:#fff;">Dev Ticket</p>
          <p style="margin:0;font-size:13px;color:#94A3B8;">新しいデモ商談リクエストが届きました</p>
        </td></tr>

        <tr><td style="padding:40px;">
          <!-- 申込者情報 -->
          <p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#6B7280;letter-spacing:.08em;">申込者情報</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border-radius:10px;margin-bottom:24px;">
            <tr><td style="padding:20px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:13px;color:#6B7280;padding:5px 0;width:120px;">問い合わせプラン</td>
                  <td style="font-size:13px;font-weight:700;padding:5px 0;"><span style="background:#ECFDF5;color:#065F46;border-radius:6px;padding:2px 10px;">${planLabel}</span></td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:#6B7280;padding:5px 0;">会社名</td>
                  <td style="font-size:13px;color:#1A1714;font-weight:600;padding:5px 0;">${company}</td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:#6B7280;padding:5px 0;">担当者名</td>
                  <td style="font-size:13px;color:#1A1714;font-weight:600;padding:5px 0;">${p.contactName}</td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:#6B7280;padding:5px 0;">メール</td>
                  <td style="font-size:13px;padding:5px 0;"><a href="mailto:${p.email}" style="color:#059669;font-weight:600;">${p.email}</a></td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:#6B7280;padding:5px 0;">電話番号</td>
                  <td style="font-size:13px;color:#1A1714;font-weight:600;padding:5px 0;">${p.phone}</td>
                </tr>
              </table>
            </td></tr>
          </table>

          <!-- 候補日時 -->
          <p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#6B7280;letter-spacing:.08em;">商談候補日時</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#ECFDF5;border-radius:10px;margin-bottom:24px;">
            <tr><td style="padding:20px 24px;">
              <ul style="margin:0;padding:0 0 0 16px;font-size:13px;color:#374151;line-height:1.8;">
                ${candidatesHtml(p.candidates)}
              </ul>
            </td></tr>
          </table>

          <!-- 24時間限定デモリンク -->
          <p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#DC2626;letter-spacing:.08em;">⏱ 24時間限定デモリンク（顧客へは送らないこと）</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;margin-bottom:24px;">
            <tr><td style="padding:20px 24px;">
              <p style="margin:0 0 10px;font-size:12px;color:#991B1B;">このリンクは発行から24時間のみ有効です。商談時に画面共有等でご利用ください。</p>
              <a href="${demoUrl}" style="display:block;font-size:13px;color:#0284C7;font-weight:700;word-break:break-all;background:#EFF6FF;border-radius:6px;padding:10px 14px;text-decoration:none;">${demoUrl}</a>
            </td></tr>
          </table>

          <p style="margin:0;font-size:12px;color:#9CA3AF;">
            申込日時：${now}
          </p>
        </td></tr>

        <tr><td style="background:#F9FAFB;border-top:1px solid #E5E7EB;padding:16px 40px;text-align:center;">
          <p style="margin:0;font-size:11px;color:#9CA3AF;">Dev Ticket — 管理者通知メール</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const payload = req.body as BookingPayload;
  if (!payload?.email || !payload?.contactName || !payload?.candidates?.length) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY not set — skipping email send');
    return res.status(200).json({ success: true, note: 'email skipped (no API key)' });
  }

  const resend = new Resend(apiKey);

  const companyLabel = payload.isIndividual
    ? payload.contactName
    : `${payload.companyName} ${payload.contactName}`;

  const candidateText = payload.candidates
    .map((c, i) => `第${i + 1}候補：${formatDate(c.date)} ${PREF_LABELS[c.preference] ?? ''}`)
    .join('\n');

  // 24時間限定デモURL生成（管理者メール専用）
  const demoToken = generateDemoToken();
  const demoUrl = `${PUBLIC_URL}/demo-preview?t=${demoToken}`;

  try {
    // 1. 予約者への確認メール
    await resend.emails.send({
      from: FROM_EMAIL,
      to: payload.email,
      subject: '【Dev Ticket】デモ商談リクエストを受け付けました',
      html: confirmationHtml(payload),
      text: [
        `${companyLabel} 様`,
        '',
        'このたびはDev Ticketのデモ商談をご希望いただき、ありがとうございます。',
        'ご入力いただいた候補日時を確認後、担当者よりご連絡いたします。',
        '',
        '【ご希望の候補日時】',
        candidateText,
        '',
        '※こちらはご予約リクエストです。日程の再調整をお願いする場合がございます。',
        '',
        'Dev Ticket',
      ].join('\n'),
    });

    // 2. 管理者（info@meece.io）への通知メール（デモリンク付き）
    await resend.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `【Dev Ticket】デモ商談リクエスト：${companyLabel}（${payload.plan ? (PLAN_LABELS[payload.plan] ?? payload.plan) : '未選択'}）`,
      html: adminNotificationHtml(payload, demoUrl),
      text: [
        '新しいデモ商談リクエストが届きました。',
        '',
        `問い合わせプラン：${payload.plan ? (PLAN_LABELS[payload.plan] ?? payload.plan) : '未選択'}`,
        `会社名：${payload.isIndividual ? '（個人事業主）' : payload.companyName}`,
        `担当者：${payload.contactName}`,
        `メール：${payload.email}`,
        `電話：${payload.phone}`,
        '',
        '【候補日時】',
        candidateText,
        '',
        '【24時間限定デモリンク（顧客には送らないこと）】',
        demoUrl,
      ].join('\n'),
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Resend error:', err);
    return res.status(500).json({ error: 'メール送信に失敗しました' });
  }
}
