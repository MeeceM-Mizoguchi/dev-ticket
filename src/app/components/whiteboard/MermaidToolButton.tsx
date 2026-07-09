// Excalidraw 標準ツールバー(.App-toolbar-content)の図形メニュー末尾に「Mermaid」ボタンを
// DOM 注入する（TriangleToolButton と同じ注入方式）。クリックで小さなモーダルを開き、
// テキストで Mermaid 定義を入力 → ライブプレビュー → 「生成」でキャンバスに図を配置する。
//
// 生成方針（確定）: @excalidraw/mermaid-to-excalidraw で編集可能なネイティブ図形に変換。
//   変換に対応しない図種（一部のダイアグラム）は、Mermaid を SVG→PNG 化して画像要素として
//   配置するフォールバックに切り替える（既存の画像同期パイプラインにそのまま乗る）。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { convertToExcalidrawElements, CaptureUpdateAction } from "@excalidraw/excalidraw";
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";
import { renderMermaid, mermaidSvgToPngDataUrl } from "@/app/lib/mermaid";
import { MermaidView } from "../shared/MermaidView";

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
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of els) {
    const x = e.x ?? 0, y = e.y ?? 0, w = e.width ?? 0, h = e.height ?? 0;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
  }
  const { cx, cy } = viewportCenter(api);
  const dx = cx - (minX + (maxX - minX) / 2);
  const dy = cy - (minY + (maxY - minY) / 2);
  for (const e of els) { e.x = (e.x ?? 0) + dx; e.y = (e.y ?? 0) + dy; }
  return els;
}

// mermaid-to-excalidraw はラベル内の <br/> を改行に変換しないため、変換後のテキスト要素で改行へ置換する。
const fixBr = (t: string) => t.replace(/<br\s*\/?>/gi, "\n");

// 生成した全要素に印(wbMermaid)を付け、グループ解除・フォント正規化・<br/>改行を行う。
// - wbMermaid 印: この白板の自動処理（線を近くの図形へスナップする autoConnect 等）が mermaid の
//   矢印・線を触って崩さないよう「除外対象」として使う（whiteboardAutoConnect / whiteboardSnap 参照）。
// - groupIds を空に: mermaid-to-excalidraw は alt ブロック等をグループ化するため、クリックすると
//   個別図形でなくグループが選択され「図形を個別に選択・移動できない」状態になる。個別編集できるよう解除。
// - fontFamily=2(Helvetica 通常): 既定が手書きフォント(Excalifont)になるため、白板の既定スタイル
//   (CLEAN_DEFAULTS の currentItemFontFamily=2)に合わせてシンプルなフォントにする。
const NORMAL_FONT_FAMILY = 2;
function markMermaidElements(els: any[]): any[] {
  for (const e of els) {
    e.customData = { ...(e.customData ?? {}), wbMermaid: true };
    e.groupIds = [];
    // 手書き風の揺れ(roughness)をなくして直線・シンプルな罫線にする（白板の既定スタイルに合わせる）。
    e.roughness = 0;
    if (e.type === "arrow" || e.type === "line") {
      // 角丸ルーティングをやめて直線に。
      e.roundness = null;
      // 図形への「バインド(接続)」を外す。バインドが残ると undo/移動時に Excalidraw が
      // 束ねた矢印の位置を連鎖再計算し、この白板の Yjs 同期＋履歴と噛み合って図全体が崩れる。
      // 生成物は独立した図形として扱い、各要素を自由に動かせるようにする。
      e.startBinding = null;
      e.endBinding = null;
      // 【最重要】線形要素の正規化。Excalidraw は points[0] が [0,0] であることを要求する。
      // mermaid-to-excalidraw は未正規化の矢印(points[0]≠原点)を返すため、点をドラッグすると
      // LinearElementEditor が「not normalized」で壊れ、x が -1.5e23 等の異常値になり、
      // その結果 isValidEl に弾かれて矢印が消える/飛ぶ。ここで先頭点を原点へ揃えて根絶する
      // （TriangleToolButton の normalizeLinear と同じ処理）。
      if (Array.isArray(e.points) && e.points.length > 0) {
        const ox = e.points[0][0], oy = e.points[0][1];
        if (ox !== 0 || oy !== 0) {
          e.points = e.points.map((p: number[]) => [p[0] - ox, p[1] - oy]);
          e.x = (e.x ?? 0) + ox;
          e.y = (e.y ?? 0) + oy;
        }
        const xs = e.points.map((p: number[]) => p[0]);
        const ys = e.points.map((p: number[]) => p[1]);
        e.width = Math.max(...xs) - Math.min(...xs);
        e.height = Math.max(...ys) - Math.min(...ys);
      }
    }
    // 図形側に残る「矢印バインド」参照も外す（テキストラベルの紐づけ type:"text" は残す）。
    if (Array.isArray(e.boundElements)) {
      e.boundElements = e.boundElements.filter((b: any) => b?.type === "text");
    }
    if (typeof e.text === "string") {
      e.text = fixBr(e.text);
      e.fontFamily = NORMAL_FONT_FAMILY;
    }
    if (typeof e.originalText === "string") e.originalText = fixBr(e.originalText);
  }
  return els;
}

