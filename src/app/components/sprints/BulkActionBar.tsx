// BRU6-002 一括操作 ─ 画面下部フローティングバー
//
// チケットを1件以上選択している間だけ出現。選択件数と一括アクションを提供する。
// 「エクスポート」(CSV / Word / Markdown)は選択したチケットを書き出す。バーは画面下端に貼り付いて
// いるので、メニューは上向きに開く。
// 「AIで実装」は、選んだチケットをAIに1件ずつ読み取らせて実装させる手順書をコピーする（BRU20-022）。
// 「PR不要」は、選んだチケットの pr_link_waived をまとめて付け外しする。メニューはエクスポートと同じく上向き（BRU21-003）。

import { useEffect, useRef, useState } from "react";
import { Trash2, ArrowRightLeft, Sparkles, Link2, Download, X, Bot, GitPullRequest, Check } from "lucide-react";
import { TICKET_EXPORT_LABEL, type TicketExportFormat } from "@/app/lib/ticketExport";

const EXPORT_FORMATS: TicketExportFormat[] = ["csv", "docx", "md"];

/**
 * バーが画面下端に貼り付いている分の高さ（bottom:24 + バー本体 ≒ 80px）に余白を足したもの。
 * 一覧を一番下までスクロールしたときに最後のチケットがバーに隠れないよう、
 * 選択中はリストの末尾にこの高さのスペーサーを置く（useBulkTicketActions の ui が描画する）。
 */
export const BULK_ACTION_BAR_CLEARANCE = 96;

