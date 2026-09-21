import { createPortal } from "react-dom";

// 処理中に画面の真ん中へ大きなぐるぐるを出し、終わるまで操作を止める。
//
// Googleドライブとのやり取り（作成・変換アップロード・既存ファイルの追加）は数秒かかる。
// ボタン内の小さなスピナーだけだと、処理中なのかどうかが分かりにくかったため。
//
// ★ document.body へポータルで描く。ファイルボックスのボタン類は上部の固定ヘッダー
//   （position: sticky; z-index: 200）の中にあり、その中に描くとアプリ上部のバー(z-index 250)が
//   幕の上に乗ってしまう（BRU17-009 と同じ理由）。
// ★ Google の選択画面（Picker）を開いている間は出さないこと。Picker より手前に来て操作を塞ぐ。
//   Picker を閉じた後の、サーバーでの処理中だけ出す。

export function BlockingSpinner({ label = "処理しています" }: { label?: string }) {
  return createPortal(
    <div role="status" aria-live="polite" aria-label={label}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(245,246,248,0.55)", backdropFilter: "blur(1.5px)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "wait" }}>
      <style>{`@keyframes blocking-spinner-rotate { to { transform: rotate(360deg); } }`}</style>
      <div aria-hidden="true"
        style={{ width: 64, height: 64, borderRadius: "50%", border: "6px solid rgba(5,150,105,0.18)", borderTopColor: "#059669", animation: "blocking-spinner-rotate 0.8s linear infinite" }} />
    </div>,
    document.body,
  );
}
