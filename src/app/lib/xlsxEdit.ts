// ENHA2-035 Excel(.xlsx/.xlsm) 直接パッチ保存
//
// 方針: exceljs で読み込んで書き戻すと、グラフ・ピボット・一部の描画が
// 失われてしまう。そこで「編集したセルだけ」を元ファイル(=zip)の中で
// 書き換え、その他のエントリ(charts / media / drawings / pivot ...)は
// 一切触らずそのまま再梱包する。これによりグラフ・画像・図形を保持したまま
// 値・数式・セル色だけを更新できる。
//
// XML の編集はブラウザ標準の DOMParser / XMLSerializer で行う
// (再シリアライズするのは sheetN.xml / styles.xml / workbook.xml のみ)。

import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

export interface CellEdit {
  /** 対象シート名（exceljs の ws.name と一致させる） */
  sheet: string;
  /** 1始まりの行番号 */
  row: number;
  /** 1始まりの列番号 */
  col: number;
  /** keep=値は触らず書式だけ変える（塗り・揃え・折り返しのみの変更） */
  kind: "number" | "string" | "formula" | "blank" | "keep";
  /** number/string/formula の中身。formula は先頭 '=' を含めない */
  value: string;
  /** 数式の場合の表示キャッシュ値（あれば <v> に書く） */
  cached?: string;
  /** セル背景色 "#RRGGBB"。undefined=変更なし / null=塗り解除(現状は無視) */
  fill?: string | null;
  /** 水平揃え */
  align?: "left" | "center" | "right";
  /** 垂直揃え */
  valign?: "top" | "middle" | "bottom";
  /** 折り返し表示。undefined=変更なし / true=折り返す / false=はみ出す（BRU10-055） */
  wrap?: boolean;
}

// ── 列番号 <-> 列文字 ──────────────────────────────────────────
export function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
export function colNum(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// ── XML ヘルパ ────────────────────────────────────────────────
function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("XMLの解析に失敗しました");
  }
  return doc;
}
function serializeXml(doc: Document, original: string): string {
  // ブラウザの XMLSerializer は宣言を含めないが、実装によっては含める。
  // 二重付与を防ぐため、本体先頭の宣言を一旦剥がしてから付け直す。
  const body = new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, "");
  const decl = original.match(/^<\?xml[^>]*\?>/);
  return (decl ? decl[0] : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>') + body;
}
function el(doc: Document, name: string): Element {
  return doc.createElementNS(MAIN_NS, name);
}

// ── workbook.xml から シート名 -> sheetN.xml のパス を解決 ──────
function resolveSheetPaths(files: Record<string, Uint8Array>): Map<string, string> {
  const map = new Map<string, string>();
  const wbText = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : null;
  const relText = files["xl/_rels/workbook.xml.rels"] ? strFromU8(files["xl/_rels/workbook.xml.rels"]) : null;
  if (!wbText || !relText) return map;

  const wb = parseXml(wbText);
  const rels = parseXml(relText);

  // rId -> target(worksheets/sheet1.xml)
  const relMap = new Map<string, string>();
  for (const r of Array.from(rels.getElementsByTagName("Relationship"))) {
    const id = r.getAttribute("Id");
    const target = r.getAttribute("Target");
    if (id && target) relMap.set(id, target.replace(/^\/?/, ""));
  }

  for (const s of Array.from(wb.getElementsByTagName("sheet"))) {
    const name = s.getAttribute("name");
    // r:id は名前空間付き属性。getAttribute("r:id") が拾えない実装があるため両対応。
    const rid = s.getAttribute("r:id")
      || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    if (!name || !rid) continue;
    const target = relMap.get(rid);
    if (!target) continue;
    const path = target.startsWith("xl/") ? target : `xl/${target}`;
    map.set(name, path);
  }
  return map;
}

