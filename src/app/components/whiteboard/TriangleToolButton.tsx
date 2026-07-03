// Excalidraw標準ツールバー(.App-toolbar-content)に「三角形」ボタンをDOM注入する。
// Excalidrawは三角形プリミティブもツール追加APIも持たないため、ボタンで「三角形モード」を
// トグルし、キャンバス上のドラッグで四角ツールのように矩形を描いて三角形を作る（ENHA2-022）。
// モード中はキャンバス上に透明オーバーレイ(z-index:3)を敷いてドラッグを捕捉する。
// ツールバー(layer-ui, z-index:4)はオーバーレイより上なので、ボタン操作は妨げない。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { convertToExcalidrawElements, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";

const TRI_SIZE = 120;         // ドラッグせずクリックしただけの時の既定サイズ
const MIN_DRAG = 6;           // これ未満のドラッグはクリック扱い（既定サイズ）
const SOFT_BLACK = "#343a40";
const BTN_ID = "wb-triangle-tool";
const GUIDE = "#6965db";      // Excalidraw選択色に合わせたプレビュー色
const EQ_RATIO = Math.sqrt(3) / 2; // 正三角形の 高さ/底辺

// Shift拘束：始点からの矩形を「正三角形の外接矩形」(高さ=底辺×√3/2) にそろえた終点を返す。
// 四角のShift(正方形化)と同様、底辺は縦横ドラッグ量の大きい方を採用。
function constrainEnd(x0: number, y0: number, x1: number, y1: number) {
  const dx = x1 - x0, dy = y1 - y0;
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: x0 + (dx < 0 ? -1 : 1) * s, y: y0 + (dy < 0 ? -1 : 1) * s * EQ_RATIO };
}

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
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  armedRef.current = armed;
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const start = useRef<{ lx: number; ly: number; sx: number; sy: number } | null>(null);
  const lastLocal = useRef<{ lx: number; ly: number } | null>(null); // 最新ポインタ(ローカルpx)。Shift押下切替時の再描画用

  // ── ツールバーへボタン注入（DOM）。クリックで三角形モードをトグル。 ──
  useEffect(() => {
    const root = containerRef.current;
    if (!api || !root) return;

    const btn = document.createElement("button");
    btnRef.current = btn;
    btn.id = BTN_ID;
    btn.type = "button";
    btn.title = "三角形（ドラッグで描画）";
    btn.setAttribute("aria-label", "三角形");
    btn.style.cssText = "width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;border-radius:8px;cursor:pointer;color:#1b1b1f;";
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 4 L21 20 L3 20 Z"/></svg>';
    btn.onmouseenter = () => { if (!armedRef.current) btn.style.background = "rgba(0,0,0,0.06)"; };
    btn.onmouseleave = () => { if (!armedRef.current) btn.style.background = "transparent"; };
    btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); setArmed((a) => !a); };

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

  // ── モード中のボタン強調 / Esc解除 / 他ツール選択時の自動解除 ──
  useEffect(() => {
    const btn = btnRef.current;
    if (btn) btn.style.background = armed ? "#e0dfff" : "transparent";
    if (!armed) return;

    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setArmed(false); };
    window.addEventListener("keydown", onKey);
    // ドラッグ中に Shift を押し外ししたら、動かさなくてもプレビューを更新
    const onShift = (e: KeyboardEvent) => {
      if (e.key !== "Shift") return;
      const ll = lastLocal.current;
      if (start.current && ll) render(ll.lx, ll.ly, e.type === "keydown");
    };
    window.addEventListener("keydown", onShift);
    window.addEventListener("keyup", onShift);
    // 他のツールに切り替えられたらモード解除（オーバーレイが描画を妨げないように）
    const iv = window.setInterval(() => {
      try { if (api.getAppState().activeTool?.type !== "selection") setArmed(false); } catch { /* noop */ }
    }, 200);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onShift);
      window.removeEventListener("keyup", onShift);
      window.clearInterval(iv);
    };
  }, [armed, api]);

  // ── プレビュー用キャンバスのサイズ調整（モード中のみ存在） ──
  useLayoutEffect(() => {
    if (!armed) return;
    const container = containerRef.current, canvas = canvasRef.current;
    if (!container || !canvas) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth, h = container.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => ro.disconnect();
  }, [armed, containerRef]);

  const clearPreview = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) { const dpr = window.devicePixelRatio || 1; ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr); }
  };

  // ローカルpxで三角形プレビューを描く
  const drawPreview = (x0: number, y0: number, x1: number, y1: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    clearPreview();
    const left = Math.min(x0, x1), right = Math.max(x0, x1);
    const top = Math.min(y0, y1), bottom = Math.max(y0, y1);
    ctx.save();
    ctx.strokeStyle = GUIDE;
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo((left + right) / 2, top); // 頂点（上・中央）
    ctx.lineTo(right, bottom);           // 右下
    ctx.lineTo(left, bottom);            // 左下
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  };

  const toScene = (clientX: number, clientY: number) =>
    viewportCoordsToSceneCoords({ clientX, clientY }, api.getAppState());

  const onDown = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sc = toScene(e.clientX, e.clientY);
    start.current = { lx: e.clientX - rect.left, ly: e.clientY - rect.top, sx: sc.x, sy: sc.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  // 始点(ローカル)から現在ローカルまでをプレビュー。shift時は正三角形に拘束。
  const render = (curLx: number, curLy: number, shift: boolean) => {
    const s = start.current;
    if (!s) return;
    let ex = curLx, ey = curLy;
    if (shift) { const c = constrainEnd(s.lx, s.ly, curLx, curLy); ex = c.x; ey = c.y; }
    drawPreview(s.lx, s.ly, ex, ey);
  };

  const onMove = (e: React.PointerEvent) => {
    const s = start.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!s || !rect) return;
    const lx = e.clientX - rect.left, ly = e.clientY - rect.top;
    lastLocal.current = { lx, ly };
    render(lx, ly, e.shiftKey);
  };

  const onUp = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    lastLocal.current = null;
    clearPreview();
    if (!s) { setArmed(false); return; }
    const sc = toScene(e.clientX, e.clientY);
    let ex = sc.x, ey = sc.y;
    if (e.shiftKey) { const c = constrainEnd(s.sx, s.sy, sc.x, sc.y); ex = c.x; ey = c.y; }
    createTriangle(s.sx, s.sy, ex, ey);
    setArmed(false); // 1つ描いたら選択に戻る（Excalidraw標準ツールと同じ）
  };

  const createTriangle = (sx0: number, sy0: number, sx1: number, sy1: number) => {
    let x = Math.min(sx0, sx1), y = Math.min(sy0, sy1);
    let w = Math.abs(sx1 - sx0), h = Math.abs(sy1 - sy0);
    if (w < MIN_DRAG || h < MIN_DRAG) { // ほぼクリック → 既定サイズを中央に
      w = TRI_SIZE; h = TRI_SIZE; x = sx0 - w / 2; y = sy0 - h / 2;
    }
    const els = convertToExcalidrawElements([
      {
        type: "line",
        id: `wb_tri_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        x, y,
        points: [[w / 2, 0], [w, h], [0, h], [w / 2, 0]],
        roughness: 0, strokeWidth: 1, strokeColor: SOFT_BLACK, backgroundColor: "transparent",
      } as any,
    ], { regenerateIds: false }) as any[]; // wb_tri_ の id を保持（三角形判定のため）
    els.forEach((el) => { if (el.type === "line") normalizeLinear(el); });
    // コネクト追従（ENHA2-022）で三角形を識別するための印
    if (els[0]) els[0].customData = { ...(els[0].customData ?? {}), wbTriangle: true };
    api.updateScene({ elements: [...api.getSceneElements(), ...els] });
    const tri = els[0];
    if (tri) api.updateScene({ appState: { selectedElementIds: { [tri.id]: true } } });
  };

  if (!armed) return null;
  return (
    <div
      style={{ position: "absolute", inset: 0, zIndex: 3, cursor: "crosshair", pointerEvents: "auto", touchAction: "none" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
    </div>
  );
}
