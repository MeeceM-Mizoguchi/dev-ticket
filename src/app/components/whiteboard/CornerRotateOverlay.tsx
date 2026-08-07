// 四隅からの回転（BRU9-054）＋グループ対応（BRU10-044）。
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
//
// 【BRU10-044】モードを2つ持つ。
//   ・単体モード … 単独選択の要素を、その要素の中心で回す（従来）。
//     グループの中へ入って1つだけ選んだ状態（editingGroupId）でも出す。ここを弾いていたのが
//     「グループ化すると四隅のアイコンが出ない」の原因その1。
//   ・グループモード … 複数選択（＝グループ選択を含む）を、共通外接矩形の中心でまとめて回す。
//     選択枠は本体仕様どおり軸平行のままなので、ゾーンも回さずに四隅へ置く。
//     意味論は本体の rotateMultipleElements に合わせる。回転中心は **pointerdown 時点で凍結**
//     する（回すと共通bboxの中心自体が動くため、毎フレーム取り直すと図形が流れていく。本体も
//     pointerDownState.resize.center で凍結している）。
//
//   グループモードの要素種別ごとの扱い（この盤面固有の事情）:
//     ・コネクタ（三角形/大括弧/折れ矢印を除く線・矢印）は **angle ではなく点列を回す**。
//       自動接続まわり（anchorToPoint など）は「コネクタの angle は 0」前提で端点を scene 座標の
//       まま points へ書き戻すため、angle を付けると二重回転して矢印だけ明後日へ飛ぶ。
//       点列を回せば図形側の angle 回転と結果が一致し、追従パスと綱引きにならない。
//       手で打った折れ点（customData.wbVias・始点相対）も同じ角度だけ回す。
//     ・折れ矢印(elbow)は触らない（本体も回さない）。接続済みなら図形の移動に合わせて引き直される。
//     ・表のセル／フレームを含む選択はゾーンごと出さない。表は reflowTables が毎tick軸平行に
//       敷き直すので回しても戻される（表はセルが groupIds を共有する＝それ自体がグループなので、
//       素通しにすると「表を選ぶと回転アイコンが出て、回すと壊れる」事故になる）。
//       フレームは装飾矩形(syncFrameDecorRects)が軸平行前提で追従するため見た目が破綻する。
//     ・影矩形（テキスト背景・フレーム装飾）は対象外。angle は同期関数が親から転写する。
import { useEffect, useRef } from "react";
import { viewportCoordsToSceneCoords, getCommonBounds } from "@excalidraw/excalidraw";
import { elementBBox, isBrace, isLinearEl, isTriangle } from "@/app/lib/whiteboardSnap";
import { readVias } from "@/app/lib/whiteboardAutoConnect";
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
const norm = (a: number) => ((a % TAU) + TAU) % TAU;

// 点(x,y)を中心(cx,cy)まわりに a ラジアン回転
const rotPt = (x: number, y: number, cx: number, cy: number, a: number) => {
  const s = Math.sin(a), c = Math.cos(a);
  const dx = x - cx, dy = y - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
};

// 四隅（中心からの符号）。tl, tr, bl, br の順。
const CORNERS: { sx: number; sy: number }[] = [
  { sx: -1, sy: -1 }, { sx: 1, sy: -1 }, { sx: -1, sy: 1 }, { sx: 1, sy: 1 },
];

const isFrameLike = (el: any) => el?.type === "frame" || el?.type === "magicframe";
const isDerivedRect = (el: any) => isTextBgRect(el) || isFrameDecorRect(el);

// 回転させてよい要素か（単体モード）。
function rotatable(el: any): boolean {
  if (!el || el.isDeleted || el.locked) return false;
  if (isFrameLike(el)) return false;                                  // 本体も回転不可
  if (isTableCell(el) || isDerivedRect(el)) return false;             // 自前の派生要素は追従側
  if (el.type === "text" && el.containerId) return false;             // 図形ラベルは図形側で回す
  if (isLinearEl(el)) {
    if (el.elbowed) return false;                                     // 折れ矢印は本体も回転不可
    if (!Array.isArray(el.points) || el.points.length <= 2) return false; // 2点の線＝端点操作（回転枠が出ない）
  }
  return true;
}

// グループ回転で「実際に動かす」要素か（BRU10-044）。
// 単体モードと違い、2点の線（コネクタ）も一緒に運ぶ必要があるので除外しない。
function groupMovable(el: any): boolean {
  if (!el || el.isDeleted || el.locked) return false;
  if (isFrameLike(el)) return false;
  if (isTableCell(el) || isDerivedRect(el)) return false;
  if (el.type === "text" && el.containerId) return false;             // ラベルは容器側で運ぶ
  if (isLinearEl(el) && el.elbowed) return false;                     // 折れ矢印は触らない
  return true;
}

type Box = { x: number; y: number; w: number; h: number };

type Target =
  | { mode: "single"; el: any; box: Box; angle: number }
  | { mode: "group"; ids: string[]; movable: any[]; box: Box };