function selectElements(api: any, els: any[]) {
  const ids: Record<string, boolean> = {};
  els.forEach((e) => { if (e?.id) ids[e.id] = true; });
  // 選択(appStateのみ)は履歴に残さない（NEVER）。生成そのものの1ステップと分離する。
  api.updateScene({ appState: { selectedElementIds: ids }, captureUpdate: CaptureUpdateAction.NEVER });
}

function pngSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 400, height: img.naturalHeight || 300 });
    img.onerror = () => resolve({ width: 400, height: 300 });
    img.src = dataUrl;
  });
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
      // ① ネイティブ変換（編集可能な図形）を試す。
      try {
        const { elements: skeleton, files } = await parseMermaidToExcalidraw(src);
        const converted = convertToExcalidrawElements(skeleton as any) as any[];
        if (!converted.length) throw new Error("変換結果が空です");
        markMermaidElements(converted);
        placeAtCenter(api, converted);
        if (files) { try { api.addFiles(Object.values(files)); } catch { /* noop */ } }
        // 生成を undo 履歴の1ステップとして記録（IMMEDIATELY）。これがないと挿入が履歴の
        // 正しいベースラインにならず、undo時にExcalidrawが不整合な差分を復元して
        // customData(wbMermaid)が失われ、自動接続が矢印を再スナップして崩す。
        api.updateScene({ elements: [...api.getSceneElements(), ...converted], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
        selectElements(api, converted);
        setOpen(false);
        return;
      } catch (nativeErr) {
        // ② フォールバック: SVG→PNG 画像として配置。
        const res = await renderMermaid(src, { forRaster: true });
        if (!("svg" in res)) throw new Error(res.error);
        const dataUrl = await mermaidSvgToPngDataUrl(res.svg);
        const { width, height } = await pngSize(dataUrl);
        // 画像が大きすぎないよう最大幅600pxに収める。
        const scale = width > 600 ? 600 / width : 1;
        const w = Math.round(width * scale), h = Math.round(height * scale);
        const fileId = `mermaid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        api.addFiles([{ id: fileId, dataURL: dataUrl, mimeType: "image/png", created: Date.now() }]);
        const { cx, cy } = viewportCenter(api);
        const els = convertToExcalidrawElements([
          { type: "image", fileId, x: cx - w / 2, y: cy - h / 2, width: w, height: h, status: "saved" } as any,
        ]) as any[];
        markMermaidElements(els);
        api.updateScene({ elements: [...api.getSceneElements(), ...els], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
        selectElements(api, els);
        setOpen(false);
        // ネイティブ変換が落ちた旨は console にのみ残す（利用者には画像で成功として見せる）。
        console.debug("[Mermaid] native conversion failed, inserted as image:", nativeErr);
        return;
      }
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
              onKeyDown={(e) => e.stopPropagation()}
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
    document.body
  );
}
