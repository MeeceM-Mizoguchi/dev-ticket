export interface SlackNotifyParams {
  recipientUserName: string;
  projectSlug: string;
  title: string;
  body: string;
}

/** Slack通知をバックグラウンドで送信する（メイン処理をブロックしない）。 */
export function fireSlackNotify(params: SlackNotifyParams): void {
  fetch("/api/slack-notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }).catch(err => console.warn("[slack-notify] request failed:", err));
}
