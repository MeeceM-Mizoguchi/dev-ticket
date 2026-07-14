// 図形ガイド層（ENHA2-022）。線・矢印の“実端点”を対象に、ドラッグ中は上下左右の
// 整列ガイド線を canvas に描画し、離した瞬間に最寄りアンカーへピッタリ揃える。
// Excalidraw 標準スナップ（図形の磁力感）はそのまま活かし、標準では扱えない
// 線・矢印の端点だけを本層が補う。React 再レンダーを避けるため描画は canvas へ命令的に行う。
import { useEffect, useRef } from "react";
import { anchorPoints, isLinearEl, isTriangle, linearEndpoints, solveSnap, type Pt } from "@/app/lib/whiteboardSnap";

interface Props {
  api: any; // ExcalidrawImperativeAPI
  containerRef: React.RefObject<HTMLDivElement | null>;
  canEdit: boolean;
}

const SNAP_PX = 8;            // スナップ発動距離（画面px）。多少の手ブレを吸収する。
const GUIDE_COLOR = "#e5484d"; // Figma風の赤系ガイド

interface Seg { x0: number; y0: number; x1: number; y1: number }

// 「位置|サイズ」の署名。位置差＝移動、サイズ差＝リサイズ/端点編集の判別に使う。
const sig = (el: any): string => `${el.x},${el.y}|${el.width}x${el.height}x${el.points?.length ?? 0}`;