// pointerdown 時点で凍結する原本（原本→現在を毎回計算するので誤差が蓄積しない）
type Orig = {
  id: string;
  kind: "angle" | "points";
  x: number; y: number; angle: number;
  cx: number; cy: number;                                   // 要素の中心（scene）
  points: number[][] | null;                                // kind==="points" のときだけ
  vias: { dx: number; dy: number }[] | null;                // 手動の折れ点（始点相対）
  label: { id: string; x: number; y: number; angle: number } | null;
};

type Drag =
  | { mode: "single"; id: string; cx: number; cy: number; startAngle: number; startPointer: number }
  | { mode: "group"; ids: Set<string>; cx: number; cy: number; startPointer: number; origs: Orig[]; applied: number }
  | null;

export function CornerRotateOverlay({ api, containerRef, canEdit }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag>(null);

  useEffect(() => {
    if (!canEdit) return;
    const container = containerRef.current;
    const layer = layerRef.current;
    if (!container || !layer) return;

    const scene = (): any[] => api.getSceneElements() as any[];
    const elById = (id: string) => scene().find((e) => e.id === id);

    // 回転対象。操作中・編集中・描画中は出さない。
    // editingGroupId（グループの中に入っている）は妨げないこと（BRU10-044）。
    const readTarget = (): Target | null => {
      const st = api.getAppState?.();
      if (!st) return null;
      if (st.newElement || st.isResizing || st.isRotating || st.selectedElementsAreBeingDragged) return null;
      if (st.editingTextElement || st.editingLinearElement) return null;
      if (st.activeTool?.type && st.activeTool.type !== "selection") return null;
      if (document.querySelector(".excalidraw-wysiwyg")) return null;
      const sel = st.selectedElementIds || {};
      const els = scene().filter((e) => sel[e.id] && !e.isDeleted);
      if (els.length === 0) return null;

      if (els.length === 1) {
        const el = els[0];
        return rotatable(el) ? { mode: "single", el, box: elementBBox(el), angle: el.angle || 0 } : null;
      }
      // 複数選択（グループ選択を含む）。表・フレームが1つでも混じっていたら出さない。
      if (els.some((e) => isFrameLike(e) || isTableCell(e))) return null;
      const movable = els.filter(groupMovable);
      if (movable.length === 0) return null;
      // 選択枠（＝本体が描く軸平行の共通bbox）にゾーンを合わせる
      const [x1, y1, x2, y2] = getCommonBounds(els as any);
      return { mode: "group", ids: els.map((e) => e.id), movable, box: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } };
    };

    // 角度を反映（対象＋その図形ラベル）。中間フレームは EVENTUALLY で溜まる（guardApi）。
    const applyAngle = (id: string, angle: number) => {
      const els = scene();
      const el = els.find((e) => e.id === id);
      if (!el || Math.abs((el.angle || 0) - angle) < 1e-4) return;
      const labelId = (el.boundElements ?? []).find((b: any) => b?.type === "text")?.id;
      const next = els.map((e) =>
        e.id === id || (labelId && e.id === labelId)
          ? { ...e, angle, version: (e.version ?? 1) + 1, versionNonce: rand() }
          : e);
      api.updateScene({ elements: next });
    };

    // グループ回転の原本を取る
    const snapshot = (el: any, all: any[]): Orig => {
      const pts: number[][] | null = Array.isArray(el.points) && el.points.length >= 2
        ? el.points.map((p: number[]) => [p[0], p[1]]) : null;
      // コネクタ（三角形・大括弧を除く線/矢印）は点列を回す。既に angle を持つ線は保険として angle 回転。
      const kind: "angle" | "points" =
        pts && isLinearEl(el) && !isTriangle(el) && !isBrace(el) && !el.angle ? "points" : "angle";
      const b = elementBBox(el);
      const labelId = (el.boundElements ?? []).find((x: any) => x?.type === "text")?.id;
      const label = labelId ? all.find((e) => e.id === labelId && !e.isDeleted) : null;
      return {
        id: el.id, kind,
        x: el.x, y: el.y, angle: el.angle || 0,
        cx: b.x + b.w / 2, cy: b.y + b.h / 2,
        points: kind === "points" ? pts : null,
        vias: kind === "points" ? readVias(el.customData) : null,
        label: label ? { id: label.id, x: label.x, y: label.y, angle: label.angle || 0 } : null,
      };
    };

    // 選択全体を共通中心まわりに delta だけ回す（本体 rotateMultipleElements 相当）
    const applyGroup = (d: Extract<NonNullable<Drag>, { mode: "group" }>, delta: number) => {
      const s = Math.sin(delta), c = Math.cos(delta);
      const patch = new Map<string, any>();
      for (const o of d.origs) {
        const nc = rotPt(o.cx, o.cy, d.cx, d.cy, delta);
        const dx = nc.x - o.cx, dy = nc.y - o.cy;
        if (o.kind === "points" && o.points) {
          // 点列を scene 座標へ展開 → 共通中心まわりに回す → 先頭点基準へ戻す
          const abs = o.points.map((p) => rotPt(o.x + p[0], o.y + p[1], d.cx, d.cy, delta));
          const ox = abs[0].x, oy = abs[0].y;
          const np = abs.map((p) => [p.x - ox, p.y - oy]);
          const xs = np.map((p) => p[0]), ys = np.map((p) => p[1]);
          patch.set(o.id, {
            x: ox, y: oy, points: np,
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
            // 手動の折れ点は始点相対のベクトルなので、同じ角度だけ回す（BRU7-043 の保存形式）
            vias: o.vias?.length ? o.vias.map((v) => ({ dx: v.dx * c - v.dy * s, dy: v.dx * s + v.dy * c })) : null,
          });
          // 矢印のラベルは角度を持たない（本体も回さない）。位置だけ一緒に運ぶ。
          if (o.label) patch.set(o.label.id, { x: o.label.x + dx, y: o.label.y + dy });
        } else {
          patch.set(o.id, { x: o.x + dx, y: o.y + dy, angle: norm(o.angle + delta) });
          if (o.label) patch.set(o.label.id, { x: o.label.x + dx, y: o.label.y + dy, angle: norm(o.label.angle + delta) });
        }
      }
      const next = scene().map((e) => {
        const p = patch.get(e.id);
        if (!p) return e;
        const { vias, ...rest } = p;
        const merged: any = { ...e, ...rest, version: (e.version ?? 1) + 1, versionNonce: rand() };
        if (vias) merged.customData = { ...(e.customData ?? {}), wbVias: vias };
        return merged;
      });
      api.updateScene({ elements: next });
    };

    const onDown = (e: PointerEvent) => {
      const t = readTarget();
      if (!t) return;
      e.preventDefault();
      e.stopPropagation(); // Excalidraw にドラッグ（＝リサイズ／選択解除）を始めさせない
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      const cx = t.box.x + t.box.w / 2, cy = t.box.y + t.box.h / 2;
      const p = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState());
      const startPointer = Math.atan2(p.y - cy, p.x - cx);
      beginHistoryGesture(api);
      if (t.mode === "single") {
        dragRef.current = { mode: "single", id: t.el.id, cx, cy, startAngle: t.el.angle || 0, startPointer };
      } else {
        const all = scene();
        dragRef.current = {
          mode: "group", ids: new Set(t.ids), cx, cy, startPointer,
          origs: t.movable.map((el) => snapshot(el, all)), applied: 0,
        };
      }
    };

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const p = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState());
      // つかんだ位置からの角度差を足す（掴んだ瞬間に図形が飛ばない）
      const diff = Math.atan2(p.y - d.cy, p.x - d.cx) - d.startPointer;
      if (d.mode === "single") {
        let ang = d.startAngle + diff;
        if (e.shiftKey) ang = Math.round(ang / SNAP) * SNAP;
        applyAngle(d.id, norm(ang));
      } else {
        // グループは「差分角」を刻む（要素同士の相対角度が崩れない）
        let delta = diff;
        if (e.shiftKey) delta = Math.round(delta / SNAP) * SNAP;
        if (Math.abs(delta - d.applied) < 1e-4) return;
        d.applied = delta;
        applyGroup(d, delta);
      }
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
    const hide = () => { for (const z of zones) z.style.display = "none"; };

    let raf = 0;
    const position = () => {
      raf = requestAnimationFrame(position);
      const d = dragRef.current;
      const st = api.getAppState?.();
      if (!st) { hide(); return; }

      // ドラッグ中は「掴んだ対象」を見続ける（選択状態の揺れでゾーンが消えないように）。
      // グループ枠はドラッグ中も毎フレーム取り直す（回すと共通bboxが変わる＝本体つまみと同じ挙動）。
      let box: Box | null = null;
      let angle = 0;
      if (d?.mode === "single") {
        const el = elById(d.id);
        if (el) { box = elementBBox(el); angle = el.angle || 0; }
      } else if (d?.mode === "group") {
        const live = scene().filter((e) => d.ids.has(e.id) && !e.isDeleted);
        if (live.length) {
          const [x1, y1, x2, y2] = getCommonBounds(live as any);
          box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
        }
      } else {
        const t = readTarget();
        if (t) { box = t.box; angle = t.mode === "single" ? t.angle : 0; }
      }
      if (!box) { hide(); return; }

      const zoom = st.zoom?.value ?? 1;
      if (box.w * zoom < MIN_BOX || box.h * zoom < MIN_BOX) { hide(); return; }

      const rect = container.getBoundingClientRect();
      const toLocalX = (sx: number) => sx * zoom + st.scrollX * zoom + (st.offsetLeft ?? 0) - rect.left;
      const toLocalY = (sy: number) => sy * zoom + st.scrollY * zoom + (st.offsetTop ?? 0) - rect.top;
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      const sa = Math.sin(angle), ca = Math.cos(angle);
      const diag = Math.SQRT1_2; // 斜め方向の単位ベクトル成分

      zones.forEach((z, i) => {
        const { sx, sy } = CORNERS[i];
        const dx = (sx * box!.w) / 2, dy = (sy * box!.h) / 2;
        // 図形と一緒に回る四隅（scene）→ 画面px。そこから斜め外側へ画面px で逃がす。
        // グループモードは選択枠が回らない（angle=0）ので、そのまま四隅＋斜め外側になる。
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