export function BulkActionBar({
  count, onDelete, onMove, onAssign, onCopyLinks, onPrWaive, onAiImplement, onExport, exportEnabled = true, onClear, disabled,
}: {
  count: number;
  onDelete: () => void;
  onMove: () => void;
  onAssign: () => void;
  onCopyLinks: () => void;
  /** 選んだチケットを「PR不要」にする（true）／外す（false）。未指定ならボタンを出さない */
  onPrWaive?: (waived: boolean) => void;
  /** 選んだチケットを「AIで実装」する手順書の画面を開く。未指定ならボタンを出さない */
  onAiImplement?: () => void;
  /** 選択したチケットを書き出す。未指定ならエクスポートボタンを出さない */
  onExport?: (format: TicketExportFormat) => void;
  /** プランの都合で使えないときは false（ボタンは出すが押せない） */
  exportEnabled?: boolean;
  onClear: () => void;
  disabled?: boolean;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const [waiveOpen, setWaiveOpen] = useState(false);
  const waiveRef = useRef<HTMLDivElement>(null);

  // 選択が解除されてバーが消えるときにメニューだけ残らないようにする
  useEffect(() => { if (count === 0) { setExportOpen(false); setWaiveOpen(false); } }, [count]);

  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [exportOpen]);

  useEffect(() => {
    if (!waiveOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!waiveRef.current?.contains(e.target as Node)) setWaiveOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [waiveOpen]);

  if (count === 0) return null;

  // whiteSpace/flexShrink はラベルの折り返し（BRU14-002）対策。
  // 幅が足りないときに文字を折り返すのではなく、バー全体を横に伸ばして1行に保つ。
  const btnBase = {
    display: "flex", alignItems: "center", gap: 5, padding: "8px 12px",
    fontSize: 12.5, fontWeight: 700, borderRadius: 10, border: "none",
    whiteSpace: "nowrap", flexShrink: 0,
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1,
    transition: "all 0.15s",
  } as const;

  // width:max-content が要点。left:50% で置いた fixed 要素の shrink-to-fit 幅は
  // 「画面右半分」しか取れず、収まらないと min-content（＝各ボタンが折り返した幅）まで
  // 縮んでしまう。max-content を明示して、中身がそのまま1行で並ぶ幅にする。
  return (
    <div style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 250, display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", width: "max-content", background: "#1A1714", borderRadius: 14, boxShadow: "0 12px 40px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.16)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, paddingLeft: 4, paddingRight: 2 }}>
        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", minWidth: 22, height: 22, padding: "0 6px", borderRadius: 999, background: "#059669", color: "#fff", fontSize: 12, fontWeight: 800 }}>{count}</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "#F3F4F6", whiteSpace: "nowrap" }}>件選択中</span>
      </div>

      <div style={{ width: 1, height: 22, flexShrink: 0, background: "rgba(255,255,255,0.14)" }} />

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

      {onPrWaive && (
        <div ref={waiveRef} style={{ position: "relative", flexShrink: 0 }}>
          <button type="button" disabled={disabled}
            title="選んだチケットの「プルリクエスト不要」を付け外しする"
            onClick={() => setWaiveOpen(o => !o)}
            style={{ ...btnBase, background: "rgba(255,255,255,0.10)", color: "#F3F4F6", border: "1px solid rgba(255,255,255,0.16)" }}
            onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.18)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.10)"; }}>
            <GitPullRequest style={{ width: 14, height: 14 }} />PR不要
          </button>
          {waiveOpen && !disabled && (
            <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", minWidth: 168, padding: 5, background: "#241F1B", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,0.35)", display: "flex", flexDirection: "column", gap: 2 }}>
              {([
                { waived: true, label: "PR不要にする", Icon: Check },
                { waived: false, label: "PR不要を外す", Icon: X },
              ] as const).map(({ waived, label, Icon }) => (
                <button key={label} type="button"
                  onClick={() => { setWaiveOpen(false); onPrWaive(waived); }}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", fontSize: 12, fontWeight: 600, color: "#F3F4F6", background: "transparent", border: "none", borderRadius: 7, cursor: "pointer", whiteSpace: "nowrap", textAlign: "left" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.10)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                  <Icon style={{ width: 13, height: 13, opacity: 0.75 }} />{label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {onAiImplement && (
        <button type="button" disabled={disabled} onClick={onAiImplement}
          title="選んだチケットをAIに読み取らせて実装させる手順をコピー"
          style={{ ...btnBase, background: "rgba(124,58,237,0.22)", color: "#EDE9FE", border: "1px solid rgba(167,139,250,0.40)" }}
          onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = "rgba(124,58,237,0.38)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(124,58,237,0.22)"; }}>
          <Bot style={{ width: 14, height: 14 }} />AIで実装
        </button>
      )}

      {onExport && (
        <div ref={exportRef} style={{ position: "relative", flexShrink: 0 }}>
          <button type="button" disabled={disabled || !exportEnabled}
            title={exportEnabled ? undefined : "現在のプランではご利用できません"}
            onClick={() => setExportOpen(o => !o)}
            style={{ ...btnBase, background: "rgba(255,255,255,0.10)", color: "#F3F4F6", border: "1px solid rgba(255,255,255,0.16)", cursor: (disabled || !exportEnabled) ? "not-allowed" : "pointer", opacity: (disabled || !exportEnabled) ? 0.6 : 1 }}
            onMouseEnter={e => { if (!disabled && exportEnabled) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.18)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.10)"; }}>
            <Download style={{ width: 14, height: 14 }} />エクスポート
          </button>
          {exportOpen && (
            <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", minWidth: 168, padding: 5, background: "#241F1B", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,0.35)", display: "flex", flexDirection: "column", gap: 2 }}>
              {EXPORT_FORMATS.map(f => (
                <button key={f} type="button"
                  onClick={() => { setExportOpen(false); onExport(f); }}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", fontSize: 12, fontWeight: 600, color: "#F3F4F6", background: "transparent", border: "none", borderRadius: 7, cursor: "pointer", whiteSpace: "nowrap", textAlign: "left" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.10)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                  <Download style={{ width: 13, height: 13, opacity: 0.75 }} />{TICKET_EXPORT_LABEL[f]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <button type="button" disabled={disabled} onClick={onDelete}
        style={{ ...btnBase, background: "rgba(220,38,38,0.16)", color: "#FCA5A5", border: "1px solid rgba(220,38,38,0.35)" }}
        onMouseEnter={e => { if (!disabled) { (e.currentTarget as HTMLElement).style.background = "#DC2626"; (e.currentTarget as HTMLElement).style.color = "#fff"; } }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(220,38,38,0.16)"; (e.currentTarget as HTMLElement).style.color = "#FCA5A5"; }}>
        <Trash2 style={{ width: 14, height: 14 }} />削除
      </button>

      <div style={{ width: 1, height: 22, flexShrink: 0, background: "rgba(255,255,255,0.14)" }} />

      <button type="button" onClick={onClear} title="選択を解除"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, flexShrink: 0, borderRadius: 9, border: "none", background: "transparent", color: "#B0A9A4", cursor: "pointer" }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.10)"; (e.currentTarget as HTMLElement).style.color = "#fff"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#B0A9A4"; }}>
        <X style={{ width: 16, height: 16 }} />
      </button>
    </div>
  );
}
