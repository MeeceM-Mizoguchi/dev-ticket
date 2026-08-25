// BRU13-019 シートの追加・削除・名前変更
//
// シート1枚は「xl/worksheets/sheetN.xml（実体）」＋「workbook.xml の <sheet>（並び順と名前）」
// ＋「workbook.xml.rels（実体への参照）」＋「[Content_Types].xml（種類の宣言）」の4点で成り立つ。
// どれか1つでも欠けると Excel は「修復が必要」と言うので、必ず4点まとめて書き換える。
//
// ⚠ 既知の制約：名前変更では数式・定義名のシート参照を best-effort で追随させる。

import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const PKGREL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WS_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
const WS_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml";

type Files = Record<string, Uint8Array>;

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
function readDoc(files: Files, path: string): { doc: Document; text: string } {
  const entry = files[path];
  if (!entry) throw new Error(`${path} が見つかりません`);
  const text = strFromU8(entry);
  return { doc: parseXml(text), text };
}
function writeDoc(files: Files, path: string, doc: Document, original: string) {
  files[path] = strToU8(serializeXml(doc, original));
}

/**
 * 数式の再計算順キャッシュ。シートを足し引きすると中身と食い違って
 * Excel が修復を求めるので、シート操作のたびに丸ごと捨てる（次に開いた時に作り直される）。
 */
