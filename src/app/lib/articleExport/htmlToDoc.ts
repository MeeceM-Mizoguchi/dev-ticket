// 本文HTML(TipTap) を共通ドキュメントモデル(IR)へ変換する。
// helpers.ts の htmlToMarkdown と同じく DOMParser で walk するが、出力は Block[]。
// メンション(span.*-mention)は可視テキスト(#123 / @名前 / $ラベル)がそのまま textContent に入るため、
// 特別扱いせず textContent をそのまま Run として取り込む。
import type { Block, ListBlock, ListItem, Run, TableBlock, TableCell } from "./types";

interface Marks { bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean }

function tagOf(node: Node): string {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element).tagName.toLowerCase() : "";
}

// インライン要素群 → Run[]（マークを引き継ぎながら再帰）
function runsOf(nodes: Iterable<ChildNode>, marks: Marks): Run[] {
  const out: Run[] = [];
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) out.push({ text, ...marks });
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") { out.push({ text: "\n" }); continue; }
    if (tag === "img") continue; // 画像はブロックとして別処理
    if (tag === "strong" || tag === "b") { out.push(...runsOf(el.childNodes, { ...marks, bold: true })); continue; }
    if (tag === "em" || tag === "i") { out.push(...runsOf(el.childNodes, { ...marks, italic: true })); continue; }
    if (tag === "s" || tag === "del" || tag === "strike") { out.push(...runsOf(el.childNodes, { ...marks, strike: true })); continue; }
    if (tag === "code") { out.push(...runsOf(el.childNodes, { ...marks, code: true })); continue; }
    if (tag === "span") {
      // メンション等：可視テキストをそのまま取り込む
      const text = el.textContent ?? "";
      if (text) out.push({ text, ...marks });
      continue;
    }
    // a / その他インライン：中身を辿る
    out.push(...runsOf(el.childNodes, marks));
  }
  return out;
}

// セル内容 → Run[]（<p> をまたぐ場合は改行を挟んで平坦化）
function cellRunsOf(cell: Element): Run[] {
  const out: Run[] = [];
  const blockTags = new Set(["p", "div", "h1", "h2", "h3", "ul", "ol", "blockquote", "pre"]);
  let first = true;
  for (const child of cell.childNodes) {
    if (tagOf(child) && blockTags.has(tagOf(child))) {
      if (!first) out.push({ text: "\n" });
      out.push(...runsOf((child as Element).childNodes, {}));
      first = false;
    } else {
      out.push(...runsOf([child as ChildNode], {}));
      first = false;
    }
  }
  return out;
}

function parseList(el: Element, ordered: boolean): ListBlock {
  const items: ListItem[] = [];
  el.querySelectorAll(":scope > li").forEach(li => {
    const runs: Run[] = [];
    let sub: ListBlock | undefined;
    for (const child of li.childNodes) {
      const tag = tagOf(child);
      if (tag === "ul") sub = parseList(child as Element, false);
      else if (tag === "ol") sub = parseList(child as Element, true);
      else if (tag === "p") runs.push(...runsOf((child as Element).childNodes, {}));
      else runs.push(...runsOf([child as ChildNode], {}));
    }
    items.push({ runs, sub });
  });
  return { type: "list", ordered, items };
}

function parseTable(el: Element): TableBlock {
  const rows: TableCell[][] = [];
  const trs = Array.from(el.querySelectorAll("tr"));
  trs.forEach(tr => {
    const cells: TableCell[] = [];
    tr.querySelectorAll("th,td").forEach(td => {
      cells.push({ runs: cellRunsOf(td), header: td.tagName.toLowerCase() === "th" });
    });
    rows.push(cells);
  });
  // 先頭行セルの colwidth 属性から列幅を拾う（prosemirror-tables 形式："150" など）
  let colWidths: number[] | undefined;
  const firstCells = trs[0] ? Array.from(trs[0].querySelectorAll("th,td")) : [];
  if (firstCells.length) {
    const widths = firstCells.map(c => {
      const cw = c.getAttribute("colwidth");
      const n = cw ? parseInt(cw.split(",")[0], 10) : NaN;
      return Number.isFinite(n) ? n : 0;
    });
    if (widths.some(w => w > 0)) colWidths = widths;
  }
  return { type: "table", rows, colWidths };
}

function walkBlocks(parent: Node): Block[] {
  const blocks: Block[] = [];
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").trim();
      if (text) blocks.push({ type: "paragraph", runs: [{ text }] });
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case "h1": blocks.push({ type: "heading", level: 1, runs: runsOf(el.childNodes, {}) }); break;
      case "h2": blocks.push({ type: "heading", level: 2, runs: runsOf(el.childNodes, {}) }); break;
      case "h3": blocks.push({ type: "heading", level: 3, runs: runsOf(el.childNodes, {}) }); break;
      case "ul": blocks.push(parseList(el, false)); break;
      case "ol": blocks.push(parseList(el, true)); break;
      case "blockquote": blocks.push({ type: "blockquote", blocks: walkBlocks(el) }); break;
      case "pre": {
        const code = el.querySelector("code")?.textContent ?? el.textContent ?? "";
        blocks.push({ type: "codeblock", text: code.replace(/\n$/, "") });
        break;
      }
      case "table": blocks.push(parseTable(el)); break;
      case "img": blocks.push({ type: "image", url: el.getAttribute("src") ?? "", alt: el.getAttribute("alt") ?? undefined }); break;
      case "hr": break;
      case "p": {
        // 段落中に画像だけが入るケース：画像はブロックに、テキストがあれば段落も出す
        const imgs = Array.from(el.querySelectorAll("img"));
        const runs = runsOf(el.childNodes, {});
        if (runs.some(r => r.text.trim())) blocks.push({ type: "paragraph", runs });
        imgs.forEach(img => blocks.push({ type: "image", url: img.getAttribute("src") ?? "", alt: img.getAttribute("alt") ?? undefined }));
        break;
      }
      case "div": blocks.push(...walkBlocks(el)); break;
      default: {
        const runs = runsOf(el.childNodes, {});
        if (runs.some(r => r.text.trim())) blocks.push({ type: "paragraph", runs });
      }
    }
  }
  return blocks;
}

export function htmlToBlocks(html: string | undefined | null): Block[] {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  return walkBlocks(doc.body);
}
