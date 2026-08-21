// ENHA2-035 Word(.docx) 保存用：TipTap の HTML を docx に変換する
//
// 注意: これは「再生成」方式。段落・見出し・箇条書き・番号付き・表・リンク・画像に加え、
// 文字書式（色・サイズ・書体・蛍光ペン・下線・打ち消し・上付き/下付き・小型大文字・字間）と
// 段落書式（配置・字下げ・行間・前後の空き・網かけ・罫線）、表の列幅・セルの塗り・罫線・
// 縦位置・結合、用紙サイズと余白まで書き戻す。
// 元の docx にあった図形・テキストボックス・脚注・変更履歴・ヘッダー/フッターは
// 引き継げない（欠落する）。

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, ExternalHyperlink, ImageRun,
  AlignmentType, BorderStyle, ShadingType, LineRuleType, VerticalAlign, PageOrientation,
} from "docx";

/** px(96dpi) → twip */
const pxToTwip = (px: number) => Math.round(px * 15);
/** pt → twip */
const ptToTwip = (pt: number) => Math.round(pt * 20);

export interface DocxPageSetup {
  twips: { width: number; height: number; top: number; right: number; bottom: number; left: number };
  landscape: boolean;
}

interface RunStyle {
  bold?: boolean; italics?: boolean; underline?: boolean; strike?: boolean;
  superScript?: boolean; subScript?: boolean; smallCaps?: boolean; allCaps?: boolean;
  link?: string;
  color?: string; sizeHalfPt?: number; font?: string; shading?: string; spacing?: number;
}

// ── CSS 値の読み取り ───────────────────────────────────────

/** CSS の色（rgb()/#hex）→ docx の "RRGGBB" */
function cssColorToHex(value: string): string | undefined {
  const v = (value ?? "").trim();
  if (!v || v === "transparent" || v === "inherit" || v === "initial") return undefined;
  const rgb = /^rgba?\(([^)]+)\)$/.exec(v);
  if (rgb) {
    const [r, g, b, a] = rgb[1].split(",").map(n => parseFloat(n));
    if (a === 0) return undefined;
    return [r, g, b].map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1];
    return (h.length === 3 ? h.split("").map(c => c + c).join("") : h).toUpperCase();
  }
  return undefined;
}

/** CSS の長さ → px（pt/px/em/%を許す。em/% は本文11ptを基準にする） */
function cssLengthPx(value: string): number | undefined {
  const m = /^(-?[\d.]+)(pt|px|em|%)?$/.exec((value ?? "").trim());
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!isFinite(n)) return undefined;
  switch (m[2]) {
    case "pt": return n * (96 / 72);
    case "em": return n * 11 * (96 / 72);
    case "%": return (n / 100) * 11 * (96 / 72);
    default: return n;
  }
}

/** CSS の長さ → ハーフポイント（docx の文字サイズ単位） */
function cssSizeToHalfPt(value: string): number | undefined {
  const px = cssLengthPx(value);
  return px && px > 0 ? Math.round((px * 72 / 96) * 2) : undefined;
}

