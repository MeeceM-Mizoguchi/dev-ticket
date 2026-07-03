// フレーム書式の描画（背景色・枠線）。Excalidraw標準フレームは塗り/枠色を持たないため自前描画する。
// 背景は内容の“背面”に描くため下層canvas(z-index:-1)へ、枠線は標準の枠に重ねるため上層canvas(z-index:4)へ描く。
// 書式は frame.customData.wbFrame = { bg?, border?, borderColor? } に保持（要素なのでYjsで同期される）。
import { useEffect, useRef } from "react";

interface Props {
  api: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export interface WbFrameFormat { bg?: string; border?: boolean; borderColor?: string }

const isFrame = (e: any) => e?.type === "frame" || e?.type === "magicframe";
const RADIUS = 8; // フレームの角丸に合わせる

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

export function FrameDecorLayer({ api, containerRef }: Props) {
  const bgRef = useRef<HTMLCanvasElement>(null);   // 背面（背景色）
  const lineRef = useRef<HTMLCanvasElement>(null); // 前面（枠線）
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const bg = bgRef.current, line = lineRef.current;
    if (!container || !bg || !line) return;
    const bgCtx = bg.getContext("2d");
    const lineCtx = line.getContext("2d");

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth, h = container.clientHeight;
      for (const c of [bg, line]) {
        c.width = Math.max(1, Math.round(w * dpr));
        c.height = Math.max(1, Math.round(h * dpr));
        c.style.width = `${w}px`;
        c.style.height = `${h}px`;
        c.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);

    const clear = (ctx: CanvasRenderingContext2D | null, c: HTMLCanvasElement) => {
      if (!ctx) return; const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, c.width / dpr, c.height / dpr);
    };

    const draw = () => {
      rafId.current = requestAnimationFrame(draw);
      const st = api.getAppState();
      const rect = container.getBoundingClientRect();
      const zoom = st.zoom?.value ?? 1;
      const toLocalX = (sx: number) => sx * zoom + st.scrollX * zoom + (st.offsetLeft ?? 0) - rect.left;
      const toLocalY = (sy: number) => sy * zoom + st.scrollY * zoom + (st.offsetTop ?? 0) - rect.top;

      clear(bgCtx, bg);
      clear(lineCtx, line);
      const frames = api.getSceneElements().filter((e: any) => isFrame(e) && !e.isDeleted && e.customData?.wbFrame);
      for (const f of frames) {
        const fmt: WbFrameFormat = f.customData.wbFrame;
        const x = toLocalX(f.x), y = toLocalY(f.y), w = f.width * zoom, h = f.height * zoom;
        if (fmt.bg && bgCtx) {
          bgCtx.save();
          bgCtx.fillStyle = fmt.bg;
          roundRect(bgCtx, x, y, w, h, RADIUS);
          bgCtx.fill();
          bgCtx.restore();
        }
        if (fmt.border && lineCtx) {
          lineCtx.save();
          lineCtx.strokeStyle = fmt.borderColor || "#343a40";
          lineCtx.lineWidth = 2;
          roundRect(lineCtx, x + 0.5, y + 0.5, w, h, RADIUS);
          lineCtx.stroke();
          lineCtx.restore();
        }
      }
    };
    rafId.current = requestAnimationFrame(draw);

    return () => {
      ro.disconnect();
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
    };
  }, [api, containerRef]);

  return (
    <>
      <canvas ref={bgRef} style={{ position: "absolute", inset: 0, zIndex: -1, pointerEvents: "none" }} />
      <canvas ref={lineRef} style={{ position: "absolute", inset: 0, zIndex: 4, pointerEvents: "none" }} />
    </>
  );
}
