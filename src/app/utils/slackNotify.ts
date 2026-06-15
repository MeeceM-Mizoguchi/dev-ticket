export interface SlackNotifyParams {
  recipientUserNames: string[];
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
