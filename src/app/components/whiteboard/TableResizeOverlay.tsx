// 表（BRU5-042）の手動リサイズ用オーバーレイ。
// 表を選択している間、次のドラッグ用つまみを重ねる:
//   ・列の境界（縦の区切り）→ 列幅変更（customData.wbTable.cw）
//   ・行の境界（横の区切り）→ 行高変更（customData.wbTable.rh）
//   ・四隅（コーナー）→ 表全体のリサイズ。Shiftで縦横比固定、Shift無しで縦横自由に伸縮。
// つまみをダブルクリックすると、その列/行を自動フィット（手動値クリア）に戻す。
// いずれも手動値を書き込むと reflowTables が隙間なくタイルし直す。
// 座標変換は他オーバーレイ（FrameHighlightLayer 等）と同じ scene→ローカル画面px。
import { useEffect, useRef } from "react";
import { selectedTableId, tableGrid } from "@/app/lib/whiteboardTable";

interface Props {
  api: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  canEdit: boolean;
}

const MIN_COL_W = 40;
const MIN_ROW_H = 32;
const GRIP = 8;               // 列/行つまみの当たり幅（px・画面）
const CORNER = 28;            // コーナーつまみの当たり幅（Excalidraw の四隅ハンドルに重ねて捕捉する）
const ACCENT = "#6965db";     // Excalidraw の選択色

type Corner = "tl" | "tr" | "bl" | "br";
type Drag =
  | { kind: "col"; index: number; tid: string; startClient: number; startSize: number }
  | { kind: "row"; index: number; tid: string; startClient: number; startSize: number }
  | { kind: "corner"; corner: Corner; tid: string; startCX: number; startCY: number;
      baseOx: number; baseOy: number; baseW: number; baseH: number; baseColW: number[]; baseRowH: number[] }
  | null;

