// IR(MdBlock[]) → HTML。TipTap（RichEditor）のスキーマに載る形だけを出力する。
//
// 出力先は ProseMirror の DOMParser なので、スキーマに無いタグは黙って落ちる。
// ここでは「落ちない形」に寄せる:
//   ・リスト項目の中身は <p> で包む（listItem の content は "paragraph block*"）
//   ・表のセルの中身も <p> で包む（tableCell の content は "block+"）
//   ・チェックボックスは TaskList 拡張が未導入のため ☐/☑ の文字にする
//   ・mermaid は MermaidNode が解釈する <div data-type="mermaid" data-code="..."> 形式
import type { MdBlock, MdInline } from "./types";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 本文テキスト。段落内の改行は <br>（＝hardBreak）にして見た目を保つ。 */
const escText = (s: string) => esc(s).replace(/\n/g, "<br>");

// javascript: 等の危険なスキームは落とす（リンクは貼り付け元由来の文字列のため）
function safeHref(href: string): string | null {
  const s = href.trim();
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
  return s; // スキーム無し（相対パス等）はそのまま
}

function inlineToHtml(nodes: MdInline[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.t === "image") {
      const src = safeHref(n.src);
      out += src ? `<img src="${esc(src)}" alt="${esc(n.alt)}">` : escText(n.alt);
      continue;
    }
    if (n.t === "link") {
      const href = safeHref(n.href);
      const inner = inlineToHtml(n.children);
      out += href ? `<a href="${esc(href)}">${inner}</a>` : inner;
      continue;
    }
    if (n.code) { out += `<code>${escText(n.v)}</code>`; continue; }
    let h = escText(n.v);
    if (n.strike) h = `<s>${h}</s>`;
    if (n.italic) h = `<em>${h}</em>`;
    if (n.bold) h = `<strong>${h}</strong>`;
    out += h;
  }
  return out;
}

function blockToHtml(b: MdBlock): string {
  switch (b.t) {
    case "heading":
      return `<h${b.level}>${inlineToHtml(b.children)}</h${b.level}>`;
    case "para":
      return `<p>${inlineToHtml(b.children)}</p>`;
    case "hr":
      return "<hr>";
    case "code":
      return `<pre><code${b.lang ? ` class="language-${esc(b.lang)}"` : ""}>${esc(b.code)}</code></pre>`;
    case "mermaid":
      return `<div data-type="mermaid" data-code="${esc(b.code)}"></div>`;
    case "quote":
      return `<blockquote>${b.blocks.map(blockToHtml).join("") || "<p></p>"}</blockquote>`;
    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      const attr = b.ordered && b.start !== 1 ? ` start="${b.start}"` : "";
      const items = b.items.map((it) => {
        const mark = it.checked === undefined ? "" : it.checked ? "☑ " : "☐ ";
        return `<li><p>${mark}${inlineToHtml(it.children)}</p>${it.sub.map(blockToHtml).join("")}</li>`;
      }).join("");
      return `<${tag}${attr}>${items}</${tag}>`;
    }
    case "table": {
      const cell = (tag: string, c: MdInline[]) => `<${tag}><p>${inlineToHtml(c)}</p></${tag}>`;
      const head = `<tr>${b.header.map((c) => cell("th", c)).join("")}</tr>`;
      const body = b.rows.map((r) => `<tr>${r.map((c) => cell("td", c)).join("")}</tr>`).join("");
      return `<table><tbody>${head}${body}</tbody></table>`;
    }
  }
}

export function mdBlocksToHtml(blocks: MdBlock[]): string {
  return blocks.map(blockToHtml).join("");
}
