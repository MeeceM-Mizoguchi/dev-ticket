// IR(MdBlock[]) → Markdown テキスト。parse.ts（Markdown → IR）の逆写像。
//
// 使いどころは「リッチな本文を Markdown として保存したい」とき。
// 例: Wiki の本文は TipTap の HTML なので、ナレッジノートに取り込むには
//     htmlToBlocks(HTML → IR) と繋いで Markdown にする（htmlDocToMarkdown）。
//
// 出力は parse.ts が読み戻せる形に揃えてある。ナレッジノートは
// 保存した Markdown を「見出しで分割 → 検索 → 再表示」に使うため、
// 往復して崩れると目次と本文がずれる。
import type { MdBlock, MdInline } from "./types";

/** 表の桁数。これ未満だと parse.ts が表と認識しないので行として書き出す */
const MIN_TABLE_COLS = 2;

/**
 * 記号を文字として書き戻す。
 *
 * 過剰にエスケープすると本文が読みにくくなり、そのまま検索・埋め込みに使う
 * ナレッジノートでは精度も落ちる。「そのままだと別の意味になる記号」だけに絞る。
 * `_` を対象外にしているのは snake_case を壊さないため
 * （parse.ts 側も単語の途中の `_` は強調と見なさない）。
 */
function escapeText(s: string): string {
  return s.replace(/([\\`*[\]])/g, "\\$1").replace(/~~/g, "\\~\\~");
}

/** 行頭がブロック記法に見えてしまう行を打ち消す（段落が見出しやリストに化けるのを防ぐ） */
function escapeLineStarts(text: string): string {
  return text
    .split("\n")
    .map(line =>
      line.replace(
        /^([ \t]*)(#{1,6}[ \t]|>|\||-{3,}[ \t]*$|={2,}[ \t]*$|(?:[-+]|\d{1,9}[.)])[ \t])/,
        (_m, indent: string, mark: string) => `${indent}\\${mark}`,
      ),
    )
    .join("\n");
}

/** インラインコード。中身のバックティックより1本長いフェンスで囲む */
function codeSpan(raw: string): string {
  const text = raw.replace(/\r?\n/g, " ");
  if (!text) return "";
  const longest = (text.match(/`+/g) ?? []).reduce((a, b) => Math.max(a, b.length), 0);
  const fence = "`".repeat(longest + 1);
  // 先頭・末尾がバックティックだと閉じ記号と続いてしまうので空白を挟む（parse.ts が剥がす）
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

const sameMarks = (a: MdInline, b: MdInline) =>
  a.t === "text" && b.t === "text"
  && !!a.bold === !!b.bold && !!a.italic === !!b.italic
  && !!a.strike === !!b.strike && !!a.code === !!b.code;

/** 隣り合う同装飾のテキストを繋ぐ。`**a****b**` のような読み戻せない出力を避ける */
function mergeAdjacent(nodes: MdInline[]): MdInline[] {
  const out: MdInline[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (prev && sameMarks(prev, n) && prev.t === "text" && n.t === "text") {
      out[out.length - 1] = { ...prev, v: prev.v + n.v };
      continue;
    }
    out.push(n);
  }
  return out;
}

function inlineToMd(nodes: MdInline[]): string {
  let out = "";
  for (const n of mergeAdjacent(nodes)) {
    if (n.t === "image") { out += `![${escapeText(n.alt)}](${n.src})`; continue; }
    if (n.t === "link") {
      const inner = inlineToMd(n.children);
      out += n.href ? `[${inner}](${n.href})` : inner;
      continue;
    }
    if (n.code) { out += codeSpan(n.v); continue; }

    const escaped = escapeText(n.v);
    if (!escaped) continue;
    // 装飾記号の内側に空白を入れると強調として読み戻せない（`** x **`）ので外へ出す
    const lead = /^\s*/.exec(escaped)![0];
    const tail = escaped.length > lead.length ? /\s*$/.exec(escaped)![0] : "";
    let core = escaped.slice(lead.length, escaped.length - tail.length);
    if (core) {
      if (n.strike) core = `~~${core}~~`;
      if (n.italic) core = `*${core}*`;
      if (n.bold) core = `**${core}**`;
    }
    out += lead + core + tail;
  }
  return out;
}

/** 表のセル。`|` と改行はセルの区切りと衝突するので潰す */
function cellToMd(cell: MdInline[]): string {
  return inlineToMd(cell).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function tableToMd(header: MdInline[][], rows: MdInline[][][]): string {
  const cols = Math.max(header.length, ...rows.map(r => r.length), 0);
  const line = (cells: MdInline[][]) => {
    const filled = Array.from({ length: cols }, (_, i) => (cells[i] ? cellToMd(cells[i]) : ""));
    return `| ${filled.join(" | ")} |`;
  };
  // 1列の表は parse.ts が表と認識しない。表の形で書いても読み戻せないので行にする
  if (cols < MIN_TABLE_COLS) {
    return [header, ...rows].map(r => escapeLineStarts(r.map(cellToMd).join(" "))).filter(Boolean).join("\n");
  }
  return [line(header), `| ${Array(cols).fill("---").join(" | ")} |`, ...rows.map(line)].join("\n");
}

function fenceFor(code: string): string {
  const longest = (code.match(/^ {0,3}`+/gm) ?? []).reduce((a, b) => Math.max(a, b.trim().length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

function listToMd(b: Extract<MdBlock, { t: "list" }>): string {
  const lines: string[] = [];
  b.items.forEach((item, idx) => {
    const marker = b.ordered ? `${b.start + idx}. ` : "- ";
    const box = item.checked === undefined ? "" : item.checked ? "[x] " : "[ ] ";
    const body = escapeLineStarts(inlineToMd(item.children));
    const [first = "", ...rest] = body.split("\n");
    lines.push(`${marker}${box}${first}`.trimEnd());
    // 継続行は記号の幅だけ下げる（下げないと項目が切れて新しい段落になる）
    const cont = " ".repeat(marker.length);
    rest.forEach(l => lines.push(l ? cont + l : ""));
    // 入れ子は2桁下げる。parse.ts は「親より2以上深い項目」を入れ子と見なす
    for (const sub of item.sub) {
      const md = blockToMd(sub);
      if (!md) continue;
      md.split("\n").forEach(l => lines.push(l ? `  ${l}` : ""));
    }
  });
  return lines.join("\n");
}

function blockToMd(b: MdBlock): string {
  switch (b.t) {
    case "heading": {
      const text = inlineToMd(b.children).replace(/\r?\n/g, " ").trim();
      return text ? `${"#".repeat(b.level)} ${text}` : "";
    }
    case "para":
      return escapeLineStarts(inlineToMd(b.children)).trimEnd();
    case "hr":
      return "---";
    case "code": {
      const fence = fenceFor(b.code);
      return `${fence}${b.lang}\n${b.code}\n${fence}`;
    }
    case "mermaid": {
      const fence = fenceFor(b.code);
      return `${fence}mermaid\n${b.code}\n${fence}`;
    }
    case "quote": {
      const inner = blocksToMd(b.blocks);
      if (!inner) return "";
      return inner.split("\n").map(l => (l ? `> ${l}` : ">")).join("\n");
    }
    case "list":
      return listToMd(b);
    case "table":
      return tableToMd(b.header, b.rows);
  }
}

function blocksToMd(blocks: MdBlock[]): string {
  return blocks.map(blockToMd).filter(s => s.trim()).join("\n\n");
}

/** IR を Markdown テキストにする。中身が無ければ空文字。 */
export function mdBlocksToMarkdown(blocks: MdBlock[]): string {
  const body = blocksToMd(blocks).replace(/\n{3,}/g, "\n\n").trim();
  return body ? `${body}\n` : "";
}
