// Excalidraw標準ツールバー(.App-toolbar-content)に「大括弧」ボタンをDOM注入する（BRU9-042）。
// Excalidrawは括弧プリミティブもツール追加APIも持たないため、TriangleToolButton と同じ方式で
// 「大括弧モード」をトグルし、キャンバス上のドラッグで四角ツールのように矩形を描いて括弧を作る。
// モード中はキャンバス上に透明オーバーレイ(z-index:3)を敷いてドラッグを捕捉する。
// ツールバー(layer-ui, z-index:4)はオーバーレイより上なので、ボタン操作は妨げない。
//
// 括弧の形（点列）と接続点の定義は whiteboardBrace.ts にある。リサイズ後の形の作り直しは
// normalizeBraces（WhiteboardCanvas の onChange から毎tick呼ばれる）が担当する。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { convertToExcalidrawElements, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import { bracePoints, type BraceDir } from "@/app/lib/whiteboardBrace";
import { COMMIT } from "@/app/lib/whiteboardHistory";

const DIR: BraceDir = "left";   // 作成時はトゲが左を向く `{`。他の向きは標準の回転ハンドルで作る
const DEF_H = 180;              // ドラッグせずクリックしただけの時の既定サイズ（高さ）
const DEPTH_RATIO = 0.25;       // 括弧の「深さ(幅)」/「高さ」の標準比。Shift拘束と既定サイズに使う
const MIN_DRAG = 6;             // これ未満のドラッグはクリック扱い（既定サイズ）
const SOFT_BLACK = "#343a40";
const BTN_ID = "wb-brace-tool";
const GUIDE = "#6965db";        // Excalidraw選択色に合わせたプレビュー色
// 他の自前ツール（TriangleToolButton）と同時にモードONにならないようにするイベント名。
// 両ファイルで同じ文字列を使う。detail は自分のツール名を入れ、他人のイベントを受けたら解除する。
const ARM_EVENT = "wb-tool-armed";

// ボタンのアイコンは実際に作られる点列から生成する（形を直したのにアイコンだけ古い、を起こさない）。
// 24x24 のviewBox内に 10x18 の括弧を置く。
const ICON_PATH = bracePoints(10, 18, DIR)
  .map((p, i) => `${i ? "L" : "M"}${(p[0] + 7).toFixed(1)} ${(p[1] + 3).toFixed(1)}`).join("");

// Shift拘束：始点からの矩形を「標準比率の括弧の外接矩形」(幅=高さ×DEPTH_RATIO) にそろえた終点を返す。
// 高さを基準にするが、横に大きくドラッグした場合もその深さを満たす高さへ広げる。
function constrainEnd(x0: number, y0: number, x1: number, y1: number) {
  const dx = x1 - x0, dy = y1 - y0;
  const s = Math.max(Math.abs(dy), Math.abs(dx) / DEPTH_RATIO);
  return { x: x0 + (dx < 0 ? -1 : 1) * s * DEPTH_RATIO, y: y0 + (dy < 0 ? -1 : 1) * s };
}

// convertToExcalidrawElements は線形要素の points[0] を [0,0] にしないため、生成後に再正規化する
// （Excalidrawの「正規化」要件を満たさないと not normalized エラー/座標破壊を招く）。
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

