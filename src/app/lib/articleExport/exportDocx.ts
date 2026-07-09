// ArticleDoc(IR) → Word(.docx, Blob)。docx ライブラリで真の編集可能 OOXML を生成。
// リストは numbering 設定を避け、行頭マーカー＋インデントで表現（PDF/Excel と統一）。
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ImageRun, BorderStyle, TableLayoutType,
} from "docx";
import type { ArticleDoc, Block, ListBlock, Run } from "./types";
import type { LoadedImage } from "./imageLoader";

const CONTENT_PX = 620; // A4縦の本文幅目安(px)

// "\n" を改行として TextRun 列に展開
function toTextRuns(runs: Run[], base: { font?: string } = {}): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    const parts = r.text.split("\n");
    parts.forEach((p, i) => {
      out.push(new TextRun({
        text: p,
        bold: r.bold,
        italics: r.italic,
        strike: r.strike,
        break: i > 0 ? 1 : undefined,
        font: r.code ? "Consolas" : base.font,
      }));
    });
  }
  if (!out.length) out.push(new TextRun({ text: "" }));
  return out;
}

function listParagraphs(block: ListBlock, depth = 0): Paragraph[] {
  const out: Paragraph[] = [];
  let n = 0;
  for (const it of block.items) {
    n++;
    const marker = block.ordered ? `${n}. ` : "• ";
    out.push(new Paragraph({
      indent: { left: 360 + depth * 360 },
      children: [new TextRun({ text: marker }), ...toTextRuns(it.runs)],
    }));
    if (it.sub) out.push(...listParagraphs(it.sub, depth + 1));
  }
  return out;
}

// A4縦の本文幅目安(twips)。docx はパーセント幅だと Word/Googleドキュメントで列が潰れるため、
// 固定幅(DXA/twips)＋FIXEDレイアウトで列幅を明示する。
const TABLE_TWIPS = 9020;

function tableCell(runs: Run[], header: boolean, widthTwips: number): TableCell {
  return new TableCell({
    width: { size: widthTwips, type: WidthType.DXA },
    shading: header ? { fill: "F4F5F6" } : undefined,
    children: [new Paragraph({ children: toTextRuns(runs) })],
  });
}

function buildTable(block: Block & { type: "table" }): Table {
  const cols = Math.max(...block.rows.map(r => r.length), 1);
  const raw = block.colWidths && block.colWidths.length ? block.colWidths : [];
  const weights = Array.from({ length: cols }, (_, i) => (raw[i] && raw[i] > 0 ? raw[i] : 1));
  const sum = weights.reduce((a, b) => a + b, 0) || cols;
  // 各列を比率で twips 配分（極端に狭い列が出ないよう最小幅を確保）。
  const colTwips = weights.map(w => Math.max(700, Math.round((w / sum) * TABLE_TWIPS)));
  return new Table({
    width: { size: TABLE_TWIPS, type: WidthType.DXA },
    columnWidths: colTwips,
    layout: TableLayoutType.FIXED,
    rows: block.rows.map(row => new TableRow({
      children: Array.from({ length: cols }).map((_, ci) =>
        tableCell(row[ci]?.runs ?? [{ text: "" }], !!row[ci]?.header, colTwips[ci])),
    })),
  });
}

function imageParagraph(url: string, images: Map<string, LoadedImage>): Paragraph | null {
  const im = images.get(url);
  if (!im) return null;
  const w = Math.min(im.width || CONTENT_PX, CONTENT_PX);
  const h = im.width ? Math.round((w * im.height) / im.width) : im.height;
  return new Paragraph({
    spacing: { before: 120, after: 120 },
    children: [new ImageRun({ data: im.arrayBuffer, type: im.docxType, transformation: { width: w, height: h } })],
  });
}

function blockToChildren(b: Block, images: Map<string, LoadedImage>): (Paragraph | Table)[] {
  switch (b.type) {
    case "heading": {
      const level = b.level === 1 ? HeadingLevel.HEADING_1 : b.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      return [new Paragraph({ heading: level, children: toTextRuns(b.runs) })];
    }
    case "paragraph": return [new Paragraph({ children: toTextRuns(b.runs), spacing: { after: 120 } })];
    case "list": return listParagraphs(b);
    case "blockquote":
      // 引用内の段落は左罫線＋インデントで表現。段落以外(表/画像)はそのまま。
      return b.blocks.flatMap(inner => {
        if (inner.type === "paragraph") {
          return [new Paragraph({
            indent: { left: 360 },
            border: { left: { style: BorderStyle.SINGLE, size: 12, space: 8, color: "D8D3CD" } },
            children: toTextRuns(inner.runs),
          })];
        }
        return blockToChildren(inner, images);
      });
    case "codeblock":
      return [new Paragraph({
        shading: { fill: "F4F5F6" },
        children: toTextRuns([{ text: b.text, code: true }]),
      })];
    // 通常は render() 前に画像化されるが、変換失敗時の保険としてコード表示。
    case "mermaid":
      return [new Paragraph({
        shading: { fill: "F4F5F6" },
        children: toTextRuns([{ text: b.code, code: true }]),
      })];
    case "table": return [buildTable(b)];
    case "image": { const p = imageParagraph(b.url, images); return p ? [p] : []; }
    default: return [];
  }
}

export async function renderDocx(doc: ArticleDoc, images: Map<string, LoadedImage>): Promise<Blob> {
  const children: (Paragraph | Table)[] = [];

  children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: doc.title || "無題", bold: true })] }));
  for (const m of doc.meta) {
    children.push(new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: `${m.label}：`, bold: true, color: "9E9690" }), new TextRun({ text: m.value })],
    }));
  }
  children.push(new Paragraph({ text: "", border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 6, color: "EEEBE7" } } }));

  for (const b of doc.blocks) children.push(...blockToChildren(b, images));

  if (doc.actionItems && doc.actionItems.length > 0) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240 }, children: [new TextRun({ text: "アクションアイテム", bold: true })] }));
    for (const a of doc.actionItems) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${a.done ? "☑" : "☐"} ` }),
          new TextRun({ text: `[${a.category}] `, color: "9E9690" }),
          new TextRun({ text: a.title }),
        ],
      }));
    }
  }

  const document = new Document({ sections: [{ children }] });
  return Packer.toBlob(document);
}
