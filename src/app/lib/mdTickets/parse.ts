// Markdown テキスト → チケットへの写像。
//
// 書式のルールは3つだけ:
//   1. 見出し = タイトル。ファイル内で最も浅い見出しレベルが親、その1段下が子。
//   2. 見出し直後に続く「- キー: 値」の箇条書きがメタ情報。
//   3. 残りはすべて詳細（HTML化して description に入る）。
//
// メタ抽出を「行単位」で行うのが要点。ブロックパーサ(parseMarkdown)に先に通してしまうと、
// メタ行の直後に空行なしで本文が続いたときに Markdown の遅延継続行(lazy continuation)として
// 最後のメタ項目へ吸収され、本文が丸ごと消える。さらに本文の後ろのリストまで同じリストへ
// 融合し、「キー: 値」でない項目が混ざるせいでメタ全体が詳細へ落ちる。実際のAI出力は
// 空行を入れないことが多いため、メタは行単位で先に切り出し、残りだけを Markdown として扱う。
//
// 未記載の項目は空欄（null）で登録する。ただし status / priority は型・DB制約上
// 「空」を表現できないため既定値（未着手 / 中）、見積工数は既存の表からの一括作成と
// 揃えて 0 が入る。詳細は docs/md-bulk-create-design.md を参照。
import { parseMarkdown, mdBlocksToHtml } from "@/app/lib/markdown";
import type { MdBlock, MdInline } from "@/app/lib/markdown";
import type { TicketStatus, Priority } from "@/app/types";
import type { ParsedTicket, ParseWarning, ParseResult, ParseContext } from "./types";

// ── 値の候補（既存の一括作成ダイアログと同じ写像） ─────────────────────────

export const MD_STATUS_LABELS = ["未着手", "進行中", "レビュー中", "レビュー完了", "STG完了", "UAT完了", "クローズ"] as const;
export const MD_PRIORITY_LABELS = ["高", "中", "低"] as const;

const STATUS_BY_LABEL: Record<string, TicketStatus> = {
  "未着手": "todo",
  "進行中": "in-progress",
  "レビュー中": "in-review",
  "レビュー完了": "review-done",
  "stg完了": "stg-test",
  "uat完了": "uat",
  "クローズ": "closed",
  // AI が英語で返した場合の受け皿
  "todo": "todo",
  "notstarted": "todo",
  "inprogress": "in-progress",
  "inreview": "in-review",
  "reviewdone": "review-done",
  "stg": "stg-test",
  "stgtest": "stg-test",
  "uat": "uat",
  "closed": "closed",
  "done": "closed",
};

const PRIORITY_BY_LABEL: Record<string, Priority> = {
  "高": "high", "中": "medium", "低": "low",
  "high": "high", "medium": "medium", "mid": "medium", "low": "low",
  "h": "high", "m": "medium", "l": "low",
};

type MetaField = "status" | "priority" | "category" | "assignee" | "startDate" | "dueDate" | "estimatedHours";

/** メタのキー名 → 内部フィールド名 */
const META_KEYS: Record<string, MetaField> = {
  "ステータス": "status", "状態": "status", "status": "status",
  "優先度": "priority", "priority": "priority",
  "分類": "category", "カテゴリ": "category", "カテゴリー": "category", "種別": "category", "category": "category",
  "担当者": "assignee", "担当": "assignee", "assignee": "assignee", "owner": "assignee",
  "開始日": "startDate", "開始": "startDate", "start": "startDate", "startdate": "startDate",
  "期限日": "dueDate", "期限": "dueDate", "締切": "dueDate", "終了日": "dueDate", "due": "dueDate", "duedate": "dueDate",
  "見積工数": "estimatedHours", "見積": "estimatedHours", "工数": "estimatedHours",
  "estimate": "estimatedHours", "estimatedhours": "estimatedHours", "hours": "estimatedHours",
};

/** AI用プロンプトに出す、メタとして使えるキーの表示名 */
export const MD_META_KEY_LABELS = ["ステータス", "優先度", "分類", "担当者", "開始日", "期限日", "見積工数"] as const;

// ── 行の判定 ──────────────────────────────────────────────────────────────

/** ノーブレークスペース。行頭インデント判定を狂わせるので通常の空白へ寄せる */
const NBSP_RE = new RegExp("\u00a0", "g");
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
function toHalfWidth(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ":")
    .replace(/[／]/g, "/")
    .replace(/[－−―]/g, "-")
    .replace(/[．]/g, ".")
    .replace(/　/g, " ");
}

