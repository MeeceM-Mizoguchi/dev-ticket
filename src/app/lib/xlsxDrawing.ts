import { unzipSync } from "fflate";

// ENHA2-035 xlsx の「描画レイヤー」パーサ
//
// exceljs はセルの値しか扱わず、シート上に浮いている画像・図形・矢印(DrawingML)を
// 一切パースしない。スクリーンショットを貼った資料系のxlsxは中身のほとんどが
// この描画レイヤーなので、ここで xl/drawings/*.xml を自前で解釈して描画用モデルに変換する。
//
// 注意: DrawingML の完全実装ではない。よく使う図形・塗り・線・回転・テキスト・矢印に絞った近似。

const NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const EMU_PER_PX = 9525; // 96dpi
const PT_TO_PX = 4 / 3;

export interface TextRun { text: string; bold: boolean; italic: boolean; sizePx: number; color: string }
export interface Paragraph { align: "left" | "center" | "right"; runs: TextRun[] }

export interface DrawingObject {
  id: string;
  kind: "image" | "shape" | "connector";
  x: number; y: number; w: number; h: number;
  rot: number;              // 度
  flipH: boolean; flipV: boolean;
  src?: string;             // image: blob URL
  geom?: string;            // shape: prstGeom の prst
  fill?: string | null;
  line?: { color: string; width: number } | null;
  paragraphs?: Paragraph[];
  arrowHead?: boolean;      // 始点側の矢印
  arrowTail?: boolean;      // 終点側の矢印
}

export interface ParsedDrawings {
  objects: DrawingObject[];
  /** 描画が占める最大の列・行（グリッドをそこまで伸ばすために使う） */
  maxCol: number;
  maxRow: number;
  /** blob URL の解放 */
  dispose: () => void;
}

// ── XML ヘルパ（名前空間つきの直下の子だけを見る） ──────────────
function child(el: Element | null, ns: string, name: string): Element | null {
  if (!el) return null;
  for (const c of Array.from(el.children)) if (c.namespaceURI === ns && c.localName === name) return c;
  return null;
}
function children(el: Element | null, ns: string, name: string): Element[] {
  if (!el) return [];
  return Array.from(el.children).filter(c => c.namespaceURI === ns && c.localName === name);
}
function dig(el: Element | null, ...steps: [string, string][]): Element | null {
  let cur: Element | null = el;
  for (const [ns, n] of steps) { cur = child(cur, ns, n); if (!cur) return null; }
  return cur;
}
function num(el: Element | null, attr: string, fallback = 0): number {
  const v = el?.getAttribute(attr);
  const n = v === null || v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, "application/xml");
}

// ── 色 ────────────────────────────────────────────────────────
type Theme = Record<string, string>;

