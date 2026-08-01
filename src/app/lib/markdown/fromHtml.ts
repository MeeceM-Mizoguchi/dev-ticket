// HTML → IR(MdBlock[])。
//
// ブラウザ上で「選択して Cmd+C」したときのクリップボードは text/plain(素の文字) と text/html の
// 2本立てで、書式は **text/html 側にしか無い**。リッチエディタ(TipTap)は ProseMirror が
// text/html を解釈するので何もしなくてよいが、ホワイトボード(Excalidraw)は text/html を
// 一切見ないため、こちらで IR に変換して同じレンダラー(whiteboardPasteMarkdown)へ流す。
//
// 対応範囲は Markdown パーサ(parse.ts)と同じ＝ TipTap のスキーマに載る範囲。
import type { MdBlock, MdInline, MdListItem } from "./types";

type Marks = { bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean };

const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "main", "header", "footer", "aside", "figure", "figcaption",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "pre", "blockquote", "hr", "details",
]);

/** 表示されない要素（貼り付け元のUI部品やスタイル）は落とす */
const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "head", "button", "svg"]);

const isEl = (n: Node): n is Element => n.nodeType === 1;
const isText = (n: Node): n is Text => n.nodeType === 3;
const tagOf = (el: Element) => el.tagName.toLowerCase();

// ── インライン ──
function inlineOf(node: Node, m: Marks): MdInline[] {
  if (isText(node)) {
    // HTML のテキストノードは改行・インデントを含むので空白を1つに畳む
    const v = (node.textContent ?? "").replace(/\s+/g, " ");
    return v ? [{ t: "text", v, ...m }] : [];
  }
  if (!isEl(node)) return [];
  const tag = tagOf(node);
  if (SKIP_TAGS.has(tag)) return [];
  if (tag === "br") return [{ t: "text", v: "\n", ...m }];
  if (tag === "img") {
    const src = node.getAttribute("src") ?? "";
    return src ? [{ t: "image", src, alt: node.getAttribute("alt") ?? "" }] : [];
  }
  if (tag === "code" || tag === "kbd" || tag === "samp") {
    const v = node.textContent ?? "";
    return v ? [{ t: "text", v, code: true }] : [];
  }
  if (tag === "a") {
    const href = node.getAttribute("href") ?? "";
    const children = childInline(node, m);
    if (!children.length) return [];
    return href ? [{ t: "link", href, children }] : children;
  }
  const next: Marks =
    tag === "strong" || tag === "b" ? { ...m, bold: true }
      : tag === "em" || tag === "i" ? { ...m, italic: true }
        : tag === "s" || tag === "del" || tag === "strike" ? { ...m, strike: true }
          : m;
  return childInline(node, next);
}

function childInline(el: Node, m: Marks): MdInline[] {
  const out: MdInline[] = [];
  el.childNodes.forEach((c) => out.push(...inlineOf(c, m)));
  return out;
}

/** 前後の空白を落とし、空になったら空配列 */
function trimInline(list: MdInline[]): MdInline[] {
  const out = list.slice();
  while (out.length && out[0].t === "text" && !out[0].v.trim()) out.shift();
  while (out.length && out[out.length - 1].t === "text" && !out[out.length - 1].v.trim()) out.pop();
  if (out.length) {
    const first = out[0], last = out[out.length - 1];
    if (first.t === "text") first.v = first.v.replace(/^\s+/, "");
    if (last.t === "text") last.v = last.v.replace(/\s+$/, "");
  }
  return out.filter((n) => !(n.t === "text" && n.v === ""));
}

// ── 表 ──
function tableBlock(el: Element): MdBlock | null {
  const rows = Array.from(el.querySelectorAll("tr"));
  if (!rows.length) return null;
  const cellsOf = (tr: Element) =>
    Array.from(tr.querySelectorAll(":scope > th, :scope > td")).map((c) => trimInline(childInline(c, {})));
  const all = rows.map(cellsOf).filter((r) => r.length > 0);
  if (!all.length) return null;
  return { t: "table", header: all[0], rows: all.slice(1) };
}

