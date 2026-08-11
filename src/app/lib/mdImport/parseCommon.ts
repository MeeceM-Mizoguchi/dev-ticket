// MDファイル取り込みの共通部分（チケット / タスク）。
//
// どちらも書式のルールは3つだけで、同じものを読む:
//   1. 見出し = タイトル。ファイル内で最も浅い見出しレベルが親、その1段下が子。
//   2. 見出し直後に続く「- キー: 値」の箇条書きがメタ情報。
//   3. 残りはすべて詳細（HTML化して description に入る）。
// 違うのは「使えるキーと値」だけなので、行の切り出しと値の正規化はここに集める。
//
// メタ抽出を「行単位」で行うのが要点。ブロックパーサ(parseMarkdown)に先に通してしまうと、
// メタ行の直後に空行なしで本文が続いたときに Markdown の遅延継続行(lazy continuation)として
// 最後のメタ項目へ吸収され、本文が丸ごと消える。さらに本文の後ろのリストまで同じリストへ
// 融合し、「キー: 値」でない項目が混ざるせいでメタ全体が詳細へ落ちる。実際のAI出力は
// 空行を入れないことが多いため、メタは行単位で先に切り出し、残りだけを Markdown として扱う。
import { parseMarkdown, mdBlocksToHtml } from "@/app/lib/markdown";
import type { MdBlock, MdInline } from "@/app/lib/markdown";
import type { Priority } from "@/app/types";

// ── 取り込みをブロックしない注意書き ──────────────────────────────────────

/** 確認画面の黄色ストリップに出す。取り込み自体は止めない。 */
export interface MdParseWarning {
  /** 対象のタイトル（全体に関わる警告なら null） */
  ticketTitle: string | null;
  message: string;
}

// ── 行の判定 ──────────────────────────────────────────────────────────────

/** ノーブレークスペース。行頭インデント判定を狂わせるので通常の空白へ寄せる */
const NBSP_RE = /\u00a0/g;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const FENCE_RE = /^ {0,3}(```+|~~~+)/;
/** 箇条書き1行（入れ子は対象外なので行頭インデントは3つまで） */
const BULLET_RE = /^ {0,3}[-*+][ \t]+(.+?)[ \t]*$/;

// ── 文字列の正規化 ────────────────────────────────────────────────────────

/**
 * 全角英数・全角記号を半角へ寄せる（AI や日本語入力が全角を混ぜてくるため）。
 * 長音符 U+30FC「ー」はハイフンに寄せてはいけない（「ステータス」が「ステ-タス」になり
 * キー照合が全滅する）。ハイフン扱いにするのは全角ハイフン・マイナス・水平線だけ。
 */
export function toHalfWidth(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ":")
    .replace(/[／]/g, "/")
    .replace(/[－−―]/g, "-")
    .replace(/[．]/g, ".")
    .replace(/　/g, " ");
}

/** キー照合用: 半角化・小文字化・空白と装飾記号を除去（`**優先度**` にも効かせる） */
export function normalizeKey(s: string): string {
  return toHalfWidth(s).toLowerCase().replace(/[\s_*`]/g, "");
}

/** 値照合用: 半角化・小文字化・空白除去（日本語ラベルはそのまま残る） */
export function normalizeValue(s: string): string {
  return toHalfWidth(s).toLowerCase().replace(/\s/g, "");
}

// ── 値の解釈 ──────────────────────────────────────────────────────────────

/** 「キー: 値」に分解する。コロンが無ければ null。 */
export function splitKeyValue(raw: string): { key: string; value: string } | null {
  const m = /^([^:：]{1,24})[:：]\s*([\s\S]*)$/.exec(raw.trim());
  if (!m) return null;
  return { key: m[1].trim(), value: m[2].trim() };
}