export function BraceToolButton({ api, containerRef }: { api: any; containerRef: React.RefObject<HTMLDivElement | null> }) {
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  armedRef.current = armed;
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const start = useRef<{ lx: number; ly: number; sx: number; sy: number } | null>(null);
  const lastLocal = useRef<{ lx: number; ly: number } | null>(null); // 最新ポインタ(ローカルpx)。Shift押下切替時の再描画用

  // ── ツールバーへボタン注入（DOM）。クリックで大括弧モードをトグル。 ──
  useEffect(() => {
    const root = containerRef.current;
    if (!api || !root) return;

    const btn = document.createElement("button");
    btnRef.current = btn;
    btn.id = BTN_ID;
    btn.type = "button";
    btn.title = "大括弧（ドラッグで描画 / Shiftで標準比率）";
    btn.setAttribute("aria-label", "大括弧");
    btn.style.cssText = "width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;border-radius:8px;cursor:pointer;color:#1b1b1f;";
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON_PATH}"/></svg>`;
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

  // ── 他の自前ツールがモードONになったら自分は解除（二重にオーバーレイが敷かれるのを防ぐ） ──
  useEffect(() => {
    const onOther = (e: Event) => { if ((e as CustomEvent).detail !== "brace") setArmed(false); };
    window.addEventListener(ARM_EVENT, onOther);
    return () => window.removeEventListener(ARM_EVENT, onOther);
  }, []);

  // ── モード中のボタン強調 / Esc解除 / 他ツール選択時の自動解除 ──
  useEffect(() => {
    const btn = btnRef.current;
    if (btn) btn.style.background = armed ? "#e0dfff" : "transparent";
    if (!armed) return;
    window.dispatchEvent(new CustomEvent(ARM_EVENT, { detail: "brace" })); // 他の自前ツールを解除させる

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

  // ローカルpxで括弧プレビューを描く（実際に作られる点列と同じ計算を使う）
  const drawPreview = (x0: number, y0: number, x1: number, y1: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    clearPreview();
    const left = Math.min(x0, x1), top = Math.min(y0, y1);
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    if (w < 1 || h < 1) return;
    const pts = bracePoints(w, h, DIR);
    ctx.save();
    ctx.strokeStyle = GUIDE;
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(left + pts[0][0], top + pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(left + pts[i][0], top + pts[i][1]);
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

  // 始点(ローカル)から現在ローカルまでをプレビュー。shift時は標準比率に拘束。
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
    createBrace(s.sx, s.sy, ex, ey);
    setArmed(false); // 1つ描いたら選択に戻る（Excalidraw標準ツールと同じ）
  };

  const createBrace = (sx0: number, sy0: number, sx1: number, sy1: number) => {
    let x = Math.min(sx0, sx1), y = Math.min(sy0, sy1);
    let w = Math.abs(sx1 - sx0), h = Math.abs(sy1 - sy0);
    if (w < MIN_DRAG || h < MIN_DRAG) { // ほぼクリック → 既定サイズを中央に
      h = DEF_H; w = Math.round(DEF_H * DEPTH_RATIO);
      x = sx0 - w / 2; y = sy0 - h / 2;
    }
    // 線の色・太さ・線種は「次に描く要素」の設定を引き継ぐ（塗りは開いた曲線なので必ず透明）
    let st: any = null;
    try { st = api.getAppState(); } catch { /* noop */ }
    const els = convertToExcalidrawElements([
      {
        type: "line",
        id: `wb_brace_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        x, y,
        points: bracePoints(w, h, DIR),
        roughness: 0, // 手描き風にすると括弧の弧が波打って読めないため常に 0
        roundness: null,
        strokeWidth: st?.currentItemStrokeWidth ?? 1,
        strokeStyle: st?.currentItemStrokeStyle,
        strokeColor: st?.currentItemStrokeColor ?? SOFT_BLACK,
        backgroundColor: "transparent",
      } as any,
    ], { regenerateIds: false }) as any[]; // wb_brace_ の id を保持（括弧判定の保険）
    els.forEach((el) => { if (el.type === "line") normalizeLinear(el); });
    // 図形として扱う印（コネクト対象・点編集の無効化・点列の作り直しの判定に使う）
    if (els[0]) els[0].customData = { ...(els[0].customData ?? {}), wbBrace: { dir: DIR } };
    // 括弧の追加は 1 undo ステップとして記録する（BRU7-058）
    api.updateScene({ elements: [...api.getSceneElements(), ...els], ...COMMIT });
    const brace = els[0];
    if (brace) api.updateScene({ appState: { selectedElementIds: { [brace.id]: true } } });
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
