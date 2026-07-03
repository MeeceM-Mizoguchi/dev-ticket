// Excalidraw標準ツールバー(.App-toolbar-content)に「三角形」ボタンをDOM注入する。
// Excalidrawは標準ツールバーへのAPI追加をサポートしないため、描画後のDOMへ差し込み、
// React再描画で消えても MutationObserver で再注入して維持する。
import { useEffect } from "react";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

const TRI_SIZE = 120;
const SOFT_BLACK = "#343a40";
const BTN_ID = "wb-triangle-tool";

function normalizeLinear(el: any) {
  if (!el || !Array.isArray(el.points) || el.points.length === 0) return;
  const [ox, oy] = el.points[0];
  if (ox === 0 && oy === 0) return;
  el.points = el.points.map(([px, py]: number[]) => [px - ox, py - oy]);
  el.x += ox; el.y += oy;
  const xs = el.points.map((p: number[]) => p[0]);
  const ys = el.points.map((p: number[]) => p[1]);
  el.width = Math.max(...xs) - Math.min(...xs);
  el.height = Math.max(...ys) - Math.min(...ys);
}

export function TriangleToolButton({ api, containerRef }: { api: any; containerRef: React.RefObject<HTMLDivElement | null> }) {
  useEffect(() => {
    const root = containerRef.current;
    if (!api || !root) return;

    const addTriangle = () => {
      const st = api.getAppState();
      const zoom = st.zoom?.value ?? 1;
      const cx = (st.width ?? 800) / 2 / zoom - st.scrollX;
      const cy = (st.height ?? 600) / 2 / zoom - st.scrollY;
      const x = cx - TRI_SIZE / 2, y = cy - TRI_SIZE / 2;
      const els = convertToExcalidrawElements([
        {
          type: "line",
          id: `wb_tri_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          x, y,
          points: [[TRI_SIZE / 2, 0], [TRI_SIZE, TRI_SIZE], [0, TRI_SIZE], [TRI_SIZE / 2, 0]],
          roughness: 0, strokeWidth: 1, strokeColor: SOFT_BLACK, backgroundColor: "transparent",
        } as any,
      ]) as any[];
      els.forEach((e) => { if (e.type === "line") normalizeLinear(e); });
      api.updateScene({ elements: [...api.getSceneElements(), ...els] });
      const tri = els[0];
      if (tri) api.updateScene({ appState: { selectedElementIds: { [tri.id]: true } } });
    };

    // ToolIcon風のボタンを1つ作って使い回す
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.title = "三角形を追加";
    btn.setAttribute("aria-label", "三角形");
    btn.style.cssText = "width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;border-radius:8px;cursor:pointer;color:#1b1b1f;";
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 4 L21 20 L3 20 Z"/></svg>';
    btn.onmouseenter = () => { btn.style.background = "rgba(0,0,0,0.06)"; };
    btn.onmouseleave = () => { btn.style.background = "transparent"; };
    btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); addTriangle(); };

    const ensure = () => {
      if (root.querySelector("#" + BTN_ID)) return;
      // 実ツールボタン(data-testid="toolbar-…")を目印に、最後のツールの並びへ差し込む
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

  return null;
}
