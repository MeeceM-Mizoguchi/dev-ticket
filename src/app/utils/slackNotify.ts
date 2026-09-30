import { appOrigin } from "@/app/lib/appOrigin";

export interface SlackNotifyParams {
  recipientUserNames: string[];
  projectSlug: string;
  title: string;
  body: string;
}

/** 本文の上限。超えた分は fireSlackNotify が「...」で切り詰める */
const MAX_LENGTH = 300;

/** リンクの表示名に入れるタイトルの上限。長すぎると本文の上限で <url|…> ごと切れてリンクが壊れる */
const MAX_LINK_TITLE = 80;

/** Slack の mrkdwn で制御文字になる & < > を逃がす（表示名に > があるとリンクがそこで終わるため） */
function escapeSlackText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Slack の <url|表示名> 形式のリンク。公開URLを作れない環境（ネイティブ等）では表示名だけ返す */
function slackLink(path: string, label: string): string {
  const origin = appOrigin();
  const text = escapeSlackText(label);
  return origin ? `<${origin}${path}|${text}>` : text;
}

/** チケット詳細へのリンク（「BRU18-013: タイトル」が押せる形） */
export function slackTicketLink(projectSlug: string, wbs: string, title: string): string {
  const t = title.length > MAX_LINK_TITLE ? `${title.slice(0, MAX_LINK_TITLE)}…` : title;
  return slackLink(`/${encodeURIComponent(projectSlug)}/${encodeURIComponent(wbs)}`, `${wbs}: ${t}`);
}

/**
 * 複数チケットのリンクを1行ずつ並べる（一括作成で1人に何件も割り当てたとき用）。
 * 本文の上限で途中のリンクが切れないよう、収まる行だけ並べて残りは「ほかN件」にまとめる。
 */
export function slackTicketLinkList(projectSlug: string, tickets: { wbs: string; title: string }[]): string {
  const lines: string[] = [];
  let used = 0;
  for (let i = 0; i < tickets.length; i++) {
    const line = slackTicketLink(projectSlug, tickets[i].wbs, tickets[i].title);
    const rest = tickets.length - i - 1;
    const reserve = rest > 0 ? `\nほか${rest}件`.length : 0;   // 最後の「ほかN件」を入れる余地
    if (lines.length > 0 && used + 1 + line.length + reserve > MAX_LENGTH) {
      lines.push(`ほか${tickets.length - i}件`);
      break;
    }
    lines.push(line);
    used += (lines.length > 1 ? 1 : 0) + line.length;
  }
  return lines.join("\n");
}

/** タスクへのリンク（Topbar のお知らせと同じ /tasks?task={id} へ飛ばす） */
export function slackTaskLink(taskId: string, title: string): string {
  return slackLink(`/tasks?task=${encodeURIComponent(taskId)}`, `タスク: ${title}`);
}

/** Slack通知をバックグラウンドで送信する（メイン処理をブロックしない）。 */
export function fireSlackNotify(params: SlackNotifyParams): void {
  const displayBody = params.body && params.body.length > MAX_LENGTH
    ? params.body.substring(0, MAX_LENGTH) + '...'
    : params.body;

  const payload = {
    ...params,
    body: displayBody
  };

  fetch("/api/slack-notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(async res => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("[slack-notify] APIエラー:", res.status, data);
      } else if (data.skipped) {
        console.warn("[slack-notify] スキップされました:", data.reason);
      }
    })
    .catch(e => console.error("[slack-notify] ネットワークエラー:", e));
}
