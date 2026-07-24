// BRU6-002 一括操作 ─ 画面下部フローティングバー
//
// チケットを1件以上選択している間だけ出現。選択件数と3つの一括アクションを提供する。

import { Trash2, ArrowRightLeft, Sparkles, Link2, X } from "lucide-react";

export function BulkActionBar({
  count, onDelete, onMove, onAssign, onCopyLinks, onClear, disabled,
}: {
  count: number;
  onDelete: () => void;
  onMove: () => void;
  onAssign: () => void;
  onCopyLinks: () => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  if (count === 0) return null;

  const btnBase = {
    display: "flex", alignItems: "center", gap: 6, padding: "9px 16px",
    fontSize: 12.5, fontWeight: 700, borderRadius: 10, border: "none",
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1,
    transition: "all 0.15s",
  } as const;

  return (
    <div style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 250, display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#1A1714", borderRadius: 14, boxShadow: "0 12px 40px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.16)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 4, paddingRight: 4 }}>
        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: 22, height: 22, padding: "0 6px", borderRadius: 999, background: "#059669", color: "#fff", fontSize: 12, fontWeight: 800 }}>{count}</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "#F3F4F6", whiteSpace: "nowrap" }}>件選択中</span>
      </div>

      <div style={{ width: 1, height: 22, background: "rgba(255,255,255,0.14)" }} />

      <button type="button" disabled={disabled} onClick={onAssign}
        style={{ ...btnBase, background: "#059669", color: "#fff" }}
        onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = "#047857"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
        <Sparkles style={{ width: 14, height: 14 }} />一括アサイン
      </button>

      <button type="button" disabled={disabled} onClick={onMove}
        style={{ ...btnBase, background: "rgba(255,255,255,0.10)", color: "#F3F4F6", border: "1px solid rgba(255,255,255,0.16)" }}
        onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.18)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.10)"; }}>
        <ArrowRightLeft style={{ width: 14, height: 14 }} />スプリント移動
      </button>

      <button type="button" disabled={disabled} onClick={onCopyLinks}
        style={{ ...btnBase, background: "rgba(255,255,255,0.10)", color: "#F3F4F6", border: "1px solid rgba(255,255,255,0.16)" }}
        onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.18)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.10)"; }}>
        <Link2 style={{ width: 14, height: 14 }} />リンクをコピー
      </button>

      <button type="button" disabled={disabled} onClick={onDelete}
        style={{ ...btnBase, background: "rgba(220,38,38,0.16)", color: "#FCA5A5", border: "1px solid rgba(220,38,38,0.35)" }}
        onMouseEnter={e => { if (!disabled) { (e.currentTarget as HTMLElement).style.background = "#DC2626"; (e.currentTarget as HTMLElement).style.color = "#fff"; } }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(220,38,38,0.16)"; (e.currentTarget as HTMLElement).style.color = "#FCA5A5"; }}>
        <Trash2 style={{ width: 14, height: 14 }} />削除
      </button>

      <div style={{ width: 1, height: 22, background: "rgba(255,255,255,0.14)" }} />

      <button type="button" onClick={onClear} title="選択を解除"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 9, border: "none", background: "transparent", color: "#B0A9A4", cursor: "pointer" }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.10)"; (e.currentTarget as HTMLElement).style.color = "#fff"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#B0A9A4"; }}>
        <X style={{ width: 16, height: 16 }} />
      </button>
    </div>
  );
}
