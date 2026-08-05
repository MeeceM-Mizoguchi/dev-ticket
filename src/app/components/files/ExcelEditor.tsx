import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from "react";
import { HotTable } from "@handsontable/react";
import { registerAllModules } from "handsontable/registry";
import { textRenderer } from "handsontable/renderers";
import { Loader2, Save, PaintBucket, Square, Circle, MessageSquare, Minus, MoveRight, Type, Trash2, BringToFront, SendToBack, AlignLeft, AlignCenter, AlignRight, Undo2, Redo2, WrapText, MoveHorizontal } from "lucide-react";
import type { ProjectFile } from "@/app/types";
import { uploadProjectFile, fetchSignedUrl } from "@/app/lib/projectFiles";
import { patchXlsx, colLetter, type CellEdit } from "@/app/lib/xlsxEdit";
import { insertRows, removeRows, insertCols, removeCols, setColWidths, setRowHeights, addHyperlinks } from "@/app/lib/xlsxStructure";
import { parseXlsxDrawings, type DrawingObject } from "@/app/lib/xlsxDrawing";
import { patchXlsxDrawing, repairDrawings, findDrawingDefects } from "@/app/lib/xlsxDrawingWrite";
import { parseThemePalette, resolveFill } from "@/app/lib/xlsxCellColor";
import { unzipSync, strFromU8 } from "fflate";
import { ShapeEditorOverlay, type ShapeEditorHandle, type SelectInfo } from "./ShapeEditorOverlay";
import {
  CHAR_PX, COL_PADDING_PX, DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT_PT, PT_TO_PX,
} from "./ExcelViewer";
import { textWidth, wrapHeight, spillExtents } from "@/app/lib/xlsxTextLayout";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";

// ENHA2-035 Excel(.xlsx/.xlsm) 画面内エディタ
//
// 値・数式・セル色を Handsontable で編集し、保存時は xlsxEdit.patchXlsx で
// 元ファイルの該当セルだけを書き換える（グラフ・画像・図形は保持される）。
// 数式は fast-formula-parser でその場再計算して表示する。

registerAllModules();

const MAX_ROWS = 400;
const MAX_COLS = 80;

// エディタ内部の「真の値」グリッド。formula は "=..." 文字列で保持する。
type Grid = string[][];

// BRU10-055 セル文字のレイアウト。Handsontable の既定スタイルに合わせた値で、
// 文字幅の計測(canvas)と実際の描画を一致させる（CSS 側は CELL_CSS で固定）。
const HOT_FONT_FAMILY = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif`;
const HOT_FONT_PX = 13;
const HOT_LINE_H = 21;   // handsontable 既定の line-height
const HOT_PAD_X = 4;     // handsontable 既定の padding: 0 4px
const HOT_FONT = { size: HOT_FONT_PX, family: HOT_FONT_FAMILY };
// セル幅から、文字を置ける幅（左右パディング＋右枠）を引く
const contentWidth = (cellW: number) => cellW - HOT_PAD_X * 2 - 1;
// 折り返しなしのセルは改行が空白になって1行に並ぶ
const flatText = (s: string) => s.replace(/\n/g, " ");
const CELL_CSS = `
.xls-hot .htCore td { font-family: ${HOT_FONT_FAMILY}; font-size: ${HOT_FONT_PX}px; line-height: ${HOT_LINE_H}px; }
.xls-hot .htCore td .xls-spill { position: absolute; top: 0; bottom: 0; display: flex; box-sizing: border-box;
  padding: 0 ${HOT_PAD_X}px; white-space: nowrap; overflow: hidden; pointer-events: none; }
