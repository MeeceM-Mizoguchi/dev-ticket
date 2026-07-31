// ENHA2-035 / BRU7-054 Excel 構造編集（行/列の挿入・削除、列幅/行高、ハイパーリンク）
//
// いずれも sheetN.xml（＋ハイパーリンクは rels）だけを書き換え、他エントリは無改変で再梱包する。
// ⚠ 既知の制約：行/列の挿入・削除で数式の参照は自動補正しない。結合セルは best-effort。

import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";

function colLetter(n: number): string {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function colNum(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const PKGREL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const HLINK_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new Error("XMLの解析に失敗しました");
  return doc;
}
function serializeXml(doc: Document, original: string): string {
  const body = new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, "");
  const decl = original.match(/^<\?xml[^>]*\?>/);
  return (decl ? decl[0] : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>') + body;
}
function el(doc: Document, name: string, ns = MAIN_NS): Element { return doc.createElementNS(ns, name); }

const REF = /^([A-Z]+)(\d+)$/;
function splitRef(ref: string): { col: number; row: number } | null {
  const m = REF.exec(ref);
  return m ? { col: colNum(m[1]), row: Number(m[2]) } : null;
}

// シート名 → xl/worksheets/sheetN.xml のパスを解決
function resolveSheetPath(files: Record<string, Uint8Array>, sheetName: string): string | null {
  const wb = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : null;
  const rels = files["xl/_rels/workbook.xml.rels"] ? strFromU8(files["xl/_rels/workbook.xml.rels"]) : null;
  if (!wb || !rels) return null;
  const relMap = new Map<string, string>();
  for (const r of Array.from(parseXml(rels).getElementsByTagName("Relationship"))) {
    const id = r.getAttribute("Id"), t = r.getAttribute("Target");
    if (id && t) relMap.set(id, t.replace(/^\/?/, ""));
  }
  for (const s of Array.from(parseXml(wb).getElementsByTagName("sheet"))) {
    if (s.getAttribute("name") !== sheetName) continue;
    const rid = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const target = rid ? relMap.get(rid) : null;
    if (!target) return null;
    return target.startsWith("xl/") ? target : `xl/${target}`;
  }
  return null;
}

// sheetN.xml を編集する共通ラッパ（sheetName から解決）
function withSheet(bytes: Uint8Array, sheetName: string, fn: (doc: Document, files: Record<string, Uint8Array>, sheetPath: string) => void): Uint8Array {
  const files = unzipSync(bytes);
  const sheetPath = resolveSheetPath(files, sheetName);
  if (!sheetPath || !files[sheetPath]) throw new Error("シートが見つかりません");
  const text = strFromU8(files[sheetPath]);
  const doc = parseXml(text);
  fn(doc, files, sheetPath);
  files[sheetPath] = strToU8(serializeXml(doc, text));
  return zipSync(files, { level: 6 });
}

// ── 行のシフト ────────────────────────────────────────────────
function shiftRows(doc: Document, from: number, delta: number) {
  const sheetData = doc.getElementsByTagName("sheetData")[0];
  if (!sheetData) return;
  for (const row of Array.from(sheetData.getElementsByTagName("row"))) {
    const rn = Number(row.getAttribute("r"));
    if (rn >= from) {
      row.setAttribute("r", String(rn + delta));
      for (const c of Array.from(row.getElementsByTagName("c"))) {
        const p = splitRef(c.getAttribute("r") || "");
        if (p) c.setAttribute("r", colLetter(p.col) + (p.row + delta));
      }
    }
  }
}
// ── 列のシフト（全行のセル参照＋<cols>） ─────────────────────
function shiftCols(doc: Document, from: number, delta: number) {
  const sheetData = doc.getElementsByTagName("sheetData")[0];
  if (sheetData) {
    for (const row of Array.from(sheetData.getElementsByTagName("row"))) {
      for (const c of Array.from(row.getElementsByTagName("c"))) {
        const p = splitRef(c.getAttribute("r") || "");
        if (p && p.col >= from) c.setAttribute("r", colLetter(p.col + delta) + p.row);
      }
    }
  }
  const cols = doc.getElementsByTagName("cols")[0];
  if (cols) {
    for (const col of Array.from(cols.getElementsByTagName("col"))) {
      const min = Number(col.getAttribute("min")), max = Number(col.getAttribute("max"));
      if (max >= from) col.setAttribute("max", String(max + delta));
      if (min >= from) col.setAttribute("min", String(min + delta));
    }
  }
}
// ── 結合セルの調整（best-effort） ────────────────────────────
function adjustMerges(doc: Document, kind: "row" | "col", at: number, delta: number) {
  const mc = doc.getElementsByTagName("mergeCells")[0];
  if (!mc) return;
  for (const m of Array.from(mc.getElementsByTagName("mergeCell"))) {
    const ref = m.getAttribute("ref") || "";
    const [a, b] = ref.split(":");
    const p1 = splitRef(a), p2 = splitRef(b);
    if (!p1 || !p2) continue;
    const shift = (v: number) => (v >= at ? v + delta : v);
    if (kind === "row") { p1.row = shift(p1.row); p2.row = shift(p2.row); }
    else { p1.col = shift(p1.col); p2.col = shift(p2.col); }
    // 範囲がつぶれたら削除、それ以外は更新
    if (p2.row < p1.row || p2.col < p1.col) mc.removeChild(m);
    else m.setAttribute("ref", `${colLetter(p1.col)}${p1.row}:${colLetter(p2.col)}${p2.row}`);
  }
  if (mc.getElementsByTagName("mergeCell").length === 0) mc.parentNode?.removeChild(mc);
  else mc.setAttribute("count", String(mc.getElementsByTagName("mergeCell").length));
}

// ── 行の挿入・削除（at は1始まり） ───────────────────────────
export function insertRows(bytes: Uint8Array, sheetName: string, at: number, count: number): Uint8Array {
  return withSheet(bytes, sheetName, doc => { shiftRows(doc, at, count); adjustMerges(doc, "row", at, count); });
}
export function removeRows(bytes: Uint8Array, sheetName: string, at: number, count: number): Uint8Array {
  return withSheet(bytes, sheetName, doc => {
    const sheetData = doc.getElementsByTagName("sheetData")[0];
    if (sheetData) for (const row of Array.from(sheetData.getElementsByTagName("row"))) {
      const rn = Number(row.getAttribute("r"));
      if (rn >= at && rn < at + count) sheetData.removeChild(row);
    }
    shiftRows(doc, at + count, -count);
    adjustMerges(doc, "row", at, -count);
  });
}
// ── 列の挿入・削除（at は1始まり） ───────────────────────────
export function insertCols(bytes: Uint8Array, sheetName: string, at: number, count: number): Uint8Array {
  return withSheet(bytes, sheetName, doc => { shiftCols(doc, at, count); adjustMerges(doc, "col", at, count); });
}
export function removeCols(bytes: Uint8Array, sheetName: string, at: number, count: number): Uint8Array {
  return withSheet(bytes, sheetName, doc => {
    const sheetData = doc.getElementsByTagName("sheetData")[0];
    if (sheetData) for (const row of Array.from(sheetData.getElementsByTagName("row"))) {
      for (const c of Array.from(row.getElementsByTagName("c"))) {
        const p = splitRef(c.getAttribute("r") || "");
        if (p && p.col >= at && p.col < at + count) row.removeChild(c);
      }
    }
    // 残った <cols> のうち削除範囲に掛かるものを整理
    const cols = doc.getElementsByTagName("cols")[0];
    if (cols) for (const col of Array.from(cols.getElementsByTagName("col"))) {
      const min = Number(col.getAttribute("min")), max = Number(col.getAttribute("max"));
      if (max >= at && min < at + count) {
        const nMax = Math.max(min - 1, at - 1, Math.min(max, at - 1));
        if (min >= at) { col.parentNode?.removeChild(col); continue; }
        col.setAttribute("max", String(Math.min(max, at - 1)));
      }
    }
    shiftCols(doc, at + count, -count);
    adjustMerges(doc, "col", at, -count);
  });
}

// ── 列幅（px）／行高（px）を反映 ─────────────────────────────
// px→Excel列幅は colPx の逆算 (px-5)/7、px→pt は px*3/4
export function setColWidths(bytes: Uint8Array, sheetName: string, widths: { col: number; px: number }[]): Uint8Array {
  if (widths.length === 0) return bytes;
  return withSheet(bytes, sheetName, doc => {
    const root = doc.documentElement;
    let cols = doc.getElementsByTagName("cols")[0];
    if (!cols) {
      cols = el(doc, "cols");
      const sheetData = doc.getElementsByTagName("sheetData")[0];
      root.insertBefore(cols, sheetData);
    }
    // 既存の <col> をレンジ配列に展開
    type Range = { min: number; max: number; attrs: Record<string, string> };
    const ranges: Range[] = Array.from(cols.getElementsByTagName("col")).map(c => {
      const attrs: Record<string, string> = {};
      for (const a of Array.from(c.attributes)) attrs[a.name] = a.value;
      return { min: Number(c.getAttribute("min")), max: Number(c.getAttribute("max")), attrs };
    });
    const widthOf = (px: number) => Math.max(0, (px - 5) / 7);
    for (const { col, px } of widths) {
      const w = widthOf(px).toFixed(4);
      const idx = ranges.findIndex(r => r.min <= col && col <= r.max);
      if (idx >= 0) {
        const r = ranges[idx];
        const parts: Range[] = [];
        if (r.min < col) parts.push({ min: r.min, max: col - 1, attrs: { ...r.attrs } });
        parts.push({ min: col, max: col, attrs: { ...r.attrs, width: w, customWidth: "1" } });
        if (r.max > col) parts.push({ min: col + 1, max: r.max, attrs: { ...r.attrs } });
        ranges.splice(idx, 1, ...parts);
      } else {
        ranges.push({ min: col, max: col, attrs: { min: String(col), max: String(col), width: w, customWidth: "1" } });
      }
    }
    ranges.sort((a, b) => a.min - b.min);
    while (cols.firstChild) cols.removeChild(cols.firstChild);
    for (const r of ranges) {
      const c = el(doc, "col");
      const attrs = { ...r.attrs, min: String(r.min), max: String(r.max) };
      for (const [k, v] of Object.entries(attrs)) c.setAttribute(k, v);
      cols.appendChild(c);
    }
  });
}
export function setRowHeights(bytes: Uint8Array, sheetName: string, heights: { row: number; px: number }[]): Uint8Array {
  if (heights.length === 0) return bytes;
  return withSheet(bytes, sheetName, doc => {
    const sheetData = doc.getElementsByTagName("sheetData")[0];
    if (!sheetData) return;
    const getOrCreateRow = (rowNum: number): Element => {
      const rows = sheetData.getElementsByTagName("row");
      let after: Element | null = null;
      for (const r of Array.from(rows)) {
        const n = Number(r.getAttribute("r"));
        if (n === rowNum) return r;
        if (n < rowNum) after = r; else break;
      }
      const row = el(doc, "row"); row.setAttribute("r", String(rowNum));
      if (after && after.nextSibling) sheetData.insertBefore(row, after.nextSibling);
      else if (after) sheetData.appendChild(row);
      else sheetData.insertBefore(row, sheetData.firstChild);
      return row;
    };
    for (const { row, px } of heights) {
      const r = getOrCreateRow(row);
      r.setAttribute("ht", (px * 0.75).toFixed(2));
      r.setAttribute("customHeight", "1");
    }
  });
}

// ── ハイパーリンク ───────────────────────────────────────────
export function addHyperlinks(bytes: Uint8Array, sheetName: string, links: { ref: string; url: string }[]): Uint8Array {
  if (links.length === 0) return bytes;
  return withSheet(bytes, sheetName, (doc, files, sheetPath) => {
    const relsPath = sheetPath.replace(/([^/]+)$/, "_rels/$1.rels");
    // rels（無ければ生成）
    const relsText = files[relsPath] ? strFromU8(files[relsPath]) : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKGREL_NS}"></Relationships>`;
    const relsDoc = parseXml(relsText);
    const relsRoot = relsDoc.documentElement;
    let maxId = 0;
    for (const r of Array.from(relsRoot.getElementsByTagName("Relationship"))) {
      const m = /rId(\d+)/.exec(r.getAttribute("Id") || ""); if (m) maxId = Math.max(maxId, Number(m[1]));
    }
    // worksheet の <hyperlinks>（無ければ pageMargins/printOptions の前 or 末尾に生成）
    const root = doc.documentElement;
    let hl = doc.getElementsByTagName("hyperlinks")[0];
    if (!hl) {
      hl = el(doc, "hyperlinks");
      const before = doc.getElementsByTagName("pageMargins")[0] ?? doc.getElementsByTagName("printOptions")[0] ?? null;
      if (before) root.insertBefore(hl, before); else root.appendChild(hl);
    }
    for (const { ref, url } of links) {
      const id = `rId${++maxId}`;
      const rel = relsDoc.createElementNS(PKGREL_NS, "Relationship");
      rel.setAttribute("Id", id); rel.setAttribute("Type", HLINK_TYPE);
      rel.setAttribute("Target", url); rel.setAttribute("TargetMode", "External");
      relsRoot.appendChild(rel);
      const h = el(doc, "hyperlink");
      h.setAttribute("ref", ref);
      h.setAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "r:id", id);
      hl.appendChild(h);
    }
    hl.setAttribute("count", String(hl.getElementsByTagName("hyperlink").length));
    files[relsPath] = strToU8(serializeXml(relsDoc, relsText));
  });
}
