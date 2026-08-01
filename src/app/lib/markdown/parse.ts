// Markdown テキスト → IR(MdBlock[]) のパーサ。
//
// なぜ自前か: ProseMirror の clipboardTextParser は Slice を「同期で」返さなければならず、
// 遅延 import した外部ライブラリ（marked 等）を貼り付けの瞬間に await できない。
// また必要なのは TipTap のスキーマが受け取れる範囲だけで、そこは既存の htmlToMarkdown /
// clipboardTextSerializer が出力する範囲＝この実装の逆写像に一致する。依存追加も不要。
//
// 対応: 見出し(#) / 段落 / 箇条書き・番号付き(入れ子・チェックボックス) / 引用(>) /
//       コードブロック(```) / mermaid(```mermaid) / GFM表 / 水平線 / 太字 / 斜体 /
//       打ち消し / インラインコード / リンク / 画像 / 生URL / バックスラッシュエスケープ
import type { MdBlock, MdInline, MdListItem } from "./types";

// ── 暴走防止の上限（極端な入力でフリーズさせない） ──
const MAX_TABLE_COLS = 20;
const MAX_TABLE_ROWS = 200;
const MAX_LIST_DEPTH = 6;

// ── 行の分類に使う正規表現 ──
const FENCE = /^ {0,3}(```+|~~~+)[ \t]*([^\s`]*)[^`]*$/;
const HR = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const SETEXT_H1 = /^ {0,3}=+[ \t]*$/;

/** タブを4スペース換算した「行頭インデント量」 */
function indentOf(prefix: string): number {
  let n = 0;
  for (const ch of prefix) n += ch === "\t" ? 4 - (n % 4) : 1;
  return n;
}

// ────────────────────────────────────────────────────────────
// インライン
// ────────────────────────────────────────────────────────────

type Marks = { bold?: boolean; italic?: boolean; strike?: boolean };

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~>]/;
const WORDY = /[0-9A-Za-z]/;

/** from 以降から delim の閉じを探す。エスケープとインラインコードは読み飛ばす。見つからなければ -1。 */
function findClose(src: string, from: number, delim: string): number {
  let i = from;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") { i += 2; continue; }
    if (ch === "`") {
      const run = /^`+/.exec(src.slice(i))![0];
      const end = src.indexOf(run, i + run.length);
      i = end === -1 ? i + run.length : end + run.length;
      continue;
    }
    if (src.startsWith(delim, i)) return i;
    i++;
  }
  return -1;
}

/** `[` の位置から対応する `]` を返す（入れ子・エスケープ対応）。見つからなければ -1。 */
function matchBracket(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") { i++; continue; }
    if (ch === "[") depth++;
    else if (ch === "]") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** `(` の位置から対応する `)` を返す（入れ子・エスケープ対応）。見つからなければ -1。 */
function matchParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") { i++; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** リンク先から `<...>` と タイトル( "..." )を落とす */
function cleanHref(raw: string): string {
  let s = raw.trim();
  const t = /\s+["'(].*["')]$/.exec(s);
  if (t) s = s.slice(0, t.index).trim();
  if (s.startsWith("<") && s.endsWith(">")) s = s.slice(1, -1);
  return s;
}

/** 隣接する同装飾のテキストを結合する（HTMLタグが無駄に増えるのを防ぐ） */
function mergeInline(list: MdInline[]): MdInline[] {
  const out: MdInline[] = [];
  for (const n of list) {
    const prev = out[out.length - 1];
    if (n.t === "text" && prev && prev.t === "text"
      && !!prev.bold === !!n.bold && !!prev.italic === !!n.italic
      && !!prev.strike === !!n.strike && !!prev.code === !!n.code) {
      prev.v += n.v;
      continue;
    }
    if (n.t === "text" && n.v === "") continue;
    out.push(n);
  }
  return out;
}

function scanInline(src: string, m: Marks): MdInline[] {
  const out: MdInline[] = [];
  let buf = "";
  const flush = () => { if (buf) { out.push({ t: "text", v: buf, ...m }); buf = ""; } };
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    // バックスラッシュエスケープ
    if (ch === "\\" && i + 1 < src.length && ESCAPABLE.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }

    // インラインコード（中身は一切解釈しない）
    if (ch === "`") {
      const run = /^`+/.exec(src.slice(i))![0];
      const close = src.indexOf(run, i + run.length);
      if (close !== -1) {
        let code = src.slice(i + run.length, close);
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "") code = code.slice(1, -1);
        flush();
        out.push({ t: "text", v: code, code: true });
        i = close + run.length;
        continue;
      }
    }

    // 画像 ![alt](src) / リンク [text](href)
    if (ch === "[" || (ch === "!" && src[i + 1] === "[")) {
      const isImg = ch === "!";
      const ob = isImg ? i + 1 : i;
      const cb = matchBracket(src, ob);
      if (cb !== -1 && src[cb + 1] === "(") {
        const cp = matchParen(src, cb + 1);
        if (cp !== -1) {
          const label = src.slice(ob + 1, cb);
          const href = cleanHref(src.slice(cb + 2, cp));
          if (href) {
            flush();
            if (isImg) out.push({ t: "image", src: href, alt: label });
            else out.push({ t: "link", href, children: mergeInline(scanInline(label, m)) });
            i = cp + 1;
            continue;
          }
        }
      }
    }

    // 打ち消し ~~x~~
    if (src.startsWith("~~", i) && !m.strike) {
      const close = findClose(src, i + 2, "~~");
      if (close > i + 2) {
        flush();
        out.push(...scanInline(src.slice(i + 2, close), { ...m, strike: true }));
        i = close + 2;
        continue;
      }
    }

    // 太字 **x** / __x__
    if ((src.startsWith("**", i) || src.startsWith("__", i)) && !m.bold) {
      const delim = src.slice(i, i + 2);
      // __ は単語の途中では効かせない（snake_case 対策）
      const okOpen = delim === "**" || !WORDY.test(src[i - 1] ?? "");
      if (okOpen) {
        const close = findClose(src, i + 2, delim);
        if (close > i + 2 && (delim === "**" || !WORDY.test(src[close + 2] ?? ""))) {
          flush();
          out.push(...scanInline(src.slice(i + 2, close), { ...m, bold: true }));
          i = close + 2;
          continue;
        }
      }
    }

    // 斜体 *x* / _x_
    if ((ch === "*" || ch === "_") && !m.italic) {
      const okOpen = (ch === "*" || !WORDY.test(src[i - 1] ?? "")) && src[i + 1] !== " " && src[i + 1] !== undefined;
      if (okOpen) {
        const close = findClose(src, i + 1, ch);
        if (close > i + 1 && (ch === "*" || !WORDY.test(src[close + 1] ?? ""))) {
          flush();
          out.push(...scanInline(src.slice(i + 1, close), { ...m, italic: true }));
          i = close + 1;
          continue;
        }
      }
    }

    // 生URL（TipTap の autolink は入力時のみ効くため、貼り付けはここでリンク化する）
    if ((ch === "h" || ch === "w") && (src[i - 1] === undefined || !/[\w/@.-]/.test(src[i - 1]))) {
      const mm = /^(?:https?:\/\/|www\.)[^\s<>"'`\][(){}]+/.exec(src.slice(i));
      if (mm) {
        let url = mm[0];
        const trimmed = url.replace(/[.,;:!?]+$/, "");   // 文末の句読点はURLに含めない
        if (trimmed.length > 8) url = trimmed;
        flush();
        out.push({ t: "link", href: url.startsWith("www.") ? `https://${url}` : url, children: [{ t: "text", v: url, ...m }] });
        i += url.length;
        continue;
      }
    }

    buf += ch;
    i++;
  }

  flush();
  return out;
}

