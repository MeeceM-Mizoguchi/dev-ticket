// 貼り付けテキスト（Markdown）をリッチな中身へ変換する共通入口。
// 詳細は parse.ts / toHtml.ts を参照。ホワイトボード側は IR を直接使う（whiteboardPasteMarkdown.ts）。
export type { MdBlock, MdInline, MdListItem } from "./types";
export { looksLikeMarkdown, parseMarkdown, parseInline } from "./parse";
export { mdBlocksToHtml } from "./toHtml";
export { mdBlocksToMarkdown } from "./toMarkdown";
export { htmlToBlocks, hasRichBlocks } from "./fromHtml";

import { looksLikeMarkdown, parseMarkdown } from "./parse";
import { mdBlocksToHtml } from "./toHtml";
import { mdBlocksToMarkdown } from "./toMarkdown";
import { htmlToBlocks } from "./fromHtml";

/** 極端に長い貼り付けは変換しない（解析コストと事故を避ける） */
export const MD_MAX_LENGTH = 200_000;

/**
 * Markdown とみなせるテキストなら HTML を返す。対象外なら null（＝呼び出し側は既定動作に任せる）。
 */
export function markdownToHtml(text: string): string | null {
  if (!text || text.length > MD_MAX_LENGTH) return null;
  if (!looksLikeMarkdown(text)) return null;
  const blocks = parseMarkdown(text);
  if (!blocks.length) return null;
  return mdBlocksToHtml(blocks);
}

/**
 * .md ファイルの取り込み用。拡張子で Markdown だと分かっているので
 * looksLikeMarkdown の推測は通さず必ず変換する。
 * （記号が一つも無い素の文章でも、段落として取り込めるようにするため）
 */
export function markdownFileToHtml(text: string): string | null {
  if (!text || text.length > MD_MAX_LENGTH) return null;
  const blocks = parseMarkdown(text);
  if (!blocks.length) return null;
  return mdBlocksToHtml(blocks);
}

/**
 * 記事本文の HTML（TipTap が保存した Wiki / 議事録の content）を Markdown にする。
 *
 * helpers.ts の htmlToMarkdown とは別物。あちらは要約・プレビュー用で、
 * 画像・リンク・h4以降・mermaid が落ちる。こちらは IR を経由するため
 * 「Markdown として保存し、あとで読み戻す」用途に使える。
 */
export function htmlDocToMarkdown(html: string | null | undefined): string {
  if (!html || !html.trim()) return "";
  return mdBlocksToMarkdown(htmlToBlocks(html));
}
