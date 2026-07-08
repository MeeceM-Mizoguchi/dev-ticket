// テキストボックスの書式描画（背景色・枠線）。Excalidrawの text 要素は文字色(strokeColor)しか
// 持たず枠線/背景を描けないため、フレーム書式(FrameDecorLayer)と同じ自前オーバーレイ方式で描く。
// 書式は text.customData.wbTextBox = { border?, borderColor?, bg? } に保持（要素なのでYjsで同期）。
// 背景は文字の“背面”に描くため下層canvas(z-index:-1)へ、枠線は文字を囲むよう上層canvas(z-index:4)へ描く。
import { useEffect, useRef } from "react";
import { TEXT_BORDER_PAD } from "@/app/lib/whiteboardAutoConnect";

interface Props {
  api: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export interface WbTextBoxFormat { border?: boolean; borderColor?: string; bg?: string }

// 枠線・背景を持てるのは素のテキストボックスのみ（図形内ラベル=containerId ありは対象外）
export const isPlainTextBox = (e: any) => e?.type === "text" && !e?.isDeleted && !e?.containerId;
const RADIUS = 4;  // ほんの少しの角丸(画面px)
// 文字の外側への余白は scene単位（TEXT_BORDER_PAD）。接続の吸着位置(connectBBox)と一致させ、
// 枠線ちょうどに線・矢印の端点が貼り付くようにする（ズーム時もズレない）。

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

export function TextBoxDecorLayer({ api, containerRef }: Props) {
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
      const texts = api.getSceneElements().filter((e: any) => isPlainTextBox(e) && e.customData?.wbTextBox);
      for (const t of texts) {
        const fmt: WbTextBoxFormat = t.customData.wbTextBox;
        if (!fmt.border && !fmt.bg) continue;
        // 文字の外接矩形の中心を軸に、要素の回転(angle)へ合わせて枠/背景を描く
        const cx = toLocalX(t.x + (t.width ?? 0) / 2), cy = toLocalY(t.y + (t.height ?? 0) / 2);
        // 余白は scene単位でズームに追従（接続の connectBBox と同一基準）
        const halfW = ((t.width ?? 0) / 2 + TEXT_BORDER_PAD) * zoom, halfH = ((t.height ?? 0) / 2 + TEXT_BORDER_PAD) * zoom;
        const angle = t.angle || 0;
        if (fmt.bg && bgCtx) {
          bgCtx.save();
          bgCtx.translate(cx, cy);
          if (angle) bgCtx.rotate(angle);
          bgCtx.fillStyle = fmt.bg;
          roundRect(bgCtx, -halfW, -halfH, halfW * 2, halfH * 2, RADIUS);
          bgCtx.fill();
          bgCtx.restore();
        }
        if (fmt.border && lineCtx) {
          lineCtx.save();
          lineCtx.translate(cx, cy);
          if (angle) lineCtx.rotate(angle);
          lineCtx.strokeStyle = fmt.borderColor || "#343a40";
          lineCtx.lineWidth = 2;
          roundRect(lineCtx, -halfW + 0.5, -halfH + 0.5, halfW * 2, halfH * 2, RADIUS);
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