export function parseInline(src: string): MdInline[] {
  return mergeInline(scanInline(src, {}));
}

// ────────────────────────────────────────────────────────────
// 表
// ────────────────────────────────────────────────────────────

/** `|` を区切りにセルへ分解する（`\|` はセル内の文字） */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
    if (s[i] === "|") { cells.push(cur); cur = ""; continue; }
    cur += s[i];
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

/** GFM の区切り行（|---|:--:|）か */
function isDelimRow(line: string): boolean {
  if (!line.includes("-")) return false;
  if (!/^[\s|:-]+$/.test(line)) return false;
  const cells = splitRow(line);
  return cells.length >= 1 && cells.every((c) => /^:?-{1,}:?$/.test(c));
}

/** i 行目から表が始まるか（見出し行＋区切り行） */
function isTableStart(lines: string[], i: number): boolean {
  const head = lines[i];
  const delim = lines[i + 1];
  if (!head || !delim || !head.includes("|")) return false;
  if (!isDelimRow(delim)) return false;
  return splitRow(head).length === splitRow(delim).length && splitRow(head).length >= 2;
}

// ────────────────────────────────────────────────────────────
// ブロック
// ────────────────────────────────────────────────────────────

function isBlockStart(lines: string[], i: number): boolean {
  const line = lines[i];
  if (!line.trim()) return true;
  return FENCE.test(line) || HR.test(line) || HEADING.test(line) || QUOTE.test(line)
    || ITEM.test(line) || isTableStart(lines, i);
}

