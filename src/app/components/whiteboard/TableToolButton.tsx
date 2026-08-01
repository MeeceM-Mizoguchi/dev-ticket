// Excalidraw 標準ツールバー(.App-toolbar-content)の図形メニュー末尾に「表」ボタンを
// DOM 注入する（TriangleToolButton / MermaidToolButton と同じ注入方式）。クリックで
// ボタン直下に Google ドキュメント風のグリッドピッカーを開き、ホバーで「列 × 行」を選んで
// クリックすると、その大きさの表をキャンバス中央に生成する（BRU5-042）。
//
// 表の実体: セル1つ = 標準の rectangle。行×列ぶんの矩形を升目状に敷き詰め、同一 groupId で
//   グループ化する（＝一体で移動・リサイズできる）。各セルはダブルクリックで Excalidraw
//   ネイティブのテキスト編集ができる。矩形なので自動接続/フレーム等の onChange 補助処理には
//   触られない（isConnector は line/arrow のみ対象）。印として customData.wbTable を付ける。
//
// 生成の実体は whiteboardTableCreate.ts に集約してある（Markdown の貼り付けでも同じ表を作るため）。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { overlayMount } from "@/app/lib/whiteboardPortal";
import { insertTableAtCenter } from "@/app/lib/whiteboardTableCreate";

const BTN_ID = "wb-table-tool";
const MAX_COLS = 8;               // グリッドピッカーの最大列
const MAX_ROWS = 8;               // グリッドピッカーの最大行

// ボタン直下に開くグリッドピッカー（Google ドキュメント風・ホバーで行×列を選ぶ）。
function GridPicker({ onPick, onClose }: { onPick: (rows: number, cols: number) => void; onClose: () => void }) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const CELL = 20, GAP = 3;
  return (
    <div style={{ userSelect: "none" }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${MAX_COLS}, ${CELL}px)`, gap: GAP }}>
        {Array.from({ length: MAX_ROWS }).map((_, r) =>
          Array.from({ length: MAX_COLS }).map((__, c) => {
            const on = hover ? r <= hover.r && c <= hover.c : false;
            return (
              <div
                key={`${r}-${c}`}
                onMouseEnter={() => setHover({ r, c })}
                onClick={() => { onPick(r + 1, c + 1); onClose(); }}
                style={{
                  width: CELL, height: CELL, borderRadius: 3, cursor: "pointer",
                  border: `1px solid ${on ? "#6965db" : "rgba(0,0,0,0.18)"}`,
                  background: on ? "rgba(105,101,219,0.22)" : "#fff",
                }}
              />
            );
          })
        )}
      </div>
      <div style={{ marginTop: 8, textAlign: "center", fontSize: 12, fontWeight: 600, color: hover ? "#1A1714" : "#B0A9A4" }}>
        {hover ? `${hover.c + 1} 列 × ${hover.r + 1} 行` : "サイズを選択"}
      </div>
    </div>
  );
}

export function TableToolButton({ api, containerRef }: { api: any; containerRef: React.RefObject<HTMLDivElement | null> }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // ── ツールバーへボタン注入（DOM）。クリックで直下にグリッドピッカーを開閉する。 ──
  useEffect(() => {
    const root = containerRef.current;
    if (!api || !root) return;

    const btn = document.createElement("button");
    btnRef.current = btn;
    btn.id = BTN_ID;
    btn.type = "button";
    btn.title = "表を作成（列×行を選んで挿入）";
    btn.setAttribute("aria-label", "表");
    btn.style.cssText = "width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;border-radius:8px;cursor:pointer;color:#1b1b1f;";
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="1"/><line x1="3" y1="9.5" x2="21" y2="9.5"/><line x1="3" y1="14.5" x2="21" y2="14.5"/><line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/></svg>';
    btn.onmouseenter = () => { btn.style.background = "rgba(0,0,0,0.06)"; };
    btn.onmouseleave = () => { btn.style.background = "transparent"; };
    btn.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      const r = btn.getBoundingClientRect();
      const width = 200; // ピッカー概算幅（右端はみ出しをクランプ）
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      setPos({ top: r.bottom + 8, left });
      setOpen((o) => !o);
    };

    const ensure = () => {
      if (root.querySelector("#" + BTN_ID)) return;
      const tools = root.querySelectorAll('[data-testid^="toolbar-"]');
      const anchor = tools[tools.length - 1] as HTMLElement | undefined;
      const row = anchor?.parentElement;
      if (row) {
        if (anchor.nextSibling) row.insertBefore(btn, anchor.nextSibling);
        else row.appendChild(btn);
      }
    };
    ensure();
    const obs = new MutationObserver(() => ensure());
    obs.observe(root, { childList: true, subtree: true });

    return () => { obs.disconnect(); btn.remove(); btnRef.current = null; };
  }, [api, containerRef]);

  // 開いている間だけボタンを強調。Esc で閉じる。
  useEffect(() => {
    const btn = btnRef.current;
    if (btn) btn.style.background = open ? "#e0dfff" : "transparent";
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <>
      {/* 外側クリックで閉じる透明バックドロップ */}
      <div style={{ position: "fixed", inset: 0, zIndex: 4000 }} onMouseDown={() => setOpen(false)} />
      <div
        style={{
          position: "fixed", top: pos.top, left: pos.left, zIndex: 4001,
          background: "#fff", borderRadius: 10, border: "1px solid rgba(0,0,0,0.1)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.22)", padding: 12,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <GridPicker onPick={(rows, cols) => insertTableAtCenter(api, rows, cols)} onClose={() => setOpen(false)} />
      </div>
    </>,
    // 全画面中は body 直下だと描画されないので、全画面要素の中へ取り付ける（BRU7-056-9）
    overlayMount()
  );
}
