// ENHA2-035 Word(.docx) の「見た目」を docx 本体から読み取る
//
// docx → HTML の変換は mammoth に任せているが、mammoth が運んでくれるのは
// 段落・見出し・箇条書き・表・画像・リンクといった骨組みだけで、
// 文字色/サイズ/書体、配置、字下げ、行間、段落前後の空き、網かけ、罫線、
// 表の列幅やセルの塗りといった「書式」はすべて落ちてしまう。
// ここでは docx の XML を直接読んで
//   ① エディタに流し込む CSS（用紙・本文・見出しの既定）
//   ② 文書順のラン書式（色・サイズ・書体・蛍光ペン・字間・大文字化）
//   ③ 文書順の段落書式（配置・字下げ・行間・前後の空き・網かけ・罫線）
//   ④ 表ごとの列幅とセル書式（塗り・縦位置・罫線）
// を取り出す。②③④は docxToHtml が mammoth の出力に着せ直す。

import { unzipSync, strFromU8 } from "fflate";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** twip(1/1440インチ) → px(96dpi) */
const twipToPx = (twips: number) => Math.round((twips * 96) / 1440);
/** ハーフポイント → pt */
const halfToPt = (half: number) => half / 2;
/** 罫線の太さ(1/8pt) → px */
const eighthToPx = (eighth: number) => Math.max(1, Math.round((eighth / 8) * (96 / 72)));

export interface RunLook {
  /** 突き合わせ用のラン本文（mammoth 側のランと一致するか確かめる） */
  text: string;
  css: string;
}

export type BlockKind = "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "blockquote";

export interface ParaLook {
  text: string;
  kind: BlockKind;
  css: string;
  /** 箇条書き/番号付きの段落（mammoth のリスト化に任せるので書式は着せない） */
  isList: boolean;
}

export interface TableLook {
  /** 1行目のセルに配す列幅（%）。列数が読めない/結合があるときは null */
  colWidthsPct: number[] | null;
  /** 行ごと・セルごとの書式（表の既定と同じ罫線は書かない） */
  rows: string[][];
  /**
   * その表の既定の罫線（表の罫線指定、または最も多くのセルが使っている罫線）。
   * 表そのものに持たせるので、編集中に足した行やセルも同じ罫線になり、
   * 保存時も同じ罫線で書き出せる。
   */
  defaultBorder?: string;
}

export interface DocxLook {
  /** 用紙の実寸。px はエディタ表示用、twips は保存時に書き戻す用 */
  page: {
    widthPx: number;
    padding: { top: number; right: number; bottom: number; left: number };
    twips: { width: number; height: number; top: number; right: number; bottom: number; left: number };
    landscape: boolean;
  };
  /** 本文の既定書式 */
  base: { font?: string; sizePt: number };
  css: string;
  runs: RunLook[];
  paragraphs: ParaLook[];
  tables: TableLook[];
}

interface RunProps { color?: string; szHalf?: number; font?: string; highlight?: string; caps?: "small" | "all"; spacing?: number }
interface ParaProps {
  align?: string; indLeft?: number; indRight?: number; indFirst?: number; indHang?: number;
  before?: number; after?: number; line?: number; lineRule?: string; shd?: string;
  borders?: Record<string, string>;
}
interface StyleDef { basedOn?: string; run: RunProps; para: ParaProps; outline?: number; name?: string }

function attr(el: Element | null, name: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(W_NS, name) ?? el.getAttribute("w:" + name);
}
function child(parent: Element | null | undefined, name: string): Element | null {
  if (!parent) return null;
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes[i] as Element;
    if (n.nodeType === 1 && n.localName === name) return n;
  }
  return null;
}
function children(parent: Element | null | undefined, name: string): Element[] {
  if (!parent) return [];
  const out: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes[i] as Element;
    if (n.nodeType === 1 && n.localName === name) out.push(n);
  }
  return out;
}
function descendants(root: Element | Document, name: string): Element[] {
  return Array.from(root.getElementsByTagNameNS(W_NS, name));
}
function intAttr(el: Element | null, name: string): number | undefined {
  const v = attr(el, name);
  return v && /^-?\d+$/.test(v) ? parseInt(v, 10) : undefined;
}
function onOff(el: Element | null): boolean | undefined {
  if (!el) return undefined;
  const v = attr(el, "val");
  return v === null || v === "1" || v === "true" || v === "on";
}

// ── 書式の読み取り ─────────────────────────────────────────