/** border ショートハンド（"1px solid #000"）→ docx の罫線 */
function cssBorderToDocx(value: string) {
  const v = (value ?? "").trim();
  if (!v || v === "none" || v.startsWith("0")) return undefined;
  const width = cssLengthPx(/(^|\s)(-?[\d.]+(?:px|pt))(\s|$)/.exec(v)?.[2] ?? "1px") ?? 1;
  const color = cssColorToHex(/#[0-9a-f]{3,6}|rgba?\([^)]+\)/i.exec(v)?.[0] ?? "") ?? "000000";
  const style = /dashed/.test(v) ? BorderStyle.DASHED
    : /dotted/.test(v) ? BorderStyle.DOTTED
      : /double/.test(v) ? BorderStyle.DOUBLE : BorderStyle.SINGLE;
  // docx の太さは 1/8pt 単位
  return { style, size: Math.max(1, Math.round((width * 72 / 96) * 8)), color, space: 1 };
}

// ── 文字書式 ──────────────────────────────────────────────

/** インラインstyle（色・大きさ・書体・背景・字間・大文字化）を読み取って書式に足す */
function applyInlineStyle(el: HTMLElement, style: RunStyle): RunStyle {
  const next = { ...style };
  const css = el.style;
  if (!css || !el.getAttribute("style")) return next;
  const color = cssColorToHex(css.color || "");
  if (color) next.color = color;
  const size = cssSizeToHalfPt(css.fontSize || "");
  if (size) next.sizeHalfPt = size;
  const family = (css.fontFamily || "").split(",")[0].replace(/^["']|["']$/g, "").trim();
  if (family) next.font = family;
  const bg = cssColorToHex(css.backgroundColor || "");
  if (bg) next.shading = bg;
  if (css.fontWeight === "bold" || parseInt(css.fontWeight || "", 10) >= 600) next.bold = true;
  if (css.fontStyle === "italic") next.italics = true;
  if (/underline/.test(css.textDecoration || "") || /underline/.test((css as any).textDecorationLine || "")) next.underline = true;
  if (/line-through/.test(css.textDecoration || "")) next.strike = true;
  if ((css.fontVariant || "").includes("small-caps")) next.smallCaps = true;
  if (css.textTransform === "uppercase") next.allCaps = true;
  const spacing = cssLengthPx(css.letterSpacing || "");
  if (spacing) next.spacing = Math.round((spacing * 72 / 96) * 20);
  return next;
}

/** 書式付きの TextRun を作る */
function textRun(text: string, style: RunStyle): TextRun {
  return new TextRun({
    text,
    bold: style.bold, italics: style.italics,
    underline: style.underline ? {} : undefined, strike: style.strike,
    superScript: style.superScript, subScript: style.subScript,
    smallCaps: style.smallCaps, allCaps: style.allCaps,
    color: style.color, size: style.sizeHalfPt, font: style.font,
    characterSpacing: style.spacing,
    shading: style.shading ? { type: ShadingType.CLEAR, fill: style.shading } : undefined,
  } as any);
}

// data:URI / base64 → Uint8Array（画像用）
function dataUriToBytes(src: string): Uint8Array | null {
  const m = /^data:[^;]+;base64,(.*)$/.exec(src);
  if (!m) return null;
  try {
    const bin = atob(m[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function imageType(src: string): "png" | "jpg" | "gif" | "bmp" {
  if (/^data:image\/(jpe?g)/i.test(src)) return "jpg";
  if (/^data:image\/gif/i.test(src)) return "gif";
  if (/^data:image\/bmp/i.test(src)) return "bmp";
  return "png";
}

// インライン要素 → TextRun/Hyperlink/ImageRun の配列
function inlineRuns(node: Node, style: RunStyle): (TextRun | ExternalHyperlink | ImageRun)[] {
  const out: (TextRun | ExternalHyperlink | ImageRun)[] = [];
  node.childNodes.forEach(child => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      if (text) out.push(textRun(text, style));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const elChild = child as HTMLElement;
    const tag = elChild.tagName.toLowerCase();
    let next: RunStyle = applyInlineStyle(elChild, style);
    if (tag === "strong" || tag === "b") next.bold = true;
    else if (tag === "em" || tag === "i") next.italics = true;
    else if (tag === "u" || tag === "ins") next.underline = true;
    else if (tag === "s" || tag === "strike" || tag === "del") next.strike = true;
    else if (tag === "sup") next.superScript = true;
    else if (tag === "sub") next.subScript = true;
    else if (tag === "mark") next = { ...next, shading: next.shading ?? "FFFF00" };
    else if (tag === "code") next = { ...next, font: next.font ?? "Consolas" };
    else if (tag === "br") { out.push(new TextRun({ break: 1 })); return; }
    else if (tag === "a") {
      const href = elChild.getAttribute("href") || "";
      const runs = inlineRuns(elChild, { ...next, link: href }) as TextRun[];
      out.push(new ExternalHyperlink({ link: href, children: runs.length ? runs : [new TextRun(elChild.textContent ?? "")] }));
      return;
    } else if (tag === "img") {
      const src = elChild.getAttribute("src") || "";
      const bytes = dataUriToBytes(src);
      if (bytes) {
        try {
          out.push(new ImageRun({
            data: bytes, type: imageType(src),
            transformation: { width: elChild.clientWidth || 400, height: elChild.clientHeight || 300 },
          } as any));
        } catch { /* 画像失敗は無視 */ }
      }
      return;
    }
    out.push(...inlineRuns(elChild, next));
  });
  return out;
}

// ── 段落書式 ──────────────────────────────────────────────

const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT, center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED,
};

/** 段落の style 属性 → docx の段落オプション */
function paragraphOptions(el: HTMLElement): Record<string, any> {
  const out: Record<string, any> = {};
  const css = el.style;
  if (!css || !el.getAttribute("style")) return out;

  const align = ALIGN[css.textAlign];
  if (align) out.alignment = align;

  const indent: Record<string, number> = {};
  const left = cssLengthPx(css.marginLeft || "");
  if (left) indent.left = pxToTwip(left);
  const right = cssLengthPx(css.marginRight || "");
  if (right) indent.right = pxToTwip(right);
  const firstLine = cssLengthPx(css.textIndent || "");
  if (firstLine && firstLine > 0) indent.firstLine = pxToTwip(firstLine);
  if (firstLine && firstLine < 0) indent.hanging = pxToTwip(-firstLine);
  if (Object.keys(indent).length) out.indent = indent;

  const spacing: Record<string, any> = {};
  const before = cssLengthPx(css.marginTop || "");
  if (before !== undefined) spacing.before = pxToTwip(before);
  const after = cssLengthPx(css.marginBottom || "");
  if (after !== undefined) spacing.after = pxToTwip(after);
  const lh = (css.lineHeight || "").trim();
  if (lh && lh !== "normal") {
    if (/^[\d.]+$/.test(lh)) { spacing.line = Math.round(parseFloat(lh) * 240); spacing.lineRule = LineRuleType.AUTO; }
    else {
      const px = cssLengthPx(lh);
      if (px) { spacing.line = ptToTwip(px * 72 / 96); spacing.lineRule = LineRuleType.EXACT; }
    }
  }
  if (Object.keys(spacing).length) out.spacing = spacing;

  const shading = cssColorToHex(css.backgroundColor || "");
  if (shading) out.shading = { type: ShadingType.CLEAR, fill: shading };

  const border: Record<string, any> = {};
  for (const side of ["top", "bottom", "left", "right"] as const) {
    const value = (css as any)[`border${side[0].toUpperCase()}${side.slice(1)}`] as string;
    const b = value ? cssBorderToDocx(value) : undefined;
    if (b) border[side] = b;
  }
  if (Object.keys(border).length) out.border = border;

  return out;
}

const HEADING: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4, h5: HeadingLevel.HEADING_5, h6: HeadingLevel.HEADING_6,
};

// ブロック要素 → docx の Paragraph/Table の配列
function blockToDocx(el: HTMLElement, listCtx?: { ordered: boolean; level: number }): (Paragraph | Table)[] {
  const tag = el.tagName.toLowerCase();
  const opts = paragraphOptions(el);

  if (tag in HEADING) {
    return [new Paragraph({ heading: HEADING[tag], ...opts, children: inlineRuns(el, {}) as any })];
  }
  if (tag === "p" || tag === "div") {
    return [new Paragraph({ ...opts, children: inlineRuns(el, {}) as any })];
  }
  if (tag === "blockquote") {
    return [new Paragraph({
      indent: { left: 480 }, spacing: { before: 60, after: 60 },
      ...opts, children: inlineRuns(el, {}) as any,
    })];
  }
  if (tag === "ul" || tag === "ol") {
    const ordered = tag === "ol";
    const level = listCtx ? listCtx.level + 1 : 0;
    const out: (Paragraph | Table)[] = [];
    el.childNodes.forEach(li => {
      if (li.nodeType === Node.ELEMENT_NODE && (li as HTMLElement).tagName.toLowerCase() === "li") {
        out.push(...listItemToDocx(li as HTMLElement, { ordered, level }));
      }
    });
    return out;
  }
  if (tag === "table") {
    return [tableToDocx(el)];
  }
  if (tag === "hr") {
    return [new Paragraph({ border: { bottom: { color: "999999", space: 1, style: BorderStyle.SINGLE, size: 6 } }, children: [] })];
  }
  // 未知のブロックは中の文をプレーン段落に
  return [new Paragraph({ ...opts, children: inlineRuns(el, {}) as any })];
}

function listItemToDocx(li: HTMLElement, ctx: { ordered: boolean; level: number }): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  // li の直接のインライン部分を1段落に（中に p がある場合はその段落書式も拾う）
  const inner = li.children.length === 1 && li.children[0].tagName.toLowerCase() === "p"
    ? (li.children[0] as HTMLElement) : li;
  const inline = new Paragraph({
    ...paragraphOptions(inner),
    children: inlineRuns(inner, {}).filter(r => !(r instanceof ImageRun)) as any,
    ...(ctx.ordered
      ? { numbering: { reference: "ol-ref", level: ctx.level } }
      : { bullet: { level: ctx.level } }),
  });
  out.push(inline);
  // ネストしたリスト
  li.childNodes.forEach(child => {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const t = (child as HTMLElement).tagName.toLowerCase();
      if (t === "ul" || t === "ol") out.push(...blockToDocx(child as HTMLElement, ctx));
    }
  });
  return out;
}

// ── 表 ───────────────────────────────────────────────────

function cellOptions(cell: HTMLElement): Record<string, any> {
  const out: Record<string, any> = {};
  const css = cell.style;
  const span = parseInt(cell.getAttribute("colspan") || "", 10);
  if (span > 1) out.columnSpan = span;
  const rowSpan = parseInt(cell.getAttribute("rowspan") || "", 10);
  if (rowSpan > 1) out.rowSpan = rowSpan;
  if (!css || !cell.getAttribute("style")) return out;

  const width = (css.width || "").trim();
  if (width.endsWith("%")) out.width = { size: parseFloat(width), type: WidthType.PERCENTAGE };
  else {
    const px = cssLengthPx(width);
    if (px) out.width = { size: pxToTwip(px), type: WidthType.DXA };
  }
  const shading = cssColorToHex(css.backgroundColor || "");
  if (shading) out.shading = { type: ShadingType.CLEAR, fill: shading };
  const valign = css.verticalAlign;
  if (valign === "middle" || valign === "center") out.verticalAlign = VerticalAlign.CENTER;
  else if (valign === "bottom") out.verticalAlign = VerticalAlign.BOTTOM;
  else if (valign === "top") out.verticalAlign = VerticalAlign.TOP;

  const borders: Record<string, any> = {};
  for (const side of ["top", "bottom", "left", "right"] as const) {
    const value = (css as any)[`border${side[0].toUpperCase()}${side.slice(1)}`] as string;
    const b = value ? cssBorderToDocx(value) : undefined;
    if (b) borders[side] = b;
  }
  if (Object.keys(borders).length) out.borders = borders;
  return out;
}

/** 表が持つ既定罫線（--dv-cell-border）→ docx の表罫線 */
function tableBorders(table: HTMLElement) {
  const value = table.style?.getPropertyValue("--dv-cell-border")?.trim();
  const border = value ? cssBorderToDocx(value) : undefined;
  const none = { style: BorderStyle.NONE, size: 0, color: "auto" };
  const side = border ?? none;
  return {
    top: side, bottom: side, left: side, right: side,
    insideHorizontal: side, insideVertical: side,
  };
}

function tableToDocx(table: HTMLElement): Table {
  const rows: TableRow[] = [];
  table.querySelectorAll("tr").forEach(tr => {
    const cells: TableCell[] = [];
    tr.querySelectorAll("th,td").forEach(cell => {
      const el = cell as HTMLElement;
      // セル内はブロック（段落・入れ子リスト・入れ子表）として扱う
      const blocks: (Paragraph | Table)[] = [];
      el.childNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const t = (node as HTMLElement).tagName.toLowerCase();
          if (["p", "div", "ul", "ol", "table", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6"].includes(t)) {
            blocks.push(...blockToDocx(node as HTMLElement));
          }
        }
      });
      if (!blocks.length) blocks.push(new Paragraph({ children: inlineRuns(el, {}) as any }));
      cells.push(new TableCell({ ...cellOptions(el), children: blocks as any }));
    });
    if (cells.length) rows.push(new TableRow({ children: cells }));
  });
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, borders: tableBorders(table) });
}

