// 表（BRU5-042）の行・列 追加/削除パネル。線・矢印の書式パネル（ConnectorFormatPanel）と同じ体裁で、
// 標準パネル(island)の真下にドッキングする。表のセル（または表全体）を選択している間だけ表示。
//
// セルはグループ化されているため1クリックだと表全体が選択される。そこで pointerdown で「クリックした
// セル」を追跡し、全体選択時はそのセルを基準にする（single）。セルを個別に複数選択している時は、その
// 選択が跨る行数/列数を単位に一括で追加/削除する（3セル→3行/3列。列も同様）。
//   行: [上に追加][下に追加][削除]   列: [左に追加][右に追加][削除]
// 追加後は基準（フォーカス/選択セル）を保持するので同じ位置へ続けて追加できる。削除後は選択が外れて閉じる。
import { useEffect, useRef, useState } from "react";
import { viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import {
  selectedTableRange, tableCellAtPoint,
  insertTableColumns, insertTableRows, deleteTableColumns, deleteTableRows,
} from "@/app/lib/whiteboardTable";

interface Props {
  api: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  canEdit: boolean;
}

const PANEL_W = 184;
const PANEL_H = 120;

type Focused = { tid: string; r: number; c: number; id: string } | null;

export function TableRowColControls({ api, containerRef, canEdit }: Props) {
  const [state, setState] = useState<
    { tid: string; rows: number[]; cols: number[]; R: number; C: number; single: boolean; focusedId: string | null; left: number; top: number } | null
  >(null);
  const raf = useRef<number>(0);
  const sigRef = useRef<string>("");
  const focusedRef = useRef<Focused>(null);

  // pointerdown（キャプチャ phase）で、クリックした scene 座標を含む表セルを記憶する。
  // キャプチャにするのは Excalidraw が stopPropagation してもこちらが先に受け取れるようにするため。
  useEffect(() => {
    const container = containerRef.current;
    if (!canEdit || !container) return;
    const onDown = (e: PointerEvent) => {
      try {
        const st = api.getAppState();
        const p = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, st);
        const hit = tableCellAtPoint(api.getSceneElements(), p.x, p.y);
        if (hit) focusedRef.current = hit; // セル上のクリックだけ更新（パネル/空白クリックでは保持）
      } catch { /* noop */ }
    };
    container.addEventListener("pointerdown", onDown, true);
    return () => container.removeEventListener("pointerdown", onDown, true);
  }, [api, canEdit, containerRef]);

  useEffect(() => {
    if (!canEdit) { setState(null); return; }
    const tick = () => {
      try {
        const st = api.getAppState();
        // 入力/ドラッグ/リサイズ中はパネルを出さない（操作の邪魔をしない）
        const busy = !!(st.newElement || st.resizingElement || st.editingTextElement ||
          st.selectionElement || st.editingLinearElement || st.selectedElementsAreBeingDragged || st.isResizing);
        const range = !busy ? selectedTableRange(api, focusedRef.current) : null;
        const box = containerRef.current?.getBoundingClientRect();

        if (!range || !box) {
          if (sigRef.current !== "") { sigRef.current = ""; setState(null); }
          raf.current = requestAnimationFrame(tick);
          return;
        }
        // 標準パネル(island)の真下にドッキング。入りきらない時は右隣へ逃がす（ConnectorFormatPanel と同方針）。
        const menu = containerRef.current?.querySelector(".App-menu__left") as HTMLElement | null;
        const bar = containerRef.current?.querySelector(".App-toolbar") as HTMLElement | null;
        let left = 12, top = 12;
        if (menu) {
          const m = menu.getBoundingClientRect();
          const below = m.bottom - box.top + 8;
          if (below + PANEL_H < box.height - 70) {
            left = Math.round(m.left - box.left);
            top = Math.round(below);
          } else {
            const barBottom = bar ? bar.getBoundingClientRect().bottom - box.top + 8 : 8;
            left = Math.round(m.right - box.left + 8);
            top = Math.round(Math.max(m.top - box.top, barBottom));
          }
        }
        const { tid, rows, cols, R, C, single, focusedId } = range;
        const sig = `${tid}:${rows.join(",")}:${cols.join(",")}:${R}:${C}:${single}:${left}:${top}`;
        if (sig !== sigRef.current) { sigRef.current = sig; setState({ tid, rows, cols, R, C, single, focusedId, left, top }); }
      } catch { /* noop */ }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [api, canEdit, containerRef]);

  if (!state) return null;
  const { tid, rows, cols, R, C, single, focusedId, left, top } = state;
  const rowCount = rows.length, colCount = cols.length;
  const minRow = rows[0], maxRow = rows[rows.length - 1];
  const minCol = cols[0], maxCol = cols[cols.length - 1];
  const rowLabel = rowCount > 1 ? `${rowCount}行` : "行";
  const colLabel = colCount > 1 ? `${colCount}列` : "列";

  // 単一（全体選択→フォーカスセル基準）で追加した後は、選択をそのフォーカスセルへ寄せる。
  // こうしないと表全体選択のまま新セルが増え、次回の基準がずれる（＝また一番下に入る）。
  const run = (op: () => boolean) => {
    const ok = op();
    if (ok && single && focusedId) {
      api.updateScene({ appState: { selectedElementIds: { [focusedId]: true } } });
    }
  };

  const btn = (label: string, title: string, danger: boolean, disabled: boolean, onClick: () => void) => (
    <button
      key={label}
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{
        flex: 1, padding: "4px 6px", borderRadius: 6, fontSize: 11, fontFamily: "inherit",
        border: "1px solid rgba(0,0,0,0.15)", whiteSpace: "nowrap",
        cursor: disabled ? "default" : "pointer",
        background: "#fff",
        color: disabled ? "#c8c2bd" : danger ? "#e03131" : "#1971c2",
      }}
    >{label}</button>
  );

  const heading = (label: string) => (
    <span style={{ fontSize: 11, fontWeight: 600, color: "#868e96" }}>{label}</span>
  );

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute", left, top, width: PANEL_W, zIndex: 21, pointerEvents: "auto",
        background: "#fff", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12,
        boxShadow: "0 6px 20px rgba(0,0,0,0.15)", padding: "10px 12px",
        display: "flex", flexDirection: "column", gap: 10, fontSize: 11, color: "#444",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {heading(rowLabel)}
        <div style={{ display: "flex", gap: 6 }}>
          {btn("上に追加", `選択の上に${rowLabel}を追加`, false, false, () => run(() => insertTableRows(api, tid, minRow, rowCount)))}
          {btn("下に追加", `選択の下に${rowLabel}を追加`, false, false, () => run(() => insertTableRows(api, tid, maxRow + 1, rowCount)))}
          {btn("削除", `選択した${rowLabel}を削除`, true, rowCount >= R, () => deleteTableRows(api, tid, rows))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {heading(colLabel)}
        <div style={{ display: "flex", gap: 6 }}>
          {btn("左に追加", `選択の左に${colLabel}を追加`, false, false, () => run(() => insertTableColumns(api, tid, minCol, colCount)))}
          {btn("右に追加", `選択の右に${colLabel}を追加`, false, false, () => run(() => insertTableColumns(api, tid, maxCol + 1, colCount)))}
          {btn("削除", `選択した${colLabel}を削除`, true, colCount >= C, () => deleteTableColumns(api, tid, cols))}
        </div>
      </div>
    </div>
  );
}
