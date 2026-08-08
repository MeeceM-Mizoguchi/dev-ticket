// Excalidraw 標準ツールバー(.App-toolbar-content)の図形メニュー末尾に「Mermaid」ボタンを
// DOM 注入する（TriangleToolButton と同じ注入方式）。クリックで小さなモーダルを開き、
// テキストで Mermaid 定義を入力 → ライブプレビュー → 「生成」でキャンバスに図を配置する。
//
// 生成方針（確定）: @excalidraw/mermaid-to-excalidraw で編集可能なネイティブ図形に変換。
//   変換に対応しない図種（一部のダイアグラム）は、Mermaid を SVG→PNG 化して画像要素として
//   配置するフォールバックに切り替える（既存の画像同期パイプラインにそのまま乗る）。
//
// 変換の実体は whiteboardMermaid.ts に集約してある（Markdown 貼り付けの ```mermaid と共用）。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { mermaidToElements, boundsOf, translateElements } from "@/app/lib/whiteboardMermaid";
import { overlayMount } from "@/app/lib/whiteboardPortal";
import { MermaidView } from "../shared/MermaidView";
import { isSubmitShortcut } from "@/app/lib/submitKey";

const BTN_ID = "wb-mermaid-tool";

const DEFAULT_CODE = `flowchart TD
  A[開始] --> B{条件?}
  B -->|はい| C[処理1]
  B -->|いいえ| D[処理2]
  C --> E[完了]
  D --> E`;

// 現在のビューポート中心（scene座標）。WhiteboardToolbar と同じ算出。
function viewportCenter(api: any): { cx: number; cy: number } {
  const st = api.getAppState();
  const zoom = st.zoom?.value ?? 1;
  return {
    cx: (st.width ?? 800) / 2 / zoom - st.scrollX,
    cy: (st.height ?? 600) / 2 / zoom - st.scrollY,
  };
}

// 変換後要素群の外接矩形の中心が、ビューポート中心に来るよう全要素を平行移動する。
function placeAtCenter(api: any, els: any[]): any[] {
  if (!els.length) return els;
  const b = boundsOf(els);
  const { cx, cy } = viewportCenter(api);
  return translateElements(els, cx - (b.minX + (b.maxX - b.minX) / 2), cy - (b.minY + (b.maxY - b.minY) / 2));
}

function selectElements(api: any, els: any[]) {
  const ids: Record<string, boolean> = {};
  els.forEach((e) => { if (e?.id) ids[e.id] = true; });
  // 選択(appStateのみ)は履歴に残さない（NEVER）。生成そのものの1ステップと分離する。
  api.updateScene({ appState: { selectedElementIds: ids }, captureUpdate: CaptureUpdateAction.NEVER });
}

export function MermaidToolButton({ api, containerRef }: { api: any; containerRef: React.RefObject<HTMLDivElement | null> }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(DEFAULT_CODE);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const openRef = useRef(false);
  openRef.current = open;

  // ── ツールバーへボタン注入（DOM）。クリックでモーダルを開く。 ──
  useEffect(() => {
    const root = containerRef.current;
    if (!api || !root) return;

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.title = "Mermaid図を作成（テキストから図を生成）";
    btn.setAttribute("aria-label", "Mermaid図");
    btn.style.cssText = "width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;border-radius:8px;cursor:pointer;color:#1b1b1f;";
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="5" rx="1"/><rect x="14" y="16" width="7" height="5" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><path d="M6.5 8v3a2 2 0 0 0 2 2h9"/><path d="M17.5 8v5"/></svg>';
    btn.onmouseenter = () => { btn.style.background = "rgba(0,0,0,0.06)"; };
    btn.onmouseleave = () => { btn.style.background = "transparent"; };
    btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); };

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

    return () => { obs.disconnect(); btn.remove(); };
  }, [api, containerRef]);

  const close = () => { if (!generating) { setOpen(false); setError(""); } };

  const generate = async () => {
    if (generating) return;
    const src = code.trim();
    if (!src) { setError("Mermaidの定義を入力してください"); return; }
    setGenerating(true);
    setError("");
    try {
      const els = await mermaidToElements(api, src);
      placeAtCenter(api, els);
      // 生成を undo 履歴の1ステップとして記録（IMMEDIATELY）。これがないと挿入が履歴の
      // 正しいベースラインにならず、undo時にExcalidrawが不整合な差分を復元して
      // customData(wbMermaid)が失われ、自動接続が矢印を再スナップして崩す。
      api.updateScene({ elements: [...api.getSceneElements(), ...els], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      selectElements(api, els);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "図の生成に失敗しました");
    } finally {
      setGenerating(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div style={{ width: "min(920px, 96vw)", maxHeight: "90vh", background: "#fff", borderRadius: 12, boxShadow: "0 24px 80px rgba(0,0,0,0.35)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#1A1714" }}>Mermaid図を作成</div>
          <button type="button" onClick={close} disabled={generating}
            style={{ background: "transparent", border: "none", fontSize: 20, lineHeight: 1, color: "#9A938C", cursor: generating ? "default" : "pointer" }}>×</button>
        </div>

        <div style={{ display: "flex", gap: 12, padding: 16, minHeight: 0, flex: 1, flexWrap: "wrap" }}>
          {/* 左: 定義入力 */}
          <div style={{ flex: "1 1 340px", minWidth: 280, display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#6B6458" }}>Mermaid定義</label>
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                // ⌘/Ctrl + Enter でキャンバスに生成（Enter 単体は改行のまま）
                if (isSubmitShortcut({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, isComposing: e.nativeEvent.isComposing }) && !generating) {
                  e.preventDefault();
                  void generate();
                }
              }}
              spellCheck={false}
              style={{ flex: 1, minHeight: 260, resize: "vertical", fontFamily: "var(--font-mono, monospace)", fontSize: 12.5, lineHeight: 1.6, padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.15)", color: "#1A1714", background: "#FAFAF8", outline: "none" }}
            />
            <div style={{ fontSize: 11, color: "#B0A9A4" }}>
              例: <code>flowchart</code> / <code>sequenceDiagram</code> / <code>classDiagram</code> / <code>gantt</code> など
            </div>
          </div>

          {/* 右: プレビュー */}
          <div style={{ flex: "1 1 340px", minWidth: 280, display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#6B6458" }}>プレビュー</label>
            <div style={{ flex: 1, minHeight: 260, overflow: "auto", padding: 12, borderRadius: 8, border: "1px solid rgba(0,0,0,0.10)", background: "#fff" }}>
              <MermaidView code={code} align="center" minHeight={240} />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderTop: "1px solid rgba(0,0,0,0.08)" }}>
          <div style={{ fontSize: 12, color: "#DC2626", flex: 1, whiteSpace: "pre-wrap" }}>{error}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={close} disabled={generating}
              style={{ padding: "7px 14px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "1px solid rgba(0,0,0,0.15)", background: "#fff", color: "#6B6458", cursor: generating ? "default" : "pointer" }}>
              キャンセル
            </button>
            <button type="button" onClick={generate} disabled={generating}
              style={{ padding: "7px 16px", fontSize: 13, fontWeight: 700, borderRadius: 8, border: "none", background: generating ? "#A7C4B5" : "#059669", color: "#fff", cursor: generating ? "default" : "pointer" }}>
              {generating ? "生成中…" : "キャンバスに生成"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    // 全画面中は body 直下だと描画されないので、全画面要素の中へ取り付ける（BRU7-056-9）
    overlayMount()
  );
}
