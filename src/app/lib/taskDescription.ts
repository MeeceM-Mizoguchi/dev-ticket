// ENHA2-032 タスクの詳細メモ（RichEditor の HTML）を、表の1セルで扱うための変換。
//
// 詳細メモは書式つき（HTML）で持っているが、表の1行には素のテキストしか置けない。
// ここで HTML ↔ 素のテキストを往復させる。
//
// 往復で壊れるもの（箇条書き・表・画像・見出し・複数段落）は isRichDescription で
// 見分け、上書きする前に確認を挟む。

/** 表に出すための素のテキスト。改行は空白に潰して1行にする */
export function descriptionToText(html: string): string {
  if (!html) return "";
  // 画像の読み込みや onerror を走らせたくないので、DOM に挿さない DOMParser で読む
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 表で打った素のテキストを詳細メモの HTML に戻す（RichEditor と同じ1行=1段落） */
export function textToDescription(text: string): string {
  const v = text.trim();
  if (!v) return "";
  return v.split("\n").map(line => `<p>${escapeHtml(line)}</p>`).join("");
}

/** 段落・改行の数（素のテキストに落とすと1行に潰れてしまう構造かの判定に使う） */
const BLOCK_TAG = /<(ul|ol|li|table|img|h[1-6]|pre|blockquote|hr|figure)\b/i;

/**
 * 1行の入力欄では編集できない（＝往復すると情報が落ちる）詳細メモか。
 * true のセルは、書式が消えることを確認してから編集させる。
 */
export function isRichDescription(html: string): boolean {
  if (!html) return false;
  if (BLOCK_TAG.test(html)) return true;
  if (/<br\b/i.test(html)) return true;
  // 段落が2つ以上 = 改行を含む文章
  const paragraphs = html.match(/<p\b/gi);
  return !!paragraphs && paragraphs.length > 1;
}