/** リスト領域をまとめて読み、入れ子を復元する。戻り値は消費後の行番号。 */
function parseList(lines: string[], start: number, depth: number): { block: MdBlock; next: number } {
  const first = ITEM.exec(lines[start])!;
  const baseIndent = indentOf(first[1]);
  const ordered = /\d/.test(first[2]);
  const startNo = ordered ? parseInt(first[2], 10) || 1 : 1;

  const items: MdListItem[] = [];
  const raw: string[] = [];         // 各項目の本文（継続行込み・未パース）
  const subLines: string[][] = [];  // 各項目にぶら下がる入れ子リストの行

  let i = start;
  let blanks = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      // 空行1つは許容（次が同じリストの続きなら継続）
      blanks++;
      if (blanks > 1) break;
      i++;
      continue;
    }

    const m = ITEM.exec(line);
    if (m) {
      const ind = indentOf(m[1]);
      if (ind < baseIndent) break;                       // 親のレベルへ戻った
      if (ind >= baseIndent + 2 && raw.length > 0) {      // 入れ子 → 後でまとめて再帰
        subLines[raw.length - 1].push(line);
        blanks = 0;
        i++;
        continue;
      }
      if (ordered !== /\d/.test(m[2])) break;             // 記号が変わったら別のリスト
      raw.push(m[3]);
      subLines.push([]);
      blanks = 0;
      i++;
      continue;
    }

    if (blanks > 0) break;                                // 空行のあとの非項目 → リスト終了
    const cont = /^([ \t]*)(.*)$/.exec(line)!;
    if (indentOf(cont[1]) <= baseIndent && isBlockStart(lines, i)) break;
    if (raw.length === 0) break;
    if (subLines[raw.length - 1].length > 0) subLines[raw.length - 1].push(line);  // 入れ子側の継続行
    else raw[raw.length - 1] += "\n" + cont[2];
    i++;
  }

  for (let k = 0; k < raw.length; k++) {
    let body = raw[k];
    let checked: boolean | undefined;
    const cb = /^\[([ xX])\][ \t]+/.exec(body);
    if (cb) { checked = cb[1] !== " "; body = body.slice(cb[0].length); }
    const sub = subLines[k].length && depth < MAX_LIST_DEPTH
      ? parseBlocks(dedent(subLines[k]), depth + 1)
      : [];
    items.push({ children: parseInline(body), checked, sub });
  }

  return { block: { t: "list", ordered, start: startNo, items }, next: i };
}

/** 入れ子リストの行から共通の行頭インデントを取り除く */
function dedent(lines: string[]): string[] {
  let min = Infinity;
  for (const l of lines) {
    if (!l.trim()) continue;
    min = Math.min(min, indentOf(/^[ \t]*/.exec(l)![0]));
  }
  if (!isFinite(min) || min === 0) return lines;
  return lines.map((l) => {
    if (!l.trim()) return "";
    const pre = /^[ \t]*/.exec(l)![0];
    return " ".repeat(Math.max(0, indentOf(pre) - min)) + l.slice(pre.length);
  });
}