function readRunProps(rPr: Element | null): RunProps {
  if (!rPr) return {};
  const out: RunProps = {};
  const color = attr(child(rPr, "color"), "val");
  if (color && color !== "auto") out.color = "#" + color;
  const sz = intAttr(child(rPr, "sz"), "val");
  if (sz) out.szHalf = sz;
  const fonts = child(rPr, "rFonts");
  const font = attr(fonts, "eastAsia") || attr(fonts, "ascii") || attr(fonts, "hAnsi");
  if (font) out.font = font;
  const hl = attr(child(rPr, "highlight"), "val");
  if (hl && hl !== "none") out.highlight = hl;
  const shd = attr(child(rPr, "shd"), "fill");
  if (shd && shd !== "auto") out.highlight = "#" + shd;
  if (onOff(child(rPr, "smallCaps"))) out.caps = "small";
  if (onOff(child(rPr, "caps"))) out.caps = "all";
  const spacing = intAttr(child(rPr, "spacing"), "val");
  if (spacing) out.spacing = spacing; // 1/20pt
  return out;
}

function readParaProps(pPr: Element | null): ParaProps {
  if (!pPr) return {};
  const out: ParaProps = {};
  const jc = attr(child(pPr, "jc"), "val");
  if (jc) out.align = jc;
  const ind = child(pPr, "ind");
  if (ind) {
    out.indLeft = intAttr(ind, "left") ?? intAttr(ind, "start");
    out.indRight = intAttr(ind, "right") ?? intAttr(ind, "end");
    out.indFirst = intAttr(ind, "firstLine");
    out.indHang = intAttr(ind, "hanging");
  }
  const sp = child(pPr, "spacing");
  if (sp) {
    out.before = intAttr(sp, "before");
    out.after = intAttr(sp, "after");
    out.line = intAttr(sp, "line");
    out.lineRule = attr(sp, "lineRule") ?? undefined;
  }
  const shd = attr(child(pPr, "shd"), "fill");
  if (shd && shd !== "auto") out.shd = "#" + shd;
  const bdr = child(pPr, "pBdr");
  if (bdr) {
    const borders: Record<string, string> = {};
    for (const side of ["top", "bottom", "left", "right"]) {
      const b = child(bdr, side);
      const css = borderCss(b);
      if (css) borders[side] = css;
    }
    if (Object.keys(borders).length) out.borders = borders;
  }
  return out;
}

function borderCss(b: Element | null): string | undefined {
  if (!b) return undefined;
  const val = attr(b, "val");
  if (!val || val === "nil" || val === "none") return undefined;
  const size = eighthToPx(intAttr(b, "sz") ?? 4);
  const color = attr(b, "color");
  const style = val === "dashed" || val === "dotted" || val === "double" ? val : "solid";
  return `${size}px ${style} ${color && color !== "auto" ? "#" + color : "#000000"}`;
}

/** styles.xml → styleId ごとの定義と、文書既定 */
function readStyles(doc: Document) {
  const styles = new Map<string, StyleDef>();
  for (const st of descendants(doc, "style")) {
    const id = attr(st, "styleId");
    if (!id) continue;
    const pPr = child(st, "pPr");
    styles.set(id, {
      basedOn: attr(child(st, "basedOn"), "val") ?? undefined,
      name: attr(child(st, "name"), "val") ?? undefined,
      run: readRunProps(child(st, "rPr")),
      para: readParaProps(pPr),
      outline: intAttr(child(pPr, "outlineLvl"), "val"),
    });
  }
  const defaults = descendants(doc, "docDefaults")[0] ?? null;
  return {
    styles,
    docRun: readRunProps(child(child(defaults, "rPrDefault"), "rPr")),
    docPara: readParaProps(child(child(defaults, "pPrDefault"), "pPr")),
  };
}

function resolveStyle(styles: Map<string, StyleDef>, styleId: string | null | undefined, seen = new Set<string>()): { run: RunProps; para: ParaProps; outline?: number; name?: string } {
  if (!styleId || seen.has(styleId)) return { run: {}, para: {} };
  seen.add(styleId);
  const def = styles.get(styleId);
  if (!def) return { run: {}, para: {} };
  const parent = resolveStyle(styles, def.basedOn, seen);
  return {
    run: { ...parent.run, ...def.run },
    para: { ...parent.para, ...def.para },
    outline: def.outline ?? parent.outline,
    name: def.name,
  };
}

// ── CSS 化 ────────────────────────────────────────────────

function fontStack(font?: string): string {
  const base = `"Yu Gothic", "游ゴシック", "Hiragino Sans", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif`;
  return font ? `"${font}", ${base}` : base;
}

