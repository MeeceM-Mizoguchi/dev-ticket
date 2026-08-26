// IME(日本語入力)の変換確定Enterを「確定操作」として拾ってしまうバグの作り込み防止。
//
// keydown は変換確定の Enter でも発火する。1行入力欄で `if (e.key === "Enter") save()`
// と書くと、変換を確定した瞬間に打ちかけの内容で保存される。
// 何度も同じバグを埋め込んでいるので、書けないように機械で止める。
//
// 正しい書き方（src/app/lib/submitKey.ts）:
//   1行入力     … onKeyDown={submitOnEnter(save, { onCancel: close })}
//   複数行入力   … onKeyDown={submitOnModEnter(save)}   // Enterは改行、⌘/Ctrl+Enterで確定
//   自前の分岐   … if (isImeComposing(e)) return;  を分岐より前に置く
//
// どうしても素で書く必要がある箇所は、その行か直前行に `ime-ok:<理由>` を書けば除外できる。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const ENTER = /\bkey\s*===\s*["']Enter["']/;
const GUARD = /isComposing|keyCode\s*===\s*229|isImeComposing|isPlainEnter|isSubmitShortcut|submitOnEnter|submitOnModEnter|ime-ok:/;

// ガードは分岐の直前とは限らず、関数の入口にまとめて置かれることが多い
// (例: beforeKeyDown の先頭で isImeComposing なら return)。
// そのため「その行を含む関数の先頭からその行まで」を見る。
// インデントを頼りに、より浅い位置にある直近の関数ヘッダまで遡る。
const FN_HEAD = /(=>|\bfunction\b)[^=]*\{\s*$/;
function scopeOf(lines, i) {
  const indentOf = l => l.match(/^\s*/)[0].length;
  let base = indentOf(lines[i]);
  for (let j = i - 1; j >= 0 && j >= i - 200; j--) {
    const l = lines[j];
    if (!l.trim()) continue;
    const ind = indentOf(l);
    if (ind >= base) continue;
    base = ind;
    if (FN_HEAD.test(l)) return lines.slice(j, i + 1).join("\n");
  }
  return lines.slice(Math.max(0, i - 8), i + 1).join("\n");
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const violations = [];
for (const file of walk(ROOT)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!ENTER.test(line)) return;
    if (GUARD.test(scopeOf(lines, i))) return;
    violations.push(`${file}:${i + 1}\n    ${line.trim()}`);
  });
}

if (violations.length > 0) {
  console.error(`\n✗ IMEガードの無い Enter 判定が ${violations.length} 件あります。`);
  console.error("  変換確定のEnterで誤動作します。src/app/lib/submitKey.ts の submitOnEnter / isImeComposing を使ってください。");
  console.error("  (意図的な箇所は同じ行か直前行に `ime-ok:理由` を書けば除外されます)\n");
  for (const v of violations) console.error(`  - ${v}`);
  console.error("");
  process.exit(1);
}
console.log("✓ Enter判定のIMEガード: 問題なし");
