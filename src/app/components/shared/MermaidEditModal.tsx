// Mermaid図の入力・編集モーダル（テキスト編集エディタ側で使う）。
// 左に定義テキスト、右にライブプレビュー。挿入/保存で onSave(code) を返す。
// チケット詳細・コメント等ではコードをインライン表示するとスクロールが増えるため、
// 入力・編集はこのモーダルに集約し、本文中は図だけを表示する。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MermaidView } from "./MermaidView";

interface Props {
  initialCode: string;
  title?: string;
  saveLabel?: string;
  onSave: (code: string) => void;
  onClose: () => void;
}

const DEFAULT_TEMPLATE = `flowchart TD
  A[開始] --> B{条件?}
  B -->|はい| C[処理1]
  B -->|いいえ| D[処理2]
  C --> E[完了]
  D --> E`;

export function MermaidEditModal({ initialCode, title = "Mermaid図", saveLabel = "挿入", onSave, onClose }: Props) {
  const [code, setCode] = useState(initialCode || DEFAULT_TEMPLATE);
  const canSave = code.trim().length > 0;

  // Escで閉じる。伝播を止めないと親のチケット詳細パネル等の Esc ハンドラまで届いて
  // パネルごと閉じてしまうため、capture 段階で捕まえて確実に打ち切る。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); onClose(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: "min(920px, 96vw)", maxHeight: "90vh", background: "#fff", borderRadius: 12, boxShadow: "0 24px 80px rgba(0,0,0,0.35)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#1A1714" }}>{title}</div>
          <button type="button" onClick={onClose}
            style={{ background: "transparent", border: "none", fontSize: 20, lineHeight: 1, color: "#9A938C", cursor: "pointer" }}>×</button>
        </div>

        <div style={{ display: "flex", gap: 12, padding: 16, minHeight: 0, flex: 1, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 340px", minWidth: 280, display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#6B6458" }}>Mermaid定義</label>
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              spellCheck={false}
              autoFocus
              style={{ flex: 1, minHeight: 260, resize: "vertical", fontFamily: "var(--font-mono, monospace)", fontSize: 12.5, lineHeight: 1.6, padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.15)", color: "#1A1714", background: "#FAFAF8", outline: "none" }}
            />
            <div style={{ fontSize: 11, color: "#B0A9A4" }}>
              例: <code>flowchart</code> / <code>sequenceDiagram</code> / <code>classDiagram</code> / <code>gantt</code> など
            </div>
          </div>

          <div style={{ flex: "1 1 340px", minWidth: 280, display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#6B6458" }}>プレビュー</label>
            <div style={{ flex: 1, minHeight: 260, overflow: "auto", padding: 12, borderRadius: 8, border: "1px solid rgba(0,0,0,0.10)", background: "#fff" }}>
              <MermaidView code={code} align="center" minHeight={240} />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "12px 16px", borderTop: "1px solid rgba(0,0,0,0.08)" }}>
          <button type="button" onClick={onClose}
            style={{ padding: "7px 14px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "1px solid rgba(0,0,0,0.15)", background: "#fff", color: "#6B6458", cursor: "pointer" }}>
            キャンセル
          </button>
          <button type="button" onClick={() => canSave && onSave(code)} disabled={!canSave}
            style={{ padding: "7px 16px", fontSize: 13, fontWeight: 700, borderRadius: 8, border: "none", background: canSave ? "#059669" : "#A7C4B5", color: "#fff", cursor: canSave ? "pointer" : "default" }}>
            {saveLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
