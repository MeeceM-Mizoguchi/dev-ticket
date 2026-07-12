// Excalidraw 標準ツールバー(.App-toolbar-content)の図形メニュー末尾に「表」ボタンを
// DOM 注入する（TriangleToolButton / MermaidToolButton と同じ注入方式）。クリックで
// ボタン直下に Google ドキュメント風のグリッドピッカーを開き、ホバーで「列 × 行」を選んで
// クリックすると、その大きさの表をキャンバス中央に生成する（BRU5-042）。
//
// 表の実体: セル1つ = 標準の rectangle。行×列ぶんの矩形を升目状に敷き詰め、同一 groupId で
//   グループ化する（＝一体で移動・リサイズできる）。各セルはダブルクリックで Excalidraw
//   ネイティブのテキスト編集ができる。矩形なので自動接続/フレーム等の onChange 補助処理には
//   触られない（isConnector は line/arrow のみ対象）。印として customData.wbTable を付ける。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { convertToExcalidrawElements, CaptureUpdateAction } from "@excalidraw/excalidraw";

const BTN_ID = "wb-table-tool";
const SOFT_BLACK = "#343a40";     // 白板の既定線色（CLEAN_DEFAULTS と揃える）
const HEADER_FILL = "#f1f3f5";    // 先頭行（ヘッダー）の薄いグレー
const CELL_W = 120;               // セル既定幅
const CELL_H = 44;                // セル既定高
const MAX_COLS = 8;               // グリッドピッカーの最大列
const MAX_ROWS = 8;               // グリッドピッカーの最大行

// 現在のビューポート中心（scene座標）。WhiteboardToolbar / MermaidToolButton と同じ算出。
function viewportCenter(api: any): { cx: number; cy: number } {
  const st = api.getAppState();
  const zoom = st.zoom?.value ?? 1;
  return {
    cx: (st.width ?? 800) / 2 / zoom - st.scrollX,
    cy: (st.height ?? 600) / 2 / zoom - st.scrollY,
  };
}

// rows×cols の表をビューポート中央に生成する。
function insertTable(api: any, rows: number, cols: number) {
  if (!api || rows < 1 || cols < 1) return;
  const groupId = `wb_table_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const { cx, cy } = viewportCenter(api);
  const totalW = cols * CELL_W, totalH = rows * CELL_H;
  const ox = cx - totalW / 2, oy = cy - totalH / 2;

  // セル(r,c) を skeleton で作成。customData.wbTable に格子座標を持たせ、再レイアウトの識別子にする。
  const skeleton: any[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      skeleton.push({
        type: "rectangle",
        x: ox + c * CELL_W,
        y: oy + r * CELL_H,
        width: CELL_W,
        height: CELL_H,
        strokeColor: SOFT_BLACK,
        strokeWidth: 1,
        roughness: 0,
        // 複数行のときは先頭行をヘッダーとして薄グレー、他は不透明の白（背後の図が透けない）
        backgroundColor: rows > 1 && r === 0 ? HEADER_FILL : "#ffffff",
        fillStyle: "solid",
        customData: { wbTable: { tid: groupId, r, c } },
      });
    }
  }

  const els = convertToExcalidrawElements(skeleton) as any[];
  // convertToExcalidrawElements は customData を保持しないことがあるため、行/列順で確実に再付与する。
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const e = els[i++];
      if (!e) continue;
      e.roundness = null;                 // 角あり（表の罫線は角丸にしない）
      e.roughness = 0;                    // 直線罫線
      e.fillStyle = "solid";
      e.groupIds = [groupId];             // 全セルを1グループに（一体で移動・削除）
      e.customData = { ...(e.customData ?? {}), wbTable: { tid: groupId, r, c } };
    }
  }

  // 生成を undo 履歴の1ステップとして記録（IMMEDIATELY）。MermaidToolButton と同方針。
  api.updateScene({ elements: [...api.getSceneElements(), ...els], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  // 生成直後は表全体を選択（選択のみは履歴に残さない・NEVER）
  const ids: Record<string, boolean> = {};
  els.forEach((e) => { if (e?.id) ids[e.id] = true; });
  api.updateScene({ appState: { selectedElementIds: ids }, captureUpdate: CaptureUpdateAction.NEVER });
}

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
        <GridPicker onPick={(rows, cols) => insertTable(api, rows, cols)} onClose={() => setOpen(false)} />
      </div>
    </>,
    document.body
  );
}