/** キー照合用: 半角化・小文字化・空白と装飾記号を除去（`**優先度**` にも効かせる） */
function normalizeKey(s: string): string {
  return toHalfWidth(s).toLowerCase().replace(/[\s_*`]/g, "");
}

/** 値照合用: 半角化・小文字化・空白除去（日本語ラベルはそのまま残る） */
function normalizeValue(s: string): string {
  return toHalfWidth(s).toLowerCase().replace(/\s/g, "");
}

// ── 値の解釈 ──────────────────────────────────────────────────────────────

/** 「キー: 値」に分解する。コロンが無ければ null。 */
function splitKeyValue(raw: string): { key: string; value: string } | null {
  const m = /^([^:：]{1,24})[:：]\s*([\s\S]*)$/.exec(raw.trim());
  if (!m) return null;
  return { key: m[1].trim(), value: m[2].trim() };
}

/** "2026/08/03" / "2026-8-3" / "2026年8月3日" → "2026-08-03"。読めなければ null。 */
function parseDate(raw: string): string | null {
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
function parseHours(raw: string): number | null {
  const s = toHalfWidth(raw).trim().replace(/\s/g, "").replace(/(時間|人時|hours?|hrs?|h)$/i, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** 大文字小文字・全角・表記ゆれを吸収して担当者名をメンバー一覧に照合する */
function matchMember(raw: string, memberNames: string[]): string | null {
  const name = raw.trim();
  if (!name) return null;
  if (memberNames.length === 0) return name;   // メンバー未取得時は書かれたまま採用
  const exact = memberNames.find(m => m === name);
  if (exact) return exact;
  const key = normalizeValue(name);
  return memberNames.find(m => normalizeValue(m) === key) ?? null;
}

/** 分類名をプロジェクトのカテゴリへ照合する */
function matchCategory(raw: string, categories: { id: string; name: string }[]) {
  const name = raw.trim();
  if (!name || categories.length === 0) return null;
  const exact = categories.find(c => c.name === name);
  if (exact) return exact;
  const key = normalizeValue(name);
  return categories.find(c => normalizeValue(c.name) === key) ?? null;
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
function hasMetaRightAfter(lines: string[], headingLine: number): boolean {
  for (let i = headingLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;                       // 見出しとメタの間の空行は許す
    const b = BULLET_RE.exec(line);
    if (!b) return false;
    const kv = splitKeyValue(b[1]);
    return !!kv && !!META_KEYS[normalizeKey(kv.key)];
  }
  return false;
}

// ── メタの切り出し ────────────────────────────────────────────────────────

interface MetaLine { field: MetaField; key: string; value: string }

/**
 * セクションの本文行から、先頭にある「箇条書きのひとかたまり」を調べてメタを取り出す。
 * 既知キーでない項目は捨てずに本文へ戻す。かたまりは空行か非箇条書き行で終わる。
 */
function extractMeta(lines: string[]): { meta: MetaLine[]; bodyLines: string[] } {
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;   // 見出し直後の空行を読み飛ばす

  const meta: MetaLine[] = [];
  const leftover: string[] = [];
  let consumed = i;

  while (i < lines.length) {
    const b = BULLET_RE.exec(lines[i]);
    if (!b) break;                                    // 箇条書きのかたまりはここで終わり
    const kv = splitKeyValue(b[1]);
    const field = kv ? META_KEYS[normalizeKey(kv.key)] : undefined;
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

// ── 本体 ──────────────────────────────────────────────────────────────────

let uidSeq = 0;

interface Section {
  level: number;
  title: string;
  lines: string[];
}

function buildTicket(section: Section, ctx: ParseContext, warnings: ParseWarning[]): ParsedTicket {
  const ticket: ParsedTicket = {
    uid: `md-${++uidSeq}`,
    title: section.title,
    status: "todo",
    priority: "medium",
    categoryId: null,
    categoryName: null,
    assignee: null,
    startDate: null,
    dueDate: null,
    estimatedHours: 0,
    descriptionHtml: null,
    descriptionExcerpt: null,
    filled: {
      status: false, priority: false, category: false, assignee: false,
      startDate: false, dueDate: false, estimatedHours: false,
    },
    children: [],
  };

  const warn = (message: string) => warnings.push({ ticketTitle: section.title, message });

  const { meta, bodyLines } = extractMeta(section.lines);

  for (const { field, value } of meta) {
    if (!value) continue;   // 「- 担当者:」のような空値は未記載と同じ扱い

    switch (field) {
      case "status": {
        const status = STATUS_BY_LABEL[normalizeValue(value)];
        if (status) { ticket.status = status; ticket.filled.status = true; }
        else warn(`ステータス「${value}」は候補にないため未着手にしました`);
        break;
      }
      case "priority": {
        const priority = PRIORITY_BY_LABEL[normalizeValue(value)];
        if (priority) { ticket.priority = priority; ticket.filled.priority = true; }
        else warn(`優先度「${value}」は候補にないため中にしました`);
        break;
      }
      case "category": {
        const category = matchCategory(value, ctx.categories);
        if (category) {
          ticket.categoryId = category.id;
          ticket.categoryName = category.name;
          ticket.filled.category = true;
        } else {
          warn(`分類「${value}」はこのプロジェクトに登録されていないため分類なしにしました`);
        }
        break;
      }
      case "assignee": {
        const member = matchMember(value, ctx.memberNames);
        if (member) { ticket.assignee = member; ticket.filled.assignee = true; }
        else warn(`担当者「${value}」はメンバーに見つからないため空欄にしました`);
        break;
      }
      case "startDate": {
        const date = parseDate(value);
        if (date) { ticket.startDate = date; ticket.filled.startDate = true; }
        else warn(`開始日「${value}」を日付として読めませんでした`);
        break;
      }
      case "dueDate": {
        const date = parseDate(value);
        if (date) { ticket.dueDate = date; ticket.filled.dueDate = true; }
        else warn(`期限日「${value}」を日付として読めませんでした`);
        break;
      }
      case "estimatedHours": {
        const hours = parseHours(value);
        if (hours !== null) {
          // estimated_hours は DB 側が int 列のため整数に丸める
          const rounded = Math.round(hours);
          if (rounded !== hours) warn(`見積工数「${value}」を ${rounded} 時間に丸めました`);
          ticket.estimatedHours = rounded;
          ticket.filled.estimatedHours = true;
        } else {
          warn(`見積工数「${value}」を数値として読めませんでした`);
        }
        break;
      }
    }
  }

  if (ticket.startDate && ticket.dueDate && ticket.dueDate < ticket.startDate) {
    warn("期限日が開始日より前です");
  }

  const bodyText = bodyLines.join("\n").trim();
  if (bodyText) {
    const blocks = parseMarkdown(bodyText);
    const html = mdBlocksToHtml(blocks);
    ticket.descriptionHtml = html || null;
    const plain = blocks.map(blockToText).join(" ").replace(/\s+/g, " ").trim();
    ticket.descriptionExcerpt = plain ? (plain.length > 120 ? plain.slice(0, 120) + "…" : plain) : null;
  }

  return ticket;
}

/**
 * Markdown テキストをチケットの配列へ変換する。
 * 取り込みをブロックする失敗は無く、読めなかった項目は warnings に積んで空欄で返す。
 */
export function mdTextToTickets(text: string, ctx: ParseContext): ParseResult {
  const warnings: ParseWarning[] = [];
  // ノーブレークスペース(U+00A0)は行頭インデント判定を狂わせるので通常の空白へ寄せる
  const lines = text.replace(/\r\n?/g, "\n").replace(NBSP_RE, " ").split("\n");

  const headings = scanHeadings(lines);
  if (headings.length === 0) return { tickets: [], warnings };

  const levels = [...new Set(headings.map(h => h.level))].sort((a, b) => a - b);
  let parentLevel = levels[0];

  // 先頭の `# ドキュメントタイトル` は、それ1つだけ・メタ無し・1段下の見出しがある場合に限り無視する
  if (levels.length >= 2) {
    const shallow = headings.filter(h => h.level === parentLevel);
    if (shallow.length === 1 && !hasMetaRightAfter(lines, shallow[0].line)) {
      parentLevel = levels[1];
    }
  }
  const childLevel = levels.find(l => l > parentLevel) ?? null;

  // セクション化。対象レベル以外の見出し（より深い小見出し）は本文の一部として残す。
  const targets = headings.filter(h => h.level === parentLevel || h.level === childLevel);
  const sections: Section[] = targets.map((h, i) => ({
    level: h.level,
    title: h.title,
    lines: lines.slice(h.line + 1, i + 1 < targets.length ? targets[i + 1].line : lines.length),
  }));

  const tickets: ParsedTicket[] = [];
  for (const section of sections) {
    if (!section.title) {
      warnings.push({ ticketTitle: null, message: "タイトルが空の見出しがあったため除外しました" });
      continue;
    }
    const ticket = buildTicket(section, ctx, warnings);

    if (section.level === parentLevel) {
      tickets.push(ticket);
      continue;
    }
    // 子見出しだが親がまだ無い（＝いきなり ### から始まった）場合は親として扱う
    const parent = tickets[tickets.length - 1];
    if (parent) parent.children.push(ticket);
    else tickets.push(ticket);
  }

  return { tickets, warnings };
}

/** 親子構造を解いて、すべて親チケットとして1列に並べ直す（確認画面の階層トグル用） */
export function flattenTickets(tickets: ParsedTicket[]): ParsedTicket[] {
  const out: ParsedTicket[] = [];
  for (const t of tickets) {
    out.push({ ...t, children: [] });
    for (const c of t.children) out.push({ ...c, children: [] });
  }
  return out;
}

/** 親＋子の総数 */
export function countTickets(tickets: ParsedTicket[]): number {
  return tickets.reduce((n, t) => n + 1 + t.children.length, 0);
}