function clamp(n: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, n)); }

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number): string {
  const f = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = 0;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

// <a:srgbClr>/<a:schemeClr> + tint/shade/lumMod/lumOff を CSS色へ
function resolveColor(holder: Element | null, theme: Theme): string | null {
  if (!holder) return null;
  const srgb = child(holder, NS_A, "srgbClr");
  const scheme = child(holder, NS_A, "schemeClr");
  const sys = child(holder, NS_A, "sysClr");
  let base: string | null = null;
  let mods: Element | null = null;

  if (srgb) { base = `#${srgb.getAttribute("val")}`; mods = srgb; }
  else if (sys) { base = `#${sys.getAttribute("lastClr") ?? "000000"}`; mods = sys; }
  else if (scheme) {
    const key = scheme.getAttribute("val") ?? "";
    // schemeClr の tx1/bg1/tx2/bg2 は theme の dk1/lt1/dk2/lt2 を指す
    const alias: Record<string, string> = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" };
    base = theme[alias[key] ?? key] ?? null;
    mods = scheme;
  }
  if (!base || !/^#[0-9a-fA-F]{6}$/.test(base)) return base && /^#/.test(base) ? base : null;

  let [r, g, b] = hexToRgb(base);
  const modVal = (name: string): number | null => {
    const e = child(mods, NS_A, name);
    return e ? num(e, "val") / 100000 : null;
  };
  const lumMod = modVal("lumMod"), lumOff = modVal("lumOff");
  const shade = modVal("shade"), tint = modVal("tint");

  if (lumMod !== null || lumOff !== null) {
    const [h, s, l] = rgbToHsl(r, g, b);
    const nl = clamp(l * (lumMod ?? 1) + (lumOff ?? 0), 0, 1);
    [r, g, b] = hslToRgb(h, s, nl);
  }
  if (shade !== null) { r *= shade; g *= shade; b *= shade; }
  if (tint !== null) {
    r = r * tint + 255 * (1 - tint);
    g = g * tint + 255 * (1 - tint);
    b = b * tint + 255 * (1 - tint);
  }
  return rgbToHex(r, g, b);
}

function parseTheme(xml: string): Theme {
  const theme: Theme = {};
  const doc = parseXml(xml);
  const scheme = doc.getElementsByTagNameNS(NS_A, "clrScheme")[0];
  if (!scheme) return theme;
  for (const el of Array.from(scheme.children)) {
    const srgb = child(el, NS_A, "srgbClr");
    const sys = child(el, NS_A, "sysClr");
    if (srgb) theme[el.localName] = `#${srgb.getAttribute("val")}`;
    else if (sys) theme[el.localName] = `#${sys.getAttribute("lastClr") ?? "000000"}`;
  }
  return theme;
}

// ── テキスト ───────────────────────────────────────────────────
function parseTextBody(txBody: Element | null, theme: Theme, defaultColor: string): Paragraph[] {
  if (!txBody) return [];
  const out: Paragraph[] = [];
  for (const p of children(txBody, NS_A, "p")) {
    const algn = dig(p, [NS_A, "pPr"])?.getAttribute("algn") ?? "";
    const align = algn === "ctr" ? "center" : algn === "r" ? "right" : "left";
    const runs: TextRun[] = [];
    for (const r of children(p, NS_A, "r")) {
      const t = child(r, NS_A, "t")?.textContent ?? "";
      if (!t) continue;
      const rPr = child(r, NS_A, "rPr");
      runs.push({
        text: t,
        bold: rPr?.getAttribute("b") === "1",
        italic: rPr?.getAttribute("i") === "1",
        sizePx: (num(rPr, "sz", 1800) / 100) * PT_TO_PX,
        color: resolveColor(child(rPr, NS_A, "solidFill"), theme) ?? defaultColor,
      });
    }
    if (runs.length) out.push({ align, runs });
  }
  return out;
}

// ── 位置計算 ───────────────────────────────────────────────────
interface Grid { colPx: (i: number) => number; rowPx: (i: number) => number }

function anchorPoint(el: Element | null, grid: Grid): { x: number; y: number; col: number; row: number } {
  // <xdr:col>2</xdr:col> のように値はテキストノードで入っている
  const int = (name: string) => {
    const n = Number(child(el, NS_XDR, name)?.textContent ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  const col = int("col"), row = int("row");
  const colOff = int("colOff"), rowOff = int("rowOff");
  let x = 0, y = 0;
  for (let i = 0; i < col; i++) x += grid.colPx(i);
  for (let i = 0; i < row; i++) y += grid.rowPx(i);
  return { x: x + colOff / EMU_PER_PX, y: y + rowOff / EMU_PER_PX, col, row };
}

// ── 図形/画像/コネクタ ─────────────────────────────────────────
function parseFrame(spPr: Element | null): { rot: number; flipH: boolean; flipV: boolean } {
  const xfrm = child(spPr, NS_A, "xfrm");
  return {
    rot: num(xfrm, "rot", 0) / 60000,
    flipH: xfrm?.getAttribute("flipH") === "1",
    flipV: xfrm?.getAttribute("flipV") === "1",
  };
}

function parseFill(spPr: Element | null, style: Element | null, theme: Theme): string | null {
  if (child(spPr, NS_A, "noFill")) return null;
  const direct = resolveColor(child(spPr, NS_A, "solidFill"), theme);
  if (direct) return direct;
  // spPr に塗りが無い場合、Excel は xdr:style の fillRef を使う
  return resolveColor(dig(style, [NS_A, "fillRef"]), theme);
}

function parseLine(spPr: Element | null, style: Element | null, theme: Theme) {
  const ln = child(spPr, NS_A, "ln");
  if (child(ln, NS_A, "noFill")) return null;
  const color = resolveColor(child(ln, NS_A, "solidFill"), theme)
    ?? resolveColor(dig(style, [NS_A, "lnRef"]), theme);
  if (!color) return null;
  const w = num(ln, "w", 9525) / EMU_PER_PX;
  return { color, width: Math.max(1, w) };
}

/**
 * xlsx のバイト列から、指定シートの描画オブジェクトを取り出す。
 * @param sheetIndex 0始まりのシート番号
 * @param grid 列幅・行高(px)を返すアクセサ。アンカー位置の算出に使う
 */
export function parseXlsxDrawings(data: ArrayBuffer, sheetIndex: number, grid: Grid): ParsedDrawings {
  const empty: ParsedDrawings = { objects: [], maxCol: 0, maxRow: 0, dispose: () => {} };
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(data));
  } catch {
    return empty;
  }

  const dec = new TextDecoder();
  const text = (name: string): string | null => files[name] ? dec.decode(files[name]) : null;

  // workbook → シート → drawing の関係を辿る
  const wbXml = text("xl/workbook.xml");
  const wbRels = text("xl/_rels/workbook.xml.rels");
  if (!wbXml || !wbRels) return empty;

  const sheets = Array.from(parseXml(wbXml).getElementsByTagNameNS("*", "sheet"));
  const sheetEl = sheets[sheetIndex];
  if (!sheetEl) return empty;
  const sheetRid = sheetEl.getAttributeNS(NS_R, "id") ?? sheetEl.getAttribute("r:id");

  const relTarget = (relsXml: string, id: string | null): string | null => {
    if (!id) return null;
    for (const r of Array.from(parseXml(relsXml).getElementsByTagNameNS("*", "Relationship"))) {
      if (r.getAttribute("Id") === id) return r.getAttribute("Target");
    }
    return null;
  };
  // "../drawings/drawing1.xml" のような相対パスを zip 内の絶対パスへ
  const resolvePath = (base: string, target: string): string => {
    if (target.startsWith("/")) return target.slice(1);
    const parts = base.split("/").slice(0, -1);
    for (const seg of target.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg !== ".") parts.push(seg);
    }
    return parts.join("/");
  };

  const sheetTarget = relTarget(wbRels, sheetRid);
  if (!sheetTarget) return empty;
  const sheetPath = resolvePath("xl/workbook.xml", sheetTarget);
  const sheetXml = text(sheetPath);
  if (!sheetXml) return empty;

  const drawingRid = parseXml(sheetXml).getElementsByTagNameNS("*", "drawing")[0]
    ?.getAttributeNS(NS_R, "id") ?? null;
  if (!drawingRid) return empty;

  const sheetRelsPath = sheetPath.replace(/([^/]+)$/, "_rels/$1.rels");
  const sheetRels = text(sheetRelsPath);
  if (!sheetRels) return empty;
  const drawingTarget = relTarget(sheetRels, drawingRid);
  if (!drawingTarget) return empty;
  const drawingPath = resolvePath(sheetPath, drawingTarget);
  const drawingXml = text(drawingPath);
  if (!drawingXml) return empty;

  const drawingRels = text(drawingPath.replace(/([^/]+)$/, "_rels/$1.rels")) ?? "";
  const themeXml = text("xl/theme/theme1.xml");
  const theme = themeXml ? parseTheme(themeXml) : {};

  // 画像は blob URL 化して <img> で表示する
  const urls: string[] = [];
  const imageUrl = (rid: string | null): string | undefined => {
    const target = drawingRels ? relTarget(drawingRels, rid) : null;
    if (!target) return undefined;
    const p = resolvePath(drawingPath, target);
    const bytes = files[p];
    if (!bytes) return undefined;
    const ext = p.split(".").pop()?.toLowerCase() ?? "png";
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg"
      : ext === "gif" ? "image/gif" : ext === "svg" ? "image/svg+xml"
      : ext === "bmp" ? "image/bmp" : "image/png";
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    urls.push(url);
    return url;
  };

  const doc = parseXml(drawingXml);
  const root = doc.documentElement;
  const objects: DrawingObject[] = [];
  let maxCol = 0, maxRow = 0;
  let seq = 0;

  interface Box { x: number; y: number; w: number; h: number }

  // 図形の既定文字色。xdr:style の fontRef を優先し、無ければ塗りの明度から自動判定する。
  const defaultTextColor = (style: Element | null, fill: string | null): string => {
    const byRef = resolveColor(dig(style, [NS_A, "fontRef"]), theme);
    if (byRef) return byRef;
    if (fill && /^#[0-9a-fA-F]{6}$/.test(fill)) {
      const [r, g, b] = hexToRgb(fill);
      return 0.299 * r + 0.587 * g + 0.114 * b < 150 ? "#FFFFFF" : "#1A1714";
    }
    return "#1A1714";
  };

  // 1オブジェクトを描画モデルへ。grpSp の場合は子を座標変換しつつ再帰する。
  const emitOne = (el: Element, box: Box): void => {
    const name = el.localName;

    if (name === "pic") {
      if (box.w <= 0 || box.h <= 0) return;
      const rid = dig(el, [NS_XDR, "blipFill"], [NS_A, "blip"])?.getAttributeNS(NS_R, "embed") ?? null;
      const src = imageUrl(rid);
      if (!src) return;
      objects.push({ id: `d${seq++}`, kind: "image", ...box, ...parseFrame(child(el, NS_XDR, "spPr")), src });
      return;
    }

    if (name === "sp" || name === "cxnSp") {
      const spPr = child(el, NS_XDR, "spPr");
      // ★ xdr:style は sp/cxnSp の直下にある（アンカー直下ではない）。
      //   ここを取り違えると fillRef が引けず、塗りが常に透明になる。
      const style = child(el, NS_XDR, "style");
      const frame = parseFrame(spPr);
      const geom = dig(spPr, [NS_A, "prstGeom"])?.getAttribute("prst") ?? (name === "sp" ? "rect" : "line");
      const line = parseLine(spPr, style, theme);

      if (name === "sp") {
        if (box.w <= 0 || box.h <= 0) return;
        const fill = parseFill(spPr, style, theme);
        objects.push({
          id: `d${seq++}`, kind: "shape", ...box, ...frame, geom, fill, line,
          paragraphs: parseTextBody(child(el, NS_XDR, "txBody"), theme, defaultTextColor(style, fill)),
        });
      } else {
        const ln = child(spPr, NS_A, "ln");
        const hasEnd = (n: string) => {
          const e = child(ln, NS_A, n);
          return !!e && e.getAttribute("type") !== "none";
        };
        objects.push({
          id: `d${seq++}`, kind: "connector", ...box, ...frame, geom,
          line: line ?? { color: "#000000", width: 1 },
          arrowHead: hasEnd("headEnd"), arrowTail: hasEnd("tailEnd"),
        });
      }
      return;
    }

    if (name === "grpSp") {
      // グループは子図形を独自座標系(chOff/chExt)で持つので、表示矩形へ写像する
      const gx = dig(el, [NS_XDR, "grpSpPr"], [NS_A, "xfrm"]);
      const chOff = child(gx, NS_A, "chOff"), chExt = child(gx, NS_A, "chExt");
      const cw = num(chExt, "cx"), ch = num(chExt, "cy");
      const ox = num(chOff, "x"), oy = num(chOff, "y");

      for (const kid of Array.from(el.children)) {
        if (kid.namespaceURI !== NS_XDR) continue;
        if (!["pic", "sp", "cxnSp", "grpSp"].includes(kid.localName)) continue;
        const kx = kid.localName === "grpSp"
          ? dig(kid, [NS_XDR, "grpSpPr"], [NS_A, "xfrm"])
          : dig(kid, [NS_XDR, "spPr"], [NS_A, "xfrm"]);
        const koff = child(kx, NS_A, "off"), kext = child(kx, NS_A, "ext");
        const kb: Box = (cw > 0 && ch > 0 && koff && kext) ? {
          x: box.x + ((num(koff, "x") - ox) / cw) * box.w,
          y: box.y + ((num(koff, "y") - oy) / ch) * box.h,
          w: (num(kext, "cx") / cw) * box.w,
          h: (num(kext, "cy") / ch) * box.h,
        } : box;
        emitOne(kid, kb);
      }
    }
  };

  for (const anchor of Array.from(root.children)) {
    if (anchor.namespaceURI !== NS_XDR) continue;
    const type = anchor.localName; // twoCellAnchor / oneCellAnchor / absoluteAnchor
    if (!["twoCellAnchor", "oneCellAnchor", "absoluteAnchor"].includes(type)) continue;

    // 位置とサイズ
    let x = 0, y = 0, w = 0, h = 0;
    if (type === "absoluteAnchor") {
      const pos = child(anchor, NS_XDR, "pos");
      const ext = child(anchor, NS_XDR, "ext");
      x = num(pos, "x") / EMU_PER_PX; y = num(pos, "y") / EMU_PER_PX;
      w = num(ext, "cx") / EMU_PER_PX; h = num(ext, "cy") / EMU_PER_PX;
    } else {
      const from = anchorPoint(child(anchor, NS_XDR, "from"), grid);
      x = from.x; y = from.y;
      maxCol = Math.max(maxCol, from.col); maxRow = Math.max(maxRow, from.row);
      if (type === "twoCellAnchor") {
        const to = anchorPoint(child(anchor, NS_XDR, "to"), grid);
        w = to.x - from.x; h = to.y - from.y;
        maxCol = Math.max(maxCol, to.col); maxRow = Math.max(maxRow, to.row);
      } else {
        const ext = child(anchor, NS_XDR, "ext");
        w = num(ext, "cx") / EMU_PER_PX; h = num(ext, "cy") / EMU_PER_PX;
      }
    }
    // 垂直・水平の直線コネクタは幅または高さが 0 になるのが正常なので、
    // ここではサイズ0を弾かない（画像・図形側は emitOne で個別に弾く）。
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 0 || h < 0) continue;

    // アンカー直下には pic / sp / cxnSp のほか grpSp(グループ) が来ることがある
    for (const el of Array.from(anchor.children)) {
      if (el.namespaceURI !== NS_XDR) continue;
      if (["pic", "sp", "cxnSp", "grpSp"].includes(el.localName)) emitOne(el, { x, y, w, h });
    }
  }

  return {
    objects, maxCol, maxRow,
    dispose: () => { for (const u of urls) URL.revokeObjectURL(u); },
  };
}
