export interface SlackNotifyParams {
  recipientUserNames: string[];
  projectSlug: string;
  title: string;
  body: string;
}

/** Slack通知をバックグラウンドで送信する（メイン処理をブロックしない）。 */
export function fireSlackNotify(params: SlackNotifyParams): void {
  const MAX_LENGTH = 300;
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