/** "2026/08/03" / "2026-8-3" / "2026年8月3日" → "2026-08-03"。読めなければ null。 */
export function parseDate(raw: string): string | null {
  const s = toHalfWidth(raw).trim()
    .replace(/年/g, "-").replace(/月/g, "-").replace(/日/g, "")
    .replace(/\./g, "-").replace(/\//g, "-")
    .replace(/-+$/, "");
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "4" / "4h" / "4時間" / "4.5" → 4。読めなければ null。 */
export function parseHours(raw: string): number | null {
  const s = toHalfWidth(raw).trim().replace(/\s/g, "").replace(/(時間|人時|hours?|hrs?|h)$/i, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** AI用プロンプトに出す優先度の選択肢（チケット・タスク共通） */
export const MD_PRIORITY_LABELS = ["高", "中", "低"] as const;

const PRIORITY_BY_LABEL: Record<string, Priority> = {
  "高": "high", "中": "medium", "低": "low",
  "high": "high", "medium": "medium", "mid": "medium", "low": "low",
  "h": "high", "m": "medium", "l": "low",
};

/** 優先度の値を解釈する。候補に無ければ null。 */
export function parsePriority(raw: string): Priority | null {
  return PRIORITY_BY_LABEL[normalizeValue(raw)] ?? null;
}

/** 大文字小文字・全角・表記ゆれを吸収して担当者名をメンバー一覧に照合する */
export function matchMember(raw: string, memberNames: string[]): string | null {
  const name = raw.trim();
  if (!name) return null;
  if (memberNames.length === 0) return name;   // メンバー未取得時は書かれたまま採用
  const exact = memberNames.find(m => m === name);
  if (exact) return exact;
  const key = normalizeValue(name);
  return memberNames.find(m => normalizeValue(m) === key) ?? null;
}

// ── IR からのテキスト抽出（詳細の抜粋用） ─────────────────────────────────

function inlineToText(nodes: MdInline[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.t === "text") out += n.v;
    else if (n.t === "link") out += inlineToText(n.children);
    else if (n.t === "image") out += n.alt;
  }
  return out;
}

function blockToText(b: MdBlock): string {
  switch (b.t) {
    case "heading":
    case "para":
      return inlineToText(b.children);
    case "list":
      return b.items.map(it => inlineToText(it.children)).join(" / ");
    case "quote":
      return b.blocks.map(blockToText).join(" ");
    case "code":
    case "mermaid":
      return b.code;
    case "table":
      return [b.header, ...b.rows].map(r => r.map(inlineToText).join(" ")).join(" ");
    default:
      return "";
  }
}

/** メタを取り除いた残りの行を、詳細（HTML）と確認画面用の抜粋に変換する */
export function bodyToDescription(
  bodyLines: string[], excerptLength = 120,
): { html: string | null; excerpt: string | null } {
  const bodyText = bodyLines.join("\n").trim();
  if (!bodyText) return { html: null, excerpt: null };
  const blocks = parseMarkdown(bodyText);
  const html = mdBlocksToHtml(blocks);
  const plain = blocks.map(blockToText).join(" ").replace(/\s+/g, " ").trim();
  return {
    html: html || null,
    excerpt: plain ? (plain.length > excerptLength ? plain.slice(0, excerptLength) + "…" : plain) : null,
  };
}

// ── 見出しの走査 ──────────────────────────────────────────────────────────

interface HeadingRef {
  level: number;
  title: string;
  /** 見出しがある行番号 */
  line: number;
}

/** コードブロックの中の `#` を見出しと誤認しないよう、フェンスを追いながら走査する */
function scanHeadings(lines: string[]): HeadingRef[] {
  const out: HeadingRef[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = FENCE_RE.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const h = HEADING_RE.exec(line);
    if (h) out.push({ level: h[1].length, title: h[2].trim(), line: i });
  }
  return out;
}

/** その見出しの直後に、既知キーのメタ行が1つでもあるか */
function hasMetaRightAfter(lines: string[], headingLine: number, isMetaKey: (key: string) => boolean): boolean {
  for (let i = headingLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;                       // 見出しとメタの間の空行は許す
    const b = BULLET_RE.exec(line);
    if (!b) return false;
    const kv = splitKeyValue(b[1]);
    return !!kv && isMetaKey(normalizeKey(kv.key));
  }
  return false;
}

/** 見出し1つ＝取り込み1件ぶん */
export interface MdSection {
  title: string;
  /** 1段下の見出し（＝子チケット・サブタスク）か */
  isChild: boolean;
  /** 見出しの次の行から、次の対象見出しの手前まで */
  lines: string[];
}

/**
 * MDテキストを見出しごとのセクションへ切り分ける。
 *
 * 最も浅い見出しレベルを親、その1段下を子とする。それ以外（さらに深い小見出し）は
 * 本文の一部として残す。先頭の `# ドキュメントタイトル` は、それ1つだけ・メタ無し・
 * 1段下の見出しがある場合に限り無視する。
 */
export function splitMdSections(text: string, isMetaKey: (key: string) => boolean): MdSection[] {
  // ノーブレークスペース(U+00A0)は行頭インデント判定を狂わせるので通常の空白へ寄せる
  const lines = text.replace(/\r\n?/g, "\n").replace(NBSP_RE, " ").split("\n");

  const headings = scanHeadings(lines);
  if (headings.length === 0) return [];

  const levels = [...new Set(headings.map(h => h.level))].sort((a, b) => a - b);
  let parentLevel = levels[0];

  if (levels.length >= 2) {
    const shallow = headings.filter(h => h.level === parentLevel);
    if (shallow.length === 1 && !hasMetaRightAfter(lines, shallow[0].line, isMetaKey)) {
      parentLevel = levels[1];
    }
  }
  const childLevel = levels.find(l => l > parentLevel) ?? null;

  const targets = headings.filter(h => h.level === parentLevel || h.level === childLevel);
  return targets.map((h, i) => ({
    title: h.title,
    isChild: h.level !== parentLevel,
    lines: lines.slice(h.line + 1, i + 1 < targets.length ? targets[i + 1].line : lines.length),
  }));
}

// ── メタの切り出し ────────────────────────────────────────────────────────

export interface MdMetaLine<F extends string> { field: F; key: string; value: string }

/**
 * セクションの本文行から、先頭にある「箇条書きのひとかたまり」を調べてメタを取り出す。
 * 既知キーでない項目は捨てずに本文へ戻す。かたまりは空行か非箇条書き行で終わる。
 */
export function extractMeta<F extends string>(
  lines: string[], keys: Record<string, F>,
): { meta: MdMetaLine<F>[]; bodyLines: string[] } {
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;   // 見出し直後の空行を読み飛ばす

  const meta: MdMetaLine<F>[] = [];
  const leftover: string[] = [];
  let consumed = i;

  while (i < lines.length) {
    const b = BULLET_RE.exec(lines[i]);
    if (!b) break;                                    // 箇条書きのかたまりはここで終わり
    const kv = splitKeyValue(b[1]);
    const field = kv ? keys[normalizeKey(kv.key)] : undefined;
    if (field) meta.push({ field, key: kv!.key, value: kv!.value });
    else leftover.push(lines[i]);                     // 未知キー・ただの箇条書きは本文へ
    i++;
    consumed = i;
  }

  if (meta.length === 0) {
    // メタが1つも無ければ、かたまりごと本文として扱う（本文のリストを壊さない）
    return { meta: [], bodyLines: lines.slice(0) };
  }
  // 残した箇条書きの直後に本文が続くと遅延継続行として吸われるので空行で区切る
  const rest = lines.slice(consumed);
  return { meta, bodyLines: leftover.length > 0 ? [...leftover, "", ...rest] : rest };
}