// ── styles.xml に「ソリッド塗り」の xf を用意する ──────────────
class StyleEditor {
  private doc: Document;
  private original: string;
  private fills: Element;
  private cellXfs: Element;
  private fillCache = new Map<string, number>();     // color -> fillId
  private xfCache = new Map<string, number>();        // baseS|color -> xfId
  dirty = false;

  usable: boolean;

  constructor(text: string) {
    this.original = text;
    this.doc = parseXml(text);
    this.fills = this.doc.getElementsByTagName("fills")[0];
    this.cellXfs = this.doc.getElementsByTagName("cellXfs")[0];
    this.usable = !!this.fills && !!this.cellXfs;
  }

  private ensureFill(color: string): number {
    const argb = "FF" + color.replace("#", "").toUpperCase();
    const cached = this.fillCache.get(argb);
    if (cached !== undefined) return cached;

    const fill = el(this.doc, "fill");
    const pat = el(this.doc, "patternFill");
    pat.setAttribute("patternType", "solid");
    const fg = el(this.doc, "fgColor");
    fg.setAttribute("rgb", argb);
    const bg = el(this.doc, "bgColor");
    bg.setAttribute("indexed", "64");
    pat.appendChild(fg); pat.appendChild(bg); fill.appendChild(pat);
    this.fills.appendChild(fill);
    const id = this.fills.getElementsByTagName("fill").length - 1;
    this.fills.setAttribute("count", String(id + 1));
    this.fillCache.set(argb, id);
    return id;
  }

  /** 既存 style index(baseS) を土台に、塗り/揃え/折り返しを足した xf を返す */
  ensureXf(baseS: number, opts: { fillColor?: string | null; alignH?: string; alignV?: string; wrap?: boolean }): number {
    const key = `${baseS}|${opts.fillColor ?? ""}|${opts.alignH ?? ""}|${opts.alignV ?? ""}|${opts.wrap ?? ""}`;
    const cached = this.xfCache.get(key);
    if (cached !== undefined) return cached;

    const xfs = this.cellXfs.getElementsByTagName("xf");
    const base = xfs[baseS] ?? xfs[0];
    // alignment 等の子要素も引き継ぐため deep clone
    const xf = base ? (base.cloneNode(true) as Element) : el(this.doc, "xf");

    if (opts.fillColor) {
      xf.setAttribute("fillId", String(this.ensureFill(opts.fillColor)));
      xf.setAttribute("applyFill", "1");
    }
    if (opts.alignH || opts.alignV || opts.wrap !== undefined) {
      let al = Array.from(xf.children).find(c => c.localName === "alignment") ?? null;
      if (!al) { al = el(this.doc, "alignment"); xf.insertBefore(al, xf.firstChild); }
      if (opts.alignH) al.setAttribute("horizontal", opts.alignH);
      if (opts.alignV) al.setAttribute("vertical", opts.alignV === "middle" ? "center" : opts.alignV);
      if (opts.wrap === true) al.setAttribute("wrapText", "1");
      else if (opts.wrap === false) al.removeAttribute("wrapText");
      xf.setAttribute("applyAlignment", "1");
    }

    this.cellXfs.appendChild(xf);
    const id = this.cellXfs.getElementsByTagName("xf").length - 1;
    this.cellXfs.setAttribute("count", String(id + 1));
    this.xfCache.set(key, id);
    this.dirty = true;
    return id;
  }

  serialize(): string {
    return serializeXml(this.doc, this.original);
  }
}

// ── sheetN.xml 内のセルを取得/生成 ────────────────────────────
function getOrCreateRow(doc: Document, sheetData: Element, rowNum: number): Element {
  const rows = sheetData.getElementsByTagName("row");
  let after: Element | null = null;
  for (const r of Array.from(rows)) {
    const n = Number(r.getAttribute("r"));
    if (n === rowNum) return r;
    if (n < rowNum) after = r;
    else break;
  }
  const row = el(doc, "row");
  row.setAttribute("r", String(rowNum));
  if (after && after.nextSibling) sheetData.insertBefore(row, after.nextSibling);
  else if (after) sheetData.appendChild(row);
  else sheetData.insertBefore(row, sheetData.firstChild);
  return row;
}

