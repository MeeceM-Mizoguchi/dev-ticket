// 表（BRU5-042）の手動リサイズ用オーバーレイ。
// 表を選択している間、次のドラッグ用つまみを重ねる:
//   ・列の境界（縦の区切り）→ 列幅変更（customData.wbTable.cw）
//   ・行の境界（横の区切り）→ 行高変更（customData.wbTable.rh）
//   ・四隅（コーナー）→ 表全体のリサイズ。Shiftで縦横比固定、Shift無しで縦横自由に伸縮。
//   ・上端／左端の外側の「ヘッダー帯」→ 列・行を丸ごと選択（BRU9-039-2）。
// つまみをダブルクリックすると、その列/行を自動フィット（手動値クリア）に戻す。
// いずれも手動値を書き込むと reflowTables が隙間なくタイルし直す。
// 座標変換は他オーバーレイ（FrameHighlightLayer 等）と同じ scene→ローカル画面px。
//
// 複数列・複数行の一括調整（BRU9-039-2）:
//   セルはグループなので1クリックでは表全体が選ばれ、「列を選ぶ」手段が無かった。そこで Excel と同じ
//   ヘッダー帯を出し、クリック／ドラッグ／Shift+クリック／Ctrl+クリックで列・行を丸ごと選べるようにする。
//   選択中の列（行）の境界をドラッグすると、選択中の全列（全行）が同じ幅（高さ）になる。
//   ダブルクリックも同様に選択全体へ効く。対象の決定は resolveSizeTargets が一手に引き受ける
//   （表全体選択のときは従来どおり1本だけ動く＝既存挙動を壊さない）。
import { useEffect, useRef } from "react";
import { viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import {
  selectedTableId, tableLayout,
  applyTableSizes, resolveSizeTargets, bulkSizeTargets, selectTableAxis, tableAxisSel,
} from "@/app/lib/whiteboardTable";
import { beginHistoryGesture, commitSceneToHistory } from "@/app/lib/whiteboardHistory";

interface Props {
  api: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  canEdit: boolean;
}

const MIN_COL_W = 40;
const MIN_ROW_H = 32;
const GRIP = 8;               // 列/行つまみの当たり幅（px・画面）
const CORNER = 28;            // コーナーつまみの当たり幅（Excalidraw の四隅ハンドルに重ねて捕捉する）
const BAND = 16;              // ヘッダー帯の太さ（px・画面。ズームしても一定）
const BAND_GAP = 3;           // 表とヘッダー帯のすき間（px・画面）
const BAND_EDGE = 4;          // 帯の中で「区切り＝リサイズ」として扱う端の幅（px・画面）
const ACCENT = "#6965db";     // Excalidraw の選択色
const BAND_BG = "#f1f3f5";
const BAND_HOVER = "#dee2e6";

type Corner = "tl" | "tr" | "bl" | "br";
type Drag =
  | { kind: "col"; index: number; tid: string; startClient: number; startSize: number; targets: number[]; k: number }
  | { kind: "row"; index: number; tid: string; startClient: number; startSize: number; targets: number[]; k: number }
  | { kind: "corner"; corner: Corner; tid: string; startCX: number; startCY: number;
      baseOx: number; baseOy: number; baseW: number; baseH: number; baseColW: number[]; baseRowH: number[] }
  | null;
// ヘッダー帯のドラッグ（範囲選択）中の状態。anchor から last までを選び続ける。
type BandDrag = { kind: "col" | "row"; tid: string; anchor: number; last: number } | null;

const rangeOf = (a: number, b: number) => {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
};

export function TableResizeOverlay({ api, containerRef, canEdit }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag>(null);
  const bandRef = useRef<BandDrag>(null);
  // Shift+クリックの基点。ヘッダー帯を普通にクリックした時だけ張り直す（Shift で往復しても基点が動かない）。
  const anchorRef = useRef<{ tid: string; kind: "col" | "row"; index: number } | null>(null);
  const structRef = useRef<string>(""); // 現在描画中のつまみ構成（tid:C:R）

  useEffect(() => {
    if (!canEdit) return;
    const container = containerRef.current;
    const layer = layerRef.current;
    if (!container || !layer) return;

    let raf = 0;

    // 現在の表レイアウト（tid・シーン要素・原点・列幅/行高）を取得。無ければ null。
    const readLayout = () => {
      const tid = selectedTableId(api);
      if (!tid) return null;
      const els = api.getSceneElements();
      const lay = tableLayout(els, tid);
      return lay ? { tid, els, ...lay } : null;
    };

    // コーナードラッグ: 各列幅/行高を基準サイズから比率で拡大縮小し、手動値として全セルへ焼き込む。
    // Shift=縦横比固定（両軸同率）、Shift無し=縦横独立。原点は対角コーナーを固定して算出。
    const applyCorner = (d: Extract<Drag, { kind: "corner" }>, ev: PointerEvent) => {
      const zoom = api.getAppState().zoom?.value ?? 1;
      const dx = (ev.clientX - d.startCX) / zoom;
      const dy = (ev.clientY - d.startCY) / zoom;
      const L = d.baseOx, T = d.baseOy, Rr = d.baseOx + d.baseW, B = d.baseOy + d.baseH;
      const minW = d.baseColW.length * MIN_COL_W, minH = d.baseRowH.length * MIN_ROW_H;
      // ドラッグ中コーナーに応じた自由サイズ
      let newW = d.corner === "br" || d.corner === "tr" ? d.baseW + dx : d.baseW - dx;
      let newH = d.corner === "br" || d.corner === "bl" ? d.baseH + dy : d.baseH - dy;
      newW = Math.max(minW, newW); newH = Math.max(minH, newH);
      let sx = newW / d.baseW, sy = newH / d.baseH;
      if (ev.shiftKey) {
        let s = Math.max(sx, sy);                       // 縦横比固定: 大きい方の倍率にそろえる
        if (d.baseW * s < minW || d.baseH * s < minH) s = Math.max(minW / d.baseW, minH / d.baseH);
        sx = s; sy = s; newW = d.baseW * s; newH = d.baseH * s;
      }
      // 原点（左上）= 対角の固定コーナーから新サイズを差し引いて算出
      const nox = d.corner === "tl" || d.corner === "bl" ? Rr - newW : L;
      const noy = d.corner === "tl" || d.corner === "tr" ? B - newH : T;
      const cw = d.baseColW.map((w) => Math.max(MIN_COL_W, Math.round(w * sx)));
      const rh = d.baseRowH.map((h) => Math.max(MIN_ROW_H, Math.round(h * sy)));
      const els = api.getSceneElements();
      const next = els.map((e: any) => {
        const t = e?.customData?.wbTable;
        if (!t || t.tid !== d.tid) return e;
        const patch: any = { ...e, customData: { ...e.customData, wbTable: { ...t, cw: cw[t.c], rh: rh[t.r] } } };
        if (t.r === 0 && t.c === 0) { patch.x = nox; patch.y = noy; } // 原点セルのみ移動（reflowが残りをタイル）
        return patch;
      });
      api.updateScene({ elements: next });
    };

    // 境界ドラッグの開始。対象（単一 or 選択中の全列/全行）をここで確定する。
    // k = 対象のうち「掴んだ境界より手前にあるもの」の本数。対象が k 本あると境界は k 倍動いてしまうため、
    // 後段でカーソル移動量を k で割り、掴んだ境界がカーソルにぴたりと追従するようにする。
    const startResize = (kind: "col" | "row", index: number, e: PointerEvent, layout: NonNullable<ReturnType<typeof readLayout>>) => {
      const targets = resolveSizeTargets(api, layout.tid, kind, index);
      beginHistoryGesture(); // 離すまでの中間状態は EVENTUALLY で溜める（BRU7-058）
      dragRef.current = {
        kind, index, tid: layout.tid, targets,
        k: Math.max(1, targets.filter((i) => i <= index).length),
        startClient: kind === "col" ? e.clientX : e.clientY,
        startSize: kind === "col" ? layout.colW[index] : layout.rowH[index],
      };
    };

    // ヘッダー帯のクリック: 単独選択 / Shift=範囲 / Ctrl・⌘=トグル追加。
    const startBandSelect = (kind: "col" | "row", index: number, e: PointerEvent, tid: string) => {
      const cur = tableAxisSel(api);
      const anchor = anchorRef.current;
      if (e.shiftKey && anchor && anchor.tid === tid && anchor.kind === kind) {
        selectTableAxis(api, tid, kind, rangeOf(anchor.index, index));  // 基点は動かさない
        bandRef.current = { kind, tid, anchor: anchor.index, last: index };
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const set = new Set(cur && cur.tid === tid && cur.kind === kind ? cur.indices : []);
        if (set.has(index)) set.delete(index); else set.add(index);
        selectTableAxis(api, tid, kind, set.size ? [...set] : [index]);  // 全解除にはしない
        anchorRef.current = { tid, kind, index };
        bandRef.current = null;                                          // トグル選択はドラッグで潰さない
        return;
      }
      selectTableAxis(api, tid, kind, [index]);
      anchorRef.current = { tid, kind, index };
      bandRef.current = { kind, tid, anchor: index, last: index };
    };

    // 帯の中で「区切り付近か」を判定して、リサイズすべき列/行 index を返す（Excel と同じ感覚）。
    // 左端（上端）を掴んだ時は手前の列/行の境界。先頭のさらに手前は境界が無いので null。
    const bandEdgeTarget = (kind: "col" | "row", index: number, el: HTMLElement, e: PointerEvent): number | null => {
      const r = el.getBoundingClientRect();
      const pos = kind === "col" ? e.clientX : e.clientY;
      const lo = kind === "col" ? r.left : r.top;
      const hi = kind === "col" ? r.right : r.bottom;
      if (pos >= hi - BAND_EDGE) return index;
      if (pos <= lo + BAND_EDGE) return index > 0 ? index - 1 : null;
      return null;
    };

    // 画面座標 → その軸の index（帯のドラッグ中に「今どの列/行の上か」を測る）。
    const axisIndexAt = (layout: NonNullable<ReturnType<typeof readLayout>>, kind: "col" | "row", cx: number, cy: number) => {
      const p = viewportCoordsToSceneCoords({ clientX: cx, clientY: cy }, api.getAppState());
      if (kind === "col") {
        let x = layout.ox;
        for (let c = 0; c < layout.C; c++) { x += layout.colW[c]; if (p.x < x) return c; }
        return layout.C - 1;
      }
      let y = layout.oy;
      for (let r = 0; r < layout.R; r++) { y += layout.rowH[r]; if (p.y < y) return r; }
      return layout.R - 1;
    };

    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      const kind = el.dataset.kind as "col" | "row" | "corner" | "head-col" | "head-row" | undefined;
      if (!kind) return;
      const layout = readLayout();
      if (!layout) return;
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture?.(e.pointerId);
      if (kind === "head-col" || kind === "head-row") {
        const axis = kind === "head-col" ? "col" : "row";
        const index = Number(el.dataset.index);
        const edge = bandEdgeTarget(axis, index, el, e);
        if (edge != null) startResize(axis, edge, e, layout); // 帯の区切り＝リサイズ
        else startBandSelect(axis, index, e, layout.tid);     // 帯の中身＝選択
        return;
      }
      if (kind === "corner") {
        beginHistoryGesture();
        dragRef.current = {
          kind: "corner", corner: el.dataset.corner as Corner, tid: layout.tid,
          startCX: e.clientX, startCY: e.clientY,
          baseOx: layout.ox, baseOy: layout.oy,
          baseW: layout.colW.reduce((a, b) => a + b, 0), baseH: layout.rowH.reduce((a, b) => a + b, 0),
          baseColW: [...layout.colW], baseRowH: [...layout.rowH],
        };
        return;
      }
      startResize(kind, Number(el.dataset.index), e, layout);
    };
    const onMove = (e: PointerEvent) => {
      const b = bandRef.current;
      if (b) { // ヘッダー帯のドラッグ = 基点から現在位置までを範囲選択
        const layout = readLayout();
        if (!layout || layout.tid !== b.tid) return;
        const idx = axisIndexAt(layout, b.kind, e.clientX, e.clientY);
        if (idx === b.last) return;
        b.last = idx;
        selectTableAxis(api, b.tid, b.kind, rangeOf(b.anchor, idx));
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === "corner") { applyCorner(d, e); return; }
      const zoom = api.getAppState().zoom?.value ?? 1;
      const delta = ((d.kind === "col" ? e.clientX : e.clientY) - d.startClient) / zoom;
      const min = d.kind === "col" ? MIN_COL_W : MIN_ROW_H;
      // 対象すべてを同じサイズにそろえる（Excel/Word と同じ）。delta/k で境界をカーソルに追従させる。
      const size = Math.max(min, Math.round(d.startSize + delta / d.k));
      applyTableSizes(api, d.tid, d.kind, d.targets, size);
    };
    // ドラッグ確定の1回だけ履歴へ記録する（1ドラッグ＝1 undo ステップ・BRU7-058）。
    // 中間フレームは beginHistoryGesture により EVENTUALLY で溜まっているので、ここで
    // まとめて1つの増分になる。帯の範囲選択は選択が変わるだけなので記録しない。
    const onUp = () => {
      const had = !!dragRef.current;
      dragRef.current = null;
      bandRef.current = null;
      if (had) commitSceneToHistory(api);
    };
    const onDbl = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      const kind = el.dataset.kind as "col" | "row" | "corner" | "head-col" | "head-row" | undefined;
      if (kind === "corner" || !kind) return; // コーナーは自動フィット対象外
      const layout = readLayout();
      if (!layout) return;
      let axis: "col" | "row";
      let index: number;
      if (kind === "head-col" || kind === "head-row") {
        axis = kind === "head-col" ? "col" : "row";
        const edge = bandEdgeTarget(axis, Number(el.dataset.index), el, e as unknown as PointerEvent);
        if (edge == null) return;             // 帯の中身のダブルクリックには何も割り当てない
        index = edge;
      } else {
        axis = kind;
        index = Number(el.dataset.index);
      }
      e.preventDefault(); e.stopPropagation();
      // 選択中の全列/全行を自動フィットへ戻す。1 undo ステップとして記録（BRU7-058）。
      applyTableSizes(api, layout.tid, axis, resolveSizeTargets(api, layout.tid, axis, index), 0);
      commitSceneToHistory(api);
    };

    // つまみ div を生成（構成が変わった時のみ作り直す）。
    const buildHandles = (C: number, R: number) => {
      layer.replaceChildren();
      const mk = (kind: "col" | "row" | "corner" | "head-col" | "head-row",
                  opt: { index?: number; corner?: Corner; cursor: string }) => {
        const h = document.createElement("div");
        h.dataset.kind = kind;
        if (opt.index != null) h.dataset.index = String(opt.index);
        if (opt.corner) h.dataset.corner = opt.corner;
        h.style.cssText = `position:absolute;pointer-events:auto;cursor:${opt.cursor};z-index:1;`;
        h.addEventListener("pointerdown", onDown);
        h.addEventListener("dblclick", onDbl);
        if (kind !== "corner") { // ホバー状態は position() が見て塗り分ける（コーナーは透明のまま）
          h.addEventListener("pointerenter", () => { h.dataset.hover = "1"; });
          h.addEventListener("pointerleave", () => { delete h.dataset.hover; });
        }
        if (kind === "head-col" || kind === "head-row") {
          h.style.boxSizing = "border-box";
          h.style.border = "1px solid rgba(0,0,0,0.12)";
          h.style.borderRadius = "2px";
          // 帯の上では区切り付近だけカーソルをリサイズに変える（Excel と同じ）
          const axis = kind === "head-col" ? "col" : "row";
          h.addEventListener("pointermove", (ev) => {
            if (dragRef.current || bandRef.current) return;
            const edge = bandEdgeTarget(axis, Number(h.dataset.index), h, ev);
            h.style.cursor = edge != null ? (axis === "col" ? "col-resize" : "row-resize") : "pointer";
          });
        }
        layer.appendChild(h);
      };
      for (let c = 0; c < C; c++) mk("col", { index: c, cursor: "col-resize" });
      for (let r = 0; r < R; r++) mk("row", { index: r, cursor: "row-resize" });
      // コーナーは境界つまみより前面（四隅では両方向リサイズを優先）
      mk("corner", { corner: "tl", cursor: "nwse-resize" });
      mk("corner", { corner: "tr", cursor: "nesw-resize" });
      mk("corner", { corner: "bl", cursor: "nesw-resize" });
      mk("corner", { corner: "br", cursor: "nwse-resize" });
      // ヘッダー帯は最前面。表の外側の帯に限ってはコーナーつまみより優先させる（四隅の外側でも
      // 列/行を選べるようにする）。コーナーつまみは表の角そのもの（Excalidraw のハンドル位置）に
      // 残るので、四隅リサイズは従来どおり掴める。
      for (let c = 0; c < C; c++) mk("head-col", { index: c, cursor: "pointer" });
      for (let r = 0; r < R; r++) mk("head-row", { index: r, cursor: "pointer" });
    };

    // 位置更新（毎フレーム）。scene→ローカル画面px へ変換してつまみを境界/四隅/帯に載せる。
    const position = () => {
      raf = requestAnimationFrame(position);
      const layout = readLayout();
      if (!layout) {
        if (structRef.current) { layer.replaceChildren(); structRef.current = ""; }
        return;
      }
      const { tid, els, R, C, ox, oy, colW, rowH } = layout;
      const sig = `${tid}:${C}:${R}`;
      if (sig !== structRef.current && !dragRef.current && !bandRef.current) { buildHandles(C, R); structRef.current = sig; }

      const st = api.getAppState();
      const rect = container.getBoundingClientRect();
      const zoom = st.zoom?.value ?? 1;
      const toLocalX = (sx: number) => sx * zoom + st.scrollX * zoom + (st.offsetLeft ?? 0) - rect.left;
      const toLocalY = (sy: number) => sy * zoom + st.scrollY * zoom + (st.offsetTop ?? 0) - rect.top;
      const totalW = colW.reduce((a, b) => a + b, 0);
      const totalH = rowH.reduce((a, b) => a + b, 0);

      // 選択中の列/行（帯のハイライト用）と、ドラッグ中に一緒に動く列/行（境界つまみの強調用）。
      const marks = bulkSizeTargets(api, tid, els);
      const selCols = new Set(marks.cols), selRows = new Set(marks.rows);
      const d = dragRef.current;
      const movingCols = d?.kind === "col" ? new Set(d.targets) : null;
      const movingRows = d?.kind === "row" ? new Set(d.targets) : null;

      for (const h of Array.from(layer.children) as HTMLElement[]) {
        const kind = h.dataset.kind;
        const idx = Number(h.dataset.index);
        if (kind === "col") {
          let x = ox; for (let c = 0; c <= idx; c++) x += colW[c];
          h.style.left = `${toLocalX(x) - GRIP / 2}px`;
          h.style.top = `${toLocalY(oy)}px`;
          h.style.width = `${GRIP}px`;
          h.style.height = `${totalH * zoom}px`;
          h.style.background = movingCols?.has(idx) || (!d && h.dataset.hover) ? `${ACCENT}55` : "transparent";
        } else if (kind === "row") {
          let y = oy; for (let r = 0; r <= idx; r++) y += rowH[r];
          h.style.left = `${toLocalX(ox)}px`;
          h.style.top = `${toLocalY(y) - GRIP / 2}px`;
          h.style.width = `${totalW * zoom}px`;
          h.style.height = `${GRIP}px`;
          h.style.background = movingRows?.has(idx) || (!d && h.dataset.hover) ? `${ACCENT}55` : "transparent";
        } else if (kind === "head-col") {
          let x = ox; for (let c = 0; c < idx; c++) x += colW[c];
          const on = selCols.has(idx);
          h.style.left = `${toLocalX(x)}px`;
          h.style.top = `${toLocalY(oy) - BAND - BAND_GAP}px`;
          h.style.width = `${Math.max(2, colW[idx] * zoom)}px`;
          h.style.height = `${BAND}px`;
          h.style.background = on ? `${ACCENT}33` : h.dataset.hover ? BAND_HOVER : BAND_BG;
          h.style.borderColor = on ? ACCENT : "rgba(0,0,0,0.12)";
        } else if (kind === "head-row") {
          let y = oy; for (let r = 0; r < idx; r++) y += rowH[r];
          const on = selRows.has(idx);
          h.style.left = `${toLocalX(ox) - BAND - BAND_GAP}px`;
          h.style.top = `${toLocalY(y)}px`;
          h.style.width = `${BAND}px`;
          h.style.height = `${Math.max(2, rowH[idx] * zoom)}px`;
          h.style.background = on ? `${ACCENT}33` : h.dataset.hover ? BAND_HOVER : BAND_BG;
          h.style.borderColor = on ? ACCENT : "rgba(0,0,0,0.12)";
        } else { // corner
          const corner = h.dataset.corner as Corner;
          const cx = corner === "tr" || corner === "br" ? ox + totalW : ox;
          const cy = corner === "bl" || corner === "br" ? oy + totalH : oy;
          h.style.left = `${toLocalX(cx) - CORNER / 2}px`;
          h.style.top = `${toLocalY(cy) - CORNER / 2}px`;
          h.style.width = `${CORNER}px`;
          h.style.height = `${CORNER}px`;
        }
      }
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
      structRef.current = "";
    };
  }, [api, containerRef, canEdit]);

  // つまみ以外はクリックを透過（キャンバス操作を妨げない）。個々のつまみだけ pointer-events:auto。
  return <div ref={layerRef} style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none" }} />;
}
