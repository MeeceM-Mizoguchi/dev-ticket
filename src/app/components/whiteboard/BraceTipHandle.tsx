// 大括弧のトゲ（先っちょ）の位置を動かすつまみ（BRU9-042）。
// 括弧を1つだけ選ぶとトゲの上に緑のつまみが出て、括弧が伸びる方向へドラッグするとトゲが移動する。
// 位置は「括弧が伸びる方向の割合(0..1)」として customData.wbBrace.tip に持つので、
// その後のリサイズ・回転・反転でも比率が保たれる（点列の作り直しは whiteboardBrace が担当）。
//
// 履歴（BRU7-058）: つまみを掴んだら beginHistoryGesture でドラッグ中の更新を EVENTUALLY に溜め、
// 離したフレームで commitSceneToHistory を1回。これで1ドラッグ＝1 undo ステップになる。
import { useEffect, useRef } from "react";
import { viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import { elementBBox, isBrace } from "@/app/lib/whiteboardSnap";
import {
  braceAnchorPoints, braceDir, braceTip, isVerticalBrace, rebuiltBrace, retargetBraceTipAnchors,
  TIP_MAX, TIP_MIN, type BraceDir,
} from "@/app/lib/whiteboardBrace";
import { beginHistoryGesture, commitSceneToHistory, endHistoryGesture } from "@/app/lib/whiteboardHistory";

interface Props {
  api: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  canEdit: boolean;
}

const SIZE = 13;              // つまみの直径(px)
const COLOR = "#059669";      // 接続予定点と同じ緑（自前UIの色）

export function BraceTipHandle({ api, containerRef, canEdit }: Props) {
  const handleRef = useRef<HTMLDivElement>(null);
  const dragId = useRef<string | null>(null);

  useEffect(() => {
    if (!canEdit) return;
    const container = containerRef.current;
    const handle = handleRef.current;
    if (!container || !handle) return;
    let raf = 0;

    const sceneToLocal = (sx: number, sy: number) => {
      const st = api.getAppState();
      const rect = container.getBoundingClientRect();
      const zoom = st.zoom?.value ?? 1;
      return {
        x: sx * zoom + st.scrollX * zoom + (st.offsetLeft ?? 0) - rect.left,
        y: sy * zoom + st.scrollY * zoom + (st.offsetTop ?? 0) - rect.top,
      };
    };

    // 単独選択されている括弧を返す。新規描画/リサイズ/範囲選択/点編集中は出さない（操作の邪魔をしない）。
    // ※ 自分のドラッグ中は選択状態のままなので、そのまま追従して表示される。
    const targetBrace = (): any | null => {
      const st = api.getAppState();
      if (st.newElement || st.resizingElement || st.selectionElement || st.editingLinearElement) return null;
      if (!dragId.current && st.selectedElementsAreBeingDragged) return null;
      const sel = st.selectedElementIds || {};
      const ids = Object.keys(sel).filter((id) => sel[id]);
      if (ids.length !== 1) return null;
      const el = api.getSceneElements().find((e: any) => e.id === ids[0] && !e.isDeleted);
      return el && isBrace(el) ? el : null;
    };

    const position = () => {
      const el = targetBrace();
      if (!el) {
        handle.style.display = "none";
      } else {
        const tip = braceAnchorPoints(el)[0]; // 先頭がトゲ
        const p = sceneToLocal(tip.x, tip.y);
        handle.style.display = "block";
        handle.style.left = `${p.x}px`;
        handle.style.top = `${p.y}px`;
        // 括弧が伸びる方向にだけ動かせるので、その向きのカーソルを出す（回転は考慮しない）
        handle.style.cursor = isVerticalBrace(braceDir(el)) ? "ns-resize" : "ew-resize";
      }
      raf = requestAnimationFrame(position);
    };

    // ポインタ位置 → トゲ位置の割合(0..1)。回転している括弧でも掴んだ通りに動くよう、
    // 外接矩形の中心まわりに -angle 回して要素のローカル座標へ戻してから測る。
    const fracAt = (el: any, clientX: number, clientY: number): number => {
      const sc = viewportCoordsToSceneCoords({ clientX, clientY }, api.getAppState());
      const b = elementBBox(el);
      const a = el.angle || 0;
      let { x, y } = sc;
      if (a) {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2, s = Math.sin(-a), c = Math.cos(-a);
        const dx = x - cx, dy = y - cy;
        x = cx + dx * c - dy * s; y = cy + dx * s + dy * c;
      }
      const dir: BraceDir = braceDir(el);
      const f = isVerticalBrace(dir) ? (b.h ? (y - b.y) / b.h : 0.5) : (b.w ? (x - b.x) / b.w : 0.5);
      return Math.max(TIP_MIN, Math.min(TIP_MAX, f));
    };

    const apply = (clientX: number, clientY: number) => {
      const id = dragId.current;
      if (!id) return;
      const els = api.getSceneElements();
      const el = els.find((e: any) => e.id === id && !e.isDeleted);
      if (!el || !isBrace(el)) return;
      const dir = braceDir(el);
      const tip = fracAt(el, clientX, clientY);
      if (Math.abs(tip - braceTip(el)) < 1e-4) return;
      const patch = rebuiltBrace(el, dir, tip);
      if (!patch) return;
      let next = els.map((e: any) => (e.id === id ? patch : e));
      // トゲに繋がっている線・矢印のアンカーも一緒に動かす（取り残されないように）
      next = retargetBraceTipAnchors(next, id, dir, tip) ?? next;
      api.updateScene({ elements: next }); // ドラッグ中は履歴へ溜める（beginHistoryGesture 済み）
    };

    const onDown = (e: PointerEvent) => {
      const el = targetBrace();
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture?.(e.pointerId);
      dragId.current = el.id;
      beginHistoryGesture(); // 離すまでの中間状態は EVENTUALLY で溜める（BRU7-058）
    };
    const onMove = (e: PointerEvent) => {
      if (!dragId.current) return;
      e.preventDefault();
      apply(e.clientX, e.clientY);
    };
    const onUp = (e: PointerEvent) => {
      if (!dragId.current) return;
      apply(e.clientX, e.clientY);
      dragId.current = null;
      endHistoryGesture();
      commitSceneToHistory(api); // 1ドラッグ＝1 undo ステップとして確定
    };

    handle.addEventListener("pointerdown", onDown);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
    raf = requestAnimationFrame(position);
    return () => {
      cancelAnimationFrame(raf);
      handle.removeEventListener("pointerdown", onDown);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      if (dragId.current) { dragId.current = null; endHistoryGesture(); }
    };
  }, [api, canEdit, containerRef]);

  return (
    <div
      ref={handleRef}
      title="先っちょの位置を動かす"
      style={{
        position: "absolute", display: "none", zIndex: 21,
        width: SIZE, height: SIZE, marginLeft: -SIZE / 2, marginTop: -SIZE / 2,
        borderRadius: "50%", background: COLOR, border: "2px solid #fff",
        boxShadow: "0 1px 4px rgba(0,0,0,0.3)", pointerEvents: "auto", touchAction: "none",
      }}
    />
  );
}
