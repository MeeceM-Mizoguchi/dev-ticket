export interface SlackNotifyParams {
  recipientUserName: string;
  projectSlug: string;
  title: string;
  body: string;
}

/** Slack通知をバックグラウンドで送信する（メイン処理をブロックしない）。 */
export function fireSlackNotify(params: SlackNotifyParams): void {
  console.log("[slack-notify] firing →", params);
  fetch("/api/slack-notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
    .then(async r => {
      const data = await r.json();
      if (!r.ok) {
        console.error("[slack-notify] API error", r.status, data);
      } else if (data.skipped) {
        console.warn("[slack-notify] skipped:", data.reason);
      } else {
        console.log("[slack-notify] success:", data);
      }
    })
    .catch(err => console.error("[slack-notify] network error:", err));
}
