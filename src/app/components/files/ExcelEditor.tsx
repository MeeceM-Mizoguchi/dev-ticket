import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from "react";
import { HotTable } from "@handsontable/react";
import { registerAllModules } from "handsontable/registry";
import { textRenderer } from "handsontable/renderers";
import { Loader2, Save, PaintBucket, Square, Circle, MessageSquare, Minus, MoveRight, Type, Trash2, BringToFront, SendToBack, AlignLeft, AlignCenter, AlignRight, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, Plus, Pencil, Undo2, Redo2, WrapText, MoveHorizontal } from "lucide-react";
import type { ProjectFile } from "@/app/types";
import { uploadProjectFile, fetchSignedUrl } from "@/app/lib/projectFiles";
import { patchXlsx, colLetter, type CellEdit } from "@/app/lib/xlsxEdit";
import { insertRows, removeRows, insertCols, removeCols, copyRows, copyCols, setColWidths, setRowHeights, addHyperlinks } from "@/app/lib/xlsxStructure";
import { addSheet, removeSheet, renameSheet, validateSheetName } from "@/app/lib/xlsxSheets";
import { parseXlsxDrawings, type DrawingObject } from "@/app/lib/xlsxDrawing";
import { patchXlsxDrawing, repairDrawings, findDrawingDefects } from "@/app/lib/xlsxDrawingWrite";
import { parseThemePalette, resolveFill } from "@/app/lib/xlsxCellColor";
import { parseXfFonts, parseCellStyleIndexes, type CellFont } from "@/app/lib/xlsxCellStyle";
import {
  clipToTsv, clipToHtml, parseTsv, parseHtmlTable, readClipPayload, emptyClip, type ClipCell,
} from "@/app/lib/xlsxClipboard";
import { unzipSync, strFromU8 } from "fflate";
import { ShapeEditorOverlay, type ShapeEditorHandle, type SelectInfo } from "./ShapeEditorOverlay";
import {
  CHAR_PX, COL_PADDING_PX, DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT_PT, PT_TO_PX,
} from "./ExcelViewer";
import {
  textWidth, wrapHeight, spillExtents, shouldWrap, fitColumnWidth, AUTOFIT_MAX_W, type FontSpec,
} from "@/app/lib/xlsxTextLayout";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";

// ENHA2-035 Excel(.xlsx/.xlsm) 画面内エディタ
//
// 値・数式・セル色を Handsontable で編集し、保存時は xlsxEdit.patchXlsx で
// 元ファイルの該当セルだけを書き換える（グラフ・画像・図形は保持される）。
// 数式は fast-formula-parser でその場再計算して表示する。

registerAllModules();

const MAX_ROWS = 400;
const MAX_COLS = 80;
// 中身が少ないシートでも、この行数・列数までは空欄を出しておく（足りなければ挿入で増やす）
const MIN_ROWS = 100;
const MIN_COLS = 30;

// エディタ内部の「真の値」グリッド。formula は "=..." 文字列で保持する。
type Grid = string[][];

// BRU10-055 セル文字のレイアウト。Handsontable の既定スタイルに合わせた値で、
// 文字幅の計測(canvas)と実際の描画を一致させる（CSS 側は CELL_CSS で固定）。
const HOT_FONT_FAMILY = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif`;
const HOT_FONT_PX = 13;
const HOT_LINE_H = 21;   // handsontable 既定の line-height
const HOT_PAD_X = 4;     // handsontable 既定の padding: 0 4px
const HOT_FONT: FontSpec = { size: HOT_FONT_PX, family: HOT_FONT_FAMILY };
// セル幅から、文字を置ける幅（左右パディング＋右枠）を引く
const contentWidth = (cellW: number) => cellW - HOT_PAD_X * 2 - 1;
// 折り返しなしのセルは改行が空白になって1行に並ぶ
const flatText = (s: string) => s.replace(/\n/g, " ");
const CELL_CSS = `
.xls-hot .htCore td { font-family: ${HOT_FONT_FAMILY}; font-size: ${HOT_FONT_PX}px; line-height: ${HOT_LINE_H}px; }
.xls-hot .htCore td .xls-spill { position: absolute; top: 0; bottom: 0; display: flex; box-sizing: border-box;
  padding: 0 ${HOT_PAD_X}px; white-space: nowrap; overflow: hidden; pointer-events: none;
  /* 右隣のセルは白い背景を持つので、重ねて描かないと はみ出した文字が隠れてしまう */
  z-index: 1; }
/* BRU13-023 列ヘッダ(A,B,C…)と行ヘッダ(1,2,3…)をスクロールしても消えないように固定する。
   Handsontable は自前でスクロールせず外側の div がスクロールする作りなので、
   ヘッダのクローン層（絶対配置）はそのまま流れていってしまう。
   本体と同じ升目に grid で重ねたうえで position: sticky にして、スクロールに追従させる。 */
.xls-hot > .handsontable { display: grid; overflow: visible !important; }
.xls-hot > .handsontable > .ht_master,
.xls-hot > .handsontable > .ht_clone_top,
.xls-hot > .handsontable > .ht_clone_inline_start,
.xls-hot > .handsontable > .ht_clone_top_inline_start_corner {
  grid-area: 1 / 1; align-self: start; justify-self: start; }