export function TableResizeOverlay({ api, containerRef, canEdit }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag>(null);
  const structRef = useRef<string>(""); // 現在描画中のつまみ構成（tid:C:R）

  useEffect(() => {
    if (!canEdit) return;
    const container = containerRef.current;
    const layer = layerRef.current;
    if (!container || !layer) return;

    let raf = 0;

    // 現在の表レイアウト（tid・格子・原点・列幅/行高）を取得。無ければ null。
    const readLayout = () => {
      const tid = selectedTableId(api);
      if (!tid) return null;
      const els = api.getSceneElements();
      const info = tableGrid(els, tid);
      if (!info) return null;
      const { grid, R, C } = info;
      const anchor = grid[0][0];
      const colW = Array.from({ length: C }, (_, c) => {
        for (let r = 0; r < R; r++) if (grid[r][c]) return grid[r][c].width;
        return 0;
      });
      const rowH = Array.from({ length: R }, (_, r) => {
        for (let c = 0; c < C; c++) if (grid[r][c]) return grid[r][c].height;
        return 0;
      });
      return { tid, R, C, ox: anchor.x, oy: anchor.y, colW, rowH };
    };

    // 列/行の手動値を全該当セルへ書き込む（cw or rh）。value<=0 でクリア（自動フィット復帰）。
    const applyManual = (tid: string, kind: "col" | "row", index: number, value: number) => {
      const els = api.getSceneElements();
      const next = els.map((e: any) => {
        const t = e?.customData?.wbTable;
        if (!t || t.tid !== tid) return e;
        if (kind === "col" && t.c !== index) return e;
        if (kind === "row" && t.r !== index) return e;
        const wb = { ...t };
        if (kind === "col") { if (value > 0) wb.cw = value; else delete wb.cw; }
        else { if (value > 0) wb.rh = value; else delete wb.rh; }
        return { ...e, customData: { ...e.customData, wbTable: wb } };
      });
      api.updateScene({ elements: next });
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

    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement;
      const kind = el.dataset.kind as "col" | "row" | "corner" | undefined;
      if (!kind) return;
      const layout = readLayout();
      if (!layout) return;
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture?.(e.pointerId);
      if (kind === "corner") {
        dragRef.current = {
          kind: "corner", corner: el.dataset.corner as Corner, tid: layout.tid,
          startCX: e.clientX, startCY: e.clientY,
          baseOx: layout.ox, baseOy: layout.oy,
          baseW: layout.colW.reduce((a, b) => a + b, 0), baseH: layout.rowH.reduce((a, b) => a + b, 0),
          baseColW: [...layout.colW], baseRowH: [...layout.rowH],
        };
      } else {
        const index = Number(el.dataset.index);
        dragRef.current = {
          kind, index, tid: layout.tid,
          startClient: kind === "col" ? e.clientX : e.clientY,
          startSize: kind === "col" ? layout.colW[index] : layout.rowH[index],
        };
      }
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === "corner") { applyCorner(d, e); return; }
      const zoom = api.getAppState().zoom?.value ?? 1;
      if (d.kind === "col") {
        const dx = (e.clientX - d.startClient) / zoom;
        applyManual(d.tid, "col", d.index, Math.max(MIN_COL_W, Math.round(d.startSize + dx)));
      } else {
        const dy = (e.clientY - d.startClient) / zoom;
        applyManual(d.tid, "row", d.index, Math.max(MIN_ROW_H, Math.round(d.startSize + dy)));
      }
    };
    const onUp = () => { dragRef.current = null; };
    const onDbl = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      const kind = el.dataset.kind as "col" | "row" | "corner" | undefined;
      if (kind !== "col" && kind !== "row") return; // コーナーは自動フィット対象外
      const layout = readLayout();
      if (!layout) return;
      e.preventDefault(); e.stopPropagation();
      applyManual(layout.tid, kind, Number(el.dataset.index), 0); // 自動フィットに戻す
    };

    // つまみ div を生成（構成が変わった時のみ作り直す）。
    const buildHandles = (C: number, R: number) => {
      layer.replaceChildren();
      const mk = (kind: "col" | "row" | "corner", opt: { index?: number; corner?: Corner; cursor: string }) => {
        const h = document.createElement("div");
        h.dataset.kind = kind;
        if (opt.index != null) h.dataset.index = String(opt.index);
        if (opt.corner) h.dataset.corner = opt.corner;
        h.style.cssText = `position:absolute;pointer-events:auto;cursor:${opt.cursor};z-index:1;`;
        h.addEventListener("pointerdown", onDown);
        h.addEventListener("dblclick", onDbl);
        if (kind !== "corner") { // 境界つまみはホバーで薄く強調（コーナーは透明のまま）
          h.addEventListener("pointerenter", () => { h.style.background = `${ACCENT}55`; });
          h.addEventListener("pointerleave", () => { h.style.background = "transparent"; });
        }
        layer.appendChild(h);
      };
      for (let c = 0; c < C; c++) mk("col", { index: c, cursor: "col-resize" });
      for (let r = 0; r < R; r++) mk("row", { index: r, cursor: "row-resize" });
      // コーナーは最後に追加＝境界つまみより前面（四隅では両方向リサイズを優先）
      mk("corner", { corner: "tl", cursor: "nwse-resize" });
      mk("corner", { corner: "tr", cursor: "nesw-resize" });
      mk("corner", { corner: "bl", cursor: "nesw-resize" });
      mk("corner", { corner: "br", cursor: "nwse-resize" });
    };

    // 位置更新（毎フレーム）。scene→ローカル画面px へ変換してつまみを境界/四隅に載せる。
    const position = () => {
      raf = requestAnimationFrame(position);
      const layout = readLayout();
      if (!layout) {
        if (structRef.current) { layer.replaceChildren(); structRef.current = ""; }
        return;
      }
      const { tid, R, C, ox, oy, colW, rowH } = layout;
      const sig = `${tid}:${C}:${R}`;
      if (sig !== structRef.current && !dragRef.current) { buildHandles(C, R); structRef.current = sig; }

      const st = api.getAppState();
      const rect = container.getBoundingClientRect();
      const zoom = st.zoom?.value ?? 1;
      const toLocalX = (sx: number) => sx * zoom + st.scrollX * zoom + (st.offsetLeft ?? 0) - rect.left;
      const toLocalY = (sy: number) => sy * zoom + st.scrollY * zoom + (st.offsetTop ?? 0) - rect.top;
      const totalW = colW.reduce((a, b) => a + b, 0);
      const totalH = rowH.reduce((a, b) => a + b, 0);

      for (const h of Array.from(layer.children) as HTMLElement[]) {
        const kind = h.dataset.kind;
        if (kind === "col") {
          const idx = Number(h.dataset.index);
          let x = ox; for (let c = 0; c <= idx; c++) x += colW[c];
          h.style.left = `${toLocalX(x) - GRIP / 2}px`;
          h.style.top = `${toLocalY(oy)}px`;
          h.style.width = `${GRIP}px`;
          h.style.height = `${totalH * zoom}px`;
        } else if (kind === "row") {
          const idx = Number(h.dataset.index);
          let y = oy; for (let r = 0; r <= idx; r++) y += rowH[r];
          h.style.left = `${toLocalX(ox)}px`;
          h.style.top = `${toLocalY(y) - GRIP / 2}px`;
          h.style.width = `${totalW * zoom}px`;
          h.style.height = `${GRIP}px`;
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