/** TipTap の HTML 文字列を docx の Blob に変換する */
export async function htmlToDocxBlob(html: string, page?: DocxPageSetup): Promise<Blob> {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;

  const children: (Paragraph | Table)[] = [];
  body.childNodes.forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      children.push(...blockToDocx(node as HTMLElement));
    } else if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent?.trim();
      if (t) children.push(new Paragraph({ children: [new TextRun(t)] }));
    }
  });
  if (children.length === 0) children.push(new Paragraph({ children: [] }));

  // 用紙は元の docx の設定を引き継ぐ（読めなかったときは docx の既定＝A4）
  const properties = page
    ? {
      page: {
        size: {
          width: page.twips.width, height: page.twips.height,
          orientation: page.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
        },
        margin: {
          top: page.twips.top, right: page.twips.right,
          bottom: page.twips.bottom, left: page.twips.left,
        },
      },
    }
    : undefined;

  const document = new Document({
    numbering: {
      config: [{
        reference: "ol-ref",
        levels: Array.from({ length: 4 }, (_, i) => ({
          level: i, format: "decimal" as const, text: `%${i + 1}.`, alignment: "start" as const,
          style: { paragraph: { indent: { left: 480 * (i + 1), hanging: 260 } } },
        })),
      }],
    },
    sections: [{ ...(properties ? { properties } : {}), children }],
  });

  return await Packer.toBlob(document);
}
