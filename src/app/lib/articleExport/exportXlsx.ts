// ArticleDoc(IR) → Excel(.xlsx, Blob)。「文書まるごと流し込み型」。
// メタ＋本文を行に展開し、本文中のテーブルはその位置に実セル範囲(枠線付き)として再現する（Excel上で再編集可）。
// 画像はセルにアンカーして貼り付け。議事録は末尾にアクションアイテム表。
import ExcelJS from "exceljs";
import type { ArticleDoc, Block, ListBlock, Run } from "./types";
import type { LoadedImage } from "./imageLoader";

const MAX_IMG_PX = 600;
const GRAY = "FFF4F5F6";
// 罫線は薄すぎるとGoogle Sheetsの既定グリッド線と同化して「罫線なし」に見えるため、明確に見える濃さにする。
const thin = { style: "thin" as const, color: { argb: "FF808080" } };
const allBorders = { top: thin, left: thin, bottom: thin, right: thin };

function toRich(runs: Run[]): ExcelJS.CellValue {
  const rt = runs.filter(r => r.text !== "").map(r => ({
    text: r.text,
    font: {
      bold: r.bold || undefined,
      italic: r.italic || undefined,
      strike: r.strike || undefined,
      name: r.code ? "Consolas" : undefined,
    },
  }));
  if (!rt.length) return "";
  return { richText: rt };
}

function plain(runs: Run[]): string {
  return runs.map(r => r.text).join("");
}

function writeList(ws: ExcelJS.Worksheet, cursor: number, block: ListBlock, depth = 0): number {
  let row = cursor;
  let n = 0;
  for (const it of block.items) {
    n++;
    const marker = block.ordered ? `${n}. ` : "• ";
    const cell = ws.getCell(row, 1);
    cell.value = marker + plain(it.runs);
    cell.alignment = { wrapText: false, vertical: "top", indent: depth + 1 };
    row++;
    if (it.sub) row = writeList(ws, row, it.sub, depth + 1);
  }
  return row;
}

function writeTable(ws: ExcelJS.Worksheet, cursor: number, block: Block & { type: "table" }): number {
  const cols = Math.max(...block.rows.map(r => r.length), 1);
  block.rows.forEach((row, ri) => {
    const xr = ws.getRow(cursor + ri);
    for (let ci = 0; ci < cols; ci++) {
      const c = xr.getCell(ci + 1);
      const cell = row[ci];
      c.value = cell ? toRich(cell.runs) : "";
      c.border = allBorders;
      c.alignment = { wrapText: true, vertical: "top" };
      if (cell?.header) {
        c.font = { bold: true };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY } };
      }
    }
  });
  return cursor + block.rows.length + 1; // 表の後は1行あける
}

function writeImage(ws: ExcelJS.Worksheet, wb: ExcelJS.Workbook, cursor: number, url: string, images: Map<string, LoadedImage>): number {
  const im = images.get(url);
  if (!im) return cursor;
  const w = Math.min(im.width || MAX_IMG_PX, MAX_IMG_PX);
  const h = im.width ? Math.round((w * im.height) / im.width) : im.height;
  // exceljs は png/jpeg/gif のみ。bmp は png として扱う（稀ケースのフォールバック）。
  const extension = im.ext === "bmp" ? "png" : im.ext;
  const id = wb.addImage({ base64: im.base64, extension });
  ws.addImage(id, { tl: { col: 0, row: cursor - 1 }, ext: { width: w, height: h }, editAs: "oneCell" });
  return cursor + Math.ceil(h / 18) + 1; // 画像高さぶん行を送る
}

function writeBlocks(ws: ExcelJS.Worksheet, wb: ExcelJS.Workbook, cursor: number, blocks: Block[], images: Map<string, LoadedImage>): number {
  let row = cursor;
  for (const b of blocks) {
    switch (b.type) {
      case "heading": {
        const c = ws.getCell(row, 1);
        c.value = plain(b.runs);
        c.font = { bold: true, size: b.level === 1 ? 15 : b.level === 2 ? 13 : 12 };
        c.alignment = { wrapText: false, vertical: "top" };
        row += 1;
        break;
      }
      case "paragraph": {
        const c = ws.getCell(row, 1);
        c.value = toRich(b.runs);
        c.alignment = { wrapText: false, vertical: "top" };
        row += 1;
        break;
      }
      case "list": row = writeList(ws, row, b); break;
      case "blockquote": {
        const inner = writeBlocks(ws, wb, row, b.blocks, images);
        for (let r = row; r < inner; r++) {
          const c = ws.getCell(r, 1);
          c.font = { ...(c.font ?? {}), italic: true, color: { argb: "FF6B6458" } };
          c.alignment = { ...(c.alignment ?? {}), indent: 1 };
        }
        row = inner;
        break;
      }
      case "codeblock": {
        const c = ws.getCell(row, 1);
        c.value = b.text;
        c.font = { name: "Consolas" };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY } };
        c.alignment = { wrapText: false, vertical: "top" };
        row += 1;
        break;
      }
      case "table": row = writeTable(ws, row, b); break;
      case "image": row = writeImage(ws, wb, row, b.url, images); break;
    }
  }
  return row;
}

export async function renderXlsx(doc: ArticleDoc, images: Map<string, LoadedImage>): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(doc.kind === "wiki" ? "Wiki" : "議事録");
  ws.getColumn(1).width = 52;
  for (let i = 2; i <= 12; i++) ws.getColumn(i).width = 18;

  let row = 1;
  // タイトル
  const titleCell = ws.getCell(row, 1);
  titleCell.value = doc.title || "無題";
  titleCell.font = { bold: true, size: 18 };
  row += 2;

  // メタ
  for (const m of doc.meta) {
    const c = ws.getCell(row, 1);
    c.value = { richText: [{ text: `${m.label}：`, font: { bold: true, color: { argb: "FF9E9690" } } }, { text: m.value }] };
    c.alignment = { wrapText: false, vertical: "top" };
    row += 1;
  }
  row += 1;

  // 本文
  row = writeBlocks(ws, wb, row, doc.blocks, images);

  // アクションアイテム
  if (doc.actionItems && doc.actionItems.length > 0) {
    row += 1;
    const head = ws.getCell(row, 1);
    head.value = "アクションアイテム";
    head.font = { bold: true, size: 13 };
    row += 1;
    const headers = ["完了", "分類", "内容"];
    const hr = ws.getRow(row);
    headers.forEach((h, i) => {
      const c = hr.getCell(i + 1);
      c.value = h;
      c.font = { bold: true };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY } };
      c.border = allBorders;
    });
    row += 1;
    for (const a of doc.actionItems) {
      const r = ws.getRow(row);
      const cells = [a.done ? "☑" : "☐", a.category, a.title];
      cells.forEach((v, i) => {
        const c = r.getCell(i + 1);
        c.value = v;
        c.border = allBorders;
        c.alignment = { wrapText: true, vertical: "top" };
      });
      row += 1;
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