function parseBlocks(lines: string[], depth = 0): MdBlock[] {
  const out: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // ── コードブロック / mermaid ──
    const f = FENCE.exec(line);
    if (f) {
      const marker = f[1][0];  // ` か ~
      const lang = (f[2] || "").toLowerCase();
      const closing = marker === "`" ? /^ {0,3}```+[ \t]*$/ : /^ {0,3}~~~+[ \t]*$/;
      const body: string[] = [];
      i++;
      while (i < lines.length && !closing.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // 閉じフェンス
      const code = body.join("\n");
      out.push(lang === "mermaid" ? { t: "mermaid", code } : { t: "code", lang, code });
      continue;
    }

    // ── 水平線 ──
    if (HR.test(line)) { out.push({ t: "hr" }); i++; continue; }

    // ── ATX見出し ──
    const h = HEADING.exec(line);
    if (h) {
      out.push({ t: "heading", level: h[1].length as 1 | 2 | 3 | 4 | 5 | 6, children: parseInline(h[2]) });
      i++;
      continue;
    }

    // ── 引用 ──
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && (QUOTE.test(lines[i]) || (lines[i].trim() && inner.length > 0 && !isBlockStart(lines, i)))) {
        const q = QUOTE.exec(lines[i]);
        inner.push(q ? q[1] : lines[i].trim());
        i++;
      }
      out.push({ t: "quote", blocks: depth < MAX_LIST_DEPTH ? parseBlocks(inner, depth + 1) : [] });
      continue;
    }

    // ── 表 ──
    if (isTableStart(lines, i)) {
      const header = splitRow(lines[i]).slice(0, MAX_TABLE_COLS);
      const cols = header.length;
      i += 2; // 見出し行＋区切り行
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() && rows.length < MAX_TABLE_ROWS) {
        if (isDelimRow(lines[i])) { i++; continue; }
        const cells = splitRow(lines[i]);
        while (cells.length < cols) cells.push("");
        rows.push(cells.slice(0, cols));
        i++;
      }
      out.push({
        t: "table",
        header: header.map((c) => parseInline(c)),
        rows: rows.map((r) => r.map((c) => parseInline(c))),
      });
      continue;
    }

    // ── リスト ──
    if (ITEM.test(line)) {
      const r = parseList(lines, i, depth);
      out.push(r.block);
      i = r.next > i ? r.next : i + 1;
      continue;
    }

    // ── Setext見出し（Title の次行が === ） ──
    if (i + 1 < lines.length && SETEXT_H1.test(lines[i + 1])) {
      out.push({ t: "heading", level: 1, children: parseInline(line.trim()) });
      i += 2;
      continue;
    }

    // ── 段落（次のブロック開始まで。行内改行は改行のまま残す） ──
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && !isBlockStart(lines, i) && !(i + 1 < lines.length && SETEXT_H1.test(lines[i + 1]))) {
      para.push(lines[i].trim());
      i++;
    }
    out.push({ t: "para", children: parseInline(para.join("\n")) });
  }

  return out;
}

export function parseMarkdown(text: string): MdBlock[] {
  // ノーブレークスペース(U+00A0)は行頭インデント判定を狂わせるので通常の空白へ寄せる
  const lines = text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").split("\n");
  return parseBlocks(lines);
}

// ────────────────────────────────────────────────────────────
// 「Markdown として解釈すべきか」の判定
// ────────────────────────────────────────────────────────────

/**
 * 変換してよいテキストか。強いシグナルが1つ以上あり、かつコード片でないときだけ true。
 *
 * 判定を外しても逃げ道が3つある（Cmd+Shift+V＝素のまま貼る / Cmd+Z で1手戻す /
 * コードブロック内はそもそも呼ばれない）ため、多少の取りこぼしは許容して誤変換を避ける側に倒す。
 */
export function looksLikeMarkdown(text: string): boolean {
  const src = text.replace(/\r\n?/g, "\n");
  if (!src.trim()) return false;
  const lines = src.split("\n");

  // 明らかにコード／構造化データなら触らない
  const head = src.trimStart();
  if (/^[{[<]/.test(head)) return false;
  const codeish = lines.filter((l) => l.trim() && /[;{})]\s*$/.test(l)).length;
  if (codeish >= Math.max(2, Math.ceil(lines.filter((l) => l.trim()).length * 0.6))) return false;

  // ── 強いシグナル ──
  if (/^ {0,3}```/m.test(src)) return true;                       // コードフェンス
  if (lines.some((l) => HEADING.test(l))) return true;            // 見出し
  for (let i = 0; i < lines.length - 1; i++) if (isTableStart(lines, i)) return true; // GFM表
  const items = lines.filter((l) => ITEM.test(l)).length;
  if (items >= 2) return true;                                    // 箇条書き/番号付きが2行以上
  const quotes = lines.filter((l) => QUOTE.test(l)).length;
  if (quotes >= 2) return true;                                   // 引用が2行以上
  const strong = (src.match(/\*\*[^\s*][^*]*\*\*/g) || []).length
    + (src.match(/`[^`\n]+`/g) || []).length;
  if (strong >= 2) return true;                                   // 太字/インラインコードが2箇所以上
  if (/\[[^\]\n]+\]\([^)\s]+\)/.test(src)) return true;           // Markdownリンク

  return false;
}