function dropCalcChain(files: Files) {
  const path = "xl/calcChain.xml";
  if (!files[path]) return;
  delete files[path];
  try {
    const { doc, text } = readDoc(files, "[Content_Types].xml");
    for (const ov of Array.from(doc.getElementsByTagName("Override"))) {
      if (ov.getAttribute("PartName") === "/" + path) ov.parentNode?.removeChild(ov);
    }
    writeDoc(files, "[Content_Types].xml", doc, text);
  } catch { /* 宣言が無ければそのまま */ }
  try {
    const { doc, text } = readDoc(files, "xl/_rels/workbook.xml.rels");
    for (const rel of Array.from(doc.getElementsByTagName("Relationship"))) {
      if ((rel.getAttribute("Target") ?? "").replace(/^\/?xl\//, "") === "calcChain.xml") rel.parentNode?.removeChild(rel);
    }
    writeDoc(files, "xl/_rels/workbook.xml.rels", doc, text);
  } catch { /* 参照が無ければそのまま */ }
}

function findSheetEl(wbDoc: Document, name: string): Element | null {
  for (const s of Array.from(wbDoc.getElementsByTagName("sheet"))) {
    if (s.getAttribute("name") === name) return s;
  }
  return null;
}
function relIdOf(sheetEl: Element): string | null {
  return sheetEl.getAttribute("r:id") || sheetEl.getAttributeNS(R_NS, "id");
}

/** シート名として使えるか。使えなければ理由を返す */
export function validateSheetName(name: string, existing: string[], current?: string): string | null {
  const n = name.trim();
  if (!n) return "シート名を入力してください";
  if (n.length > 31) return "シート名は31文字までです";
  if (/[:\\/?*[\]]/.test(n)) return "シート名に : \\ / ? * [ ] は使えません";
  if (n.startsWith("'") || n.endsWith("'")) return "シート名の先頭と末尾に ' は使えません";
  if (existing.some(e => e !== current && e.toLowerCase() === n.toLowerCase())) return `「${n}」は既にあります`;
  return null;
}

/** name のシートを追加する。afterName を渡すとその右隣に入る */
export function addSheet(bytes: Uint8Array, name: string, afterName?: string): Uint8Array {
  const files = unzipSync(bytes);
  const wb = readDoc(files, "xl/workbook.xml");
  const rels = readDoc(files, "xl/_rels/workbook.xml.rels");
  const ct = readDoc(files, "[Content_Types].xml");

  // 空いている sheetN.xml と rId を探す
  let n = 1;
  while (files[`xl/worksheets/sheet${n}.xml`]) n++;
  const target = `worksheets/sheet${n}.xml`;
  const path = `xl/${target}`;
  let maxRid = 0;
  for (const rel of Array.from(rels.doc.getElementsByTagName("Relationship"))) {
    const m = /^rId(\d+)$/.exec(rel.getAttribute("Id") ?? "");
    if (m) maxRid = Math.max(maxRid, Number(m[1]));
  }
  const rid = `rId${maxRid + 1}`;

  // 1) 実体（空のシート）
  files[path] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
    + `<worksheet xmlns="${MAIN_NS}" xmlns:r="${R_NS}"><sheetData/></worksheet>`);

  // 2) 実体への参照
  const rel = rels.doc.createElementNS(PKGREL_NS, "Relationship");
  rel.setAttribute("Id", rid);
  rel.setAttribute("Type", WS_REL_TYPE);
  rel.setAttribute("Target", target);
  rels.doc.documentElement.appendChild(rel);

  // 3) 並び順と名前
  const sheetsEl = wb.doc.getElementsByTagName("sheets")[0];
  if (!sheetsEl) throw new Error("workbook.xml に <sheets> がありません");
  let maxSheetId = 0;
  for (const s of Array.from(sheetsEl.getElementsByTagName("sheet"))) {
    maxSheetId = Math.max(maxSheetId, Number(s.getAttribute("sheetId") ?? 0));
  }
  const sheetEl = wb.doc.createElementNS(MAIN_NS, "sheet");
  sheetEl.setAttribute("name", name);
  sheetEl.setAttribute("sheetId", String(maxSheetId + 1));
  sheetEl.setAttribute("r:id", rid);
  const after = afterName ? findSheetEl(wb.doc, afterName) : null;
  if (after && after.nextSibling) sheetsEl.insertBefore(sheetEl, after.nextSibling);
  else sheetsEl.appendChild(sheetEl);

  // 4) 種類の宣言
  const ov = ct.doc.createElementNS(ct.doc.documentElement.namespaceURI, "Override");
  ov.setAttribute("PartName", "/" + path);
  ov.setAttribute("ContentType", WS_CONTENT_TYPE);
  ct.doc.documentElement.appendChild(ov);

  writeDoc(files, "xl/workbook.xml", wb.doc, wb.text);
  writeDoc(files, "xl/_rels/workbook.xml.rels", rels.doc, rels.text);
  writeDoc(files, "[Content_Types].xml", ct.doc, ct.text);
  dropCalcChain(files);
  return zipSync(files, { level: 6 });
}

/** name のシートを削除する（最後の1枚は消せない） */
export function removeSheet(bytes: Uint8Array, name: string): Uint8Array {
  const files = unzipSync(bytes);
  const wb = readDoc(files, "xl/workbook.xml");
  const rels = readDoc(files, "xl/_rels/workbook.xml.rels");
  const ct = readDoc(files, "[Content_Types].xml");

  const sheetEl = findSheetEl(wb.doc, name);
  if (!sheetEl) throw new Error(`シート「${name}」が見つかりません`);
  if (wb.doc.getElementsByTagName("sheet").length <= 1) throw new Error("最後のシートは削除できません");

  const rid = relIdOf(sheetEl);
  let target: string | null = null;
  for (const rel of Array.from(rels.doc.getElementsByTagName("Relationship"))) {
    if (rel.getAttribute("Id") !== rid) continue;
    target = (rel.getAttribute("Target") ?? "").replace(/^\/?/, "");
    rel.parentNode?.removeChild(rel);
  }
  sheetEl.parentNode?.removeChild(sheetEl);

  if (target) {
    const path = target.startsWith("xl/") ? target : `xl/${target}`;
    delete files[path];
    delete files[path.replace(/([^/]+)$/, "_rels/$1.rels")];  // シート自身の参照表
    for (const ov of Array.from(ct.doc.getElementsByTagName("Override"))) {
      if (ov.getAttribute("PartName") === "/" + path) ov.parentNode?.removeChild(ov);
    }
  }

  // 消したシートを指している定義名は残しても Excel が壊れたと見なすので落とす
  const dn = wb.doc.getElementsByTagName("definedNames")[0];
  if (dn) {
    const pat = sheetRefPattern(name);
    for (const d of Array.from(dn.getElementsByTagName("definedName"))) {
      if (pat.test(d.textContent ?? "")) d.parentNode?.removeChild(d);
    }
    if (dn.getElementsByTagName("definedName").length === 0) dn.parentNode?.removeChild(dn);
  }

  writeDoc(files, "xl/workbook.xml", wb.doc, wb.text);
  writeDoc(files, "xl/_rels/workbook.xml.rels", rels.doc, rels.text);
  writeDoc(files, "[Content_Types].xml", ct.doc, ct.text);
  dropCalcChain(files);
  return zipSync(files, { level: 6 });
}

// 数式の中でシートを指す書き方は Name! と 'Name'! の2通り。
// 名前に空白や記号があれば引用符つきになる。
const needsQuote = (n: string) => !/^[A-Za-z_぀-ヿ㐀-鿿][A-Za-z0-9_.぀-ヿ㐀-鿿]*$/.test(n);
const quoteName = (n: string) => `'${n.replace(/'/g, "''")}'`;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function sheetRefPattern(name: string): RegExp {
  const plain = escapeRe(name);
  const quoted = escapeRe(quoteName(name));
  return new RegExp(`(?:${quoted}|(?<![A-Za-z0-9_.'])${plain})(?=!)`, "g");
}

/** シート名を変更する。数式・定義名の参照も best-effort で追随させる */
export function renameSheet(bytes: Uint8Array, oldName: string, newName: string): Uint8Array {
  if (oldName === newName) return bytes;
  const files = unzipSync(bytes);
  const wb = readDoc(files, "xl/workbook.xml");
  const sheetEl = findSheetEl(wb.doc, oldName);
  if (!sheetEl) throw new Error(`シート「${oldName}」が見つかりません`);
  sheetEl.setAttribute("name", newName);

  const pat = sheetRefPattern(oldName);
  const replacement = needsQuote(newName) ? quoteName(newName) : newName;

  // 定義名（名前の管理）の参照
  for (const d of Array.from(wb.doc.getElementsByTagName("definedName"))) {
    const t = d.textContent ?? "";
    if (t) d.textContent = t.replace(pat, replacement);
  }
  writeDoc(files, "xl/workbook.xml", wb.doc, wb.text);

  // 各シートの数式の参照
  for (const path of Object.keys(files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) continue;
    const text = strFromU8(files[path]);
    if (!pat.test(text)) { pat.lastIndex = 0; continue; }
    pat.lastIndex = 0;
    const doc = parseXml(text);
    let touched = false;
    for (const f of Array.from(doc.getElementsByTagName("f"))) {
      const t = f.textContent ?? "";
      if (!t) continue;
      const next = t.replace(pat, replacement);
      if (next !== t) { f.textContent = next; touched = true; }
    }
    if (touched) writeDoc(files, path, doc, text);
  }

  dropCalcChain(files);
  return zipSync(files, { level: 6 });
}
