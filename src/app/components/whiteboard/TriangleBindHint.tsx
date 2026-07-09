// コネクト可能ハイライト（ENHA2-022）。線・矢印の端点を図形（四角/楕円/ひし形/三角形）に
// 近づけたとき、その図形の外周に沿ったグレー枠を出す。接続は自前の customData 固定方式に
// 統一したため、全図形でこの自前ハイライトを描く。見た目は Excalidraw 標準(rgba(0,0,0,.05))に合わせる。
import { useEffect, useRef } from "react";
import { elementBBox, linearEndpoints, nearestPointOnPolyline, type Pt } from "@/app/lib/whiteboardSnap";
import { isConnectableShape, pickConnectTarget, shapeOutline } from "@/app/lib/whiteboardAutoConnect";

interface Props {
  api: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  canEdit: boolean;
}

const HL_COLOR = "rgba(0,0,0,0.05)"; // Excalidraw のバインドハイライトと同色
const HL_WIDTH = 8;                // ストローク幅(画面px)
const HL_PAD = 5;                  // 図形の外側へのはみ出し(画面px)
const DOT_COLOR = "#059669";       // 接続予定点のドット色（緑・アクセント）
const DOT_R = 4;                   // 接続予定点ドット半径(画面px)

const isLinear = (e: any) => e?.type === "line" || e?.type === "arrow";

// 図形の外周頂点(scene座標, 回転考慮, 閉じ重複は除去)。ハイライト描画に使う。
function shapeVertices(el: any): Pt[] {
  const b = elementBBox(el);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const a = el.angle || 0, s = Math.sin(a), c = Math.cos(a);
  let pts = shapeOutline(el);
  if (pts.length > 1) { const f = pts[0], l = pts[pts.length - 1]; if (f.x === l.x && f.y === l.y) pts = pts.slice(0, -1); }
  return pts.map((p) => {
    if (!a) return p;
    const dx = p.x - cx, dy = p.y - cy;
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  });
}

export function TriangleBindHint({ api, containerRef, canEdit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerDown = useRef(false);
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || !canEdit) return;
    const ctx = canvas.getContext("2d");

    const sceneToLocal = (sx: number, sy: number): Pt => {
      const st = api.getAppState();
      const rect = container.getBoundingClientRect();
      const zoom = st.zoom?.value ?? 1;
      return {
        x: sx * zoom + st.scrollX * zoom + (st.offsetLeft ?? 0) - rect.left,
        y: sy * zoom + st.scrollY * zoom + (st.offsetTop ?? 0) - rect.top,
      };
    };

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth, h = container.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);

    const clear = () => {
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    };

    // 接続予定の図形(el)の枠を薄グレーで、接続予定点(dot)を緑ドットで描く。
    const draw = (hits: { el: any; dot?: Pt }[]) => {
      if (!ctx) return;
      clear();
      ctx.save();
      ctx.lineJoin = "round";
      for (const { el, dot } of hits) {
        const verts = shapeVertices(el).map((v) => sceneToLocal(v.x, v.y));
        if (verts.length >= 3) {
          // 重心から外側へ少しはみ出させて“辺に沿った枠”にする（四角の枠と同じ薄グレー）
          const gx = verts.reduce((s, v) => s + v.x, 0) / verts.length;
          const gy = verts.reduce((s, v) => s + v.y, 0) / verts.length;
          const off = verts.map((v) => {
            const dx = v.x - gx, dy = v.y - gy, L = Math.hypot(dx, dy) || 1;
            return { x: v.x + (dx / L) * HL_PAD, y: v.y + (dy / L) * HL_PAD };
          });
          ctx.strokeStyle = HL_COLOR;
          ctx.lineWidth = HL_WIDTH;
          ctx.beginPath();
          ctx.moveTo(off[0].x, off[0].y);
          for (let i = 1; i < off.length; i++) ctx.lineTo(off[i].x, off[i].y);
          ctx.closePath();
          ctx.stroke();
        }
        if (dot) {
          // どの点に繋がるかを明示する接続予定点（密集セルでも狙いが分かる・BRU5-061）
          const p = sceneToLocal(dot.x, dot.y);
          ctx.fillStyle = DOT_COLOR;
          ctx.beginPath();
          ctx.arc(p.x, p.y, DOT_R, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    };

    const tick = () => {
      try {
        const st = api.getAppState();
        const els = api.getSceneElements();
        const shapes = els.filter((e: any) => isConnectableShape(e));
        if (shapes.length === 0) { clear(); rafId.current = requestAnimationFrame(tick); return; }

        // 操作中の線・矢印の端点を集める（描画中 / 端点編集中 / ドラッグ移動中）
        const cand: Pt[] = [];
        const ne = st.newElement;
        if (ne && isLinear(ne)) cand.push(...linearEndpoints(ne));
        if (pointerDown.current) {
          const ids = st.selectedElementIds || {};
          for (const e of els) if (ids[e.id] && isLinear(e) && !isConnectableShape(e)) cand.push(...linearEndpoints(e));
          const editId = st.editingLinearElement?.elementId;
          if (editId) { const ed = els.find((e: any) => e.id === editId); if (ed && isLinear(ed)) cand.push(...linearEndpoints(ed)); }
        }

        if (cand.length === 0) { clear(); }
        else {
          // 各端点について「実際に接続される1つ」だけを選び、その図形＋接続予定点を描く。
          // autoConnect と同一の pickConnectTarget を使うため、ハイライトと実接続が一致する（BRU5-061）。
          const hits = new Map<string, { el: any; dot?: Pt }>();
          for (const pt of cand) {
            const t = pickConnectTarget(pt, shapes);
            if (!t) continue;
            const dot = nearestPointOnPolyline(pt, shapeOutline(t));
            hits.set(t.id, { el: t, dot });
          }
          if (hits.size === 0) clear();
          else draw([...hits.values()]);
        }
      } catch { /* noop */ }
      rafId.current = requestAnimationFrame(tick);
    };

    const onDown = () => { pointerDown.current = true; };
    const onUp = () => { pointerDown.current = false; };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    rafId.current = requestAnimationFrame(tick);

    return () => {
      ro.disconnect();
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
    };
  }, [api, containerRef, canEdit]);

  return <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, zIndex: 4, pointerEvents: "none" }} />;
}
