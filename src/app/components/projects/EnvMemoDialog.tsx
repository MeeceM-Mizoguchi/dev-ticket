import { useState } from "react";
import { ExternalLink, FileText, Globe } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import type { EnvMemo } from "@/app/types";

// BRU20-021 環境メモは見出しの下にタグで並べていたが、件数が増えると見出しまわりが
// タグで埋まってしまう。「環境メモ」ボタン1つにまとめ、押すと横長のモーダルで
// 左に一覧・右に選んだメモの中身を出す。

const memoLabel = (m: EnvMemo) => m.name || m.url || "メモ";

/** スプリント管理の見出しの下に置くボタン。モーダルは呼び出し側で描く（固定ヘッダーの外に出すため） */
export function EnvMemoButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, color: "#0284C7", background: "#F0F9FF", border: "1px solid rgba(2,132,199,0.2)", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#E0F2FE"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F0F9FF"; }}>
      <FileText style={{ width: 9, height: 9 }} />環境メモ（{count}）
    </button>
  );
}

export function EnvMemoDialog({ memos, onClose }: { memos: EnvMemo[]; onClose: () => void }) {
  const [selected, setSelected] = useState(0);
  const current = memos[selected] ?? memos[0];

  return (
    <DialogShell title="環境メモ" size="xl" minHeight={0} onClose={onClose}
      footer={<BtnSecondary onClick={onClose}>閉じる</BtnSecondary>}>
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, height: "min(440px, 60vh)" }}>
        {/* 左: メモの一覧 */}
        <div style={{ overflowY: "auto", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: 6, background: "#FAFAF8" }}>
          {memos.map((m, i) => {
            const isSel = i === selected;
            const Icon = m.url ? Globe : FileText;
            return (
              <button key={i} type="button" onClick={() => setSelected(i)}
                style={{ display: "flex", alignItems: "flex-start", gap: 8, width: "100%", textAlign: "left", padding: "9px 10px", marginBottom: 2, borderRadius: 8, border: "none", cursor: "pointer", background: isSel ? "#E0F2FE" : "transparent" }}>
                <Icon style={{ width: 13, height: 13, color: "#0284C7", flexShrink: 0, marginTop: 2 }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12, fontWeight: isSel ? 700 : 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{memoLabel(m)}</span>
                  {m.name && m.url && (
                    <span style={{ display: "block", fontSize: 10, color: "#A09790", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.url}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* 右: 選んだメモの中身 */}
        <div style={{ minWidth: 0, overflowY: "auto", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "16px 18px" }}>
          {current && (
            <>
              <h3 style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", margin: 0, wordBreak: "break-word" }}>{memoLabel(current)}</h3>
              {current.url && (
                <a href={current.url} target="_blank" rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, fontSize: 12, color: "#0284C7", wordBreak: "break-all" }}>
                  <ExternalLink style={{ width: 12, height: 12, flexShrink: 0 }} />{current.url}
                </a>
              )}
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(26,23,20,0.07)" }}>
                {current.memo
                  ? <p style={{ fontSize: 13, color: "#1A1714", lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>{current.memo}</p>
                  : <p style={{ fontSize: 12, color: "#B0A9A4", margin: 0 }}>メモはありません</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