function runToCss(p: RunProps): string {
  const parts: string[] = [];
  // 色とサイズは（未指定でも既定を確定させて）必ず書き出す。
  // 書かないと保存時に Word 既定へ化けて、編集前と見た目が変わってしまう。
  parts.push(`color:${p.color ?? "#000000"}`);
  if (p.szHalf) parts.push(`font-size:${halfToPt(p.szHalf)}pt`);
  if (p.font) parts.push(`font-family:'${p.font.replace(/'/g, "")}'`);
  if (p.highlight) {
    const bg = p.highlight.startsWith("#") ? p.highlight : highlightToCss(p.highlight);
    if (bg) parts.push(`background-color:${bg}`);
  }
  if (p.caps === "small") parts.push("font-variant:small-caps");
  if (p.caps === "all") parts.push("text-transform:uppercase");
  if (p.spacing) parts.push(`letter-spacing:${(p.spacing / 20).toFixed(2)}pt`);
  return parts.join(";");
}

function paraToCss(p: ParaProps): string {
  const parts: string[] = [];
  const align = { both: "justify", distribute: "justify", center: "center", right: "right", end: "right", left: "left", start: "left" }[p.align ?? ""];
  if (align) parts.push(`text-align:${align}`);
  if (p.indLeft) parts.push(`margin-left:${twipToPx(p.indLeft)}px`);
  if (p.indRight) parts.push(`margin-right:${twipToPx(p.indRight)}px`);
  if (p.indHang) parts.push(`text-indent:-${twipToPx(p.indHang)}px`);
  else if (p.indFirst) parts.push(`text-indent:${twipToPx(p.indFirst)}px`);
  if (p.before !== undefined) parts.push(`margin-top:${twipToPx(p.before)}px`);
  if (p.after !== undefined) parts.push(`margin-bottom:${twipToPx(p.after)}px`);
  if (p.line) {
    if (!p.lineRule || p.lineRule === "auto") parts.push(`line-height:${(p.line / 240).toFixed(2)}`);
    else parts.push(`line-height:${(p.line / 20).toFixed(1)}pt`);
  }
  if (p.shd) parts.push(`background-color:${p.shd}`);
  if (p.borders) for (const [side, css] of Object.entries(p.borders)) parts.push(`border-${side}:${css}`);
  return parts.join(";");
}

/** Word の蛍光ペン名 → CSS色 */
function highlightToCss(name: string): string | undefined {
  const map: Record<string, string> = {
    yellow: "#FFFF00", green: "#00FF00", cyan: "#00FFFF", magenta: "#FF00FF", blue: "#0000FF",
    red: "#FF0000", darkBlue: "#000080", darkCyan: "#008080", darkGreen: "#008000",
    darkMagenta: "#800080", darkRed: "#800000", darkYellow: "#808000", darkGray: "#808080",
    lightGray: "#C0C0C0", black: "#000000", white: "#FFFFFF",
  };
  return map[name];
}

/** ランの本文（w:t だけ。mammoth 側のテキストと突き合わせるため w:tab などは含めない） */
function runText(r: Element): string {
  let out = "";
  for (const t of descendants(r, "t")) out += t.textContent ?? "";
  return out;
}

/** w:del（変更履歴の削除部分）の中にあるランは表示されない */
function isDeleted(r: Element): boolean {
  for (let p: Node | null = r.parentNode; p; p = p.parentNode) {
    const el = p as Element;
    if (el.localName === "del" && el.namespaceURI === W_NS) return true;
  }
  return false;
}

/** 見出しかどうか（スタイルID・スタイル名・アウトラインレベルから） */
function blockKind(styleId: string | null, resolved: { outline?: number; name?: string }): BlockKind {
  const id = (styleId ?? "").toLowerCase();
  const name = (resolved.name ?? "").toLowerCase();
  const m = /^heading\s*([1-6])$/.exec(id) || /^heading\s*([1-6])$/.exec(name) || /^見出し\s*([1-6])$/.exec(name);
  if (m) return `h${m[1]}` as BlockKind;
  if (id === "title" || name === "title") return "h1";
  if (id === "subtitle" || name === "subtitle") return "h2";
  if (id.includes("quote") || name.includes("quote")) return "blockquote";
  if (resolved.outline !== undefined && resolved.outline >= 0 && resolved.outline <= 5) return `h${resolved.outline + 1}` as BlockKind;
  return "p";
}