// ── リスト ──
function listBlock(el: Element): MdBlock {
  const ordered = tagOf(el) === "ol";
  const start = parseInt(el.getAttribute("start") ?? "1", 10) || 1;
  const items: MdListItem[] = [];
  el.querySelectorAll(":scope > li").forEach((li) => {
    const children: MdInline[] = [];
    const sub: MdBlock[] = [];
    li.childNodes.forEach((c) => {
      if (isEl(c) && (tagOf(c) === "ul" || tagOf(c) === "ol")) { sub.push(listBlock(c)); return; }
      if (isEl(c) && BLOCK_TAGS.has(tagOf(c)) && tagOf(c) !== "p" && tagOf(c) !== "div") {
        sub.push(...blocksOf(c));
        return;
      }
      children.push(...inlineOf(c, {}));
    });
    // チェックリスト（TipTap の TaskList = data-checked / GitHub 形式 = input[type=checkbox]）
    const dataChecked = li.getAttribute("data-checked");
    const cb = li.querySelector(":scope > input[type=checkbox], :scope > label > input[type=checkbox]");
    const checked = dataChecked != null ? dataChecked === "true"
      : cb ? (cb as HTMLInputElement).checked || cb.hasAttribute("checked")
        : undefined;
    items.push({ children: trimInline(children), checked, sub });
  });
  return { t: "list", ordered, start, items };
}

// ── ブロック ──
function blockOf(el: Element): MdBlock[] {
  const tag = tagOf(el);
  if (SKIP_TAGS.has(tag)) return [];

  // 本文中の Mermaid ノード（自アプリのエディタからのコピー）
  if (tag === "div" && el.getAttribute("data-type") === "mermaid") {
    return [{ t: "mermaid", code: el.getAttribute("data-code") ?? "" }];
  }
  if (/^h[1-6]$/.test(tag)) {
    const children = trimInline(childInline(el, {}));
    return children.length ? [{ t: "heading", level: Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6, children }] : [];
  }
  if (tag === "ul" || tag === "ol") return [listBlock(el)];
  if (tag === "table") { const b = tableBlock(el); return b ? [b] : []; }
  if (tag === "pre") {
    const codeEl = el.querySelector("code");
    const lang = (codeEl?.className ?? "").match(/language-([\w+-]+)/)?.[1] ?? "";
    const code = (codeEl?.textContent ?? el.textContent ?? "").replace(/\n+$/, "");
    if (!code.trim()) return [];
    return lang === "mermaid" ? [{ t: "mermaid", code }] : [{ t: "code", lang, code }];
  }
  if (tag === "blockquote") return [{ t: "quote", blocks: blocksOf(el) }];
  if (tag === "hr") return [{ t: "hr" }];
  if (tag === "p") {
    const children = trimInline(childInline(el, {}));
    return children.length ? [{ t: "para", children }] : [];
  }
  // div / section など「入れ物」は中身を展開する
  return blocksOf(el);
}

/** 要素の子を走査してブロック列にする（インラインが続く区間は段落にまとめる） */
function blocksOf(el: Element): MdBlock[] {
  const out: MdBlock[] = [];
  let pending: MdInline[] = [];
  const flush = () => {
    const c = trimInline(pending);
    pending = [];
    if (c.length) out.push({ t: "para", children: c });
  };
  el.childNodes.forEach((node) => {
    if (isEl(node) && BLOCK_TAGS.has(tagOf(node))) { flush(); out.push(...blockOf(node)); return; }
    pending.push(...inlineOf(node, {}));
  });
  flush();
  return out;
}

/** クリップボードの text/html を IR に変換する */
export function htmlToBlocks(html: string): MdBlock[] {
  if (!html || !html.trim()) return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  return blocksOf(doc.body);
}

/**
 * 「書式として意味のある中身か」。段落だけ（＝ただの文章）なら false を返し、
 * 貼り付け先の既定動作に任せる。
 */
export function hasRichBlocks(blocks: MdBlock[]): boolean {
  return blocks.some((b) => b.t !== "para");
}
