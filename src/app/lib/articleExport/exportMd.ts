// 記事(wiki/議事録) → Markdown(.md)。
//
// PDF/Word/Excel の3レンダラーと違い、Markdown はテキストなので画像・Mermaid を
// 埋め込まない。画像は URL のまま `![alt](URL)`、Mermaid は ```mermaid フェンスで
// 書き出す（index.ts の render() が md のときだけ画像取得とラスタライズを飛ばす）。
//
// シリアライズ自体は既存の Markdown ライブラリ(lib/markdown)を再利用する。
// エスケープ・表・入れ子リスト・コードフェンスの取り回しは向こうが持っているので、
// ここは ArticleDoc の IR を MdBlock の IR に載せ替えるだけにしてある。
import type { MdBlock, MdInline, MdListItem } from "@/app/lib/markdown";
import { mdBlocksToMarkdown } from "@/app/lib/markdown";
import type { ArticleDoc, Block, ListBlock, Run, TableCell } from "./types";

// Run[] → MdInline[]。同じリンク先が続く分はひとつの [..](..) にまとめる。
function runsToInline(runs: Run[]): MdInline[] {
  const out: MdInline[] = [];
  let i = 0;
  while (i < runs.length) {
    const href = runs[i].href;
    if (!href) {
      const { text, bold, italic, strike, code } = runs[i];
      if (text) out.push({ t: "text", v: text, bold, italic, strike, code });
      i++;
      continue;
    }
    const group: Run[] = [];
    while (i < runs.length && runs[i].href === href) group.push(runs[i++]);
    const children = runsToInline(group.map(r => ({ ...r, href: undefined })));
    if (children.length) out.push({ t: "link", href, children });
  }
  return out;
}

function listToMd(b: ListBlock): MdBlock {
  const items: MdListItem[] = b.items.map(item => ({
    children: runsToInline(item.runs),
    sub: item.sub ? [listToMd(item.sub)] : [],
  }));
  return { t: "list", ordered: b.ordered, start: 1, items };
}

// TipTap の表は先頭行が見出し(th)。見出し行が無い表でも Markdown の表には
// 見出し行が要るので、その場合は先頭行を見出しとして扱う。
function tableToMd(rows: TableCell[][]): MdBlock {
  const cells = (row: TableCell[] | undefined) => (row ?? []).map(c => runsToInline(c.runs));
  const [first, ...rest] = rows;
  return { t: "table", header: cells(first), rows: rest.map(cells) };
}

function blockToMd(b: Block): MdBlock | null {
  switch (b.type) {
    case "heading": return { t: "heading", level: b.level, children: runsToInline(b.runs) };
    case "paragraph": return { t: "para", children: runsToInline(b.runs) };
    case "list": return listToMd(b);
    case "blockquote": return { t: "quote", blocks: blocksToMd(b.blocks) };
    case "codeblock": return { t: "code", lang: "", code: b.text };
    case "table": return b.rows.length ? tableToMd(b.rows) : null;
    case "image": return b.url ? { t: "para", children: [{ t: "image", src: b.url, alt: b.alt ?? "" }] } : null;
    case "divider": return { t: "hr" };
    case "mermaid": return { t: "mermaid", code: b.code };
  }
}

function blocksToMd(blocks: Block[]): MdBlock[] {
  return blocks.map(blockToMd).filter((b): b is MdBlock => b !== null);
}

export function renderMd(doc: ArticleDoc): Blob {
  const blocks: MdBlock[] = [];

  blocks.push({ t: "heading", level: 1, children: [{ t: "text", v: doc.title || "無題" }] });

  // メタ情報(会議日/参加者/更新者 など)は本文の前に箇条書きで置く。
  if (doc.meta.length) {
    blocks.push({
      t: "list", ordered: false, start: 1,
      items: doc.meta.map(m => ({
        children: [
          { t: "text", v: m.label, bold: true },
          { t: "text", v: `: ${m.value}` },
        ] as MdInline[],
        sub: [],
      })),
    });
    blocks.push({ t: "hr" });
  }

  blocks.push(...blocksToMd(doc.blocks));

  // 議事録のアクションアイテムはチェックリストとして末尾に付ける。
  if (doc.actionItems?.length) {
    blocks.push({ t: "heading", level: 2, children: [{ t: "text", v: "アクションアイテム" }] });
    blocks.push({
      t: "list", ordered: false, start: 1,
      items: doc.actionItems.map(a => ({
        checked: a.done,
        children: [
          { t: "text", v: a.category, bold: true },
          { t: "text", v: ` ${a.title}` },
        ] as MdInline[],
        sub: [],
      })),
    });
  }

  return new Blob([mdBlocksToMarkdown(blocks)], { type: "text/markdown;charset=utf-8" });
}