/**
 * docx のバイト列から、エディタ用の見た目情報を読む。
 * 解析できないときは null（呼び出し側は既定の見た目にフォールバックする）。
 */
export function readDocxLook(bytes: Uint8Array): DocxLook | null {
  try {
    const files = unzipSync(bytes, { filter: f => f.name === "word/document.xml" || f.name === "word/styles.xml" });
    const documentXml = files["word/document.xml"];
    if (!documentXml) return null;
    const parser = new DOMParser();
    const doc = parser.parseFromString(strFromU8(documentXml), "application/xml");
    const stylesDoc = files["word/styles.xml"]
      ? parser.parseFromString(strFromU8(files["word/styles.xml"]), "application/xml") : null;
    const { styles, docRun, docPara } = stylesDoc
      ? readStyles(stylesDoc)
      : { styles: new Map<string, StyleDef>(), docRun: {} as RunProps, docPara: {} as ParaProps };

    // ── 用紙（sectPr）──────────────────────────────────────
    const sect = descendants(doc, "sectPr").pop() ?? null;
    const pgSz = child(sect, "pgSz");
    const pgMar = child(sect, "pgMar");
    const tw = {
      width: intAttr(pgSz, "w") ?? 11906,
      height: intAttr(pgSz, "h") ?? 16838,
      top: intAttr(pgMar, "top") ?? 1440,
      right: intAttr(pgMar, "right") ?? 1440,
      bottom: intAttr(pgMar, "bottom") ?? 1440,
      left: intAttr(pgMar, "left") ?? 1440,
    };
    const page = {
      widthPx: twipToPx(tw.width),
      padding: { top: twipToPx(tw.top), right: twipToPx(tw.right), bottom: twipToPx(tw.bottom), left: twipToPx(tw.left) },
      twips: tw,
      landscape: attr(pgSz, "orient") === "landscape" || tw.width > tw.height,
    };

    // ── 本文の既定 ────────────────────────────────────────
    const normalStyle = resolveStyle(styles, "Normal");
    const normalRun = { ...docRun, ...normalStyle.run };
    const normalPara = { ...docPara, ...normalStyle.para };
    const baseSizePt = halfToPt(normalRun.szHalf ?? 21);
    const lineHeight = normalPara.line && (!normalPara.lineRule || normalPara.lineRule === "auto")
      ? (normalPara.line / 240).toFixed(2) : "1.15";

    // ── 見出しの既定 ──────────────────────────────────────
    const headingCss: string[] = [];
    for (let lv = 1; lv <= 6; lv++) {
      const st = resolveStyle(styles, `Heading${lv}`);
      const run = { ...normalRun, ...st.run };
      const para = { ...normalPara, ...st.para };
      const sizePt = halfToPt(run.szHalf ?? [40, 32, 28, 24, 22, 22][lv - 1]);
      headingCss.push(
        `.dv-docx .ProseMirror h${lv}{font-size:${sizePt}pt;line-height:1.25;font-weight:700;` +
        `color:${run.color ?? "#000000"};font-family:${fontStack(run.font)};` +
        `margin:${twipToPx(para.before ?? 320)}px 0 ${twipToPx(para.after ?? 120)}px;}`);
    }

    // ── 段落とランの書式（文書順）─────────────────────────
    const runs: RunLook[] = [];
    const paragraphs: ParaLook[] = [];
    for (const p of descendants(doc, "p")) {
      const pPr = child(p, "pPr");
      const styleId = attr(child(pPr, "pStyle"), "val");
      const st = resolveStyle(styles, styleId);
      const kind = blockKind(styleId, st);
      const para = { ...docPara, ...normalStyle.para, ...st.para, ...readParaProps(pPr) };
      // 既定と同じ値は書き出さない（見出しの既定マージンなどを二重に効かせないため）
      const kindBase = /^h[1-6]$/.test(kind)
        ? { ...normalPara, ...resolveStyle(styles, `Heading${kind[1]}`).para } : normalPara;
      const paraCss = paraToCss(diffPara(para, kindBase));
      let text = "";
      const inherited = { ...docRun, ...normalRun, ...st.run, ...readRunProps(child(pPr, "rPr")) };
      for (const r of descendants(p, "r")) {
        if (isDeleted(r)) continue;
        const rPr = child(r, "rPr");
        // ハイパーリンクなどは文字スタイル（w:rStyle）で色が決まる
        const charStyle = resolveStyle(styles, attr(child(rPr, "rStyle"), "val")).run;
        const eff = { ...inherited, ...charStyle, ...readRunProps(rPr) };
        const t = runText(r);
        text += t;
        runs.push({ text: t, css: runToCss(eff) });
      }
      paragraphs.push({ text, kind, css: paraCss, isList: !!child(pPr, "numPr") });
    }

    // ── 表（列幅とセル書式）───────────────────────────────
    const tables: TableLook[] = [];
    for (const tbl of descendants(doc, "tbl")) {
      // 入れ子の表は mammoth 側の出力順と合わせづらいので、外側だけ扱う
      tables.push(readTable(tbl));
    }

    const pad = page.padding;
    const css = [
      `.dv-docx{width:${page.widthPx}px;max-width:100%;padding:${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px;box-sizing:border-box;}`,
      `.dv-docx .ProseMirror{font-family:${fontStack(normalRun.font)};font-size:${baseSizePt}pt;line-height:${lineHeight};color:${normalRun.color ?? "#000000"};}`,
      `.dv-docx .ProseMirror p{margin:${twipToPx(normalPara.before ?? 0)}px 0 ${twipToPx(normalPara.after ?? 0)}px;}`,
      ...headingCss,
    ].join("\n");

    return { page, base: { font: normalRun.font, sizePt: baseSizePt }, css, runs, paragraphs, tables };
  } catch (e) {
    console.warn("[docxLook] 解析に失敗しました。既定の見た目で編集します", e);
    return null;
  }
}