.xls-hot > .handsontable > .ht_clone_top { position: sticky !important; top: 0; }
.xls-hot > .handsontable > .ht_clone_inline_start { position: sticky !important; left: 0; }
.xls-hot > .handsontable > .ht_clone_top_inline_start_corner { position: sticky !important; top: 0; left: 0; }
/* 列幅・行高のドラッグつまみは表本体を基準に置かれるので、固定したヘッダの位置まで動かす */
.xls-hot > .handsontable > .manualColumnResizer { transform: translateY(var(--xls-sy, 0px)); }
.xls-hot > .handsontable > .manualRowResizer { transform: translateX(var(--xls-sx, 0px)); }
`;

interface SheetModel {
  name: string;
  raw: Grid;        // 編集中の真の値（数式は "=..."）
  original: Grid;   // 差分判定用の元の値
  display: Grid;    // 数式を解決した表示値
  fills: (string | null)[][]; // 新規に塗ったセル色
  baseFills: (string | null)[][]; // 元ファイルが持つセル色（表示専用。保存では書き戻さない）
  baseWrap: boolean[][];      // 元ファイルの折り返し設定（BRU10-055）
  baseStyle: number[][];      // 元ファイルの書式インデックス（styles.xml の cellXfs 番号）
  styleIdx: (number | null)[][]; // 貼り付けでコピーしてきた書式インデックス（BRU13-019）
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

// BRU13-023 セル編集中の入力欄の折り返し幅。
// Handsontable は「表の幅」から入力欄の最大幅を決めるが、このエディタは表を実寸で描いて
// 外側の div でスクロールさせるため、その最大幅が画面の幅と大きくかけ離れてしまう。
// 実際に見えている右端までを最大幅として渡し直し、そこで折り返させる。
const EDITOR_EDGE_GAP = 16;  // 右端に残す余白（縦スクロールバーぶん）
const EDITOR_MIN_W = 220;    // 右端ぎりぎりのセルでも、これだけは横幅を確保する

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

// 自動調整の上限・下限（px）。無制限だと1セルで画面が埋まってしまう
// （幅の上限 AUTOFIT_MAX_W は閲覧画面と共通）
const AUTOFIT_MIN_W = 40;
const AUTOFIT_MIN_H = 24, AUTOFIT_MAX_H = 600;
// フォントサイズに合わせた行の高さ。既定(21px)より大きい文字は行間も広げる
const lineHeightOf = (f: FontSpec) => Math.max(HOT_LINE_H, Math.round(f.size * 1.35));

// 書式インデックスのフォント → 計測・描画で使うフォント指定（サイズは pt → px）
function xfFontToSpec(f: CellFont | undefined): FontSpec {
  if (!f) return HOT_FONT;
  return {
    size: f.size ? Math.round(f.size * PT_TO_PX * 10) / 10 : HOT_FONT_PX,
    family: f.name ? `"${f.name}", ${HOT_FONT_FAMILY}` : HOT_FONT_FAMILY,
    bold: f.bold, italic: f.italic,
  };
}

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
  // copyRow / copyCol は src（複製元・1始まり）から count 本を at へ複製挿入する。
  // 「入れ替え（移動）」は copy→remove の2手で表す。
  type StructOp = { type: "insertRow" | "removeRow" | "insertCol" | "removeCol" | "copyRow" | "copyCol"; at: number; count: number; src?: number };
  const structOpsRef = useRef<Record<string, StructOp[]>>({});
  // シートの追加・削除・名前変更（保存時にこの順で xlsx へ反映する）
  type SheetOp = { type: "add"; name: string; after?: string } | { type: "remove"; name: string } | { type: "rename"; from: string; name: string };
  const sheetOpsRef = useRef<SheetOp[]>([]);
  const colWidthChgRef = useRef<Record<string, Set<number>>>({});
  const rowHeightChgRef = useRef<Record<string, Set<number>>>({});
  const linksRef = useRef<Record<string, Map<string, string>>>({});
  const [gridVersion, setGridVersion] = useState(0); // 構造変更で HotTable を再マウントするための版
  const clipRef = useRef<ClipCell[][] | null>(null);  // 直近のコピー内容（OSのクリップボードが読めない時の控え）
  const xfFontsRef = useRef<CellFont[]>([]);          // 書式インデックス → フォント
  const fontSpecRef = useRef(new Map<number, FontSpec>()); // 同上（計測用に作り置き）
  const clipTokenRef = useRef("");                    // 書式インデックスが通じる範囲を示す合言葉
  // Undo/Redo
  const undoStack = useRef<any[]>([]);
  const redoStack = useRef<any[]>([]);
  const shapeSnapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const originalBytesRef = useRef<Uint8Array | null>(null);
  const sheetsRef = useRef<SheetModel[] | null>(null);
  const hotRef = useRef<InstanceType<typeof HotTable>>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const disposeRef = useRef<() => void>(() => { });
  // HotTable に渡す data 配列。ラッパーが再レンダーごとに data を再適用するため、
  // 別配列で差し替えず「同じ配列を in-place で書き換え」て編集が消えないようにする。
  const gridDataRef = useRef<Grid>([]);
  const [overlayOffset, setOverlayOffset] = useState({ left: ROW_HEADER_W, top: 26 });
  const lastOverlayOffsetRef = useRef({ left: ROW_HEADER_W, top: 26 });
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

        // 書式インデックス→フォントの表。貼り付けた書式の表示に使う（BRU13-019）
        xfFontsRef.current = parseXfFonts(originalBytesRef.current, themePalette);
        fontSpecRef.current.clear();
        // 書式インデックスは「この読み込み中の1ファイル」でしか通じないので、
        // クリップボードにも合言葉を入れて、別ファイルへ貼ったときは使わないようにする
        clipTokenRef.current = `${file.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

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
          // （空欄ぶん・図形ぶんの余白は後から足す）。
          const baseRows = Math.min(Math.max(ws.rowCount, 1), MAX_ROWS);
          const baseCols = Math.min(Math.max(ws.columnCount, 1), MAX_COLS);
          // 中身が無くても最低限の広さは出す（Excel と同じく空欄をすぐ使えるように）
          const minRows = Math.min(Math.max(baseRows, MIN_ROWS), MAX_ROWS);
          const minCols = Math.min(Math.max(baseCols, MIN_COLS), MAX_COLS);
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
          // セル内改行があるセルは、ファイルに折り返し指定が無くても改行して見せる（閲覧画面と共通の規則）
          for (let r = 0; r < baseRows; r++) {
            for (let c = 0; c < baseCols; c++) {
              baseWrap[r][c] = shouldWrap(display[r]?.[c] ?? "", baseWrap[r][c]);
            }
          }
          const colWidths = Array.from({ length: baseCols }, (_, i) => colPx(i));
          // 各セルに効いている書式インデックス（フォント・罫線・表示形式の元）。
          // 列に既定書式が付いていることがあるので、空欄ぶんまで読んでおく。
          const baseStyle = parseCellStyleIndexes(originalBytesRef.current, ws.name, minRows, minCols);
          const fontAt = (r: number, c: number) => xfFontToSpec(xfFontsRef.current[baseStyle[r]?.[c] ?? 0]);

          // 開いた時点で文字が見えない列を広げる（閲覧画面と共通の規則）。広げるだけで狭めない。
          for (let c = 0; c < baseCols; c++) {
            const w = fitColumnWidth(
              Array.from({ length: baseRows }, (_, r) => ({
                text: display[r]?.[c] ?? "",
                wrap: baseWrap[r]?.[c] ?? false,
                font: fontAt(r, c),
                spillable: (display[r]?.[c + 1] ?? "") === "",
              })), HOT_PAD_X);
            if (w > colWidths[c]) colWidths[c] = w;
          }

          // 折り返しセルのぶん行高を広げる。ファイルが持つ行高(ht)より狭くはしない
          // ＝必要なら広げるだけなので、折り返した文字が見切れることはない。
          const baseRowHeights = Array.from({ length: baseRows }, (_, i) => baseRowPx(i));
          const autoRowH = Array.from({ length: baseRows }, () => true);
          const rowHeights = baseRowHeights.map((h, r) => {
            let out = h;
            for (let c = 0; c < baseCols; c++) {
              const t = display[r]?.[c] ?? "";
              if (!t) continue;
              const f = fontAt(r, c);
              const lh = lineHeightOf(f);
              // 折り返しは行数ぶん、そうでなくても大きい文字は1行ぶんの高さを確保する
              out = Math.max(out, baseWrap[r]?.[c]
                ? wrapHeight(t, contentWidth(colWidths[c]), f, lh, 2)
                : lh + 2);
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
          const rowCount = Math.min(Math.max(baseRows, dMaxRow + 2, MIN_ROWS), MAX_ROWS);
          const colCount = Math.min(Math.max(baseCols, dMaxCol + 2, MIN_COLS), MAX_COLS);
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
          while (baseStyle.length < rowCount) baseStyle.push([]);
          for (const line of baseStyle) while (line.length < colCount) line.push(0);

          models.push({
            name: ws.name,
            raw,
            original: raw.map(row => row.slice()),
            display,
            fills: raw.map(row => row.map(() => null)),
            baseFills, baseWrap,
            baseStyle,
            styleIdx: Array.from({ length: rowCount }, () => new Array<number | null>(colCount).fill(null)),
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

  // BRU13-023 編集中の入力欄を、画面に見えている幅で折り返させる。
  // Handsontable の入力欄は「表の右端まで」横に伸びる作りなので、長い文章のセルでは
  // 画面外へ飛び出して読めなくなる。最大幅の算出（getEditedCellRect）だけを差し替え、
  // 見えている右端で頭打ちにする。幅が縮んだぶんは Handsontable 側が縦に伸ばしてくれる。
  const fitEditorToViewport = useCallback(() => {
    const hot: any = (hotRef.current as any)?.hotInstance;
    const sc = scrollRef.current;
    if (!hot || hot.isDestroyed || !sc) return;
    const ed: any = hot.getActiveEditor?.();
    if (!ed || !ed.isOpened?.() || typeof ed.getEditedCellRect !== "function") return;
    if (!ed.xlsFitted) {
      ed.xlsFitted = true;
      const cellRect = ed.getEditedCellRect.bind(ed);
      ed.getEditedCellRect = () => {
        const rect = cellRect();
        const root: HTMLElement | undefined = hot.rootElement;
        if (!rect || !root) return rect;
        // 入力欄の左端から、スクロール枠の右端までが折り返しに使える幅
        const avail = sc.getBoundingClientRect().right - (root.getBoundingClientRect().left + rect.start) - EDITOR_EDGE_GAP;
        return { ...rect, maxWidth: Math.max(EDITOR_MIN_W, Math.min(rect.maxWidth, avail)) };
      };
    }
    ed.refreshDimensions?.(true);
  }, []);

  // ── 数式セルは編集開始時に数式文字列を出す ────────────────────
  const afterBeginEditing = useCallback((row: number, col: number) => {
    const m = sheetsRef.current?.[active];
    const raw = m?.raw[row]?.[col];
    if (typeof raw === "string" && raw.startsWith("=")) {
      const ed: any = (hotRef.current as any)?.hotInstance?.getActiveEditor?.();
      if (ed) ed.setValue(raw);
    }
    // 長い文章のセルは、入力欄が画面外へ伸びないよう見えている幅で折り返させる
    fitEditorToViewport();
  }, [active, fitEditorToViewport]);

  // ── 編集の反映＋再計算 ──────────────────────────────────────
  // ── Undo/Redo（全状態のスナップショット方式）─────────────────
  const snapshot = useCallback(() => ({
    sheets: (sheetsRef.current ?? []).map(m => ({
      raw: m.raw.map(r => r.slice()), original: m.original.map(r => r.slice()),
      display: m.display.map(r => r.slice()), fills: m.fills.map(r => r.slice()),
      baseFills: m.baseFills.map(r => r.slice()), baseWrap: m.baseWrap.map(r => r.slice()),
      baseStyle: m.baseStyle.map(r => r.slice()), styleIdx: m.styleIdx.map(r => r.slice()),
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
      m.baseStyle = ms.baseStyle.map((r: number[]) => r.slice());
      m.styleIdx = ms.styleIdx.map((r: (number | null)[]) => r.slice());
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

  // ── セルのフォント（BRU13-019）────────────────────────────────
  // 貼り付けでコピーしてきた書式 > 元ファイルの書式。
  // 書式インデックスは styles.xml の cellXfs の番号で、フォント・サイズ・太字・
  // 罫線・表示形式をまとめて指す。画面ではこのうちフォント関係だけを再現する。
  const styleAt = useCallback((m: SheetModel, r: number, c: number): number =>
    m.styleIdx[r]?.[c] ?? m.baseStyle[r]?.[c] ?? 0, []);
  const xfFontAt = useCallback((m: SheetModel, r: number, c: number): CellFont | undefined =>
    xfFontsRef.current[styleAt(m, r, c)], [styleAt]);
  // 行高・文字幅の計算で1セルずつ呼ばれるので、書式インデックス単位で作り置きする
  const cellFont = useCallback((m: SheetModel, r: number, c: number): FontSpec => {
    const s = styleAt(m, r, c);
    let spec = fontSpecRef.current.get(s);
    if (!spec) { spec = xfFontToSpec(xfFontsRef.current[s]); fontSpecRef.current.set(s, spec); }
    return spec;
  }, [styleAt]);

  // 折り返しセルに合わせて行高を計算し直す（自動調整の行だけ）
  const recalcRowHeights = useCallback((m: SheetModel, rows: number[]) => {
    let changed = false;
    for (const r of rows) {
      if (!m.autoRowH[r]) continue;
      let h = m.baseRowHeights[r] ?? AUTOFIT_MIN_H;
      for (let c = 0; c < m.colWidths.length; c++) {
        const t = m.display[r]?.[c] ?? "";
        if (!t) continue;
        const f = cellFont(m, r, c);
        const lh = lineHeightOf(f);
        // 折り返しセルは行数ぶん、そうでなくても大きい文字は1行ぶんの高さを確保する
        h = Math.max(h, wrapOf(m, r, c)
          ? wrapHeight(t, contentWidth(m.colWidths[c]), f, lh, 2)
          : lh + 2);
      }
      // ここでは上限を掛けない（長文セルの中身が勝手に隠れないように）。
      // 上限があるのは「内容に合わせる」を明示的に実行したときだけ。
      if (m.rowHeights[r] !== h) { m.rowHeights[r] = h; changed = true; }
    }
    if (changed) {
      m.totalH = m.rowHeights.reduce((a, b) => a + b, 0);
      const hot: any = (hotRef.current as any)?.hotInstance;
      if (hot && !hot.isDestroyed) hot.updateSettings({ rowHeights: m.rowHeights.slice() });
      setLayoutTick(v => v + 1);
    }
    return changed;
  }, [wrapOf, cellFont]);

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
      const v = next == null ? "" : String(next);
      m.raw[row][col] = v;
      // セル内改行を入れたら折り返し表示にする（Excel の Alt+Enter と同じ）。
      // これをしないと、編集を終えた瞬間に改行が空白になって1行に見えてしまう。
      if (v.includes("\n")) (cellWrapRef.current[m.name] ??= new Map<string, boolean>()).set(`${row}:${col}`, true);
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

    // 前回と同じ位置なら State 更新をスキップ（無限レンダリング Error #185 を防止）
    if (lastOverlayOffsetRef.current.left === left && lastOverlayOffsetRef.current.top === top) {
      return;
    }

    lastOverlayOffsetRef.current = { left, top };
    // requestAnimationFrame で React のレンダリングサイクル外へ逃がす
    requestAnimationFrame(() => {
      setOverlayOffset({ left, top });
    });
  }, []);

  // BRU13-023 固定ヘッダ（sticky）が本体からどれだけずれているかを CSS 変数へ流す。
  // 列幅・行高のドラッグつまみは表本体を基準に置かれるため、この値だけずらさないと
  // スクロール中は画面外に置かれてしまい、ヘッダ境界をドラッグできなくなる。
  useEffect(() => {
    const sc = scrollRef.current;
    const wrap = wrapRef.current;
    if (!sc || !wrap) return;
    let raf = 0;
    const sync = () => {
      raf = 0;
      const root = wrap.querySelector<HTMLElement>(".handsontable");
      if (!root) return;
      const rr = root.getBoundingClientRect();
      const top = root.querySelector<HTMLElement>(":scope > .ht_clone_top");
      const left = root.querySelector<HTMLElement>(":scope > .ht_clone_inline_start");
      wrap.style.setProperty("--xls-sy", `${top ? Math.round(top.getBoundingClientRect().top - rr.top) : 0}px`);
      wrap.style.setProperty("--xls-sx", `${left ? Math.round(left.getBoundingClientRect().left - rr.left) : 0}px`);
      // 編集したままスクロールしたときも、入力欄の折り返し幅を追従させる
      fitEditorToViewport();
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(sync); };
    sc.addEventListener("scroll", onScroll, { passive: true });
    sync();
    return () => { sc.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [fitEditorToViewport]);

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
    const tw = textWidth(text, cellFont(m, row, col));
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
    box.style.fontFamily = td.style.fontFamily;
    box.style.fontSize = td.style.fontSize;
    box.style.lineHeight = td.style.lineHeight;
    box.style.fontWeight = td.style.fontWeight;
    box.style.fontStyle = td.style.fontStyle;
    td.appendChild(box);
  }, [wrapOf, cellFont]);

  const cells = useCallback(() => ({
    renderer(instance: any, td: HTMLElement, row: number, col: number, prop: any, value: any, cellProps: any) {
      textRenderer(instance, td, row, col, prop, value, cellProps);
      const m = sheetsRef.current?.[active];
      // ユーザーが塗った色を優先。書式を貼り付けたセルは、元ファイルの色ではなく
      // 貼り付けた書式が土台になるので、元の色は出さない。
      const pasted = m?.styleIdx[row]?.[col] != null;
      const color = m?.fills[row]?.[col] ?? (pasted ? null : m?.baseFills[row]?.[col]);
      if (color) td.style.background = color;
      // フォント（種類・サイズ・太字・斜体・下線・文字色）。td は使い回されるので毎回入れ直す
      const f = m ? xfFontAt(m, row, col) : undefined;
      const spec = m ? cellFont(m, row, col) : HOT_FONT;
      td.style.fontFamily = spec.family;
      td.style.fontSize = `${spec.size}px`;
      // 大きい文字は行間も広げる（既定の 21px のままだと行が重なる）
      td.style.lineHeight = `${lineHeightOf(spec)}px`;
      td.style.fontWeight = f?.bold ? "700" : "400";
      td.style.fontStyle = f?.italic ? "italic" : "normal";
      td.style.textDecoration = f?.underline ? "underline" : "none";
      td.style.color = f?.color ?? "";
      // 揃えも td の使い回しで前のセルの指定が残るので、無指定なら必ず戻す
      const al = cellAlignRef.current[m?.name ?? ""]?.get(`${row}:${col}`);
      td.style.textAlign = al?.h ?? "";
      td.style.verticalAlign = al?.v ?? "";
      td.style.cursor = "";
      if (linksRef.current[m?.name ?? ""]?.has(`${row}:${col}`)) {
        td.style.color = "#2563EB"; td.style.textDecoration = "underline"; td.style.cursor = "pointer";
      }
      if (m) applyTextLayout(td, m, row, col, al?.h ?? "left", al?.v ?? "top");
    },
  }), [active, applyTextLayout, xfFontAt, cellFont]);

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

  // ── コピー＆貼り付け（BRU13-019）──────────────────────────────
  // 現在の選択範囲（ヘッダ選択で -1 が来ることがあるので 0 で止める）
  const curRange = useCallback(() => {
    const sel = (hotRef.current as any)?.hotInstance?.getSelectedLast?.() as number[] | undefined;
    if (!sel) return null;
    return {
      r0: Math.max(0, Math.min(sel[0], sel[2])), r1: Math.max(0, Math.max(sel[0], sel[2])),
      c0: Math.max(0, Math.min(sel[1], sel[3])), c1: Math.max(0, Math.max(sel[1], sel[3])),
    };
  }, []);

  // 値の変更後に、再計算 → 表示データ（in-place）→ 行高 → 再描画 をまとめて行う
  const refreshCells = useCallback((m: SheetModel, remount: boolean) => {
    recompute(m.raw, m.name).then(disp => {
      m.display = disp;
      recalcRowHeights(m, m.rowHeights.map((_, i) => i));
      if (remount) { setGridVersion(v => v + 1); return; }
      const grid = gridDataRef.current;
      for (let r = 0; r < disp.length; r++) {
        if (!grid[r]) grid[r] = [];
        for (let c = 0; c < disp[r].length; c++) grid[r][c] = disp[r][c];
      }
      const hot: any = (hotRef.current as any)?.hotInstance;
      if (hot && !hot.isDestroyed) hot.render();
    });
  }, [recalcRowHeights]);

  // 選択範囲を ClipCell の表にする（値・数式・塗り・揃え・折り返し・リンク）
  const readClipCells = useCallback((m: SheetModel, g: { r0: number; r1: number; c0: number; c1: number }): ClipCell[][] => {
    const out: ClipCell[][] = [];
    for (let r = g.r0; r <= Math.min(g.r1, m.raw.length - 1); r++) {
      const line: ClipCell[] = [];
      for (let c = g.c0; c <= Math.min(g.c1, m.colWidths.length - 1); c++) {
        const al = cellAlignRef.current[m.name]?.get(`${r}:${c}`);
        const pasted = m.styleIdx[r]?.[c] != null;
        const f = xfFontAt(m, r, c);
        line.push({
          raw: m.raw[r]?.[c] ?? "",
          display: m.display[r]?.[c] ?? "",
          fill: m.fills[r]?.[c] ?? (pasted ? null : m.baseFills[r]?.[c]) ?? null,
          h: al?.h, v: al?.v,
          wrap: wrapOf(m, r, c),
          link: linksRef.current[m.name]?.get(`${r}:${c}`),
          // 書式インデックスごと運ぶ（フォント・サイズ・太字・罫線・表示形式まで複製される）
          style: styleAt(m, r, c),
          font: f ? { ...f } : undefined,
        });
      }
      out.push(line);
    }
    return out;
  }, [wrapOf, styleAt, xfFontAt]);

  // 貼り付け先が足りなければグリッドを広げる（上限 MAX_ROWS/MAX_COLS）
  const growGrid = useCallback((m: SheetModel, rows: number, cols: number) => {
    const wantR = Math.min(rows, MAX_ROWS), wantC = Math.min(cols, MAX_COLS);
    let grew = false;
    if (wantC > m.colWidths.length) {
      const add = wantC - m.colWidths.length;
      for (const arr of [m.raw, m.original, m.display]) for (const row of arr) row.push(...Array.from({ length: add }, () => ""));
      for (const arr of [m.fills, m.baseFills]) for (const row of arr) row.push(...Array.from({ length: add }, () => null));
      for (const row of m.baseWrap) row.push(...Array.from({ length: add }, () => false));
      for (const row of m.baseStyle) row.push(...Array.from({ length: add }, () => 0));
      for (const row of m.styleIdx) row.push(...Array.from({ length: add }, () => null));
      m.colWidths.push(...Array.from({ length: add }, () => 64));
      grew = true;
    }
    if (wantR > m.raw.length) {
      const ncol = m.colWidths.length;
      for (let i = m.raw.length; i < wantR; i++) {
        m.raw.push(emptyRow(ncol)); m.original.push(emptyRow(ncol)); m.display.push(emptyRow(ncol));
        m.fills.push(Array.from({ length: ncol }, () => null));
        m.baseFills.push(Array.from({ length: ncol }, () => null));
        m.baseWrap.push(Array.from({ length: ncol }, () => false));
        m.baseStyle.push(Array.from({ length: ncol }, () => 0));
        m.styleIdx.push(Array.from({ length: ncol }, () => null));
        m.rowHeights.push(24); m.baseRowHeights.push(24); m.autoRowH.push(true);
      }
      grew = true;
    }
    if (grew) recalcTotals(m);
    return grew;
  }, []);

  // 貼り付け本体。選択範囲がコピー元の整数倍なら敷き詰める（Excel と同じ）。
  // mode="values" は書式を持たない素のテキスト貼り付けで、貼り先の書式はそのまま残す。
  // sameFile=true（同じファイル内のコピー）のときだけ、書式インデックスごと複製する。
  const pasteClip = useCallback((cells: ClipCell[][], mode: "full" | "values" = "full", sameFile = false) => {
    const m = sheetsRef.current?.[active];
    const g = curRange();
    if (!m || !g || !cells.length) return;
    // 大量の貼り付けでも上限（MAX_ROWS/MAX_COLS）を超える分は捨てる
    const ph = Math.min(cells.length, MAX_ROWS), pw = Math.min(cells.reduce((n, r) => Math.max(n, r.length), 0), MAX_COLS);
    if (!ph || !pw) return;
    const selH = g.r1 - g.r0 + 1, selW = g.c1 - g.c0 + 1;
    const tileR = selH > ph && selH % ph === 0 ? selH / ph : 1;
    const tileC = selW > pw && selW % pw === 0 ? selW / pw : 1;
    pushUndo();
    const grew = growGrid(m, g.r0 + ph * tileR, g.c0 + pw * tileC);
    const align = (cellAlignRef.current[m.name] ??= new Map<string, CellAlign>());
    const wrapMap = (cellWrapRef.current[m.name] ??= new Map<string, boolean>());
    const links = (linksRef.current[m.name] ??= new Map<string, string>());
    for (let tr = 0; tr < tileR; tr++) for (let tc = 0; tc < tileC; tc++) {
      for (let i = 0; i < ph; i++) for (let j = 0; j < Math.min(cells[i]?.length ?? 0, pw); j++) {
        const r = g.r0 + tr * ph + i, c = g.c0 + tc * pw + j;
        if (r >= m.raw.length || c >= m.colWidths.length) continue; // 上限で切り捨て
        const src = cells[i][j] ?? emptyClip();
        m.raw[r][c] = src.raw ?? "";
        if (mode === "values") continue;
        // 同じファイル内なら書式インデックスごと複製する
        // ＝フォント・サイズ・太字・文字色・罫線・表示形式まで丸ごとコピーされる
        if (sameFile && typeof src.style === "number") m.styleIdx[r][c] = src.style;
        m.fills[r][c] = src.fill ?? null;
        if (src.h || src.v) align.set(`${r}:${c}`, { h: src.h, v: src.v }); else align.delete(`${r}:${c}`);
        wrapMap.set(`${r}:${c}`, !!src.wrap);
        if (src.link) links.set(`${r}:${c}`, src.link); else links.delete(`${r}:${c}`);
      }
    }
    setDirty(true);
    refreshCells(m, grew);
  }, [active, curRange, growGrid, pushUndo, refreshCells]);

  // コピー／切り取り。クリップボードへ渡す2形式と、切り取り時の元の消去まで行う
  const buildClipData = useCallback((cut: boolean) => {
    const m = sheetsRef.current?.[active];
    const g = curRange();
    if (!m || !g) return null;
    const cells = readClipCells(m, g);
    if (!cells.length) return null;
    if (cut) {
      pushUndo();
      const align = cellAlignRef.current[m.name], wrapMap = cellWrapRef.current[m.name], links = linksRef.current[m.name];
      for (let r = g.r0; r <= Math.min(g.r1, m.raw.length - 1); r++) {
        for (let c = g.c0; c <= Math.min(g.c1, m.colWidths.length - 1); c++) {
          m.raw[r][c] = ""; m.fills[r][c] = null; m.styleIdx[r][c] = null;
          align?.delete(`${r}:${c}`); wrapMap?.delete(`${r}:${c}`); links?.delete(`${r}:${c}`);
        }
      }
      setDirty(true);
      refreshCells(m, false);
    }
    return { cells, tsv: clipToTsv(cells), html: clipToHtml(cells, clipTokenRef.current) };
  }, [active, curRange, readClipCells, pushUndo, refreshCells]);

  // 右クリックメニューからのコピー（キー操作と違い clipboard API 経由）
  const menuCopy = useCallback(async (cut: boolean) => {
    const data = buildClipData(cut);
    if (!data) return;
    clipRef.current = data.cells;
    try {
      if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([new ClipboardItem({
          "text/plain": new Blob([data.tsv], { type: "text/plain" }),
          "text/html": new Blob([data.html], { type: "text/html" }),
        })]);
        return;
      }
    } catch { /* 権限が無ければ下の方法へ */ }
    try {
      const onCopy = (ev: ClipboardEvent) => {
        ev.preventDefault();
        ev.clipboardData?.setData("text/plain", data.tsv);
        ev.clipboardData?.setData("text/html", data.html);
      };
      document.addEventListener("copy", onCopy, true);
      document.execCommand("copy");
      document.removeEventListener("copy", onCopy, true);
    } catch { /* エディタ内での貼り付けは clipRef があるので動く */ }
  }, [buildClipData]);

  // 右クリックメニューからの貼り付け
  const menuPaste = useCallback(async () => {
    try {
      let html = "";
      if (navigator.clipboard && (navigator.clipboard as any).read) {
        const items = await (navigator.clipboard as any).read();
        for (const it of items) {
          if (it.types?.includes("text/html")) html = await (await it.getType("text/html")).text();
        }
      }
      const mine = html ? readClipPayload(html) : null;
      if (mine) { pasteClip(mine.cells, "full", mine.token === clipTokenRef.current); return; }
      const text = await navigator.clipboard?.readText?.();
      if (clipRef.current && text && text === clipToTsv(clipRef.current)) { pasteClip(clipRef.current, "full", true); return; }
      const table = html ? parseHtmlTable(html) : null;
      if (table) { pasteClip(table); return; }
      if (text) { pasteClip(parseTsv(text).map(r => r.map(v => ({ ...emptyClip(), raw: v, display: v }))), "values"); return; }
    } catch { /* 権限が無ければ直近のコピー内容で代替する */ }
    if (clipRef.current) pasteClip(clipRef.current, "full", true);
    else window.alert("クリップボードを読み取れませんでした。⌘/Ctrl+V で貼り付けてください。");
  }, [pasteClip]);

  // キーボード（⌘/Ctrl+C / X / V）。セル編集中・図形のテキスト編集中はブラウザ既定に任せる
  useEffect(() => {
    // グリッドが対象のときだけ横取りする。コメント欄など他の場所の操作は邪魔しない。
    const usable = () => {
      const hot: any = (hotRef.current as any)?.hotInstance;
      if (!hot || hot.isDestroyed || !hot.getSelectedLast?.()) return null;
      if (hot.getActiveEditor?.()?.isOpened?.()) return null;
      const el = document.activeElement as HTMLElement | null;
      const inGrid = !!(el && wrapRef.current?.contains(el));
      if (el?.isContentEditable || el?.classList?.contains("handsontableInput")) return null;
      if (el && !inGrid && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return null;
      // 画面の別の場所で文字を選択しているなら、そちらのコピーを優先する
      const sel = window.getSelection?.();
      if (sel && !sel.isCollapsed && sel.toString().trim()
        && !(sel.anchorNode && wrapRef.current?.contains(sel.anchorNode))) return null;
      return hot;
    };
    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      if (!usable()) return;
      const data = buildClipData(cut);
      if (!data) return;
      e.preventDefault();
      clipRef.current = data.cells;
      e.clipboardData?.setData("text/plain", data.tsv);
      e.clipboardData?.setData("text/html", data.html);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!usable()) return;
      const dt = e.clipboardData;
      if (!dt) return;
      e.preventDefault();
      const html = dt.getData("text/html");
      const text = dt.getData("text/plain");
      const mine = html ? readClipPayload(html) : null;
      if (mine) { pasteClip(mine.cells, "full", mine.token === clipTokenRef.current); return; }
      // 自前のコピー直後なら控えを使う（HTML の data 属性が落ちても数式・書式まで完全に再現できる）
      if (clipRef.current && text && text === clipToTsv(clipRef.current)) { pasteClip(clipRef.current, "full", true); return; }
      const table = html ? parseHtmlTable(html) : null;
      if (table) { pasteClip(table); return; }
      if (text) { pasteClip(parseTsv(text).map(r => r.map(v => ({ ...emptyClip(), raw: v, display: v }))), "values"); return; }
      if (clipRef.current) pasteClip(clipRef.current, "full", true);
    };
    const copyH = (e: ClipboardEvent) => onCopy(e, false);
    const cutH = (e: ClipboardEvent) => onCopy(e, true);
    document.addEventListener("copy", copyH);
    document.addEventListener("cut", cutH);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", copyH);
      document.removeEventListener("cut", cutH);
      document.removeEventListener("paste", onPaste);
    };
  }, [buildClipData, pasteClip]);

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
  // 行番号/列番号の Set（幅・高さの変更記録）を増減に合わせて張り替える
  const remapIdxSet = (set: Set<number> | undefined, fn: (i: number) => number | null) => {
    if (!set) return;
    const cur = [...set];
    set.clear();
    for (const i of cur) { const n = fn(i); if (n !== null) set.add(n); }
  };
  const emptyRow = (n: number) => Array.from({ length: n }, () => "");
  const sumPx = (arr: number[], a: number, b: number) => arr.slice(a, b).reduce((x, y) => x + y, 0);
  // 累積オフセット（cum[i] = i 本目の開始 px）
  const cumPx = (arr: number[]) => { const out = [0]; for (const v of arr) out.push(out[out.length - 1] + v); return out; };
  // splice による移動（src0 から cnt 本を取り出して dest0 へ差し込む）での添字の写像
  const movedIndex = (i: number, src0: number, cnt: number, dest0: number) => {
    if (i >= src0 && i < src0 + cnt) return dest0 + (i - src0);
    const j = i >= src0 + cnt ? i - cnt : i; // 取り出した後の位置
    return j >= dest0 ? j + cnt : j;
  };
  // 選択範囲を丸ごと複製するときに、対象の行(列)のマップ項目もコピーする。
  // 既存キーをずらしてから、控えておいた複製ぶんを追加する。
  const copyMapLines = <T,>(map: Map<string, T> | undefined, axis: "row" | "col", src0: number, cnt: number, at0: number) => {
    if (!map) return;
    const added: [string, T][] = [];
    for (const [k, v] of map) {
      const [r, c] = k.split(":").map(Number);
      const i = axis === "row" ? r : c;
      if (i < src0 || i >= src0 + cnt) continue;
      const n = at0 + (i - src0);
      added.push([axis === "row" ? `${n}:${c}` : `${r}:${n}`, v]);
    }
    remapKeys(map, (r, c) => axis === "row" ? (r >= at0 ? [r + cnt, c] : [r, c]) : (c >= at0 ? [r, c + cnt] : [r, c]));
    for (const [k, v] of added) map.set(k, v);
  };

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

  // 行/列の入れ替えに合わせて図形・画像を追従させる。
  // 入れ替えでは帯の外の座標は変わらない（総寸が同じ）ので、帯の中だけを
  // 「どの行(列)に載っていたか」で判定して、その行(列)の新しい開始位置へ移す。
  const moveDrawings = (m: SheetModel, axis: "x" | "y", oldStarts: number[], newStarts: number[], mapIdx: (i: number) => number, lo: number, hi: number) => {
    const loPx = oldStarts[lo] ?? 0;
    const hiPx = oldStarts[hi] ?? Infinity;
    const cur = shapeEditsRef.current[m.name]?.objects ?? m.drawings;
    const changed = new Set(shapeEditsRef.current[m.name]?.changedAnchors ?? []);
    const moved = cur.map(o => {
      const t = axis === "x" ? o.x : o.y;
      if (t < loPx || t >= hiPx) return o;
      let i = lo;
      while (i + 1 < hi && (oldStarts[i + 1] ?? Infinity) <= t) i++;
      const delta = (newStarts[mapIdx(i)] ?? oldStarts[i]) - oldStarts[i];
      if (!delta) return o;
      if (o.anchorIndex !== undefined) changed.add(o.anchorIndex);
      const nt = Math.max(0, t + delta);
      return axis === "x" ? { ...o, x: nt } : { ...o, y: nt };
    });
    shapeEditsRef.current[m.name] = { objects: moved, changedAnchors: [...changed] };
    m.drawings = moved;
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
      m.baseStyle.splice(index0, 0, Array.from({ length: ncol }, () => 0));
      m.styleIdx.splice(index0, 0, Array.from({ length: ncol }, () => null));
      m.rowHeights.splice(index0, 0, 24);
      m.baseRowHeights.splice(index0, 0, 24);
      m.autoRowH.splice(index0, 0, true);
    }
    remapKeys(cellAlignRef.current[m.name], (r, c) => r >= index0 ? [r + cnt, c] : [r, c]);
    remapKeys(cellWrapRef.current[m.name], (r, c) => r >= index0 ? [r + cnt, c] : [r, c]);
    remapKeys(linksRef.current[m.name], (r, c) => r >= index0 ? [r + cnt, c] : [r, c]);
    shiftDrawings(m, "y", boundary, cnt * 24);
    remapIdxSet(rowHeightChgRef.current[m.name], r => r >= index0 ? r + cnt : r);
    (structOpsRef.current[m.name] ??= []).push({ type: "insertRow", at: index0 + 1, count: cnt });
    recalcTotals(m); setDirty(true); setGridVersion(v => v + 1);
  }, [active]);

  const doRemoveRows = useCallback((index0: number, cnt: number) => {
    const m = sheetsRef.current?.[active]; if (!m) return;
    pushUndo();
    const boundary = sumPx(m.rowHeights, 0, index0);
    const deleted = sumPx(m.rowHeights, index0, index0 + cnt);
    [m.raw, m.original, m.display, m.fills, m.baseFills, m.baseWrap, m.baseStyle, m.styleIdx, m.rowHeights, m.baseRowHeights, m.autoRowH]
      .forEach(a => (a as any[]).splice(index0, cnt));
    remapKeys(cellAlignRef.current[m.name], (r, c) => (r >= index0 && r < index0 + cnt) ? null : (r >= index0 + cnt ? [r - cnt, c] : [r, c]));
    remapKeys(cellWrapRef.current[m.name], (r, c) => (r >= index0 && r < index0 + cnt) ? null : (r >= index0 + cnt ? [r - cnt, c] : [r, c]));
    remapKeys(linksRef.current[m.name], (r, c) => (r >= index0 && r < index0 + cnt) ? null : (r >= index0 + cnt ? [r - cnt, c] : [r, c]));
    shiftDrawings(m, "y", boundary, -deleted);
    remapIdxSet(rowHeightChgRef.current[m.name], r => (r >= index0 && r < index0 + cnt) ? null : (r >= index0 + cnt ? r - cnt : r));
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
    for (const row of m.baseStyle) row.splice(index0, 0, ...Array.from({ length: cnt }, () => 0));
    for (const row of m.styleIdx) row.splice(index0, 0, ...Array.from({ length: cnt }, () => null));
    m.colWidths.splice(index0, 0, ...Array.from({ length: cnt }, () => 64));
    remapKeys(cellAlignRef.current[m.name], (r, c) => c >= index0 ? [r, c + cnt] : [r, c]);
    remapKeys(cellWrapRef.current[m.name], (r, c) => c >= index0 ? [r, c + cnt] : [r, c]);
    remapKeys(linksRef.current[m.name], (r, c) => c >= index0 ? [r, c + cnt] : [r, c]);
    shiftDrawings(m, "x", boundary, cnt * 64);
    remapIdxSet(colWidthChgRef.current[m.name], c => c >= index0 ? c + cnt : c);
    (structOpsRef.current[m.name] ??= []).push({ type: "insertCol", at: index0 + 1, count: cnt });
    recalcTotals(m); setDirty(true); setGridVersion(v => v + 1);
  }, [active]);

  const doRemoveCols = useCallback((index0: number, cnt: number) => {
    const m = sheetsRef.current?.[active]; if (!m) return;
    pushUndo();
    const boundary = sumPx(m.colWidths, 0, index0);
    const deleted = sumPx(m.colWidths, index0, index0 + cnt);
    for (const arr of [m.raw, m.original, m.display, m.fills, m.baseFills, m.baseWrap, m.baseStyle, m.styleIdx]) for (const row of arr) (row as any[]).splice(index0, cnt);
    m.colWidths.splice(index0, cnt);
    remapKeys(cellAlignRef.current[m.name], (r, c) => (c >= index0 && c < index0 + cnt) ? null : (c >= index0 + cnt ? [r, c - cnt] : [r, c]));
    remapKeys(cellWrapRef.current[m.name], (r, c) => (c >= index0 && c < index0 + cnt) ? null : (c >= index0 + cnt ? [r, c - cnt] : [r, c]));
    remapKeys(linksRef.current[m.name], (r, c) => (c >= index0 && c < index0 + cnt) ? null : (c >= index0 + cnt ? [r, c - cnt] : [r, c]));
    shiftDrawings(m, "x", boundary, -deleted);
    remapIdxSet(colWidthChgRef.current[m.name], c => (c >= index0 && c < index0 + cnt) ? null : (c >= index0 + cnt ? c - cnt : c));
    (structOpsRef.current[m.name] ??= []).push({ type: "removeCol", at: index0 + 1, count: cnt });
    recalcTotals(m); setDirty(true); setGridVersion(v => v + 1);
  }, [active]);

  // ── 行/列のコピー挿入・入れ替え（BRU13-019）───────────────────
  // 複製・移動した先の数式は、xlsx 側の複製だと共有数式の子セルが値だけになることがある。
  // 差分の基準（original）を空にしておき、保存時に必ず数式として書き戻す。
  // ⚠ 参照の自動補正はしない（挿入・削除と同じ既知の制約）。
  const forceFormulaRewrite = (m: SheetModel, r0: number, r1: number, c0: number, c1: number) => {
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        if ((m.raw[r]?.[c] ?? "").startsWith("=") && m.original[r]) m.original[r][c] = "";
      }
    }
  };

  // 複製は「元の行/列をそのまま複製して差し込む」。保存時は xlsxStructure.copyRows /
  // copyCols が同じことを xlsx 側でも行うので、値・書式・幅/高さが揃って複製される。
  const doCopyRows = useCallback((src0: number, cnt: number, at0: number) => {
    const m = sheetsRef.current?.[active]; if (!m || cnt <= 0) return;
    pushUndo();
    const boundary = sumPx(m.rowHeights, 0, at0);
    const addedPx = sumPx(m.rowHeights, src0, src0 + cnt);
    const dup = <T,>(a: T[][]) => a.slice(src0, src0 + cnt).map(r => r.slice());
    const pick = <T,>(a: T[]) => a.slice(src0, src0 + cnt);
    m.raw.splice(at0, 0, ...dup(m.raw));
    m.original.splice(at0, 0, ...dup(m.original));
    m.display.splice(at0, 0, ...dup(m.display));
    m.fills.splice(at0, 0, ...dup(m.fills));
    m.baseFills.splice(at0, 0, ...dup(m.baseFills));
    m.baseWrap.splice(at0, 0, ...dup(m.baseWrap));
    m.baseStyle.splice(at0, 0, ...dup(m.baseStyle));
    m.styleIdx.splice(at0, 0, ...dup(m.styleIdx));
    m.rowHeights.splice(at0, 0, ...pick(m.rowHeights));
    m.baseRowHeights.splice(at0, 0, ...pick(m.baseRowHeights));
    m.autoRowH.splice(at0, 0, ...pick(m.autoRowH));
    copyMapLines(cellAlignRef.current[m.name], "row", src0, cnt, at0);
    copyMapLines(cellWrapRef.current[m.name], "row", src0, cnt, at0);
    copyMapLines(linksRef.current[m.name], "row", src0, cnt, at0);
    const heightChg = rowHeightChgRef.current[m.name];
    const copiedH = [...(heightChg ?? [])].filter(r => r >= src0 && r < src0 + cnt).map(r => at0 + (r - src0));
    remapIdxSet(heightChg, r => r >= at0 ? r + cnt : r);
    copiedH.forEach(r => heightChg?.add(r));
    shiftDrawings(m, "y", boundary, addedPx);
    forceFormulaRewrite(m, at0, at0 + cnt, 0, m.colWidths.length);
    (structOpsRef.current[m.name] ??= []).push({ type: "copyRow", at: at0 + 1, count: cnt, src: src0 + 1 });
    recalcTotals(m); setDirty(true); setGridVersion(v => v + 1);
  }, [active, pushUndo]);

  const doCopyCols = useCallback((src0: number, cnt: number, at0: number) => {
    const m = sheetsRef.current?.[active]; if (!m || cnt <= 0) return;
    pushUndo();
    const boundary = sumPx(m.colWidths, 0, at0);
    const addedPx = sumPx(m.colWidths, src0, src0 + cnt);
    for (const arr of [m.raw, m.original, m.display, m.fills, m.baseFills, m.baseWrap, m.baseStyle, m.styleIdx]) {
      for (const row of arr) (row as any[]).splice(at0, 0, ...(row as any[]).slice(src0, src0 + cnt));
    }
    m.colWidths.splice(at0, 0, ...m.colWidths.slice(src0, src0 + cnt));
    copyMapLines(cellAlignRef.current[m.name], "col", src0, cnt, at0);
    copyMapLines(cellWrapRef.current[m.name], "col", src0, cnt, at0);
    copyMapLines(linksRef.current[m.name], "col", src0, cnt, at0);
    // 差し込んだ列には xlsx 側の <cols> が無いので、幅は保存時に必ず書き出す
    const widthChg = (colWidthChgRef.current[m.name] ??= new Set());
    remapIdxSet(widthChg, c => c >= at0 ? c + cnt : c);
    for (let i = 0; i < cnt; i++) widthChg.add(at0 + i);
    shiftDrawings(m, "x", boundary, addedPx);
    forceFormulaRewrite(m, 0, m.raw.length, at0, at0 + cnt);
    (structOpsRef.current[m.name] ??= []).push({ type: "copyCol", at: at0 + 1, count: cnt, src: src0 + 1 });
    recalcTotals(m); setDirty(true); setGridVersion(v => v + 1);
  }, [active, pushUndo]);

  // dest0 は「移動後にブロックの先頭が来る位置」（配列 splice と同じ意味）
  const doMoveRows = useCallback((src0: number, cnt: number, dest0: number) => {
    const m = sheetsRef.current?.[active]; if (!m || cnt <= 0 || dest0 === src0) return;
    if (src0 < 0 || dest0 < 0 || src0 + cnt > m.raw.length || dest0 + cnt > m.raw.length) return;
    pushUndo();
    const oldStarts = cumPx(m.rowHeights);
    for (const a of [m.raw, m.original, m.display, m.fills, m.baseFills, m.baseWrap, m.baseStyle, m.styleIdx, m.rowHeights, m.baseRowHeights, m.autoRowH]) {
      const blk = (a as any[]).splice(src0, cnt);
      (a as any[]).splice(dest0, 0, ...blk);
    }
    const mapIdx = (r: number) => movedIndex(r, src0, cnt, dest0);
    remapKeys(cellAlignRef.current[m.name], (r, c) => [mapIdx(r), c]);
    remapKeys(cellWrapRef.current[m.name], (r, c) => [mapIdx(r), c]);
    remapKeys(linksRef.current[m.name], (r, c) => [mapIdx(r), c]);
    remapIdxSet(rowHeightChgRef.current[m.name], mapIdx);
    moveDrawings(m, "y", oldStarts, cumPx(m.rowHeights), mapIdx, Math.min(src0, dest0), Math.max(src0, dest0) + cnt);
    forceFormulaRewrite(m, dest0, dest0 + cnt, 0, m.colWidths.length);
    // xlsx 側は「複製して差し込む → 元を消す」で同じ並びにする
    const ops = (structOpsRef.current[m.name] ??= []);
    const insertAt = dest0 <= src0 ? dest0 + 1 : dest0 + cnt + 1;
    const removeAt = dest0 <= src0 ? src0 + cnt + 1 : src0 + 1;
    ops.push({ type: "copyRow", at: insertAt, count: cnt, src: src0 + 1 });
    ops.push({ type: "removeRow", at: removeAt, count: cnt });
    recalcTotals(m); setDirty(true); setGridVersion(v => v + 1);
  }, [active, pushUndo]);

  const doMoveCols = useCallback((src0: number, cnt: number, dest0: number) => {
    const m = sheetsRef.current?.[active]; if (!m || cnt <= 0 || dest0 === src0) return;
    const ncol = m.colWidths.length;
    if (src0 < 0 || dest0 < 0 || src0 + cnt > ncol || dest0 + cnt > ncol) return;
    pushUndo();
    const oldStarts = cumPx(m.colWidths);
    for (const arr of [m.raw, m.original, m.display, m.fills, m.baseFills, m.baseWrap, m.baseStyle, m.styleIdx]) {
      for (const row of arr) { const blk = (row as any[]).splice(src0, cnt); (row as any[]).splice(dest0, 0, ...blk); }
    }
    { const blk = m.colWidths.splice(src0, cnt); m.colWidths.splice(dest0, 0, ...blk); }
    const mapIdx = (c: number) => movedIndex(c, src0, cnt, dest0);
    remapKeys(cellAlignRef.current[m.name], (r, c) => [r, mapIdx(c)]);
    remapKeys(cellWrapRef.current[m.name], (r, c) => [r, mapIdx(c)]);
    remapKeys(linksRef.current[m.name], (r, c) => [r, mapIdx(c)]);
    const widthChg = (colWidthChgRef.current[m.name] ??= new Set());
    remapIdxSet(widthChg, mapIdx);
    for (let i = 0; i < cnt; i++) widthChg.add(dest0 + i); // 移動先には <cols> が無いので幅を明示する
    moveDrawings(m, "x", oldStarts, cumPx(m.colWidths), mapIdx, Math.min(src0, dest0), Math.max(src0, dest0) + cnt);
    forceFormulaRewrite(m, 0, m.raw.length, dest0, dest0 + cnt);
    const ops = (structOpsRef.current[m.name] ??= []);
    const insertAt = dest0 <= src0 ? dest0 + 1 : dest0 + cnt + 1;
    const removeAt = dest0 <= src0 ? src0 + cnt + 1 : src0 + 1;
    ops.push({ type: "copyCol", at: insertAt, count: cnt, src: src0 + 1 });
    ops.push({ type: "removeCol", at: removeAt, count: cnt });
    recalcTotals(m); setDirty(true); setGridVersion(v => v + 1);
  }, [active, pushUndo]);

  // ── シートの追加・名前変更・削除（BRU13-019）──────────────────
  // シートごとの記録（揃え・折り返し・リンク・図形・構造編集・幅/高さ）は
  // シート名をキーにしているので、名前を変えるときは全部まとめて引っ越す。
  const renameSheetKeys = (from: string, to: string) => {
    const move = (rec: Record<string, any>) => {
      if (rec[from] === undefined) return;
      rec[to] = rec[from]; delete rec[from];
    };
    move(cellAlignRef.current); move(cellWrapRef.current); move(linksRef.current);
    move(shapeEditsRef.current); move(structOpsRef.current);
    move(colWidthChgRef.current); move(rowHeightChgRef.current);
  };
  const dropSheetKeys = (name: string) => {
    for (const rec of [cellAlignRef.current, cellWrapRef.current, linksRef.current,
      shapeEditsRef.current, structOpsRef.current, colWidthChgRef.current, rowHeightChgRef.current]) {
      delete (rec as Record<string, unknown>)[name];
    }
  };
  // シートの増減は Excel と同じく「元に戻す」の対象外にする（履歴と食い違うため）
  const clearUndo = () => { undoStack.current = []; redoStack.current = []; };

  const emptySheetModel = useCallback((name: string): SheetModel => {
    const grid = <T,>(v: T) => Array.from({ length: MIN_ROWS }, () => Array.from({ length: MIN_COLS }, () => v));
    const colWidths = Array.from({ length: MIN_COLS }, () => 64);
    const rowHeights = Array.from({ length: MIN_ROWS }, () => 24);
    return {
      name,
      raw: grid(""), original: grid(""), display: grid(""),
      fills: grid<string | null>(null), baseFills: grid<string | null>(null), baseWrap: grid(false),
      baseStyle: grid(0), styleIdx: grid<number | null>(null),
      truncated: false,
      colWidths, rowHeights,
      baseRowHeights: rowHeights.slice(), autoRowH: Array.from({ length: MIN_ROWS }, () => true),
      drawings: [], drawingPath: null,
      totalW: colWidths.reduce((a, b) => a + b, 0),
      totalH: rowHeights.reduce((a, b) => a + b, 0),
    };
  }, []);

  const askSheetName = (title: string, initial: string, current?: string): string | null => {
    const names = (sheetsRef.current ?? []).map(s => s.name);
    for (; ;) {
      const input = window.prompt(title, initial);
      if (input === null) return null;
      const err = validateSheetName(input, names, current);
      if (!err) return input.trim();
      window.alert(err);
      initial = input;
    }
  };

  const addSheetAfterActive = useCallback(() => {
    const list = sheetsRef.current; if (!list) return;
    const base = "Sheet";
    let n = list.length + 1;
    while (list.some(s => s.name === `${base}${n}`)) n++;
    const name = askSheetName("追加するシートの名前", `${base}${n}`);
    if (name === null) return;
    const at = Math.min(active, list.length - 1);
    const next = [...list];
    next.splice(at + 1, 0, emptySheetModel(name));
    sheetsRef.current = next;
    (sheetOpsRef.current ??= []).push({ type: "add", name, after: list[at]?.name });
    clearUndo();
    setSheets(next);
    setActive(at + 1);
    setDirty(true);
    setGridVersion(v => v + 1);
  }, [active, emptySheetModel]);

  const renameSheetAt = useCallback((index: number) => {
    const list = sheetsRef.current; if (!list?.[index]) return;
    const from = list[index].name;
    const to = askSheetName("シート名", from, from);
    if (to === null || to === from) return;
    renameSheetKeys(from, to);
    list[index].name = to;          // 実行中の再計算が同じオブジェクトを見ているので入れ替えない
    const next = [...list];
    sheetsRef.current = next;
    (sheetOpsRef.current ??= []).push({ type: "rename", from, name: to });
    clearUndo();
    setSheets(next);
    setDirty(true);
    setGridVersion(v => v + 1);
  }, []);

  const removeSheetAt = useCallback((index: number) => {
    const list = sheetsRef.current; if (!list?.[index]) return;
    if (list.length <= 1) { window.alert("最後のシートは削除できません。"); return; }
    const name = list[index].name;
    if (!window.confirm(`シート「${name}」を削除します。よろしいですか？\n（この操作は「元に戻す」できません）`)) return;
    dropSheetKeys(name);
    const next = list.filter((_, i) => i !== index);
    sheetsRef.current = next;
    (sheetOpsRef.current ??= []).push({ type: "remove", name });
    clearUndo();
    setSheets(next);
    setActive(a => Math.max(0, Math.min(a >= index ? a - 1 : a, next.length - 1)));
    setDirty(true);
    setGridVersion(v => v + 1);
  }, []);

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
    // グリッドの外枠は totalW から描いているので、必ず React 側も描き直す。
    // setDirty だけだと既に dirty のときに再描画されず、広げた分が見切れる。
    setLayoutTick(v => v + 1);
  }, [active, recalcRowHeights]);
  const afterRowResize = useCallback((newSize: number, row: number, isDoubleClick?: boolean) => {
    const m = sheetsRef.current?.[active]; if (!m) return;
    pushUndo();
    // 手で高さを決めた行は、以後は折り返しでの自動調整をしない（Excel と同じ）。
    // ダブルクリックの自動調整は「中身に合わせる」操作なので、自動調整のまま残す。
    m.rowHeights[row] = newSize; m.baseRowHeights[row] = newSize; m.autoRowH[row] = !!isDoubleClick;
    recalcTotals(m);
    (rowHeightChgRef.current[m.name] ??= new Set()).add(row);
    setDirty(true);
    setLayoutTick(v => v + 1);   // 外枠の高さ（totalH）も描き直す
  }, [active]);

  // ── 内容に合わせた自動調整（BRU13-019）────────────────────────
  // 列は「一番長い文字が収まる幅」、行は「折り返し・改行の行数が収まる高さ」。
  // 際限なく広がらないよう上限を設ける。
  const autoFitColWidth = useCallback((m: SheetModel, c: number): number => {
    let w = 0;
    for (let r = 0; r < m.display.length; r++) {
      const t = m.display[r]?.[c] ?? "";
      // 折り返しセルは「折り返して収める」ものなので幅を広げる対象にしない（Excel と同じ）
      if (!t || wrapOf(m, r, c)) continue;
      w = Math.max(w, textWidth(flatText(t), cellFont(m, r, c)));
    }
    if (w <= 0) return m.colWidths[c] ?? AUTOFIT_MIN_W;   // 測るものが無ければ今の幅のまま
    return Math.min(AUTOFIT_MAX_W, Math.max(AUTOFIT_MIN_W, Math.ceil(w) + HOT_PAD_X * 2 + 3));
  }, [wrapOf, cellFont]);

  const autoFitRowHeight = useCallback((m: SheetModel, r: number): number => {
    let h = 0;
    for (let c = 0; c < m.colWidths.length; c++) {
      const t = m.display[r]?.[c] ?? "";
      if (!t) continue;
      const f = cellFont(m, r, c);
      const lh = lineHeightOf(f);
      h = Math.max(h, wrapOf(m, r, c) ? wrapHeight(t, contentWidth(m.colWidths[c]), f, lh, 2) : lh + 2);
    }
    return Math.min(AUTOFIT_MAX_H, Math.max(AUTOFIT_MIN_H, h));
  }, [wrapOf, cellFont]);

  const fitCols = useCallback((c0: number, c1: number, undoable = true) => {
    const m = sheetsRef.current?.[active]; if (!m) return;
    if (undoable) pushUndo();
    const chg = (colWidthChgRef.current[m.name] ??= new Set());
    for (let c = Math.max(0, c0); c <= Math.min(c1, m.colWidths.length - 1); c++) {
      m.colWidths[c] = autoFitColWidth(m, c);
      chg.add(c);
    }
    recalcTotals(m);
    recalcRowHeights(m, m.rowHeights.map((_, i) => i));   // 幅が変われば折り返しの行数も変わる
    setDirty(true);
    const hot: any = (hotRef.current as any)?.hotInstance;
    if (hot && !hot.isDestroyed) {
      // ドラッグで変えた幅はプラグイン側が握っているので、そちらも書き換える
      const plugin = hot.getPlugin?.("manualColumnResize");
      for (let c = Math.max(0, c0); c <= Math.min(c1, m.colWidths.length - 1); c++) plugin?.setManualSize?.(c, m.colWidths[c]);
      hot.updateSettings({ colWidths: m.colWidths.slice() });
      hot.render();
    }
    setLayoutTick(v => v + 1);
  }, [active, autoFitColWidth, pushUndo, recalcRowHeights]);

  const fitRows = useCallback((r0: number, r1: number, undoable = true) => {
    const m = sheetsRef.current?.[active]; if (!m) return;
    if (undoable) pushUndo();
    const chg = (rowHeightChgRef.current[m.name] ??= new Set());
    for (let r = Math.max(0, r0); r <= Math.min(r1, m.rowHeights.length - 1); r++) {
      const h = autoFitRowHeight(m, r);
      m.rowHeights[r] = h; m.baseRowHeights[r] = h;
      m.autoRowH[r] = true;   // 以後も中身に合わせて伸びるようにしておく
      chg.add(r);
    }
    recalcTotals(m);
    setDirty(true);
    const hot: any = (hotRef.current as any)?.hotInstance;
    if (hot && !hot.isDestroyed) {
      const plugin = hot.getPlugin?.("manualRowResize");
      for (let r = Math.max(0, r0); r <= Math.min(r1, m.rowHeights.length - 1); r++) plugin?.setManualSize?.(r, m.rowHeights[r]);
      hot.updateSettings({ rowHeights: m.rowHeights.slice() });
      hot.render();
    }
    setLayoutTick(v => v + 1);
  }, [active, autoFitRowHeight, pushUndo]);

  // 列/行ヘッダの境界をダブルクリックしたときの自動調整（Excel と同じ操作）
  const beforeColumnResize = useCallback((newSize: number, column: number, isDoubleClick: boolean) => {
    const m = sheetsRef.current?.[active];
    return (isDoubleClick && m) ? autoFitColWidth(m, column) : newSize;
  }, [active, autoFitColWidth]);
  const beforeRowResize = useCallback((newSize: number, row: number, isDoubleClick: boolean) => {
    const m = sheetsRef.current?.[active];
    return (isDoubleClick && m) ? autoFitRowHeight(m, row) : newSize;
  }, [active, autoFitRowHeight]);

  // 右クリックメニュー
  const range = (sel: any[]) => {
    const s = sel[0];
    // ヘッダをつかんだ選択では -1 が来ることがあるので 0 で止める
    return {
      r0: Math.max(0, Math.min(s.start.row, s.end.row)), r1: Math.max(0, Math.max(s.start.row, s.end.row)),
      c0: Math.max(0, Math.min(s.start.col, s.end.col)), c1: Math.max(0, Math.max(s.start.col, s.end.col)),
    };
  };
  const contextMenu = useMemo(() => ({
    items: {
      cp_cells: { name: "コピー（値・書式・背景ごと）", callback: () => { void menuCopy(false); } },
      ct_cells: { name: "切り取り", callback: () => { void menuCopy(true); } },
      pt_cells: { name: "貼り付け", callback: () => { void menuPaste(); } },
      sep1: { name: "---------" },
      ins_row_above: { name: "上に行を挿入", callback: (_k: any, sel: any[]) => { const g = range(sel); doInsertRows(g.r0, g.r1 - g.r0 + 1); } },
      ins_row_below: { name: "下に行を挿入", callback: (_k: any, sel: any[]) => { const g = range(sel); doInsertRows(g.r1 + 1, g.r1 - g.r0 + 1); } },
      del_row: { name: "行を削除", callback: (_k: any, sel: any[]) => { const g = range(sel); doRemoveRows(g.r0, g.r1 - g.r0 + 1); } },
      cp_row: {
        name: "行をコピーして下に挿入",
        callback: (_k: any, sel: any[]) => { const g = range(sel); doCopyRows(g.r0, g.r1 - g.r0 + 1, g.r1 + 1); },
      },
      mv_row_up: {
        name: "行を上へ移動（入れ替え）",
        disabled: () => { const s = curRange(); return !s || s.r0 <= 0; },
        callback: (_k: any, sel: any[]) => { const g = range(sel); doMoveRows(g.r0, g.r1 - g.r0 + 1, g.r0 - 1); },
      },
      mv_row_down: {
        name: "行を下へ移動（入れ替え）",
        disabled: () => { const s = curRange(); const n = sheetsRef.current?.[active]?.raw.length ?? 0; return !s || s.r1 >= n - 1; },
        callback: (_k: any, sel: any[]) => { const g = range(sel); doMoveRows(g.r0, g.r1 - g.r0 + 1, g.r0 + 1); },
      },
      sep2: { name: "---------" },
      ins_col_left: { name: "左に列を挿入", callback: (_k: any, sel: any[]) => { const g = range(sel); doInsertCols(g.c0, g.c1 - g.c0 + 1); } },
      ins_col_right: { name: "右に列を挿入", callback: (_k: any, sel: any[]) => { const g = range(sel); doInsertCols(g.c1 + 1, g.c1 - g.c0 + 1); } },
      del_col: { name: "列を削除", callback: (_k: any, sel: any[]) => { const g = range(sel); doRemoveCols(g.c0, g.c1 - g.c0 + 1); } },
      cp_col: {
        name: "列をコピーして右に挿入",
        callback: (_k: any, sel: any[]) => { const g = range(sel); doCopyCols(g.c0, g.c1 - g.c0 + 1, g.c1 + 1); },
      },
      mv_col_left: {
        name: "列を左へ移動（入れ替え）",
        disabled: () => { const s = curRange(); return !s || s.c0 <= 0; },
        callback: (_k: any, sel: any[]) => { const g = range(sel); doMoveCols(g.c0, g.c1 - g.c0 + 1, g.c0 - 1); },
      },
      mv_col_right: {
        name: "列を右へ移動（入れ替え）",
        disabled: () => { const s = curRange(); const n = sheetsRef.current?.[active]?.colWidths.length ?? 0; return !s || s.c1 >= n - 1; },
        callback: (_k: any, sel: any[]) => { const g = range(sel); doMoveCols(g.c0, g.c1 - g.c0 + 1, g.c0 + 1); },
      },
      sep_fit: { name: "---------" },
      fit_col: {
        name: "列幅を内容に合わせる",
        callback: (_k: any, sel: any[]) => { const g = range(sel); fitCols(g.c0, g.c1); },
      },
      fit_row: {
        name: "行の高さを内容に合わせる",
        callback: (_k: any, sel: any[]) => { const g = range(sel); fitRows(g.r0, g.r1); },
      },
      fit_all: {
        name: "シート全体を内容に合わせる",
        callback: () => {
          const m = sheetsRef.current?.[active]; if (!m) return;
          fitCols(0, m.colWidths.length - 1);
          fitRows(0, m.rowHeights.length - 1, false);   // 元に戻すは1手にまとめる
        },
      },
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
  }), [active, curRange, menuCopy, menuPaste, fitCols, fitRows, doInsertRows, doRemoveRows, doInsertCols, doRemoveCols, doCopyRows, doCopyCols, doMoveRows, doMoveCols, applyCellAlign, applyCellWrap, insertLink]);

  // 行/列ヘッダのドラッグでの入れ替え。Handsontable 側の並べ替えは常に打ち切り（false）、
  // 自前のモデルを動かして描き直す（保存の構造編集と食い違わないようにするため）。
  const beforeRowMove = useCallback((movedRows: number[], finalIndex: number, _drop: number | undefined, movePossible: boolean) => {
    if (!movedRows?.length || typeof finalIndex !== "number" || movePossible === false) return false;
    const src = Math.min(...movedRows);
    const contiguous = movedRows.length === Math.max(...movedRows) - src + 1;
    if (contiguous) doMoveRows(src, movedRows.length, finalIndex);
    return false;
  }, [doMoveRows]);
  const beforeColumnMove = useCallback((movedCols: number[], finalIndex: number, _drop: number | undefined, movePossible: boolean) => {
    if (!movedCols?.length || typeof finalIndex !== "number" || movePossible === false) return false;
    const src = Math.min(...movedCols);
    const contiguous = movedCols.length === Math.max(...movedCols) - src + 1;
    if (contiguous) doMoveCols(src, movedCols.length, finalIndex);
    return false;
  }, [doMoveCols]);

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
            // 貼り付けでコピーしてきた書式（フォント・罫線・表示形式まで含む cellXfs の番号）
            const styleIndex = m.styleIdx[r]?.[c] ?? undefined;
            // 書式を貼り付けたセルは、土台が入れ替わるので折り返しも必ず書き直す
            const wrap = (wrapU !== undefined && (styleIndex !== undefined || wrapU !== (m.baseWrap[r]?.[c] ?? false)))
              ? wrapU : undefined;
            const valueChanged = cur !== orig;
            const fillChanged = fill !== undefined && fill !== null;
            const alignChanged = !!(al?.h || al?.v);
            if (!valueChanged && !fillChanged && !alignChanged && wrap === undefined && styleIndex === undefined) continue;

            let kind: CellEdit["kind"]; let value = cur; let cached: string | undefined;
            // 値が変わっていないなら書式だけ当てる（日付・数値書式を壊さない）
            if (!valueChanged) kind = "keep";
            else if (cur === "") kind = "blank";
            else if (cur.startsWith("=")) { kind = "formula"; cached = m.display[r]?.[c]; }
            else if (isNumeric(cur)) kind = "number";
            else kind = "string";

            edits.push({ sheet: m.name, row: r + 1, col: c + 1, kind, value, cached, fill, align: al?.h, valign: al?.v, wrap, styleIndex });
          }
        }
      }

      let out = bytes;

      // 0) シートの追加・削除・名前変更。以降の処理はシート名で対象を探すので必ず先に済ませる
      let structuralTouched = false;
      for (const op of sheetOpsRef.current) {
        structuralTouched = true;
        if (op.type === "add") out = addSheet(out, op.name, op.after);
        else if (op.type === "remove") out = removeSheet(out, op.name);
        else out = renameSheet(out, op.from, op.name);
      }

      // 1) 構造編集（行/列の挿入・削除）を記録順に適用
      for (const m of models) {
        for (const op of structOpsRef.current[m.name] ?? []) {
          structuralTouched = true;
          if (op.type === "insertRow") out = insertRows(out, m.name, op.at, op.count);
          else if (op.type === "removeRow") out = removeRows(out, m.name, op.at, op.count);
          else if (op.type === "insertCol") out = insertCols(out, m.name, op.at, op.count);
          else if (op.type === "removeCol") out = removeCols(out, m.name, op.at, op.count);
          else if (op.type === "copyRow") out = copyRows(out, m.name, op.src ?? op.at, op.count, op.at);
          else if (op.type === "copyCol") out = copyCols(out, m.name, op.src ?? op.at, op.count, op.at);
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
              <div style={sep} />
              {/* 縦の揃え。横の揃えと見分けがつくようにアイコン＋ラベルで出す */}
              <button onMouseDown={keepSel} onClick={() => setV("top")} style={avbtn(curV === "top")} title="上寄せ（縦）">
                <AlignVerticalJustifyStart style={sIc} />上
              </button>
              <button onMouseDown={keepSel} onClick={() => setV("middle")} style={avbtn(curV === "middle")} title="中央寄せ（縦）">
                <AlignVerticalJustifyCenter style={sIc} />中
              </button>
              <button onMouseDown={keepSel} onClick={() => setV("bottom")} style={avbtn(curV === "bottom")} title="下寄せ（縦）">
                <AlignVerticalJustifyEnd style={sIc} />下
              </button>
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
        セルは ⌘/Ctrl+C・X・V でコピー＆貼り付け。同じファイル内ならフォント・サイズ・太字・文字色・罫線・表示形式・背景まで丸ごと複製されます
        （他アプリとの行き来では文字・背景・揃え・折り返しのみ）。
        右クリックで行/列の挿入・削除・入れ替え・コピーして挿入・リンク・揃え・折り返し。行/列ヘッダをドラッグしても入れ替えできます。
        境界ドラッグで列幅/行高を変更、<strong>境界ダブルクリックで内容に合わせて自動調整</strong>（右クリックの「〜を内容に合わせる」でも可）。
        セル内改行（Alt+Enter）を入れると折り返し表示になり、行の高さが自動で伸びます。図形はクリックで選択して編集。
        ⚠ 行/列の挿入・削除では数式の参照は自動補正されません。図形編集の保存時は図形レイヤーが再生成されます。
        {sheet.truncated && `（大きいシートのため先頭 ${MAX_ROWS}行×${MAX_COLS}列 のみ編集対象）`}
      </p>

      {/* シートタブ（追加・名前変更・削除。BRU13-019） */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 12px 0", flexWrap: "wrap", flexShrink: 0 }}>
        {sheets.map((s, i) => {
          const on = i === active;
          return (
            <div key={s.name + i}
              style={{ display: "flex", alignItems: "center", borderRadius: "6px 6px 0 0", background: on ? "#059669" : "#F4F5F6", paddingRight: on ? 3 : 0 }}>
              <button onClick={() => setActive(i)} onDoubleClick={() => renameSheetAt(i)}
                title={on ? "ダブルクリックで名前を変更" : s.name}
                style={{ padding: "5px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: "6px 0 0 0", cursor: "pointer", background: "transparent", color: on ? "#fff" : "#6B6458" }}>
                {s.name}
              </button>
              {on && (
                <>
                  <button onClick={() => renameSheetAt(i)} title="シート名を変更" style={tabIconBtn}><Pencil style={{ width: 11, height: 11 }} /></button>
                  <button onClick={() => removeSheetAt(i)} title="このシートを削除"
                    style={{ ...tabIconBtn, opacity: sheets.length > 1 ? 1 : 0.4, cursor: sheets.length > 1 ? "pointer" : "default" }}>
                    <Trash2 style={{ width: 11, height: 11 }} />
                  </button>
                </>
              )}
            </div>
          );
        })}
        <button onClick={addSheetAfterActive} title="シートを追加"
          style={{ display: "flex", alignItems: "center", gap: 3, padding: "5px 10px", fontSize: 11, fontWeight: 700, border: "1px dashed #A7F3D0", borderRadius: "6px 6px 0 0", cursor: "pointer", background: "#ECFDF5", color: "#059669" }}>
          <Plus style={{ width: 12, height: 12 }} />シート
        </button>
      </div>

      {/* グリッド＋描画レイヤー（画像・図形は表示のみ）。
          Handsontable を実サイズで描画し、外側 div でスクロールさせることで
          描画オーバーレイとセルが一緒にスクロールし、位置がズレない。 */}
      <div ref={scrollRef} style={{ flex: 1, overflow: "auto", minHeight: 0, background: "#fff" }}>
        {/* 余白は内側に持たせる。スクロール枠に padding があると、固定したヘッダの上に
            余白ぶんの隙間ができて、そこをセルが通り抜けて見えてしまう。 */}
        <div style={{ padding: "8px 12px 12px", width: "fit-content" }}>
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
              copyPaste={false}
              manualColumnResize={true}
              manualRowResize={true}
              manualRowMove={true}
              manualColumnMove={true}
              beforeRowMove={beforeRowMove as any}
              beforeColumnMove={beforeColumnMove as any}
              beforeColumnResize={beforeColumnResize as any}
              beforeRowResize={beforeRowResize as any}
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
  display: "flex", alignItems: "center", justifyContent: "center", gap: 2, minWidth: 24, height: 26, padding: "0 5px",
  background: "#fff", color: "#6B4E9E", border: "1px solid #DDD6FE", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700,
};
const sIc: React.CSSProperties = { width: 13, height: 13 };
// シートタブ内の小さなアイコンボタン（名前変更・削除）
const tabIconBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20,
  background: "rgba(255,255,255,0.18)", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", marginLeft: 2,
};
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
