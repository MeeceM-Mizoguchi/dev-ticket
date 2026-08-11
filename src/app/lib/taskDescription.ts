// ENHA2-032 タスクの詳細メモ（RichEditor の HTML）を、表の1セルで扱うための変換。
//
// 詳細メモは書式つき（HTML）で持っているが、表の1行には素のテキストしか置けない。
// ここで HTML ↔ 素のテキストを往復させる。
//
// 追加行も編集も同じ1行の入力欄なので、確認は挟まない。書式つきのメモを打ち直せば
// 書式は1行のテキストに潰れる（打ち直さずに欄から離れただけなら保存しない）。

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

