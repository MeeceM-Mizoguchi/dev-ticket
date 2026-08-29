// フレーム作成/変形中に「囲われる対象」を青枠でハイライトするガイド（BRU4-054）。
// Excalidraw標準のフレームハイライトが出ないため自前描画する。
// FrameDecorLayer と同じ座標変換(scene→画面)で、対象フレーム矩形に内包される各図形の
// 外接矩形を青い破線で囲う。作成中(appState.newElement がframe)を最優先で対象にする。
// コメントのピン（DOMオーバーレイ）は Excalidraw のシーンに居ないので、CommentLayer が
// 錨(data-wbc-anchor)に書いている“いまの位置”を読んで同じ破線で囲う。Yjs から読まないのは、
// フレームと一緒に動かしている最中の位置はまだ Yjs に書かれていない（指を離した時に1回だけ書く）ため。
import { useEffect, useRef } from "react";
import { isFrameDecorRect, DEFAULT_FRAME_BORDER } from "@/app/lib/whiteboardFrameBg";
import { COMMENT_PIN_SIZE } from "@/app/lib/whiteboardComments";

interface Props {
  api: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const isFrame = (e: any) => e?.type === "frame" || e?.type === "magicframe";
const RADIUS = 4;
const HL = "#4c9ffe"; // Excalidraw の選択色に近い青

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// フレーム矩形を正規化（ドラッグ方向で width/height が負になり得るため）。
function normRect(f: any): { x: number; y: number; width: number; height: number } {
  const x = Math.min(f.x, f.x + f.width);
  const y = Math.min(f.y, f.y + f.height);
  return { x, y, width: Math.abs(f.width), height: Math.abs(f.height) };
}

const isInside = (el: any, f: { x: number; y: number; width: number; height: number }) =>
  el.x >= f.x && el.y >= f.y && el.x + el.width <= f.x + f.width && el.y + el.height <= f.y + f.height;

// ハイライト対象のフレーム矩形。作成中(newElement)を最優先。選択中フレームの
// ドラッグ/リサイズ中も対象にする（対応環境のみ・フラグが無ければ作成中だけ）。
// newElement は指を離した後も appState に残ることがあり、そのまま描き続けると
// 「描いた時の枠」がゴーストとして残る（フレームが複製されたように見える）。
// 実際に押している間だけ作成中とみなす（holding）。
function activeFrameRect(st: any, elements: any[], holding: boolean) {
  const ne = holding ? st.newElement : null;
  if (ne && isFrame(ne)) return normRect(ne);
  const ids = st.selectedElementIds || {};
  const selFrames = elements.filter((e: any) => isFrame(e) && !e.isDeleted && ids[e.id]);
  const interacting = st.selectedElementsAreBeingDragged || st.resizingElement || st.draggingElement;
  if (selFrames.length === 1 && interacting) return normRect(selFrames[0]);
  return null;
}

export function FrameHighlightLayer({ api, containerRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafId = useRef<number | null>(null);
  const holding = useRef(false); // ポインタを押している間（＝いま描いている最中か）

  useEffect(() => {
    const down = () => { holding.current = true; };
    const up = () => { holding.current = false; };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const cv = canvasRef.current;
    if (!container || !cv) return;
    const ctx = cv.getContext("2d");

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth, h = container.clientHeight;
      cv.width = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(h * dpr));
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      cv.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);

    const draw = () => {
      rafId.current = requestAnimationFrame(draw);
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, cv.width / dpr, cv.height / dpr);

      const st = api.getAppState();
      const elements = api.getSceneElements();
      const frameRect = activeFrameRect(st, elements, holding.current);
      if (!frameRect) return; // フレーム作成/変形中でなければ何も描かない

      const rect = container.getBoundingClientRect();
      const zoom = st.zoom?.value ?? 1;
      const toLocalX = (sx: number) => sx * zoom + st.scrollX * zoom + (st.offsetLeft ?? 0) - rect.left;
      const toLocalY = (sy: number) => sy * zoom + st.scrollY * zoom + (st.offsetTop ?? 0) - rect.top;

      // フレーム新規作成中は、まだ装飾矩形が無く標準枠線も消しているため境界が見えない（BRU5-063）。
      // 作成中だけ枠の輪郭を既定グレーで描いて、どこまで囲うかを見えるようにする（離すと装飾矩形が引き継ぐ）。
      if (holding.current && st.newElement && isFrame(st.newElement)) {
        ctx.save();
        ctx.strokeStyle = DEFAULT_FRAME_BORDER;
        ctx.lineWidth = 2;
        const fx = toLocalX(frameRect.x), fy = toLocalY(frameRect.y);
        roundRect(ctx, fx, fy, frameRect.width * zoom, frameRect.height * zoom, 0); // 既定は角あり
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.strokeStyle = HL;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      for (const el of elements) {
        if (isFrame(el) || el.isDeleted) continue;
        if (isFrameDecorRect(el)) continue; // フレーム装飾の影矩形(BRU5-063)はハイライトしない
        if (el.id === st.newElement?.id) continue;
        if (!isInside(el, frameRect)) continue;
        const pad = 3; // 図形の少し外側を囲う
        const x = toLocalX(el.x) - pad, y = toLocalY(el.y) - pad;
        const w = el.width * zoom + pad * 2, h = el.height * zoom + pad * 2;
        roundRect(ctx, x, y, w, h, RADIUS);
        ctx.stroke();
      }
      // コメントピン（ENHA2-039）は Excalidraw 要素ではないので上のループに乗らない。
      // 同じ破線で囲って「このフレームに入る」ことを見せる（囲えるのに強調が出ない＝入らないと
      // 誤解させないため）。位置は錨の data-x/data-y ＝ CommentLayer が毎フレーム更新している
      // 現在位置を使う（フレームと一緒に動かしている最中も破線が置き去りにならない）。
      // ピンは画面上で固定サイズ・左下がコメント座標なので、寸法は zoom に依らない。
      const pad = 3;
      const pins = container.querySelectorAll<HTMLElement>("[data-wbc-pins] [data-wbc-anchor][data-id]");
      pins.forEach((pin) => {
        const sx = Number(pin.dataset.x);
        const sy = Number(pin.dataset.y);
        if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
        if (sx < frameRect.x || sx > frameRect.x + frameRect.width) return;
        if (sy < frameRect.y || sy > frameRect.y + frameRect.height) return;
        roundRect(ctx, toLocalX(sx) - pad, toLocalY(sy) - COMMENT_PIN_SIZE - pad,
          COMMENT_PIN_SIZE + pad * 2, COMMENT_PIN_SIZE + pad * 2, RADIUS);
        ctx.stroke();
      });
      ctx.restore();
    };
    rafId.current = requestAnimationFrame(draw);

    return () => {
      ro.disconnect();
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
    };
  }, [api, containerRef]);

  return <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none" }} />;
}