/** 既定と同じ値を落として、段落固有の指定だけ残す */
function diffPara(p: ParaProps, base: ParaProps): ParaProps {
  const out: ParaProps = { ...p };
  for (const key of ["align", "indLeft", "indRight", "indFirst", "indHang", "before", "after", "line", "shd"] as const) {
    if (out[key] === base[key]) delete out[key];
  }
  if (out.line === undefined) delete out.lineRule;
  return out;
}

function readTable(tbl: Element): TableLook {
  // 列幅は tblGrid から。全体幅に対する割合にして1行目のセルに配る
  const grid = children(child(tbl, "tblGrid"), "gridCol").map(g => intAttr(g, "w") ?? 0);
  const total = grid.reduce((a, b) => a + b, 0);
  const colWidthsPct = grid.length && total > 0
    ? grid.map(w => Math.round((w / total) * 1000) / 10) : null;

  // 表全体の罫線指定（Word の表はこちらだけのことが多い）
  const tblBorders = child(child(tbl, "tblPr"), "tblBorders");
  let defaultBorder = borderCss(child(tblBorders, "insideH"))
    ?? borderCss(child(tblBorders, "top"))
    ?? borderCss(child(tblBorders, "left"));

  // セルごとの罫線（Googleドキュメント書き出しはこちらに全部入る）
  const cellBorders: Record<string, string>[][] = [];
  const shading: string[][] = [];
  const votes = new Map<string, number>();
  for (const tr of children(tbl, "tr")) {
    const rowBorders: Record<string, string>[] = [];
    const rowShading: string[] = [];
    for (const tc of children(tr, "tc")) {
      const tcPr = child(tc, "tcPr");
      const parts: string[] = [];
      const shd = attr(child(tcPr, "shd"), "fill");
      if (shd && shd !== "auto") parts.push(`background-color:#${shd}`);
      const vAlign = attr(child(tcPr, "vAlign"), "val");
      if (vAlign) parts.push(`vertical-align:${vAlign === "center" ? "middle" : vAlign}`);
      rowShading.push(parts.join(";"));

      const bdr = child(tcPr, "tcBorders");
      const borders: Record<string, string> = {};
      for (const side of ["top", "bottom", "left", "right"]) {
        const css = borderCss(child(bdr, side));
        if (css) { borders[side] = css; votes.set(css, (votes.get(css) ?? 0) + 1); }
      }
      rowBorders.push(borders);
    }
    cellBorders.push(rowBorders);
    shading.push(rowShading);
  }
  if (!defaultBorder && votes.size) {
    defaultBorder = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  // 既定と同じ罫線はセルに書かない（表の既定として一括で効かせる）
  const rows: string[][] = cellBorders.map((rowBorders, r) => rowBorders.map((borders, c) => {
    const parts: string[] = [];
    const base = shading[r]?.[c];
    if (base) parts.push(base);
    for (const [side, css] of Object.entries(borders)) {
      if (css !== defaultBorder) parts.push(`border-${side}:${css}`);
    }
    return parts.join(";");
  }));

  return { colWidthsPct, rows, defaultBorder };
}
