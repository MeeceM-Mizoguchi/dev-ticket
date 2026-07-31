// 四隅からの回転（BRU9-054）。
//
// 要望: 図形（特に三角形）を回したいとき、回転は選択枠の上に離れて出る1つのつまみしか無く狙いにくい。
//   四隅でもつかんで回せるようにしてほしい。
//
// 方式: Figma と同じ「四隅の**少し外側**が回転ゾーン」。四隅のつまみ自体は Excalidraw のリサイズの
//   ままなので、リサイズ機能を失わずに回転できる。ゾーンは選択枠と一緒に回り、ズームしても
//   画面上の大きさは一定（Excalidraw のハンドルと同じ感覚）。
//
//   ・回転は「つかんだ瞬間の角度差」を足していく方式（＝掴んだ位置が最初にワープしない）。
//     Shift 押下で 15°刻み（Excalidraw 標準の SHIFT_LOCKING_ANGLE と同じ）。
//   ・図形ラベル（バインドテキスト）は Excalidraw 本体の回転と同じく同じ角度へそろえる。
//     テキストボックスの背景板は syncTextBoxBgRects が angle を転写するので触らない。
//   ・1ドラッグ＝1 undo。中間フレームは beginHistoryGesture で EVENTUALLY に溜め、離した
//     フレームで commitSceneToHistory する（BRU7-058 の作法。TableResizeOverlay と同じ）。
//   ・表（セルの集合）・フレーム・2点だけの線は対象外（本体も回転枠を出さない／回すと壊れる）。
import { useEffect, useRef } from "react";
import { viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import { elementBBox, isLinearEl } from "@/app/lib/whiteboardSnap";
import { isTableCell } from "@/app/lib/whiteboardTable";
import { isTextBgRect } from "@/app/lib/whiteboardTextBoxBg";
import { isFrameDecorRect } from "@/app/lib/whiteboardFrameBg";
import { beginHistoryGesture, commitSceneToHistory } from "@/app/lib/whiteboardHistory";

interface Props {
  api: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  canEdit: boolean;
}

const ZONE = 22;          // 回転ゾーンの当たり幅（px・画面）
const OUT = 27;           // 四隅から斜め外側へのオフセット（px・画面）。四隅つまみ(最大16px)より外側
const MIN_BOX = 24;       // 選択枠がこれより小さく見えている時はゾーンを出さない（図形を覆ってしまう）
const SNAP = Math.PI / 12; // Shift 押下時の刻み（15°）
const TAU = Math.PI * 2;
const ACCENT = "#6965db"; // Excalidraw の選択色
const rand = () => Math.floor(Math.random() * 0x7fffffff);

// 四隅（中心からの符号）。tl, tr, bl, br の順。
const CORNERS: { sx: number; sy: number }[] = [
  { sx: -1, sy: -1 }, { sx: 1, sy: -1 }, { sx: -1, sy: 1 }, { sx: 1, sy: 1 },
];

// 回転させてよい要素か。
function rotatable(el: any): boolean {
  if (!el || el.isDeleted || el.locked) return false;
  if (el.type === "frame" || el.type === "magicframe") return false; // 本体も回転不可
  if (isTableCell(el) || isTextBgRect(el) || isFrameDecorRect(el)) return false; // 自前の派生要素は追従側
  if (el.type === "text" && el.containerId) return false;           // 図形ラベルは図形側で回す
  if (isLinearEl(el)) {
    if (el.elbowed) return false;                                   // 折れ矢印は本体も回転不可
    if (!Array.isArray(el.points) || el.points.length <= 2) return false; // 2点の線＝端点操作（回転枠が出ない）
  }
  return true;
}

type Drag = { id: string; cx: number; cy: number; startAngle: number; startPointer: number } | null;

export function CornerRotateOverlay({ api, containerRef, canEdit }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag>(null);

  useEffect(() => {
    if (!canEdit) return;
    const container = containerRef.current;
    const layer = layerRef.current;
    if (!container || !layer) return;

    const elById = (id: string) => (api.getSceneElements() as any[]).find((e) => e.id === id);

    // 回転対象（単独選択された回転可能な要素）。操作中・編集中・描画中は出さない。
    const readTarget = (): any | null => {
      const st = api.getAppState?.();
      if (!st) return null;
      if (st.newElement || st.isResizing || st.selectedElementsAreBeingDragged) return null;
      if (st.editingTextElement || st.editingLinearElement || st.editingGroupId) return null;
      if (st.activeTool?.type && st.activeTool.type !== "selection") return null;
      if (document.querySelector(".excalidraw-wysiwyg")) return null;
      const sel = st.selectedElementIds || {};
      const ids = Object.keys(sel).filter((id) => sel[id]);
      if (ids.length !== 1) return null; // 複数選択は本体の回転つまみに任せる
      const el = elById(ids[0]);
      return rotatable(el) ? el : null;
    };

    // 角度を反映（対象＋その図形ラベル）。中間フレームは EVENTUALLY で溜まる（guardApi）。
    const applyAngle = (id: string, angle: number) => {
      const els = api.getSceneElements() as any[];
      const el = els.find((e) => e.id === id);
      if (!el || Math.abs((el.angle || 0) - angle) < 1e-4) return;
      const labelId = (el.boundElements ?? []).find((b: any) => b?.type === "text")?.id;
      const next = els.map((e) =>
        e.id === id || (labelId && e.id === labelId)
          ? { ...e, angle, version: (e.version ?? 1) + 1, versionNonce: rand() }
          : e);
      api.updateScene({ elements: next });
    };

    const onDown = (e: PointerEvent) => {
      const el = readTarget();
      if (!el) return;
      e.preventDefault();
      e.stopPropagation(); // Excalidraw にドラッグ（＝リサイズ／選択解除）を始めさせない
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      const b = elementBBox(el);
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const p = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState());
      beginHistoryGesture();
      dragRef.current = {
        id: el.id, cx, cy,
        startAngle: el.angle || 0,
        startPointer: Math.atan2(p.y - cy, p.x - cx),
      };
    };

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const p = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState());
      // つかんだ位置からの角度差を足す（掴んだ瞬間に図形が飛ばない）
      let ang = d.startAngle + (Math.atan2(p.y - d.cy, p.x - d.cx) - d.startPointer);
      if (e.shiftKey) ang = Math.round(ang / SNAP) * SNAP;
      applyAngle(d.id, ((ang % TAU) + TAU) % TAU);
    };

    // 離したフレームで1回だけ履歴へ記録する（1ドラッグ＝1 undo ステップ・BRU7-058）
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      commitSceneToHistory(api);
    };

    // ゾーン（4つ）を作る。中身は控えめな回転アイコン（ホバーで濃くなる）。
    const zones = CORNERS.map(() => {
      const z = document.createElement("div");
      z.style.cssText = `position:absolute;width:${ZONE}px;height:${ZONE}px;box-sizing:border-box;`
        + `display:none;align-items:center;justify-content:center;border-radius:50%;`
        + `background:#fff;border:1px solid ${ACCENT};color:${ACCENT};`
        + `font-size:12px;line-height:1;opacity:0.5;pointer-events:auto;cursor:grab;z-index:1;`
        + `user-select:none;touch-action:none;`;
      z.textContent = "↻";
      z.title = "ドラッグで回転（Shift で15°刻み）";
      z.addEventListener("pointerdown", onDown);
      z.addEventListener("pointerenter", () => { z.style.opacity = "1"; });
      z.addEventListener("pointerleave", () => { z.style.opacity = "0.5"; });
      layer.appendChild(z);
      return z;
    });

    let raf = 0;
    const position = () => {
      raf = requestAnimationFrame(position);
      const d = dragRef.current;
      const el = d ? elById(d.id) : readTarget();
      const st = api.getAppState?.();
      if (!el || !st) { for (const z of zones) z.style.display = "none"; return; }

      const b = elementBBox(el);
      const zoom = st.zoom?.value ?? 1;
      if (b.w * zoom < MIN_BOX || b.h * zoom < MIN_BOX) { for (const z of zones) z.style.display = "none"; return; }

      const rect = container.getBoundingClientRect();
      const toLocalX = (sx: number) => sx * zoom + st.scrollX * zoom + (st.offsetLeft ?? 0) - rect.left;
      const toLocalY = (sy: number) => sy * zoom + st.scrollY * zoom + (st.offsetTop ?? 0) - rect.top;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const a = el.angle || 0, sa = Math.sin(a), ca = Math.cos(a);
      const diag = Math.SQRT1_2; // 斜め方向の単位ベクトル成分

      zones.forEach((z, i) => {
        const { sx, sy } = CORNERS[i];
        const dx = (sx * b.w) / 2, dy = (sy * b.h) / 2;
        // 図形と一緒に回る四隅（scene）→ 画面px。そこから斜め外側へ画面px で逃がす。
        const lx = toLocalX(cx + dx * ca - dy * sa);
        const ly = toLocalY(cy + dx * sa + dy * ca);
        const ux = (sx * ca - sy * sa) * diag;
        const uy = (sx * sa + sy * ca) * diag;
        z.style.display = "flex";
        z.style.left = `${lx + ux * OUT - ZONE / 2}px`;
        z.style.top = `${ly + uy * OUT - ZONE / 2}px`;
        z.style.cursor = d ? "grabbing" : "grab";
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    raf = requestAnimationFrame(position);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      layer.replaceChildren();
    };
  }, [api, containerRef, canEdit]);

  // ゾーン以外はクリックを透過（キャンバス操作を妨げない）
  return <div ref={layerRef} style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none" }} />;
}
