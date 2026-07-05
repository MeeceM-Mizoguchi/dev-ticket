import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

export interface Rect {
  top: string;
  left: string;
  width: string;
  height: string;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * 強調オーバーレイ（対象以外グレーアウト＋対象に赤枠）。静的。
 *
 * 推奨: target に CSS セレクタ（例 "[data-spot='login']"）を渡すと、
 * 自身の親（ScreenFrame の枠）内でその要素を探し、実際の位置を測って
 * 上下左右 pad px（既定3px）だけ余白を付けて囲む。複数マッチ時は内包する最小矩形。
 * → 手作業の座標合わせが不要になり、常に対象にぴったり＋一定余白で囲める。
 *
 * 後方互換: target を渡さず rect（% 指定）でも使える（LPモック流用時など）。
 */
export function Spotlight({
  target,
  rect,
  label,
  labelPos = "bottom",
  shape = "rect",
  pad = 3,
  dim = true,
}: {
  target?: string;
  rect?: Rect;
  label?: string;
  labelPos?: "top" | "bottom" | "left" | "right";
  shape?: "rect" | "circle";
  pad?: number;
  dim?: boolean; // false にすると周囲のグレーアウトを外し、赤枠のみ（結果画面を見せたいとき）
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);

  useLayoutEffect(() => {
    if (!target) return;
    // 自身のアンカーの親要素 = ScreenFrame の枠（position:relative）
    const frame = anchorRef.current?.parentElement as HTMLElement | null;
    if (!frame) return;
    let raf = 0;
    const measure = () => {
      const els = frame.querySelectorAll(target);
      if (!els.length) return;
      const fr = frame.getBoundingClientRect();
      if (fr.width === 0) {
        // レイアウト未確定なら次フレームで再計測
        raf = requestAnimationFrame(measure);
        return;
      }
      let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
      els.forEach((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        minL = Math.min(minL, r.left);
        minT = Math.min(minT, r.top);
        maxR = Math.max(maxR, r.right);
        maxB = Math.max(maxB, r.bottom);
      });
      setBox({
        left: minL - fr.left - pad,
        top: minT - fr.top - pad,
        width: maxR - minL + pad * 2,
        height: maxB - minT + pad * 2,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(frame);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [target, pad]);

  const labelBase: CSSProperties = {
    position: "absolute",
    background: "#EF4444",
    color: "#fff",
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1.3,
    padding: "4px 9px",
    borderRadius: 7,
    whiteSpace: "nowrap",
    boxShadow: "0 2px 8px rgba(239,68,68,0.35)",
    zIndex: 6,
  };
  const labelPosStyle: Record<string, CSSProperties> = {
    bottom: { top: "calc(100% + 7px)", left: "50%", transform: "translateX(-50%)" },
    top: { bottom: "calc(100% + 7px)", left: "50%", transform: "translateX(-50%)" },
    left: { right: "calc(100% + 7px)", top: "50%", transform: "translateY(-50%)" },
    right: { left: "calc(100% + 7px)", top: "50%", transform: "translateY(-50%)" },
  };
  const commonBorder: CSSProperties = {
    border: "2.5px solid #EF4444",
    borderRadius: shape === "circle" ? "50%" : 9,
    ...(dim ? { boxShadow: "0 0 0 9999px rgba(244,245,246,0.84)" } : null),
  };

  // target 指定: 自身のアンカーで枠を特定し、実測 px で囲む
  if (target) {
    return (
      <>
        <div ref={anchorRef} style={{ position: "absolute", top: 0, left: 0, width: 0, height: 0, pointerEvents: "none" }} />
        {box && (
          <div style={{ position: "absolute", top: box.top, left: box.left, width: box.width, height: box.height, pointerEvents: "none", zIndex: 5, ...commonBorder }}>
            {label && <div style={{ ...labelBase, ...labelPosStyle[labelPos] }}>{label}</div>}
          </div>
        )}
      </>
    );
  }

  // rect 指定（後方互換）: % 矩形を pad px 外へ広げて囲む
  if (!rect) return null;
  return (
    <div style={{ position: "absolute", top: rect.top, left: rect.left, width: rect.width, height: rect.height, pointerEvents: "none", zIndex: 5 }}>
      <div style={{ position: "absolute", inset: -pad, ...commonBorder }}>
        {label && <div style={{ ...labelBase, ...labelPosStyle[labelPos] }}>{label}</div>}
      </div>
    </div>
  );
}
