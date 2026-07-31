// ENHA2-035 Word(.docx) 保存用：TipTap の HTML を docx に変換する
//
// 注意: これは「再生成」方式。段落・見出し・太字/斜体/下線/取り消し線・
// 箇条書き・番号付き・表・リンク・画像に対応する。元の docx にあった
// 図形・凝ったレイアウト・脚注・変更履歴などは引き継げない（欠落する）。

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, ExternalHyperlink, ImageRun,
} from "docx";

interface RunStyle {
  bold?: boolean; italics?: boolean; underline?: boolean; strike?: boolean;
  link?: string;
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
      if (text) out.push(new TextRun({ text, bold: style.bold, italics: style.italics, underline: style.underline ? {} : undefined, strike: style.strike }));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const elChild = child as HTMLElement;
    const tag = elChild.tagName.toLowerCase();
    const next: RunStyle = { ...style };
    if (tag === "strong" || tag === "b") next.bold = true;
    else if (tag === "em" || tag === "i") next.italics = true;
    else if (tag === "u") next.underline = true;
    else if (tag === "s" || tag === "strike" || tag === "del") next.strike = true;
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

const HEADING: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4, h5: HeadingLevel.HEADING_5, h6: HeadingLevel.HEADING_6,
};

// ブロック要素 → docx の Paragraph/Table の配列
function blockToDocx(el: HTMLElement, listCtx?: { ordered: boolean; level: number }): (Paragraph | Table)[] {
  const tag = el.tagName.toLowerCase();

  if (tag in HEADING) {
    return [new Paragraph({ heading: HEADING[tag], children: inlineRuns(el, {}) as any })];
  }
  if (tag === "p" || tag === "div") {
    return [new Paragraph({ children: inlineRuns(el, {}) as any })];
  }
  if (tag === "blockquote") {
    return [new Paragraph({ children: inlineRuns(el, {}) as any, indent: { left: 480 }, spacing: { before: 60, after: 60 } })];
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
    return [new Paragraph({ border: { bottom: { color: "999999", space: 1, style: "single", size: 6 } }, children: [] })];
  }
  // 未知のブロックは中の文をプレーン段落に
  return [new Paragraph({ children: inlineRuns(el, {}) as any })];
}

function listItemToDocx(li: HTMLElement, ctx: { ordered: boolean; level: number }): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  // li の直接のインライン部分を1段落に
  const inline = new Paragraph({
    children: inlineRuns(li, {}).filter(r => !(r instanceof ImageRun)) as any,
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

function tableToDocx(table: HTMLElement): Table {
  const rows: TableRow[] = [];
  const trs = table.querySelectorAll("tr");
  trs.forEach(tr => {
    const cells: TableCell[] = [];
    tr.querySelectorAll("th,td").forEach(cell => {
      cells.push(new TableCell({
        children: [new Paragraph({ children: inlineRuns(cell as HTMLElement, {}) as any })],
      }));
    });
    if (cells.length) rows.push(new TableRow({ children: cells }));
  });
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

/** TipTap の HTML 文字列を docx の Blob に変換する */
export async function htmlToDocxBlob(html: string): Promise<Blob> {
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
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(document);
  return blob;
}