function getOrCreateCell(doc: Document, row: Element, col: number, ref: string): Element {
  const cells = row.getElementsByTagName("c");
  let after: Element | null = null;
  for (const c of Array.from(cells)) {
    const cRef = c.getAttribute("r") || "";
    const cCol = colNum(cRef.replace(/\d+/g, ""));
    if (cCol === col) return c;
    if (cCol < col) after = c;
    else break;
  }
  const cell = el(doc, "c");
  cell.setAttribute("r", ref);
  if (after && after.nextSibling) row.insertBefore(cell, after.nextSibling);
  else if (after) row.appendChild(cell);
  else row.insertBefore(cell, row.firstChild);
  return cell;
}

function clearCellValue(cell: Element) {
  while (cell.firstChild) cell.removeChild(cell.firstChild);
  cell.removeAttribute("t");
}

// ── 行/列の既定書式の継承 ──────────────────────────────────────
//
// ★重要: <c> に s 属性が無いと、Excel はその セルを style 0（＝書式なし）として扱う。
//   行の s + customFormat（や列の style）は「XMLに存在しないセル」にしか効かないため、
//   空セルを編集して <c> を作った瞬間に、行に付いていた塗り・フォントが消えて白くなる。
//   そこで、s を持たないセルには継承していたはずの書式を明示的に持たせる。

/** <cols> の style 属性（列単位の既定書式）をレンジのまま取り出す */
function colStyleRanges(doc: Document): Array<{ min: number; max: number; s: string }> {
  const out: Array<{ min: number; max: number; s: string }> = [];
  const cols = doc.getElementsByTagName("cols")[0];
  if (!cols) return out;
  for (const c of Array.from(cols.getElementsByTagName("col"))) {
    const s = c.getAttribute("style");
    const min = Number(c.getAttribute("min")), max = Number(c.getAttribute("max"));
    if (!s || !Number.isInteger(min) || !Number.isInteger(max)) continue;
    out.push({ min, max, s });
  }
  return out;
}

/** そのセルが（<c> が無ければ）適用されていたはずの style index。無ければ null */
function inheritedStyle(row: Element, col: number, ranges: ReturnType<typeof colStyleRanges>): string | null {
  const cf = row.getAttribute("customFormat");
  const rowS = (cf === "1" || cf === "true") ? row.getAttribute("s") : null;
  if (rowS) return rowS;                                   // 行書式が列書式より優先
  return ranges.find(r => r.min <= col && col <= r.max)?.s ?? null;
}

function applyEdit(doc: Document, cell: Element, edit: CellEdit) {
  // 書式だけの変更では値に触らない。共有文字列・日付・数値書式をそのまま残すため。
  if (edit.kind === "keep") return;
  clearCellValue(cell);
  if (edit.kind === "blank") return;

  if (edit.kind === "number") {
    const v = el(doc, "v");
    v.textContent = edit.value;
    cell.appendChild(v);
  } else if (edit.kind === "string") {
    cell.setAttribute("t", "inlineStr");
    const is = el(doc, "is");
    const t = el(doc, "t");
    // 前後の空白を保持
    if (/^\s|\s$/.test(edit.value)) t.setAttribute("xml:space", "preserve");
    t.textContent = edit.value;
    is.appendChild(t);
    cell.appendChild(is);
  } else if (edit.kind === "formula") {
    const f = el(doc, "f");
    f.textContent = edit.value.replace(/^=/, "");
    cell.appendChild(f);
    if (edit.cached !== undefined && edit.cached !== "") {
      const v = el(doc, "v");
      v.textContent = edit.cached;
      cell.appendChild(v);
    }
  }
}