`;

interface SheetModel {
  name: string;
  raw: Grid;        // 編集中の真の値（数式は "=..."）
  original: Grid;   // 差分判定用の元の値
  display: Grid;    // 数式を解決した表示値
  fills: (string | null)[][]; // 新規に塗ったセル色
  baseFills: (string | null)[][]; // 元ファイルが持つセル色（表示専用。保存では書き戻さない）
  baseWrap: boolean[][];      // 元ファイルの折り返し設定（BRU10-055）
  truncated: boolean;
  colWidths: number[];  // px（Excel換算・描画レイヤーと座標系を一致させる）
  rowHeights: number[]; // px
  baseRowHeights: number[]; // 折り返しを考えない素の行高（自動調整の下限）
  autoRowH: boolean[];      // 行高が自動調整（＝Excel側で明示指定もドラッグ変更もされていない）
  drawings: DrawingObject[]; // 画像・図形（表示のみ）
  drawingPath: string | null; // 書き戻し先（xl/drawings/drawingN.xml）
  totalW: number; totalH: number;
}

const ROW_HEADER_W = 50; // Handsontable の行ヘッダ幅（固定）

// 保存前の破損ガード：exceljs で開け、描画XMLに Excel が破損とみなす欠陥が無いことを確認する
async function verifyXlsx(bytes: Uint8Array, models: SheetModel[]): Promise<boolean> {
  try {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch (e) { console.error("[ExcelEditor] verify: exceljs load failed", e); return false; }
  try {
    const files = unzipSync(bytes);
    // 全シートの描画を検査する。図形IDの重複や不完全な調整値リストがあると
    // Excel は描画パートを丸ごと捨てる（画像も図形も全消え）ので、ここで必ず弾く。
    for (const m of models) {
      if (!m.drawingPath || !files[m.drawingPath]) continue;
      const defects = findDrawingDefects(strFromU8(files[m.drawingPath]));
      if (defects.length > 0) {
        console.error("[ExcelEditor] verify: bad drawing", m.name, defects); return false;
      }
    }
  } catch (e) { console.error("[ExcelEditor] verify: unzip failed", e); return false; }
  return true;
}

// Undo/Redo 用のクローンヘルパ
function cloneSetRec(rec: Record<string, Set<number>>): Record<string, Set<number>> {
  const o: Record<string, Set<number>> = {}; for (const k in rec) o[k] = new Set(rec[k]); return o;
}
function cloneMapRec<T>(rec: Record<string, Map<string, T>>): Record<string, Map<string, T>> {
  const o: Record<string, Map<string, T>> = {}; for (const k in rec) o[k] = new Map(rec[k]); return o;
}
function cloneShapeEdits(rec: Record<string, { objects: DrawingObject[]; changedAnchors: number[] }>) {
  const o: Record<string, { objects: DrawingObject[]; changedAnchors: number[] }> = {};
  for (const k in rec) o[k] = { objects: rec[k].objects.map(x => ({ ...x })), changedAnchors: rec[k].changedAnchors.slice() };
  return o;
}
function cloneStructOps<T>(rec: Record<string, T[]>): Record<string, T[]> {
  const o: Record<string, T[]> = {}; for (const k in rec) o[k] = rec[k].map(x => ({ ...x } as T)); return o;
}

const isNumeric = (s: string) => /^-?\d+(\.\d+)?$/.test(s);

// exceljs のセルから編集用の生文字列を得る
function cellToRaw(cell: any): string {
  if (cell == null) return "";
  if (cell.formula) return "=" + cell.formula;
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "object") {
    // リッチテキスト / 日付 / ハイパーリンク等は表示テキストで代替
    if (v.richText) return cell.text ?? "";
    if (v.text) return String(v.text);
    return cell.text ?? "";
  }
  return String(v);
}

// fast-formula-parser で1シートを再計算し、表示グリッドを返す
async function recompute(raw: Grid, sheetName: string): Promise<Grid> {
  const hasFormula = raw.some(row => row.some(c => typeof c === "string" && c.startsWith("=")));
  const display = raw.map(row => row.map(c => (c.startsWith("=") ? "" : c)));
  if (!hasFormula) return display;

  const FormulaParser = (await import("fast-formula-parser")).default;
  const toVal = (s: string | undefined): number | string | null => {
    if (s == null || s === "" || s.startsWith("=")) return null;
    return isNumeric(s) ? Number(s) : s;
  };
  const values: (number | string | null)[][] = raw.map(row => row.map(toVal));

  const parser = new FormulaParser({
    onCell: ({ row, col }: any) => {
      const v = values[row - 1]?.[col - 1];
      return v == null ? null : v;
    },
    onRange: ({ from, to }: any) => {
      const arr: any[][] = [];
      for (let r = from.row; r <= to.row; r++) {
        const line: any[] = [];
        for (let c = from.col; c <= to.col; c++) {
          const v = values[r - 1]?.[c - 1];
          line.push(v == null ? null : v);
        }
        arr.push(line);
      }
      return arr;
    },
  });

  // 依存する数式を解決するため数回パスする
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (let r = 0; r < raw.length; r++) {
      for (let c = 0; c < raw[r].length; c++) {
        const src = raw[r][c];
        if (typeof src !== "string" || !src.startsWith("=")) continue;
        let res: any;
        try {
          res = parser.parse(src.slice(1), { sheet: sheetName, row: r + 1, col: c + 1 });
        } catch {
          res = "#ERROR";
        }
        const str = res == null ? "" : String(res);
        const norm = res == null ? null : (typeof res === "object" ? str : res);
        if (values[r][c] !== norm) { values[r][c] = norm; changed = true; }
        display[r][c] = str;
      }
    }
    if (!changed) break;
  }
  return display;
}

interface Props {
  url: string;
  file: ProjectFile;
  onSaved: () => void;
  onClose: () => void;
}

export interface EditorHandle { isDirty: () => boolean; save: () => Promise<boolean> }

export const ExcelEditor = forwardRef<EditorHandle, Props>(function ExcelEditor({ url, file, onSaved, onClose }, ref) {
  const [sheets, setSheets] = useState<SheetModel[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [needsRepair, setNeedsRepair] = useState(false); // 旧バグで描画が壊れている＝保存すれば直る
  const [reloadKey, setReloadKey] = useState(0);
  const [fillColor, setFillColor] = useState("#FEF08A");
  const [shapeInfo, setShapeInfo] = useState<SelectInfo | null>(null);
  const shapeSelected = shapeInfo !== null;
  const [cellSel, setCellSel] = useState<{ h?: "left" | "center" | "right"; v?: "top" | "middle" | "bottom" }>({});
  const [shapeFill, setShapeFill] = useState("#FDE68A");
  const [shapeLine, setShapeLine] = useState("#B45309");
  const [shapeText, setShapeText] = useState("#1A1714");
  const overlayRef = useRef<ShapeEditorHandle>(null);
  // シートごとの図形編集結果（objects と作り直し対象アンカー）
  const shapeEditsRef = useRef<Record<string, { objects: DrawingObject[]; changedAnchors: number[] }>>({});
  // シートごとのセル揃え（"r:c" -> {h,v}）
  type CellAlign = { h?: "left" | "center" | "right"; v?: "top" | "middle" | "bottom" };
  const cellAlignRef = useRef<Record<string, Map<string, CellAlign>>>({});
  // シートごとの折り返し設定の変更（"r:c" -> true=折り返し / false=はみ出し）。
  // 未登録のセルは元ファイル（baseWrap）のまま。
  const cellWrapRef = useRef<Record<string, Map<string, boolean>>>({});
  const [cellWrapSel, setCellWrapSel] = useState<boolean | null>(null); // ツールバーのハイライト用
  const [, setLayoutTick] = useState(0); // 行高が変わったときに React 側も描き直すためのカウンタ
  // 構造編集・幅・リンク（保存時に xlsx へ反映）
  type StructOp = { type: "insertRow" | "removeRow" | "insertCol" | "removeCol"; at: number; count: number };
  const structOpsRef = useRef<Record<string, StructOp[]>>({});
  const colWidthChgRef = useRef<Record<string, Set<number>>>({});
  const rowHeightChgRef = useRef<Record<string, Set<number>>>({});
  const linksRef = useRef<Record<string, Map<string, string>>>({});
  const [gridVersion, setGridVersion] = useState(0); // 構造変更で HotTable を再マウントするための版
  // Undo/Redo
  const undoStack = useRef<any[]>([]);
  const redoStack = useRef<any[]>([]);
  const shapeSnapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const originalBytesRef = useRef<Uint8Array | null>(null);
  const sheetsRef = useRef<SheetModel[] | null>(null);
  const hotRef = useRef<InstanceType<typeof HotTable>>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const disposeRef = useRef<() => void>(() => { });
  // HotTable に渡す data 配列。ラッパーが再レンダーごとに data を再適用するため、
  // 別配列で差し替えず「同じ配列を in-place で書き換え」て編集が消えないようにする。
  const gridDataRef = useRef<Grid>([]);
  const [overlayOffset, setOverlayOffset] = useState({ left: ROW_HEADER_W, top: 26 });
  sheetsRef.current = sheets;

  // ── 読み込み ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 保存直後はストレージ整合が遅れて署名URLが400を返すことがあるため、
        // リトライのたびに署名URLを取り直しつつ数回試す。
        let buf: ArrayBuffer | null = null;
        for (let i = 0; i < 6 && !cancelled; i++) {
          try {
            const u = i === 0 ? url : await fetchSignedUrl(file.id, "inline");
            const res = await fetch(u);
            if (res.ok) { buf = await res.arrayBuffer(); break; }
          } catch { /* リトライ */ }
          await new Promise(r => setTimeout(r, 700 * (i + 1)));
        }
        if (cancelled) return;
        if (!buf) throw new Error("ファイルの取得に失敗しました（保存直後は数秒お待ちください）");
        originalBytesRef.current = new Uint8Array(buf);
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        // Excel の色指定はテーマ色（theme + tint）が大半なので、theme1.xml から色表を作る
        const themePalette = parseThemePalette(originalBytesRef.current);

        const models: SheetModel[] = [];
        const disposers: Array<() => void> = [];
        for (let sheetIdx = 0; sheetIdx < wb.worksheets.length; sheetIdx++) {
          const ws = wb.worksheets[sheetIdx];

          // Excel の列幅・行高を px に換算（ExcelViewer と同じ計算＝描画レイヤーと一致）
          const defColW = ws.properties?.defaultColWidth ?? DEFAULT_COL_WIDTH;
          const defRowH = ws.properties?.defaultRowHeight ?? DEFAULT_ROW_HEIGHT_PT;
          // Handsontable の実レンダリング下限に合わせて floor する（列幅30 / 行高24）。
          // 同じ関数を「描画レイヤーの座標」と「グリッドの列幅/行高」の両方に使うので、
          // 多少 Excel の実寸とズレても、グリッドと画像の相対位置は必ず一致する。
          const colPx = (i: number) => Math.max(30, Math.round((ws.getColumn(i + 1)?.width ?? defColW) * CHAR_PX + COL_PADDING_PX));
          const baseRowPx = (i: number) => Math.max(24, Math.round((ws.getRow(i + 1)?.height ?? defRowH) * PT_TO_PX));

          // 折り返しの行高計算に中身が要るので、実データ範囲を先に読む
          // （図形ぶんの余白は後から足す）。
          const baseRows = Math.min(Math.max(ws.rowCount, 1), MAX_ROWS);
          const baseCols = Math.min(Math.max(ws.columnCount, 1), MAX_COLS);
          const raw: Grid = [];
          const baseFills: (string | null)[][] = [];
          const baseWrap: boolean[][] = [];
          for (let r = 1; r <= baseRows; r++) {
            const line: string[] = [];
            const fillLine: (string | null)[] = [];
            const wrapLine: boolean[] = [];
            for (let c = 1; c <= baseCols; c++) {
              const cell = ws.getRow(r).getCell(c);
              line.push(cellToRaw(cell));
              // 元ファイルのセル色。テーマ色＋tint 指定が大半なので解決してから表示する
              fillLine.push(resolveFill(cell.fill, themePalette));
              wrapLine.push(!!cell.alignment?.wrapText);
            }
            raw.push(line);
            baseFills.push(fillLine);
            baseWrap.push(wrapLine);
          }
          const display = await recompute(raw, ws.name);
          const colWidths = Array.from({ length: baseCols }, (_, i) => colPx(i));

          // 折り返しセルのぶん行高を広げる。ファイルが持つ行高(ht)より狭くはしない
          // ＝必要なら広げるだけなので、折り返した文字が見切れることはない。
          const baseRowHeights = Array.from({ length: baseRows }, (_, i) => baseRowPx(i));
          const autoRowH = Array.from({ length: baseRows }, () => true);
          const rowHeights = baseRowHeights.map((h, r) => {
            let out = h;
            for (let c = 0; c < baseCols; c++) {
              if (!baseWrap[r][c]) continue;
              const t = display[r]?.[c] ?? "";
              if (!t) continue;
              out = Math.max(out, wrapHeight(t, contentWidth(colWidths[c]), HOT_FONT, HOT_LINE_H, 2));
            }
            return out;
          });
          const rowPx = (i: number) => rowHeights[i] ?? baseRowPx(i);

          // 描画レイヤー（画像・図形・矢印）。表示のみ、保存時は元ファイル側が保持する。
          let drawings: DrawingObject[] = [];
          let dMaxCol = 0, dMaxRow = 0;
          let drawingPath: string | null = null;
          try {
            const parsed = parseXlsxDrawings(buf, sheetIdx, { colPx, rowPx });
            drawings = parsed.objects; dMaxCol = parsed.maxCol; dMaxRow = parsed.maxRow;
            drawingPath = parsed.drawingPath;
            disposers.push(parsed.dispose);
          } catch (e) { console.error("[ExcelEditor] drawing parse:", e); }

          // 図形がセル範囲より外に出ることがあるので、その分もグリッドを伸ばす
          const rowCount = Math.min(Math.max(baseRows, dMaxRow + 2), MAX_ROWS);
          const colCount = Math.min(Math.max(baseCols, dMaxCol + 2), MAX_COLS);
          for (let i = baseCols; i < colCount; i++) colWidths.push(colPx(i));
          for (let i = baseRows; i < rowCount; i++) {
            const h = baseRowPx(i);
            baseRowHeights.push(h); rowHeights.push(h); autoRowH.push(true);
          }
          for (const grid of [raw, display]) for (const line of grid) while (line.length < colCount) line.push("");
          while (baseFills.length < rowCount) baseFills.push([]);
          while (baseWrap.length < rowCount) baseWrap.push([]);
          while (raw.length < rowCount) raw.push(Array.from({ length: colCount }, () => ""));
          while (display.length < rowCount) display.push(Array.from({ length: colCount }, () => ""));
          for (const line of baseFills) while (line.length < colCount) line.push(null);
          for (const line of baseWrap) while (line.length < colCount) line.push(false);

          models.push({
            name: ws.name,
            raw,
            original: raw.map(row => row.slice()),
            display,
            fills: raw.map(row => row.map(() => null)),
            baseFills, baseWrap,
            truncated: ws.rowCount > MAX_ROWS || ws.columnCount > MAX_COLS,
            colWidths, rowHeights, baseRowHeights, autoRowH,
            drawings, drawingPath,
            totalW: colWidths.reduce((a, b) => a + b, 0),
            totalH: rowHeights.reduce((a, b) => a + b, 0),
          });
        }
        disposeRef.current = () => disposers.forEach(d => d());
        if (!cancelled) setSheets(models);

        // 旧バージョンのバグで描画が壊れているファイルの検知。
        // 中身を直せるのは保存時だけなので、ダミー編集なしで保存できるようにする
        // （dirty は立てない＝閉じるときに未保存確認を出さない。勝手な保存もしない）。
        if (!cancelled) {
          try {
            const files = unzipSync(originalBytesRef.current);
            const broken = models.some(m => m.drawingPath && files[m.drawingPath]
              && findDrawingDefects(strFromU8(files[m.drawingPath])).length > 0);
            if (broken) setNeedsRepair(true);
          } catch (e) { console.error("[ExcelEditor] defect scan:", e); }
        }
      } catch (e) {
        console.error("[ExcelEditor] load error:", e);
        if (!cancelled) setError("Excelファイルの読み込みに失敗しました");
      }
    })();
    return () => { cancelled = true; disposeRef.current(); };
  }, [url, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const sheet = sheets?.[Math.min(active, (sheets?.length ?? 1) - 1)];

  // アクティブシートの表示データ。シート切替・構造変更でのみ作り直し、以後は in-place 更新する。
  const activeData = useMemo(() => {
    const d = sheet?.display.map(r => r.slice()) ?? [];
    gridDataRef.current = d;
    return d;
  }, [sheet?.name, gridVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const colHeaders = useMemo(() => {
    const n = sheet?.raw[0]?.length ?? 0;
    return Array.from({ length: n }, (_, i) => {
      let s = "", x = i + 1;
      while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
      return s;
    });
  }, [sheet?.name, sheet?.raw]);

  // ── 数式セルは編集開始時に数式文字列を出す ────────────────────
  const afterBeginEditing = useCallback((row: number, col: number) => {
    const m = sheetsRef.current?.[active];
    const raw = m?.raw[row]?.[col];
    if (typeof raw === "string" && raw.startsWith("=")) {
      const ed: any = (hotRef.current as any)?.hotInstance?.getActiveEditor?.();
      if (ed) ed.setValue(raw);
    }
  }, [active]);

  // ── 編集の反映＋再計算 ──────────────────────────────────────
  // ── Undo/Redo（全状態のスナップショット方式）─────────────────
  const snapshot = useCallback(() => ({
    sheets: (sheetsRef.current ?? []).map(m => ({
      raw: m.raw.map(r => r.slice()), original: m.original.map(r => r.slice()),
      display: m.display.map(r => r.slice()), fills: m.fills.map(r => r.slice()),
      baseFills: m.baseFills.map(r => r.slice()), baseWrap: m.baseWrap.map(r => r.slice()),
      rowHeights: m.rowHeights.slice(), colWidths: m.colWidths.slice(),
      baseRowHeights: m.baseRowHeights.slice(), autoRowH: m.autoRowH.slice(),
      drawings: m.drawings.map(o => ({ ...o })), totalW: m.totalW, totalH: m.totalH,
    })),
    align: cloneMapRec(cellAlignRef.current), wrap: cloneMapRec(cellWrapRef.current),
    links: cloneMapRec(linksRef.current),
    shapeEdits: cloneShapeEdits(shapeEditsRef.current), structOps: cloneStructOps(structOpsRef.current),
    colChg: cloneSetRec(colWidthChgRef.current), rowChg: cloneSetRec(rowHeightChgRef.current),
  }), []);

  const restore = useCallback((snap: any) => {
    const s = sheetsRef.current;
    if (s) snap.sheets.forEach((ms: any, i: number) => {
      const m = s[i]; if (!m) return;
      m.raw = ms.raw.map((r: string[]) => r.slice()); m.original = ms.original.map((r: string[]) => r.slice());
      m.display = ms.display.map((r: string[]) => r.slice()); m.fills = ms.fills.map((r: any[]) => r.slice());
      m.baseFills = ms.baseFills.map((r: any[]) => r.slice());
      m.baseWrap = ms.baseWrap.map((r: boolean[]) => r.slice());
      m.rowHeights = ms.rowHeights.slice(); m.colWidths = ms.colWidths.slice();
      m.baseRowHeights = ms.baseRowHeights.slice(); m.autoRowH = ms.autoRowH.slice();
      m.drawings = ms.drawings.map((o: any) => ({ ...o })); m.totalW = ms.totalW; m.totalH = ms.totalH;
    });
    cellAlignRef.current = cloneMapRec(snap.align); cellWrapRef.current = cloneMapRec(snap.wrap);
    linksRef.current = cloneMapRec(snap.links);
    shapeEditsRef.current = cloneShapeEdits(snap.shapeEdits); structOpsRef.current = cloneStructOps(snap.structOps);
    colWidthChgRef.current = cloneSetRec(snap.colChg); rowHeightChgRef.current = cloneSetRec(snap.rowChg);
    setGridVersion(v => v + 1); setDirty(true);
  }, []);

  const pushUndo = useCallback(() => {
    undoStack.current.push(snapshot());
    if (undoStack.current.length > 60) undoStack.current.shift();
    redoStack.current = [];
  }, [snapshot]);
  const undo = useCallback(() => {
    if (!undoStack.current.length) return;
    redoStack.current.push(snapshot());
    restore(undoStack.current.pop());
  }, [snapshot, restore]);
  const redo = useCallback(() => {
    if (!redoStack.current.length) return;
    undoStack.current.push(snapshot());
    restore(redoStack.current.pop());
  }, [snapshot, restore]);

  // キーボード：⌘/Ctrl+Z=戻す、⌘/Ctrl+Shift+Z or ⌘/Ctrl+Y=進む（入力中は除外）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [undo, redo]);

  // ── 折り返し／はみ出し（BRU10-055）──────────────────────────
  // そのセルが折り返し表示か（ユーザー変更 > 元ファイル）
  const wrapOf = useCallback((m: SheetModel, r: number, c: number): boolean =>
    cellWrapRef.current[m.name]?.get(`${r}:${c}`) ?? m.baseWrap[r]?.[c] ?? false, []);

  // 折り返しセルに合わせて行高を計算し直す（自動調整の行だけ）
  const recalcRowHeights = useCallback((m: SheetModel, rows: number[]) => {
    let changed = false;
    for (const r of rows) {
      if (!m.autoRowH[r]) continue;
      let h = m.baseRowHeights[r] ?? 24;
      for (let c = 0; c < m.colWidths.length; c++) {
        if (!wrapOf(m, r, c)) continue;
        const t = m.display[r]?.[c] ?? "";
        if (!t) continue;
        h = Math.max(h, wrapHeight(t, contentWidth(m.colWidths[c]), HOT_FONT, HOT_LINE_H, 2));
      }
      if (m.rowHeights[r] !== h) { m.rowHeights[r] = h; changed = true; }
    }
    if (changed) {
      m.totalH = m.rowHeights.reduce((a, b) => a + b, 0);
      const hot: any = (hotRef.current as any)?.hotInstance;
      if (hot && !hot.isDestroyed) hot.updateSettings({ rowHeights: m.rowHeights.slice() });
      setLayoutTick(v => v + 1);
    }
    return changed;
  }, [wrapOf]);

  // 図形編集はドラッグ中に多数発火するため、連続編集は300msでまとめて1手に
  const onShapeDirty = useCallback((objects: DrawingObject[], changedAnchors: number[]) => {
    const m = sheetsRef.current?.[active]; if (!m) return;
    if (!shapeSnapTimer.current) pushUndo();
    clearTimeout(shapeSnapTimer.current);
    shapeSnapTimer.current = setTimeout(() => { shapeSnapTimer.current = undefined; }, 300);
    shapeEditsRef.current[m.name] = { objects, changedAnchors };
    setDirty(true);
  }, [active, pushUndo]);

  // セル編集の前にスナップショット（Undo用）
  const beforeChange = useCallback((_changes: any[] | null, source: string) => {
    if (source === "edit" || String(source).startsWith("CopyPaste") || String(source).startsWith("Autofill")) pushUndo();
  }, [pushUndo]);

  const afterChange = useCallback((changes: any[] | null, source: string) => {
    if (!changes || source === "recompute" || source === "loadData" || source === "updateData") return;
    const m = sheetsRef.current?.[active];
    if (!m) return;
    for (const [row, col, , next] of changes) {
      if (!m.raw[row]) continue;
      m.raw[row][col] = next == null ? "" : String(next);
    }
    setDirty(true);
    recompute(m.raw, m.name).then(disp => {
      m.display = disp;
      // data 配列を in-place で更新（別配列に差し替えると再レンダーで巻き戻るため）
      const grid = gridDataRef.current;
      for (let r = 0; r < disp.length; r++) {
        if (!grid[r]) grid[r] = [];
        for (let c = 0; c < disp[r].length; c++) grid[r][c] = disp[r][c];
      }
      // 折り返しセルの中身が変わったら行高も追従させる（数式の再計算ぶんも含む）
      recalcRowHeights(m, m.rowHeights.map((_, i) => i));
      const hot: any = (hotRef.current as any)?.hotInstance;
      if (hot && !hot.isDestroyed) hot.render();
    });
  }, [active, recalcRowHeights]);

  // ── セル色（新規塗り）────────────────────────────────────────
  const applyFill = useCallback((color: string | null) => {
    const hot: any = (hotRef.current as any)?.hotInstance;
    const m = sheetsRef.current?.[active];
    if (!hot || !m) return;
    const ranges = hot.getSelected() as number[][] | undefined;
    if (!ranges) return;
    pushUndo();
    for (const [r1, c1, r2, c2] of ranges) {
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
        for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
          if (m.fills[r]) m.fills[r][c] = color;
        }
      }
    }
    setDirty(true);
    hot.render();
  }, [active, pushUndo]);

  // 描画オーバーレイの原点を、実際の (0,0) セルの位置から測る（ヘッダ幅・高さに依存しない）
  const measureOverlay = useCallback(() => {
    const hot: any = (hotRef.current as any)?.hotInstance;
    const wrap = wrapRef.current;
    if (!hot || hot.isDestroyed || !wrap) return;
    const td: HTMLElement | null = hot.getCell(0, 0);
    if (!td) return;
    const wr = wrap.getBoundingClientRect();
    const tr = td.getBoundingClientRect();
    const left = Math.round(tr.left - wr.left);
    const top = Math.round(tr.top - wr.top);
    setOverlayOffset(prev => (prev.left === left && prev.top === top ? prev : { left, top }));
  }, []);

  // BRU10-055 セル文字の見切れ対策。
  // 折り返しなら td 内で改行し、そうでなければ隣が空セルの間だけ文字をはみ出させる。
  // td は Handsontable が使い回すので、どの分岐でも必ず全プロパティを設定し直す。
  const applyTextLayout = useCallback((td: HTMLElement, m: SheetModel, row: number, col: number, align: "left" | "center" | "right", valign: "top" | "middle" | "bottom") => {
    td.style.position = "relative";
    if (wrapOf(m, row, col)) {
      td.style.whiteSpace = "pre-wrap";
      td.style.overflowWrap = "anywhere";
      td.style.overflow = "hidden";
      return;
    }
    td.style.whiteSpace = "nowrap";
    td.style.overflowWrap = "normal";
    td.style.overflow = "hidden";

    const line = m.display[row] ?? [];
    const text = flatText(line[col] ?? "");
    if (!text) return;
    const contentW = contentWidth(m.colWidths[col] ?? 0);
    const tw = textWidth(text, HOT_FONT);
    if (tw <= contentW) return;

    const { left, right } = spillExtents({
      col, widths: m.colWidths, isEmpty: (c) => (line[c] ?? "") === "",
      align, textW: tw, contentW,
    });
    if (left <= 0 && right <= 0) return;

    // はみ出しぶんは絶対配置の内箱で描く。内箱の幅＝はみ出せる範囲なので、
    // 隣に文字があるセルの手前でぴたりと切れる。
    td.style.overflow = "visible";
    td.textContent = "";
    const box = document.createElement("div");
    box.className = "xls-spill";
    box.textContent = text;
    box.style.left = `${-left}px`;
    box.style.width = `${(m.colWidths[col] ?? 0) + left + right}px`;
    box.style.justifyContent = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";
    box.style.alignItems = valign === "middle" ? "center" : valign === "bottom" ? "flex-end" : "flex-start";
    box.style.color = td.style.color;
    box.style.textDecoration = td.style.textDecoration;
    td.appendChild(box);
  }, [wrapOf]);

  const cells = useCallback(() => ({
    renderer(instance: any, td: HTMLElement, row: number, col: number, prop: any, value: any, cellProps: any) {
      textRenderer(instance, td, row, col, prop, value, cellProps);
      const m = sheetsRef.current?.[active];
      // ユーザーが塗った色を優先し、無ければ元ファイルの色を出す
      const color = m?.fills[row]?.[col] ?? m?.baseFills[row]?.[col];
      if (color) td.style.background = color;
      const al = cellAlignRef.current[m?.name ?? ""]?.get(`${row}:${col}`);
      if (al?.h) td.style.textAlign = al.h;
      if (al?.v) td.style.verticalAlign = al.v === "middle" ? "middle" : al.v;
      if (linksRef.current[m?.name ?? ""]?.has(`${row}:${col}`)) {
        td.style.color = "#2563EB"; td.style.textDecoration = "underline"; td.style.cursor = "pointer";
      }
      if (m) applyTextLayout(td, m, row, col, al?.h ?? "left", al?.v ?? "top");
    },
  }), [active, applyTextLayout]);

  // 選択範囲を「折り返し表示」「はみ出し表示」に切り替える
  const applyCellWrap = useCallback((wrap: boolean) => {
    const hot: any = (hotRef.current as any)?.hotInstance;
    const m = sheetsRef.current?.[active];
    if (!hot || !m) return;
    const ranges = hot.getSelected() as number[][] | undefined;
    if (!ranges) return;
    pushUndo();
    const map = cellWrapRef.current[m.name] ?? new Map<string, boolean>();
    cellWrapRef.current[m.name] = map;
    const rows = new Set<number>();
    for (const [r1, c1, r2, c2] of ranges) {
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
        for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
          if (r < 0 || c < 0) continue;
          map.set(`${r}:${c}`, wrap);
          rows.add(r);
        }
      }
    }
    setDirty(true);
    setCellWrapSel(wrap);
    recalcRowHeights(m, [...rows]);
    hot.render();
  }, [active, pushUndo, recalcRowHeights]);

  // セルの揃えを選択範囲へ適用
  const applyCellAlign = useCallback((h?: CellAlign["h"], v?: CellAlign["v"]) => {
    const hot: any = (hotRef.current as any)?.hotInstance;
    const m = sheetsRef.current?.[active];
    if (!hot || !m) return;
    const ranges = hot.getSelected() as number[][] | undefined;
    if (!ranges) return;
    pushUndo();
    const map = cellAlignRef.current[m.name] ?? new Map<string, CellAlign>();
    cellAlignRef.current[m.name] = map;
    for (const [r1, c1, r2, c2] of ranges) {
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
        for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
          if (r < 0 || c < 0) continue;
          const cur = map.get(`${r}:${c}`) ?? {};
          map.set(`${r}:${c}`, { h: h ?? cur.h, v: v ?? cur.v });
        }
      }
    }
    setDirty(true);
    hot.render();
    setCellSel(cur => ({ h: h ?? cur.h, v: v ?? cur.v }));
  }, [active, pushUndo]);

  // セル選択時に、そのセルの現在の揃えをツールバーへ反映（ハイライト用）
  const afterSelectionEnd = useCallback((r: number, c: number) => {
    overlayRef.current?.deselect();
    const m = sheetsRef.current?.[active];
    setCellSel(m ? (cellAlignRef.current[m.name]?.get(`${r}:${c}`) ?? {}) : {});
    setCellWrapSel(m && r >= 0 && c >= 0 ? wrapOf(m, r, c) : null);
  }, [active, wrapOf]);

  // セルの揃えを CellEdit に反映するための参照（handleSave 用）
  const alignFor = useCallback((sheetName: string, r: number, c: number): CellAlign | undefined => {
    return cellAlignRef.current[sheetName]?.get(`${r}:${c}`);
  }, []);

  // "r:c" キーのマップを行/列の増減に合わせて張り替える
  const remapKeys = <T,>(map: Map<string, T> | undefined, fn: (r: number, c: number) => [number, number] | null) => {
    if (!map) return;
    const entries = [...map.entries()];
    map.clear();
    for (const [k, v] of entries) {
      const [r, c] = k.split(":").map(Number);
      const nk = fn(r, c);
      if (nk) map.set(`${nk[0]}:${nk[1]}`, v);
    }
  };
  const recalcTotals = (m: SheetModel) => {
    m.totalW = m.colWidths.reduce((a, b) => a + b, 0);
    m.totalH = m.rowHeights.reduce((a, b) => a + b, 0);
  };
  const emptyRow = (n: number) => Array.from({ length: n }, () => "");
  const sumPx = (arr: number[], a: number, b: number) => arr.slice(a, b).reduce((x, y) => x + y, 0);

  // 図形・画像を行/列の増減に合わせて「移動だけ」する（サイズは変えない＝Excelの既定「移動」）。
  // 上端が境界以降のものを delta ぶんずらす。またぐ図形はそのまま（縮めない）。
  const shiftDrawings = (m: SheetModel, axis: "x" | "y", boundary: number, delta: number) => {
    const cur = shapeEditsRef.current[m.name]?.objects ?? m.drawings;
    const changed = new Set(shapeEditsRef.current[m.name]?.changedAnchors ?? []);
    const shifted = cur.map(o => {
      const t = axis === "x" ? o.x : o.y;
      if (t < boundary) return o;                 // 境界より上(左)は不変
      const nt = Math.max(0, t + delta);          // 下(右)は移動（サイズは保持）
      if (nt === t) return o;
      if (o.anchorIndex !== undefined) changed.add(o.anchorIndex);
      return axis === "x" ? { ...o, x: nt } : { ...o, y: nt };
    });
    shapeEditsRef.current[m.name] = { objects: shifted, changedAnchors: [...changed] };
    m.drawings = shifted;
  };

  const doInsertRows = useCallback((index0: number, cnt: number) => {
    const m = sheetsRef.current?.[active]; if (!m) return;
    pushUndo();
    const boundary = sumPx(m.rowHeights, 0, index0);
    const ncol = m.raw[0]?.length ?? 0;
    for (let k = 0; k < cnt; k++) {
      m.raw.splice(index0, 0, emptyRow(ncol)); m.original.splice(index0, 0, emptyRow(ncol));
      m.display.splice(index0, 0, emptyRow(ncol)); m.fills.splice(index0, 0, Array.from({ length: ncol }, () => null));
      m.baseFills.splice(index0, 0, Array.from({ length: ncol }, () => null));
      m.baseWrap.splice(index0, 0, Array.from({ length: ncol }, () => false));
      m.rowHeights.splice(index0, 0, 24);
      m.baseRowHeights.splice(index0, 0, 24);
      m.autoRowH.splice(index0, 0, true);
    }
    remapKeys(cellAlignRef.current[m.name], (r, c) => r >= index0 ? [r + cnt, c] : [r, c]);
    remapKeys(cellWrapRef.current[m.name], (r, c) => r >= index0 ? [r + cnt, c] : [r, c]);
    remapKeys(linksRef.current[m.name], (r, c) => r >= index0 ? [r + cnt, c] : [r, c]);
    shiftDrawings(m, "y", boundary, cnt * 24);
    (structOpsRef.current[m.name] ??= []).push({ type: "insertRow", at: index0 + 1, count: cnt });
    recalcTotals(m); setDirty(true); setGridVersion(v => v + 1);
  }, [active]);

  const doRemoveRows = useCallback((index0: number, cnt: number) => {
    const m = sheetsRef.current?.[active]; if (!m) return;
    pushUndo();
    const boundary = sumPx(m.rowHeights, 0, index0);
    const deleted = sumPx(m.rowHeights, index0, index0 + cnt);
    [m.raw, m.original, m.display, m.fills, m.baseFills, m.baseWrap, m.rowHeights, m.baseRowHeights, m.autoRowH]
      .forEach(a => (a as any[]).splice(index0, cnt));
    remapKeys(cellAlignRef.current[m.name], (r, c) => (r >= index0 && r < index0 + cnt) ? null : (r >= index0 + cnt ? [r - cnt, c] : [r, c]));
    remapKeys(cellWrapRef.current[m.name], (r, c) => (r >= index0 && r < index0 + cnt) ? null : (r >= index0 + cnt ? [r - cnt, c] : [r, c]));
    remapKeys(linksRef.current[m.name], (r, c) => (r >= index0 && r < index0 + cnt) ? null : (r >= index0 + cnt ? [r - cnt, c] : [r, c]));
    shiftDrawings(m, "y", boundary, -deleted);
    (structOpsRef.current[m.name] ??= []).push({ type: "removeRow", at: index0 + 1, count: cnt });
    recalcTotals(m); setDirty(true); setGridVersion(v => v + 1);
  }, [active]);

  const doInsertCols = useCallback((index0: number, cnt: number) => {
    const m = sheetsRef.current?.[active]; if (!m) return;
    pushUndo();
    const boundary = sumPx(m.colWidths, 0, index0);
    for (const arr of [m.raw, m.original, m.display]) for (const row of arr) row.splice(index0, 0, ...Array.from({ length: cnt }, () => ""));
    for (const arr of [m.fills, m.baseFills]) for (const row of arr) row.splice(index0, 0, ...Array.from({ length: cnt }, () => null));
    for (const row of m.baseWrap) row.splice(index0, 0, ...Array.from({ length: cnt }, () => false));
    m.colWidths.splice(index0, 0, ...Array.from({ length: cnt }, () => 64));
    remapKeys(cellAlignRef.current[m.name], (r, c) => c >= index0 ? [r, c + cnt] : [r, c]);
    remapKeys(cellWrapRef.current[m.name], (r, c) => c >= index0 ? [r, c + cnt] : [r, c]);
    remapKeys(linksRef.current[m.name], (r, c) => c >= index0 ? [r, c + cnt] : [r, c]);
    shiftDrawings(m, "x", boundary, cnt * 64);
    (structOpsRef.current[m.name] ??= []).push({ type: "insertCol", at: index0 + 1, count: cnt });
    recalcTotals(m); setDirty(true); setGridVersion(v => v + 1);
  }, [active]);

  const doRemoveCols = useCallback((index0: number, cnt: number) => {
    const m = sheetsRef.current?.[active]; if (!m) return;
    pushUndo();
    const boundary = sumPx(m.colWidths, 0, index0);
    const deleted = sumPx(m.colWidths, index0, index0 + cnt);
    for (const arr of [m.raw, m.original, m.display, m.fills, m.baseFills, m.baseWrap]) for (const row of arr) (row as any[]).splice(index0, cnt);
    m.colWidths.splice(index0, cnt);
    remapKeys(cellAlignRef.current[m.name], (r, c) => (c >= index0 && c < index0 + cnt) ? null : (c >= index0 + cnt ? [r, c - cnt] : [r, c]));
    remapKeys(cellWrapRef.current[m.name], (r, c) => (c >= index0 && c < index0 + cnt) ? null : (c >= index0 + cnt ? [r, c - cnt] : [r, c]));
    remapKeys(linksRef.current[m.name], (r, c) => (c >= index0 && c < index0 + cnt) ? null : (c >= index0 + cnt ? [r, c - cnt] : [r, c]));
    shiftDrawings(m, "x", boundary, -deleted);
    (structOpsRef.current[m.name] ??= []).push({ type: "removeCol", at: index0 + 1, count: cnt });
    recalcTotals(m); setDirty(true); setGridVersion(v => v + 1);
  }, [active]);

  // リンクの挿入・編集
  const insertLink = useCallback((sel: any[]) => {
    const m = sheetsRef.current?.[active]; if (!m || !sel?.[0]) return;
    const r = sel[0].start.row, c = sel[0].start.col;
    if (r < 0 || c < 0) return;
    const map = linksRef.current[m.name] ?? new Map<string, string>();
    linksRef.current[m.name] = map;
    const cur = map.get(`${r}:${c}`) ?? "https://";
    const url = window.prompt("リンクURL（http/https/mailto。空で解除）", cur);
    if (url === null) return;
    pushUndo();
    if (url.trim() === "") map.delete(`${r}:${c}`); else map.set(`${r}:${c}`, url.trim());
    setDirty(true);
    (hotRef.current as any)?.hotInstance?.render();
  }, [active]);

  // 列幅・行高のドラッグ変更を記録（保存で xlsx へ）
  const afterColumnResize = useCallback((newSize: number, column: number) => {
    const m = sheetsRef.current?.[active]; if (!m) return;
    pushUndo();
    m.colWidths[column] = newSize; recalcTotals(m);
    (colWidthChgRef.current[m.name] ??= new Set()).add(column);
    // 幅が変われば折り返しの行数も変わる
    recalcRowHeights(m, m.rowHeights.map((_, i) => i));
    setDirty(true);
  }, [active, recalcRowHeights]);
  const afterRowResize = useCallback((newSize: number, row: number) => {
    const m = sheetsRef.current?.[active]; if (!m) return;
    pushUndo();
    // 手で高さを決めた行は、以後は折り返しでの自動調整をしない（Excel と同じ）
    m.rowHeights[row] = newSize; m.baseRowHeights[row] = newSize; m.autoRowH[row] = false;
    recalcTotals(m);
    (rowHeightChgRef.current[m.name] ??= new Set()).add(row);
    setDirty(true);
  }, [active]);

  // 右クリックメニュー
  const range = (sel: any[]) => {
    const s = sel[0];
    return { r0: Math.min(s.start.row, s.end.row), r1: Math.max(s.start.row, s.end.row), c0: Math.min(s.start.col, s.end.col), c1: Math.max(s.start.col, s.end.col) };
  };
  const contextMenu = useMemo(() => ({
    items: {
      copy: {}, cut: {},
      sep1: { name: "---------" },
      ins_row_above: { name: "上に行を挿入", callback: (_k: any, sel: any[]) => { const g = range(sel); doInsertRows(g.r0, g.r1 - g.r0 + 1); } },
      ins_row_below: { name: "下に行を挿入", callback: (_k: any, sel: any[]) => { const g = range(sel); doInsertRows(g.r1 + 1, g.r1 - g.r0 + 1); } },
      del_row: { name: "行を削除", callback: (_k: any, sel: any[]) => { const g = range(sel); doRemoveRows(g.r0, g.r1 - g.r0 + 1); } },
      sep2: { name: "---------" },
      ins_col_left: { name: "左に列を挿入", callback: (_k: any, sel: any[]) => { const g = range(sel); doInsertCols(g.c0, g.c1 - g.c0 + 1); } },
      ins_col_right: { name: "右に列を挿入", callback: (_k: any, sel: any[]) => { const g = range(sel); doInsertCols(g.c1 + 1, g.c1 - g.c0 + 1); } },
      del_col: { name: "列を削除", callback: (_k: any, sel: any[]) => { const g = range(sel); doRemoveCols(g.c0, g.c1 - g.c0 + 1); } },
      sep3: { name: "---------" },
      al_l: { name: "左寄せ", callback: () => applyCellAlign("left") },
      al_c: { name: "中央寄せ", callback: () => applyCellAlign("center") },
      al_r: { name: "右寄せ", callback: () => applyCellAlign("right") },
      al_t: { name: "上寄せ", callback: () => applyCellAlign(undefined, "top") },
      al_m: { name: "中央（縦）", callback: () => applyCellAlign(undefined, "middle") },
      al_b: { name: "下寄せ", callback: () => applyCellAlign(undefined, "bottom") },
      sep4: { name: "---------" },
      wrap_on: { name: "折り返して全体を表示", callback: () => applyCellWrap(true) },
      wrap_off: { name: "折り返さない（はみ出し表示）", callback: () => applyCellWrap(false) },
      sep5: { name: "---------" },
      link: { name: "リンクを挿入/編集", callback: (_k: any, sel: any[]) => insertLink(sel) },
    },
  }), [doInsertRows, doRemoveRows, doInsertCols, doRemoveCols, applyCellAlign, applyCellWrap, insertLink]);

  // ── 保存 ────────────────────────────────────────────────────
  // doSave: 保存だけ行い成功可否を返す（閉じる処理はしない）
  const doSave = useCallback(async (): Promise<boolean> => {
    const models = sheetsRef.current;
    const bytes = originalBytesRef.current;
    if (!models || !bytes) return false;
    setSaving(true);
    try {
      const edits: CellEdit[] = [];
      for (const m of models) {
        for (let r = 0; r < m.raw.length; r++) {
          for (let c = 0; c < m.raw[r].length; c++) {
            const cur = m.raw[r][c] ?? "";
            const orig = m.original[r][c] ?? "";
            const fill = m.fills[r]?.[c] ?? undefined;
            const al = alignFor(m.name, r, c);
            // 折り返しはユーザーが明示的に切り替えたセルだけ書き戻す
            const wrapU = cellWrapRef.current[m.name]?.get(`${r}:${c}`);
            const wrap = (wrapU !== undefined && wrapU !== (m.baseWrap[r]?.[c] ?? false)) ? wrapU : undefined;
            const valueChanged = cur !== orig;
            const fillChanged = fill !== undefined && fill !== null;
            const alignChanged = !!(al?.h || al?.v);
            if (!valueChanged && !fillChanged && !alignChanged && wrap === undefined) continue;

            let kind: CellEdit["kind"]; let value = cur; let cached: string | undefined;
            // 値が変わっていないなら書式だけ当てる（日付・数値書式を壊さない）
            if (!valueChanged) kind = "keep";
            else if (cur === "") kind = "blank";
            else if (cur.startsWith("=")) { kind = "formula"; cached = m.display[r]?.[c]; }
            else if (isNumeric(cur)) kind = "number";
            else kind = "string";

            edits.push({ sheet: m.name, row: r + 1, col: c + 1, kind, value, cached, fill, align: al?.h, valign: al?.v, wrap });
          }
        }
      }

      let out = bytes;

      // 1) 構造編集（行/列の挿入・削除）を記録順に適用
      let structuralTouched = false;
      for (const m of models) {
        for (const op of structOpsRef.current[m.name] ?? []) {
          structuralTouched = true;
          if (op.type === "insertRow") out = insertRows(out, m.name, op.at, op.count);
          else if (op.type === "removeRow") out = removeRows(out, m.name, op.at, op.count);
          else if (op.type === "insertCol") out = insertCols(out, m.name, op.at, op.count);
          else if (op.type === "removeCol") out = removeCols(out, m.name, op.at, op.count);
        }
      }
      // 2) 列幅・行高
      for (const m of models) {
        const cw = [...(colWidthChgRef.current[m.name] ?? [])].filter(ci => m.colWidths[ci] != null).map(ci => ({ col: ci + 1, px: m.colWidths[ci] }));
        const rh = [...(rowHeightChgRef.current[m.name] ?? [])].filter(ri => m.rowHeights[ri] != null).map(ri => ({ row: ri + 1, px: m.rowHeights[ri] }));
        if (cw.length) { out = setColWidths(out, m.name, cw); structuralTouched = true; }
        if (rh.length) { out = setRowHeights(out, m.name, rh); structuralTouched = true; }
      }
      // 3) セル値・色・揃え
      out = patchXlsx(out, edits);
      // 4) ハイパーリンク
      for (const m of models) {
        const map = linksRef.current[m.name];
        if (map?.size) {
          const links = [...map.entries()].map(([k, url]) => { const [r, c] = k.split(":").map(Number); return { ref: colLetter(c + 1) + (r + 1), url }; });
          out = addHyperlinks(out, m.name, links); structuralTouched = true;
        }
      }

      // 図形編集を反映（シートごとに drawingN.xml を差し替え）
      const editedSheets: string[] = [];
      for (const m of models) {
        const se = shapeEditsRef.current[m.name];
        if (!se || !m.drawingPath) continue;
        const hasNew = se.objects.some(o => o.anchorIndex === undefined);
        if (se.changedAnchors.length === 0 && !hasNew) continue;
        out = patchXlsxDrawing(out, m.drawingPath, se.objects, new Set(se.changedAnchors));
        editedSheets.push(m.name);
      }

      // 既に壊れている drawing の自己修復。
      // 旧バージョンのバグ（cNvPr/@id の重複・吹き出しの調整値欠落）を抱えたファイルは、
      // このまま保存しても Excel 側で描画が全消えになるため、ここで直しておく。
      // 図形を編集したシートも含めて全 drawing を対象にする（修復は冪等）。
      let repaired = false;
      try {
        const paths = models.filter(m => m.drawingPath).map(m => m.drawingPath as string);
        const fixed = repairDrawings(out, paths);
        if (fixed) { out = fixed; repaired = true; }
      } catch (e) { console.error("[ExcelEditor] repair drawings:", e); }

      // 破損ガード：生成物が exceljs で開け、描画XMLが整形式かつ図形IDが一意であることを確認
      if (editedSheets.length > 0 || structuralTouched || repaired) {
        const okVerify = await verifyXlsx(out, models);
        if (!okVerify) {
          setError("図形の書き戻しに失敗しました（ファイル整合性チェックに不合格）。保存を中止しました。元ファイルは無傷です。");
          setSaving(false);
          return false;
        }
      }

      // Uint8Array -> ArrayBuffer（BlobParts に安全に渡す）
      const ab = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
      const blob = new Blob([ab], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const newFile = new File([blob], file.fileName, { type: blob.type });

      let targetParentId = (file as any).parentId ?? (file as any).parent_id ?? (file as any).folderId ?? null;
      if (isSupabaseEnabled && file.id) {
        try {
          const { data } = await supabase!.from("project_files").select("parent_id").eq("id", file.id).single();
          if (data && data.parent_id) targetParentId = data.parent_id;
        } catch (err) {
          console.warn("parent_id fetch failed", err);
        }
      }

      // APIに更新対象のファイルIDを明示的に伝える
      await uploadProjectFile(file.projectId, newFile, { parentId: targetParentId, fileId: file.id });
      onSaved();
      setDirty(false);
      setNeedsRepair(false);
      return true;
    } catch (e) {
      console.error("[ExcelEditor] save error:", e);
      setError(e instanceof Error ? e.message : "保存に失敗しました");
      return false;
    } finally {
      setSaving(false);
    }
  }, [file, onSaved]);

  // 保存ボタン：保存して編集を閉じる
  const handleSave = useCallback(async () => {
    if (await doSave()) onClose();
  }, [doSave, onClose]);

  // 親（モーダル）が未保存確認・保存を行えるように公開
  useImperativeHandle(ref, () => ({ isDirty: () => dirty, save: () => doSave() }), [dirty, doSave]);

  if (error) return (
    <Centered>
      <div style={{ textAlign: "center" }}>
        <div style={{ marginBottom: 12 }}>{error}</div>
        <button onClick={() => { setError(""); setReloadKey(k => k + 1); }}
          style={{ padding: "7px 16px", background: "#059669", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          再読み込み
        </button>
      </div>
    </Centered>
  );
  if (!sheets || !sheet) return <Centered><Loader2 style={{ width: 22, height: 22, animation: "spin 1s linear infinite" }} /> 読み込み中...</Centered>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* 右クリックメニューはフルスクリーンのモーダル(z-index:9999)より前面に出す */}
      <style>{`.htMenu, .htContextMenu, .htContextMenu .wtHolder, .htDropdownMenu { z-index: 12000 !important; }` + CELL_CSS}</style>
      {needsRepair && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#FEF3C7", color: "#92400E", fontSize: 12, fontWeight: 600, borderBottom: "1px solid #FDE68A", flexShrink: 0 }}>
          このファイルは以前の不具合で図形データが壊れており、Excel で開くと画像・図形が消えます。「保存（新バージョン）」を押すと修復されます。
        </div>
      )}
      {/* ツールバー */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid rgba(26,23,20,0.07)", flexShrink: 0, flexWrap: "wrap" }}>
        <button onMouseDown={keepSel} onClick={undo} style={shapeBtn} title="元に戻す（⌘/Ctrl+Z）"><Undo2 style={sIc} /></button>
        <button onMouseDown={keepSel} onClick={redo} style={shapeBtn} title="やり直し（⌘/Ctrl+Shift+Z）"><Redo2 style={sIc} /></button>
        <div style={sep} />
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="color" value={fillColor} onChange={e => setFillColor(e.target.value)}
            title="塗りつぶし色" style={{ width: 26, height: 26, padding: 0, border: "1px solid rgba(26,23,20,0.15)", borderRadius: 6, cursor: "pointer", background: "none" }} />
          <button onMouseDown={keepSel} onClick={() => applyFill(fillColor)} style={toolBtn}>
            <PaintBucket style={{ width: 12, height: 12 }} />選択セルを塗る
          </button>
          <button onMouseDown={keepSel} onClick={() => applyFill(null)} style={{ ...toolBtn, color: "#6B6458", background: "#F4F5F6", border: "1px solid rgba(26,23,20,0.10)" }}>
            解除
          </button>
        </div>
        <div style={sep} />
        {/* 揃え（図形を選択中なら図形に、そうでなければセルに効く。状態をハイライト） */}
        {(() => {
          const curH = shapeSelected ? shapeInfo?.hAlign : cellSel.h;
          const curV = shapeSelected ? shapeInfo?.vAlign : cellSel.v;
          const setH = (a: "left" | "center" | "right") => shapeSelected ? overlayRef.current?.setHAlign(a) : applyCellAlign(a);
          const setV = (a: "top" | "middle" | "bottom") => shapeSelected ? overlayRef.current?.setVAlign(a) : applyCellAlign(undefined, a);
          return (
            <>
              <button onMouseDown={keepSel} onClick={() => setH("left")} style={abtn(curH === "left")} title="左寄せ"><AlignLeft style={sIc} /></button>
              <button onMouseDown={keepSel} onClick={() => setH("center")} style={abtn(curH === "center")} title="中央寄せ"><AlignCenter style={sIc} /></button>
              <button onMouseDown={keepSel} onClick={() => setH("right")} style={abtn(curH === "right")} title="右寄せ"><AlignRight style={sIc} /></button>
              <button onMouseDown={keepSel} onClick={() => setV("top")} style={avbtn(curV === "top")} title="上寄せ">上</button>
              <button onMouseDown={keepSel} onClick={() => setV("middle")} style={avbtn(curV === "middle")} title="中央（縦）">中</button>
              <button onMouseDown={keepSel} onClick={() => setV("bottom")} style={avbtn(curV === "bottom")} title="下寄せ">下</button>
            </>
          );
        })()}
        <div style={sep} />
        {/* 折り返し / はみ出しの切り替え（BRU10-055） */}
        <button onMouseDown={keepSel} onClick={() => applyCellWrap(true)} style={abtn(cellWrapSel === true)}
          title="折り返して全体を表示（セル幅で改行し、行の高さを広げる）"><WrapText style={sIc} /></button>
        <button onMouseDown={keepSel} onClick={() => applyCellWrap(false)} style={abtn(cellWrapSel === false)}
          title="折り返さない（隣が空セルならはみ出して表示）"><MoveHorizontal style={sIc} /></button>
        <div style={sep} />
        {/* 図形の追加（いつでも） */}
        <button onClick={() => overlayRef.current?.addShape("rect")} style={shapeBtn} title="矩形を追加"><Square style={sIc} /></button>
        <button onClick={() => overlayRef.current?.addShape("roundRect")} style={shapeBtn} title="角丸矩形"><Square style={{ ...sIc, borderRadius: 3 }} /></button>
        <button onClick={() => overlayRef.current?.addShape("ellipse")} style={shapeBtn} title="楕円"><Circle style={sIc} /></button>
        <button onClick={() => overlayRef.current?.addShape("callout")} style={shapeBtn} title="吹き出し"><MessageSquare style={sIc} /></button>
        <button onClick={() => overlayRef.current?.addShape("line")} style={shapeBtn} title="直線"><Minus style={sIc} /></button>
        <button onClick={() => overlayRef.current?.addShape("arrow")} style={shapeBtn} title="矢印"><MoveRight style={sIc} /></button>
        <button onClick={() => overlayRef.current?.addShape("text")} style={shapeBtn} title="テキストボックス"><Type style={sIc} /></button>
        <div style={{ flex: 1 }} />
        {/* 編集が無くても、壊れた描画の修復のために保存できるようにする */}
        {(() => {
          const canSave = dirty || needsRepair; return (
            <button onClick={handleSave} disabled={saving || !canSave}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", background: canSave ? "#059669" : "#D4CEC8", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: canSave && !saving ? "pointer" : "default" }}>
              {saving ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Save style={{ width: 12, height: 12 }} />}
              {saving ? "保存中..." : needsRepair && !dirty ? "修復して保存" : "保存（新バージョン）"}
            </button>
          );
        })()}
      </div>

      {/* 図形の書式ツールバー（図形選択時のみ） */}
      {shapeSelected && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderBottom: "1px solid rgba(124,58,237,0.15)", background: "#F5F3FF", flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#7C3AED", marginRight: 2 }}>選択中の図形</span>
          <label style={colorLabel}>塗<input type="color" value={shapeFill} onChange={e => { setShapeFill(e.target.value); overlayRef.current?.recolorFill(e.target.value); }} style={colorInput} title="塗り色" /></label>
          <label style={colorLabel}>線<input type="color" value={shapeLine} onChange={e => { setShapeLine(e.target.value); overlayRef.current?.recolorLine(e.target.value); }} style={colorInput} title="線の色" /></label>
          <label style={colorLabel}>字<input type="color" value={shapeText} onChange={e => { setShapeText(e.target.value); overlayRef.current?.recolorText(e.target.value); }} style={colorInput} title="文字色" /></label>
          <span style={{ fontSize: 10, color: "#9E8FC4", marginLeft: 2 }}>（揃えは上のツールバー）</span>
          <div style={sep} />
          <button onClick={() => overlayRef.current?.bring("front")} style={shapeBtn} title="前面へ"><BringToFront style={sIc} /></button>
          <button onClick={() => overlayRef.current?.bring("back")} style={shapeBtn} title="背面へ"><SendToBack style={sIc} /></button>
          <button onClick={() => overlayRef.current?.deleteSelected()} style={{ ...shapeBtn, color: "#DC2626" }} title="削除（Delキー）"><Trash2 style={sIc} /></button>
        </div>
      )}

      {/* 注意バー */}
      <p style={{ margin: 0, padding: "5px 12px", fontSize: 11, color: "#92400E", background: "#FEF3C7", borderBottom: "1px solid rgba(217,119,6,0.2)", flexShrink: 0 }}>
        右クリックで行/列の挿入・削除・コピー・リンク・揃え・折り返し。境界ドラッグで列幅/行高を変更。図形はクリックで選択して編集。
        ⚠ 行/列の挿入・削除では数式の参照は自動補正されません。図形編集の保存時は図形レイヤーが再生成されます。
        {sheet.truncated && `（大きいシートのため先頭 ${MAX_ROWS}行×${MAX_COLS}列 のみ編集対象）`}
      </p>

      {/* シートタブ */}
      {sheets.length > 1 && (
        <div style={{ display: "flex", gap: 4, padding: "8px 12px 0", flexWrap: "wrap", flexShrink: 0 }}>
          {sheets.map((s, i) => (
            <button key={s.name + i} onClick={() => setActive(i)}
              style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: "6px 6px 0 0", cursor: "pointer", background: i === active ? "#059669" : "#F4F5F6", color: i === active ? "#fff" : "#6B6458" }}>
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* グリッド＋描画レイヤー（画像・図形は表示のみ）。
          Handsontable を実サイズで描画し、外側 div でスクロールさせることで
          描画オーバーレイとセルが一緒にスクロールし、位置がズレない。 */}
      <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: "8px 12px 12px", background: "#fff" }}>
        <div ref={wrapRef} className="bulk-hot-wrap xls-hot" style={{ position: "relative", width: ROW_HEADER_W + sheet.totalW + 4 }}>
          <HotTable
            key={sheet.name + ":" + gridVersion}
            ref={hotRef}
            data={activeData}
            colHeaders={colHeaders}
            rowHeaders={true}
            rowHeaderWidth={ROW_HEADER_W}
            colWidths={sheet.colWidths}
            rowHeights={sheet.rowHeights}
            width={ROW_HEADER_W + sheet.totalW + 4}
            height="auto"
            renderAllRows={true}
            viewportColumnRenderingOffset={300}
            autoColumnSize={false}
            autoRowSize={false}
            outsideClickDeselects={false}
            undo={false}
            manualColumnResize={true}
            manualRowResize={true}
            licenseKey="non-commercial-and-evaluation"
            contextMenu={contextMenu}
            cells={cells as any}
            beforeChange={beforeChange as any}
            afterChange={afterChange as any}
            afterBeginEditing={afterBeginEditing as any}
            afterColumnResize={afterColumnResize as any}
            afterRowResize={afterRowResize as any}
            afterSelectionEnd={afterSelectionEnd as any}
            afterRender={measureOverlay as any}
          />
          {/* 図形オーバーレイは常時操作可。図形以外は透過してセル編集できる */}
          <ShapeEditorOverlay ref={overlayRef} key={"se-" + sheet.name + ":" + gridVersion}
            initialObjects={shapeEditsRef.current[sheet.name]?.objects ?? sheet.drawings}
            offsetLeft={overlayOffset.left} offsetTop={overlayOffset.top}
            width={sheet.totalW} height={sheet.totalH}
            onSelectChange={(info) => {
              setShapeInfo(info);
              if (info) {
                if (info.fill) setShapeFill(info.fill);
                if (info.line) setShapeLine(info.line);
                if (info.textColor) setShapeText(info.textColor);
              }
            }}
            onDirty={onShapeDirty} />
        </div>
      </div>
    </div>
  );
});

const toolBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 5, padding: "5px 10px",
  background: "#ECFDF5", color: "#059669", border: "1px solid #A7F3D0",
  borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer",
};

const shapeBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 26,
  background: "#fff", color: "#6B4E9E", border: "1px solid #DDD6FE", borderRadius: 6, cursor: "pointer",
};
const vBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", minWidth: 24, height: 26, padding: "0 4px",
  background: "#fff", color: "#6B4E9E", border: "1px solid #DDD6FE", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700,
};
const sIc: React.CSSProperties = { width: 13, height: 13 };
const sep: React.CSSProperties = { width: 1, height: 18, background: "rgba(124,58,237,0.2)", margin: "0 3px" };
const colorInput: React.CSSProperties = { width: 24, height: 24, padding: 0, border: "1px solid rgba(26,23,20,0.15)", borderRadius: 5, cursor: "pointer", background: "none" };
const colorLabel: React.CSSProperties = { display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "#6B6458" };
// ツールバーのボタンでグリッドのセル選択が外れないよう、フォーカス移動を抑止する
const keepSel = (e: React.MouseEvent) => e.preventDefault();
// 選択中の揃えをハイライトするボタンスタイル
const abtn = (on: boolean): React.CSSProperties => on ? { ...shapeBtn, background: "#7C3AED", color: "#fff", border: "1px solid #7C3AED" } : shapeBtn;
const avbtn = (on: boolean): React.CSSProperties => on ? { ...vBtn, background: "#7C3AED", color: "#fff", border: "1px solid #7C3AED" } : vBtn;

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: "100%", color: "#B0A9A4", fontSize: 12 }}>{children}</div>;
}