export function SnapGuideLayer({ api, containerRef, canEdit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);              // ローカルのポインタ押下中か
  const pending = useRef<{ dx: number; dy: number } | null>(null); // 離した時に適用する補正
  const sizeSnap = useRef<Map<string, string> | null>(null);        // 移動/リサイズ判別用のサイズ記録
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || !canEdit) return;
    const ctx = canvas.getContext("2d");

    // scene座標 → canvas内ローカルpx（CursorChatLayer と同一の変換）
    const sceneToLocal = (sx: number, sy: number): Pt => {
      const st = api.getAppState();
      const rect = container.getBoundingClientRect();
      const zoom = st.zoom?.value ?? 1;
      const pageX = sx * zoom + st.scrollX * zoom + (st.offsetLeft ?? 0);
      const pageY = sy * zoom + st.scrollY * zoom + (st.offsetTop ?? 0);
      return { x: pageX - rect.left, y: pageY - rect.top };
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth, h = container.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const clear = () => {
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    };

    const drawGuides = (segs: Seg[], marks: Pt[]) => {
      if (!ctx) return;
      clear();
      ctx.save();
      ctx.strokeStyle = GUIDE_COLOR;
      ctx.fillStyle = GUIDE_COLOR;
      ctx.lineWidth = 1;
      for (const s of segs) {
        const a = sceneToLocal(s.x0, s.y0), b = sceneToLocal(s.x1, s.y1);
        ctx.beginPath();
        ctx.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5);
        ctx.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5);
        ctx.stroke();
      }
      // 揃った点に小さな × マーカー（Figma風）
      const r = 3.5;
      for (const p of marks) {
        const q = sceneToLocal(p.x, p.y);
        ctx.beginPath();
        ctx.moveTo(q.x - r, q.y - r); ctx.lineTo(q.x + r, q.y + r);
        ctx.moveTo(q.x + r, q.y - r); ctx.lineTo(q.x - r, q.y + r);
        ctx.stroke();
      }
      ctx.restore();
    };

    // 現在の選択のうち線・矢印を返す
    const selectedLinears = (): any[] => {
      const ids = api.getAppState().selectedElementIds || {};
      // 三角形は図形扱い（端点スナップの対象外。標準の外接矩形スナップに任せる）
      return api.getSceneElements().filter((el: any) => ids[el.id] && !el.isDeleted && isLinearEl(el) && !isTriangle(el));
    };

    const compute = () => {
      rafId.current = null;
      const st = api.getAppState();
      // 選択ツール以外（描画中・パン中など）や折れ線編集中は対象外
      if (st.activeTool?.type !== "selection" || st.editingLinearElement) { pending.current = null; clear(); return; }
      const linears = selectedLinears();
      if (linears.length === 0) { pending.current = null; clear(); return; }

      // 移動/リサイズ判別用に、ドラッグ開始時のサイズを一度だけ記録
      const ids = st.selectedElementIds || {};
      if (!sizeSnap.current) {
        const m = new Map<string, string>();
        for (const el of api.getSceneElements()) {
          if (ids[el.id]) m.set(el.id, sig(el));
        }
        sizeSnap.current = m;
      }

      const dragPts: Pt[] = linears.flatMap((el) => linearEndpoints(el));
      const anchors: Pt[] = api.getSceneElements()
        .filter((el: any) => !ids[el.id] && !el.isDeleted && !el.customData?.wbBgFor && !el.customData?.wbFrameBg) // 影矩形(BRU5-062/063)は整列対象外
        .flatMap((el: any) => anchorPoints(el));
      if (dragPts.length === 0 || anchors.length === 0) { pending.current = null; clear(); return; }

      const zoom = st.zoom?.value ?? 1;
      const r = solveSnap(dragPts, anchors, SNAP_PX / zoom);
      pending.current = r.dx || r.dy ? { dx: r.dx, dy: r.dy } : null;

      const segs: Seg[] = [];
      if (r.vLine) segs.push({ x0: r.vLine.x, y0: r.vLine.y0, x1: r.vLine.x, y1: r.vLine.y1 });
      if (r.hLine) segs.push({ x0: r.hLine.x0, y0: r.hLine.y, x1: r.hLine.x1, y1: r.hLine.y });
      if (segs.length === 0) { clear(); return; }
      drawGuides(segs, r.marks);
    };

    const onDown = () => { dragging.current = true; pending.current = null; sizeSnap.current = null; };

    const onMove = () => {
      if (!dragging.current) return;
      if (rafId.current != null) return; // 1フレーム1回に間引く
      rafId.current = requestAnimationFrame(compute);
    };

    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (rafId.current != null) { cancelAnimationFrame(rafId.current); rafId.current = null; }
      const snap = pending.current; pending.current = null;
      const sizes = sizeSnap.current; sizeSnap.current = null;
      clear();
      if (!snap) return;

      // 剛体移動のときだけ補正する。リサイズ/端点編集（サイズ・点数が変化）や、
      // パン等で実際には要素が動いていない場合（位置が不変）はスキップ。
      const ids = api.getAppState().selectedElementIds || {};
      const els = api.getSceneElements();
      if (sizes) {
        let movedAny = false;
        for (const el of els) {
          if (!ids[el.id]) continue;
          const before = sizes.get(el.id);
          if (before == null) continue;
          const [pos0, size0] = before.split("|");
          const [pos1, size1] = sig(el).split("|");
          if (size0 !== size1) return;      // リサイズ/端点編集 → 補正しない
          if (pos0 !== pos1) movedAny = true; // 位置が動いた選択要素あり
        }
        if (!movedAny) return; // 実移動なし（パン/クリックのみ）
      }
      // 選択要素全体を剛体的に (dx,dy) 平行移動して端点をアンカーへピッタリ揃える。
      // version を上げて Yjs ブリッジ（version 比較）に確実に伝播させる。
      const moved = els.map((el: any) =>
        ids[el.id]
          ? { ...el, x: el.x + snap.dx, y: el.y + snap.dy, version: (el.version || 0) + 1, versionNonce: ((el.versionNonce || 0) + 1) | 0 }
          : el);
      // Excalidraw 自身の pointerup 処理が終わってから反映する（ドラッグ確定との競合回避）
      requestAnimationFrame(() => api.updateScene({ elements: moved }));
    };

    // Excalidraw が stopPropagation してもドラッグを取りこぼさないよう capture 段階で拾う
    const opt = { capture: true } as const;
    window.addEventListener("pointerdown", onDown, opt);
    window.addEventListener("pointermove", onMove, opt);
    window.addEventListener("pointerup", onUp, opt);
    window.addEventListener("pointercancel", onUp, opt);
    return () => {
      ro.disconnect();
      window.removeEventListener("pointerdown", onDown, opt);
      window.removeEventListener("pointermove", onMove, opt);
      window.removeEventListener("pointerup", onUp, opt);
      window.removeEventListener("pointercancel", onUp, opt);
      if (rafId.current != null) cancelAnimationFrame(rafId.current);
    };
  }, [api, containerRef, canEdit]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, zIndex: 4, pointerEvents: "none" }}
    />
  );
}