// ── workbook.xml に fullCalcOnLoad を立てる（開いた時に全再計算）──
function setFullCalcOnLoad(files: Record<string, Uint8Array>) {
  const path = "xl/workbook.xml";
  if (!files[path]) return;
  const text = strFromU8(files[path]);
  const doc = parseXml(text);
  let calcPr = doc.getElementsByTagName("calcPr")[0];
  if (!calcPr) {
    calcPr = el(doc, "calcPr");
    const root = doc.documentElement;
    const ext = root.getElementsByTagName("extLst")[0];
    if (ext) root.insertBefore(calcPr, ext);
    else root.appendChild(calcPr);
  }
  calcPr.setAttribute("fullCalcOnLoad", "1");
  files[path] = strToU8(serializeXml(doc, text));
}

/**
 * 元の xlsx バイト列に対し、編集セルだけを反映した新しい xlsx バイト列を返す。
 * グラフ・画像・図形・ピボット等の他エントリは無改変で保持される。
 */
export function patchXlsx(originalBytes: Uint8Array, edits: CellEdit[]): Uint8Array {
  const files = unzipSync(originalBytes);
  if (edits.length === 0) return zipSync(files, { level: 6 });

  const sheetPaths = resolveSheetPaths(files);

  // スタイル(色/揃え/折り返し)編集があるときだけ styles.xml を読み込む
  const hasStyle = edits.some(e => (e.fill !== undefined && e.fill !== null) || e.align || e.valign || e.wrap !== undefined);
  const stylesPath = "xl/styles.xml";
  let styleEditor = hasStyle && files[stylesPath]
    ? new StyleEditor(strFromU8(files[stylesPath])) : null;
  if (styleEditor && !styleEditor.usable) styleEditor = null; // fills/cellXfs 不在ならスタイル編集はスキップ

  let hasFormula = false;

  // シートごとにまとめて編集
  const bySheet = new Map<string, CellEdit[]>();
  for (const e of edits) {
    if (e.kind === "formula") hasFormula = true;
    const arr = bySheet.get(e.sheet) ?? [];
    arr.push(e); bySheet.set(e.sheet, arr);
  }

  for (const [sheetName, sheetEdits] of bySheet) {
    const path = sheetPaths.get(sheetName);
    if (!path || !files[path]) continue;
    const text = strFromU8(files[path]);
    const doc = parseXml(text);
    let sheetData = doc.getElementsByTagName("sheetData")[0];
    if (!sheetData) {
      sheetData = el(doc, "sheetData");
      doc.documentElement.appendChild(sheetData);
    }

    const ranges = colStyleRanges(doc);

    for (const edit of sheetEdits) {
      const ref = colLetter(edit.col) + edit.row;
      const row = getOrCreateRow(doc, sheetData, edit.row);
      const cell = getOrCreateCell(doc, row, edit.col, ref);
      // <c> を作った時点で行/列の既定書式が外れるので、明示的に引き継ぐ
      if (!cell.hasAttribute("s")) {
        const inherited = inheritedStyle(row, edit.col, ranges);
        if (inherited) cell.setAttribute("s", inherited);
      }
      applyEdit(doc, cell, edit);
      // 色・揃え・折り返し
      const wantFill = edit.fill !== undefined && edit.fill !== null;
      if ((wantFill || edit.align || edit.valign || edit.wrap !== undefined) && styleEditor) {
        const baseS = Number(cell.getAttribute("s") || "0");
        const xfId = styleEditor.ensureXf(baseS, { fillColor: wantFill ? edit.fill : undefined, alignH: edit.align, alignV: edit.valign, wrap: edit.wrap });
        cell.setAttribute("s", String(xfId));
      }
    }

    files[path] = strToU8(serializeXml(doc, text));
  }

  if (styleEditor?.dirty) files[stylesPath] = strToU8(styleEditor.serialize());
  if (hasFormula) setFullCalcOnLoad(files);

  return zipSync(files, { level: 6 });
}
