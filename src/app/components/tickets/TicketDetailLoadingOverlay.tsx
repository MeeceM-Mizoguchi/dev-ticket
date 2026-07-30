import { X } from "lucide-react";

// チケット詳細パネルの初回ロード用オーバーレイ。
// 本体フィールド・コメント(レビュー履歴)・子チケット・パンくずが別々のクエリで返るため、
// 揃うまでパネル全面を覆い、あとから差し込まれるレイアウトシフトをユーザーに見せない。
//
// パネル本体 div (position: fixed / overflow: hidden) の直下に置く前提なので inset: 0 でぴったり重なり、
// スライドインアニメーションにもそのまま追従する。
// 表示中もユーザーを閉じ込めないよう ✕ を出す（Esc は escStack 側で従来どおり効く）。
export function TicketDetailLoadingOverlay({ wbs, title, onClose }: { wbs?: string; title?: string; onClose: () => void }) {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 210, background: "#FAFAF8", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
      {/* ヘッダーの ✕ と同じ見た目・同じハンドラ（子チケットなら親へ戻る） */}
      <button type="button" onClick={onClose} aria-label="閉じる"
        style={{ position: "absolute", top: 14, right: 20, padding: 7, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", borderRadius: 9, cursor: "pointer", color: "#B0A9A4" }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
        <X style={{ width: 16, height: 16 }} />
      </button>

      {/* PageLoader と同じリング。keyframes は PageLoader がマウントされていないと存在しないため、
          同名(=同内容)の定義をここでも持たせる。 */}
      <div style={{ width: 34, height: 34, border: "3px solid rgba(5,150,105,0.15)", borderTop: "3px solid #059669", borderRadius: "50%", animation: "pageloader-spin 0.75s linear infinite" }} />
      <style>{`@keyframes pageloader-spin { to { transform: rotate(360deg); } }`}</style>

      {/* 何を開いているかは prop から即出せるので、真っ白にはしない */}
      {wbs && (
        <div style={{ fontSize: 11, fontWeight: 700, color: "#A09690", letterSpacing: "0.05em" }}>{wbs}</div>
      )}
      {title && (
        <div style={{ maxWidth: "72%", textAlign: "center", fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", lineHeight: 1.35 }}>{title}</div>
      )}
      <p style={{ fontSize: 12, color: "#A09790", marginTop: 2 }}>読み込み中...</p>
    </div>
  );
}
