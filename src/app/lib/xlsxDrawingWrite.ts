// ENHA2-035 / BRU7-054 Excel 図形の書き戻し（B1：ネイティブ DrawingML 生成）
//
// 編集した図形だけを DrawingML に再生成し、xl/drawings/drawingN.xml を差し替える。
// ★安全設計: ユーザーが触っていない元アンカーは「原文のまま温存」する。
//   これにより画像・複雑な図形・グループは無傷で残り、編集したものだけが再生成される。
//   （＝対応外の図形が消えるリスクを、編集対象に限定できる）
//
// 座標は px、EMU=9525 換算。配置は absoluteAnchor（cell-anchor 変換を避け破損リスク低減）。

import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import type { DrawingObject } from "./xlsxDrawing";

const EMU = 9525;
const PT_TO_PX = 4 / 3;
const NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";

// ── プリセット図形の調整値（a:avLst / a:gd） ──────────────────
//
// ★重要: <a:avLst> に <a:gd> を1つでも書くなら、その図形が持つ調整値を
//   「全部」書かなければならない。1つでも欠けると Excel は描画パートを
//   丸ごと破損とみなして捨てる（＝画像も図形も全消え＋修復ダイアログ）。
//   吹き出しは尾の位置(adj1/adj2)だけ動かしたいが、wedgeRoundRectCallout は
//   角丸半径(adj3)も持つため、adj1/adj2 だけ書くと必ず壊れる。
//   値は ECMA-376 のプリセット定義の既定値。
const PRESET_ADJUSTS: Record<string, { name: string; val: number }[]> = {
  wedgeRectCallout: [{ name: "adj1", val: -20833 }, { name: "adj2", val: 62500 }],
  wedgeRoundRectCallout: [{ name: "adj1", val: -20833 }, { name: "adj2", val: 62500 }, { name: "adj3", val: 16667 }],
  wedgeEllipseCallout: [{ name: "adj1", val: -20833 }, { name: "adj2", val: 62500 }],
  cloudCallout: [{ name: "adj1", val: -20833 }, { name: "adj2", val: 62500 }],
};
// prst はファイル由来の文字列なので、プロトタイプ上のプロパティを拾わないようにする
function adjustsFor(prst: string) {
  return Object.prototype.hasOwnProperty.call(PRESET_ADJUSTS, prst) ? PRESET_ADJUSTS[prst] : undefined;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function hex6(c: string | null | undefined): string | null {
  if (!c) return null;
  const h = c.replace("#", "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(h) ? h : null;
}
const emu = (px: number) => Math.max(0, Math.round(px * EMU));
const emuExt = (px: number) => Math.max(EMU, Math.round(Math.max(px, 1) * EMU));

// a:xfrm（off=0,0 / ext / rot / flip）
function xfrm(o: DrawingObject): string {
  const rot = o.rot ? ` rot="${Math.round(o.rot * 60000)}"` : "";
  const fH = o.flipH ? ` flipH="1"` : "";
  const fV = o.flipV ? ` flipV="1"` : "";
  return `<a:xfrm${rot}${fH}${fV}><a:off x="0" y="0"/><a:ext cx="${emuExt(o.w)}" cy="${emuExt(o.h)}"/></a:xfrm>`;
}

function txBody(o: DrawingObject): string {
  const anchor = o.vAlign === "top" ? "t" : o.vAlign === "bottom" ? "b" : "ctr";
  // 文字が無くても Excel は sp に txBody を必ず書く。空段落で合わせておく。
  const ps = (o.paragraphs && o.paragraphs.length > 0) ? o.paragraphs.map(p => {
    const algn = p.align === "center" ? ' algn="ctr"' : p.align === "right" ? ' algn="r"' : ' algn="l"';
    const runs = p.runs.map(r => {
      const sz = Math.max(100, Math.round((r.sizePx / PT_TO_PX) * 100));
      const b = r.bold ? ' b="1"' : "";
      const i = r.italic ? ' i="1"' : "";
      const col = hex6(r.color);
      const fill = col ? `<a:solidFill><a:srgbClr val="${col}"/></a:solidFill>` : "";
      return `<a:r><a:rPr lang="ja-JP" sz="${sz}"${b}${i}>${fill}</a:rPr><a:t>${esc(r.text)}</a:t></a:r>`;
    }).join("");
    return `<a:p><a:pPr${algn}/>${runs}</a:p>`;
  }).join("") : `<a:p><a:pPr algn="l"/><a:endParaRPr lang="ja-JP"/></a:p>`;
  return `<xdr:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="${anchor}"/><a:lstStyle/>${ps}</xdr:txBody>`;
}

function prstGeom(o: DrawingObject, geom: string): string {
  // 吹き出しは尾の先端を adj1/adj2 で指定（中心からの割合×100000）。
  // adj3 以降を持つ図形は既定値も併せて出力する（部分的な gd は破損になるため）。
  const defs = adjustsFor(geom);
  if (o.adj && defs) {
    const a1 = Math.round((o.adj.fx - 0.5) * 100000);
    const a2 = Math.round((o.adj.fy - 0.5) * 100000);
    const gds = defs.map(d => {
      const v = d.name === "adj1" ? a1 : d.name === "adj2" ? a2 : d.val;
      return `<a:gd name="${d.name}" fmla="val ${v}"/>`;
    }).join("");
    return `<a:prstGeom prst="${esc(geom)}"><a:avLst>${gds}</a:avLst></a:prstGeom>`;
  }
  // 調整値の構成が分からない図形は空の avLst にする（尾は既定位置になるが破損しない）
  return `<a:prstGeom prst="${esc(geom)}"><a:avLst/></a:prstGeom>`;
}

function spPr(o: DrawingObject, geomDefault: string, forConnector: boolean): string {
  const geom = o.geom && o.geom !== "line" ? o.geom : geomDefault;
  const fillHex = hex6(o.fill);
  const fill = forConnector ? "" : (fillHex ? `<a:solidFill><a:srgbClr val="${fillHex}"/></a:solidFill>` : `<a:noFill/>`);
  let ln = "";
  if (o.line) {
    const lc = hex6(o.line.color) ?? "000000";
    const w = Math.max(EMU, Math.round(Math.max(o.line.width, 1) * EMU));
    const head = o.arrowHead ? `<a:headEnd type="triangle"/>` : "";
    const tail = o.arrowTail ? `<a:tailEnd type="triangle"/>` : "";
    ln = `<a:ln w="${w}"><a:solidFill><a:srgbClr val="${lc}"/></a:solidFill>${head}${tail}</a:ln>`;
  } else if (!forConnector) {
    ln = `<a:ln><a:noFill/></a:ln>`;
  }
  return `<xdr:spPr>${xfrm(o)}${prstGeom(o, geom)}${fill}${ln}</xdr:spPr>`;
}

// 1オブジェクト → <xdr:absoluteAnchor>...</xdr:absoluteAnchor>
export function buildAnchorXml(o: DrawingObject, cnvId: number): string {
  const pos = `<xdr:pos x="${emu(o.x)}" y="${emu(o.y)}"/><xdr:ext cx="${emuExt(o.w)}" cy="${emuExt(o.h)}"/>`;
  let inner = "";

  if (o.kind === "image") {
    if (!o.embedId) return ""; // 参照先メディアが無ければ出力しない
    inner =
      `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${cnvId}" name="Picture ${cnvId}"/><xdr:cNvPicPr>` +
      `<a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
      `<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${esc(o.embedId)}"/>` +
      `<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
      `<xdr:spPr>${xfrm(o)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>`;
  } else if (o.kind === "connector") {
    inner =
      `<xdr:cxnSp macro=""><xdr:nvCxnSpPr><xdr:cNvPr id="${cnvId}" name="Connector ${cnvId}"/><xdr:cNvCxnSpPr/></xdr:nvCxnSpPr>` +
      `${spPr(o, "straightConnector1", true)}</xdr:cxnSp>`;
  } else {
    inner =
      `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${cnvId}" name="Shape ${cnvId}"/><xdr:cNvSpPr/></xdr:nvSpPr>` +
      `${spPr(o, "rect", false)}${txBody(o)}</xdr:sp>`;
  }

  return `<xdr:absoluteAnchor>${pos}${inner}<xdr:clientData/></xdr:absoluteAnchor>`;
}

// ── 図形ID(cNvPr/@id)の一意化 ────────────────────────────────
//
// ★重要: Excel は 1つの drawing パート内で xdr:cNvPr/@id が重複していると、
//   その描画パート全体を「破損」として読み込み時に丸ごと破棄する。
//   （＝画像も図形も全部消える。修復ダイアログすら出ないことがある）
//   旧実装は再生成アンカーの id を毎回 1 から振っていたため、原文温存した
//   既存アンカーの id と必ず衝突し、保存のたびに描画が全滅していた。
//
// ここでは「未使用の番号を配る採番器」を作り、温存側の重複も直しつつ
// 新規生成分には空き番号を配ることで、drawing 全体の一意性を保証する。
class IdAllocator {
  private used = new Set<number>();
  private cursor = 0;

  /** 既存の id を確保する。重複・不正なら未使用の番号を返して差し替えさせる */
  keepOrReplace(raw: string | null): number | null {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0 && !this.used.has(n)) { this.used.add(n); return null; }
    return this.next();
  }

  next(): number {
    do { this.cursor++; } while (this.used.has(this.cursor));
    this.used.add(this.cursor);
    return this.cursor;
  }
}

/** 要素配下の xdr:cNvPr を走査し、重複/不正な id を採番し直す。直した数を返す */
function dedupeCNvPrIds(scope: Element, ids: IdAllocator): number {
  let fixed = 0;
  for (const p of Array.from(scope.getElementsByTagNameNS(NS_XDR, "cNvPr"))) {
    const replaced = ids.keepOrReplace(p.getAttribute("id"));
    if (replaced !== null) { p.setAttribute("id", String(replaced)); fixed++; }
  }
  return fixed;
}

// ── 不完全な調整値リストの検査・修復 ─────────────────────────
//
// 旧実装は吹き出しに adj1/adj2 だけを書いていたため、adj3 を持つ
// wedgeRoundRectCallout などで描画パートが破損していた。ここでは
// 「自前で生成した absoluteAnchor の中だけ」を対象に、
//   ・構成の分かるプリセット → 足りない gd を既定値で補完
//   ・その他の吹き出し       → gd を全部落として空の avLst にする
// とすることで、Excel が読み込める形に戻す。
// （Excel 由来の twoCellAnchor / oneCellAnchor は正しいので一切触らない）

/** prstGeom の avLst が不完全なら true。fix=true なら併せて修復する */
function checkAvLst(geomEl: Element, fix: boolean): boolean {
  const prst = geomEl.getAttribute("prst") ?? "";
  const avLst = Array.from(geomEl.children).find(c => c.localName === "avLst");
  if (!avLst) return false;
  const gds = Array.from(avLst.children).filter(c => c.localName === "gd");
  if (gds.length === 0) return false;

  const defs = adjustsFor(prst);
  if (!defs) {
    // 構成が分からない図形。吹き出し以外は旧実装が gd を書かないので正常とみなす
    if (!/callout/i.test(prst)) return false;
    if (fix) while (avLst.firstChild) avLst.removeChild(avLst.firstChild);
    return true;
  }

  const have = new Map(gds.map(g => [g.getAttribute("name") ?? "", g.getAttribute("fmla") ?? ""]));
  if (have.size === defs.length && defs.every(d => have.has(d.name))) return false; // 完全なので触らない
  if (fix) {
    while (avLst.firstChild) avLst.removeChild(avLst.firstChild);
    for (const d of defs) {
      const gd = geomEl.ownerDocument.createElementNS(NS_A, "a:gd");
      gd.setAttribute("name", d.name);
      gd.setAttribute("fmla", have.get(d.name) ?? `val ${d.val}`);
      avLst.appendChild(gd);
    }
  }
  return true;
}

/** 自前生成の absoluteAnchor 配下の prstGeom を検査（fix=true で修復）。該当数を返す */
function scanGeneratedGeoms(scope: Element, fix: boolean): number {
  let hit = 0;
  const anchors = scope.localName === "absoluteAnchor"
    ? [scope]
    : Array.from(scope.getElementsByTagNameNS(NS_XDR, "absoluteAnchor"));
  for (const a of anchors) {
    for (const g of Array.from(a.getElementsByTagNameNS(NS_A, "prstGeom"))) {
      if (checkAvLst(g, fix)) hit++;
    }
  }
  return hit;
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const ROOT_OPEN =
  '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"' +
  ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';

/**
 * 描画を書き戻した新しい drawingN.xml 文字列を生成する。
 * @param originalDrawingXml 元の drawingN.xml（未編集アンカーを原文温存するため）
 * @param finalObjects 編集後の全オブジェクト（anchorIndex 付き=元アンカー由来 / undefined=新規）
 * @param changedAnchors 編集/削除で作り直す元アンカー番号の集合
 */
export function buildDrawingXml(
  originalDrawingXml: string, finalObjects: DrawingObject[], changedAnchors: Set<number>,
): string {
  const doc = new DOMParser().parseFromString(originalDrawingXml, "application/xml");
  const serializer = new XMLSerializer();
  const anchorEls = Array.from(doc.documentElement.children)
    .filter(e => e.namespaceURI === NS_XDR && /Anchor$/.test(e.localName));

  const byAnchor = new Map<number, DrawingObject[]>();
  const created: DrawingObject[] = [];
  for (const o of finalObjects) {
    if (o.anchorIndex === undefined) created.push(o);
    else { const a = byAnchor.get(o.anchorIndex) ?? []; a.push(o); byAnchor.set(o.anchorIndex, a); }
  }

  // 先に温存アンカー側の id を確保（過去バージョンが作った重複もここで解消される）。
  // これを済ませてから新規/再生成分に空き番号を配ることで、drawing 全体で id が一意になる。
  // 併せて、過去バージョンが書いた不完全な調整値リストもここで直しておく。
  const ids = new IdAllocator();
  anchorEls.forEach((el, i) => {
    if (changedAnchors.has(i)) return;
    dedupeCNvPrIds(el, ids);
    scanGeneratedGeoms(el, true);
  });

  const parts: string[] = [];
  anchorEls.forEach((el, i) => {
    if (changedAnchors.has(i)) {
      // 変更あり → 生存オブジェクトを個別 absoluteAnchor で再生成（削除されたものは出ない）
      for (const o of byAnchor.get(i) ?? []) { const x = buildAnchorXml(o, ids.next()); if (x) parts.push(x); }
    } else {
      // 未編集 → 原文のまま温存
      parts.push(serializer.serializeToString(el).replace(/^<\?xml[^>]*\?>\s*/, ""));
    }
  });
  // 新規追加
  for (const o of created) { const x = buildAnchorXml(o, ids.next()); if (x) parts.push(x); }

  return XML_DECL + ROOT_OPEN + parts.join("") + "</xdr:wsDr>";
}

/**
 * 元 xlsx バイト列に、図形編集を反映した新しいバイト列を返す。
 * drawingN.xml だけを差し替え、画像・rels・他エントリは無改変で保持する。
 */
export function patchXlsxDrawing(
  originalBytes: Uint8Array, drawingPath: string,
  finalObjects: DrawingObject[], changedAnchors: Set<number>,
): Uint8Array {
  const files = unzipSync(originalBytes);
  const orig = files[drawingPath];
  if (!orig) throw new Error("描画データが見つかりません");
  const xml = buildDrawingXml(strFromU8(orig), finalObjects, changedAnchors);
  files[drawingPath] = strToU8(xml);
  return zipSync(files, { level: 6 });
}

/**
 * drawing パートを検査し、旧バージョンのバグで壊れている箇所を修復する。
 *  ・cNvPr/@id の重複（採番バグ）
 *  ・自前生成した吹き出しの不完全な調整値リスト（adj3 欠落バグ）
 * どちらも Excel が描画パートを丸ごと捨てる原因になるため、
 * 既に壊れた状態で保存されているファイルを次の保存時に自己修復する。
 * @returns 修復が必要だった場合は新しいバイト列 / 不要なら null
 */
export function repairDrawings(originalBytes: Uint8Array, drawingPaths: string[]): Uint8Array | null {
  const targets = [...new Set(drawingPaths.filter(p => !!p))];
  if (targets.length === 0) return null;

  const files = unzipSync(originalBytes);
  const serializer = new XMLSerializer();
  let touched = false;

  for (const path of targets) {
    const bytes = files[path];
    if (!bytes) continue;
    const text = strFromU8(bytes);
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) continue; // 壊れているものは触らない
    const fixedIds = dedupeCNvPrIds(doc.documentElement, new IdAllocator());
    const fixedGeoms = scanGeneratedGeoms(doc.documentElement, true);
    if (fixedIds === 0 && fixedGeoms === 0) continue;
    const decl = text.match(/^<\?xml[^>]*\?>/);
    files[path] = strToU8((decl ? decl[0] : XML_DECL.trim()) + serializer.serializeToString(doc.documentElement));
    touched = true;
  }

  return touched ? zipSync(files, { level: 6 }) : null;
}

/**
 * drawing パートに Excel が破損とみなす欠陥が無いかを検査する（保存前のガード用）。
 * @returns 見つかった欠陥の説明。空なら健全。
 */
export function findDrawingDefects(drawingXml: string): string[] {
  const doc = new DOMParser().parseFromString(drawingXml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return ["XMLが整形式ではありません"];
  const defects: string[] = [];

  const seen = new Set<number>();
  const dups = new Set<number>();
  for (const p of Array.from(doc.getElementsByTagNameNS(NS_XDR, "cNvPr"))) {
    const n = Number(p.getAttribute("id"));
    if (!Number.isInteger(n)) continue;
    if (seen.has(n)) dups.add(n); else seen.add(n);
  }
  if (dups.size > 0) defects.push(`図形IDの重複: ${[...dups].join(",")}`);

  const badGeoms = scanGeneratedGeoms(doc.documentElement, false);
  if (badGeoms > 0) defects.push(`調整値リストが不完全な図形: ${badGeoms}件`);

  return defects;
}
