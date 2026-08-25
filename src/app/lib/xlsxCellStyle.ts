// BRU13-019 セルの書式インデックス（<c s="..">）とフォントを読む
//
// xlsx はセルの書式（フォント・サイズ・太字・色・罫線・表示形式・配置）を
// styles.xml の cellXfs にまとめ、セルはその番号（s）だけを持つ。
// この番号をそのまま持ち運べば「セルの書式をまるごとコピー」できるので、
// コピー＆貼り付けでは番号を、画面表示ではフォントを解決して使う。

import { unzipSync, strFromU8 } from "fflate";
import { resolveCellColor, type ThemePalette } from "./xlsxCellColor";
import { resolveSheetPath } from "./xlsxStructure";

export interface CellFont {
  name?: string;
  size?: number;      // pt
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;     // "#RRGGBB"
}

function parseXml(text: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    return doc.getElementsByTagName("parsererror").length > 0 ? null : doc;
  } catch { return null; }
}
function colNum(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** styles.xml を読み、cellXfs の番号 → そのセルのフォント の表を作る */
export function parseXfFonts(bytes: Uint8Array, theme: ThemePalette): CellFont[] {
  try {
    const files = unzipSync(bytes);
    const entry = files["xl/styles.xml"];
    if (!entry) return [];
    const doc = parseXml(strFromU8(entry));
    if (!doc) return [];

    const fontsEl = doc.getElementsByTagName("fonts")[0];
    const fonts: CellFont[] = Array.from(fontsEl?.getElementsByTagName("font") ?? []).map(f => {
      const val = (tag: string) => f.getElementsByTagName(tag)[0]?.getAttribute("val") ?? null;
      // <b/> は val 省略で true、<b val="0"/> は false
      const flag = (tag: string) => {
        const e = f.getElementsByTagName(tag)[0];
        if (!e) return false;
        const v = e.getAttribute("val");
        return v !== "0" && v !== "false";
      };
      const u = f.getElementsByTagName("u")[0];
      const c = f.getElementsByTagName("color")[0];
      const color = c ? resolveCellColor({
        argb: c.getAttribute("rgb") ?? undefined,
        theme: c.hasAttribute("theme") ? Number(c.getAttribute("theme")) : undefined,
        indexed: c.hasAttribute("indexed") ? Number(c.getAttribute("indexed")) : undefined,
        tint: c.hasAttribute("tint") ? Number(c.getAttribute("tint")) : undefined,
      }, theme) : null;
      const size = val("sz");
      return {
        name: val("name") ?? val("rFont") ?? undefined,
        size: size ? Number(size) : undefined,
        bold: flag("b"),
        italic: flag("i"),
        underline: u ? u.getAttribute("val") !== "none" : false,
        color: color ?? undefined,
      };
    });

    const cellXfs = doc.getElementsByTagName("cellXfs")[0];
    if (!cellXfs) return [];
    return Array.from(cellXfs.getElementsByTagName("xf"))
      .map(xf => fonts[Number(xf.getAttribute("fontId") ?? 0)] ?? {});
  } catch { return []; }
}

/**
 * シートの各セルに効いている書式インデックスを読む（0 = 既定）。
 * セルの s が無い場合は行の customFormat → <cols> の style を継承する。
 */
export function parseCellStyleIndexes(bytes: Uint8Array, sheetName: string, rows: number, cols: number): number[][] {
  const out = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  try {
    const files = unzipSync(bytes);
    const path = resolveSheetPath(files, sheetName);
    if (!path || !files[path]) return out;
    const doc = parseXml(strFromU8(files[path]));
    if (!doc) return out;

    // 列の既定書式
    const colsEl = doc.getElementsByTagName("cols")[0];
    if (colsEl) {
      for (const col of Array.from(colsEl.getElementsByTagName("col"))) {
        const s = Number(col.getAttribute("style") ?? 0);
        if (!s) continue;
        const min = Number(col.getAttribute("min")), max = Number(col.getAttribute("max"));
        if (!min || !max) continue;
        for (let c = Math.max(1, min); c <= Math.min(max, cols); c++) {
          for (let r = 0; r < rows; r++) out[r][c - 1] = s;
        }
      }
    }

    const sd = doc.getElementsByTagName("sheetData")[0];
    if (!sd) return out;
    for (const row of Array.from(sd.getElementsByTagName("row"))) {
      const rn = Number(row.getAttribute("r"));
      if (!rn || rn > rows) continue;
      const cf = row.getAttribute("customFormat");
      const rowS = (cf === "1" || cf === "true") ? Number(row.getAttribute("s") ?? 0) : 0;
      if (rowS) for (let c = 0; c < cols; c++) out[rn - 1][c] = rowS;
      for (const cell of Array.from(row.getElementsByTagName("c"))) {
        const m = /^([A-Z]+)(\d+)$/.exec(cell.getAttribute("r") ?? "");
        if (!m) continue;
        const cn = colNum(m[1]);
        if (cn < 1 || cn > cols) continue;
        const s = cell.getAttribute("s");
        if (s !== null) out[rn - 1][cn - 1] = Number(s) || 0;
      }
    }
  } catch { /* 読めなければ全部既定書式として扱う */ }
  return out;
}
