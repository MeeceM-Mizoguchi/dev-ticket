// api/ 配下の相対 import に拡張子 .js が無いと、本番の関数が読み込み時点で落ちる事故の作り込み防止。
//
// package.json が "type": "module" なので、Vercel は api/*.ts を1ファイルずつ .js に
// 変換して Node の ESM として動かす。ESM は相対 import の拡張子を補完しないため、
//   import { x } from "./_lib/memberAuth";      // ✗ /var/task/api/_lib/memberAuth が無い
// は ERR_MODULE_NOT_FOUND で関数ごと落ち、どのリクエストも 500 になる。
// vite build は api/ を見ないので、手元のビルドは緑のまま本番だけが壊れる
// （2026-09-30、招待・メンバー削除APIが本番で全件失敗した）。
//
// 正しい書き方（.ts のソースでも拡張子は .js と書く。tsconfig は bundler 解決なので型は通る）:
//   import { x } from "./_lib/memberAuth.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "api";
// from "./x" / import("./x") / import "./x" の相対指定を拾う
const REL_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["'](\.{1,2}\/[^"']+)["']/;
const HAS_EXT = /\.(m?js|cjs|json)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const violations = [];
for (const file of walk(ROOT)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const m = line.match(REL_IMPORT);
    if (!m || HAS_EXT.test(m[1])) return;
    violations.push(`${file}:${i + 1}\n    ${line.trim()}`);
  });
}

if (violations.length > 0) {
  console.error(`\n✗ api/ に拡張子の無い相対 import が ${violations.length} 件あります。`);
  console.error("  本番(Vercel)で ERR_MODULE_NOT_FOUND になり、その関数が全リクエスト 500 になります。");
  console.error('  末尾に .js を付けてください（例: from "./_lib/memberAuth.js"）。\n');
  for (const v of violations) console.error("  " + v);
  console.error("");
  process.exit(1);
}
