// リンクで飛んできたオブジェクトを一時的に強調するハイライト層。
//
// 選択状態だけだと「どれのことか」が分かりづらいので、着地したオブジェクトの外周を
// 数秒だけパルス表示する。FrameHighlightLayer と同じ「container配下のcanvas＋rAF＋
// scene→画面座標変換」方式なので、直後にスクロール/ズームしても枠がズレない。
import { useEffect, useRef } from "react";
import { getCommonBounds } from "@excalidraw/excalidraw";

interface Props {
  api: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 強調したい要素ID群と、発火のたびに増える nonce（同じ対象へ再度飛んだ時も光らせるため） */
  target: { ids: string[]; nonce: number } | null;
}

const DURATION = 2400;   // 全体の表示時間(ms)
const PERIOD = 800;      // パルス1周期(ms)
const COLOR = "251, 146, 60"; // オレンジ（Excalidrawの選択青と区別できる色）

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

export function FocusPulseLayer({ api, containerRef, target }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const cv = canvasRef.current;
    if (!container || !cv || !target || target.ids.length === 0) return;

    const ctx = cv.getContext("2d");
    let raf = 0;
    const started = performance.now();

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
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, cv.width / dpr, cv.height / dpr);

      const elapsed = performance.now() - started;
      if (elapsed > DURATION) return; // 終了（rAFを積まない＝自然に停止）
      raf = requestAnimationFrame(draw);

      const ids = new Set(target.ids);
      const els = (api.getSceneElements() as any[]).filter((e) => ids.has(e.id) && !e.isDeleted);
      if (!els.length) return;

      const st = api.getAppState();
      const zoom = st.zoom?.value ?? 1;
      const rect = container.getBoundingClientRect();
      const toLocalX = (sx: number) => sx * zoom + st.scrollX * zoom + (st.offsetLeft ?? 0) - rect.left;
      const toLocalY = (sy: number) => sy * zoom + st.scrollY * zoom + (st.offsetTop ?? 0) - rect.top;

      const [x1, y1, x2, y2] = getCommonBounds(els as any);
      const pad = 8;
      const x = toLocalX(x1) - pad, y = toLocalY(y1) - pad;
      const w = (x2 - x1) * zoom + pad * 2, h = (y2 - y1) * zoom + pad * 2;

      // 0→1→0 を PERIOD ごとに繰り返しつつ、全体としてはフェードアウトさせる
      const wave = (Math.sin((elapsed / PERIOD) * Math.PI * 2 - Math.PI / 2) + 1) / 2;
      const fade = Math.max(0, 1 - elapsed / DURATION);
      const alpha = (0.35 + 0.55 * wave) * fade;

      ctx.save();
      ctx.strokeStyle = `rgba(${COLOR}, ${alpha})`;
      ctx.lineWidth = 3;
      ctx.shadowColor = `rgba(${COLOR}, ${alpha * 0.8})`;
      ctx.shadowBlur = 12;
      roundRect(ctx, x, y, w, h, 8);
      ctx.stroke();
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ctx?.clearRect(0, 0, cv.width, cv.height);
    };
  }, [api, containerRef, target]);

  if (!target) return null;
  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5 }}
    />
  );
}
