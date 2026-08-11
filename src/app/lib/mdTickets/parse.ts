// Markdown テキスト → チケットへの写像。
//
// 書式のルールは3つだけ:
//   1. 見出し = タイトル。ファイル内で最も浅い見出しレベルが親、その1段下が子。
//   2. 見出し直後に続く「- キー: 値」の箇条書きがメタ情報。
//   3. 残りはすべて詳細（HTML化して description に入る）。
//
// 上の3つを読み取る行レベルの処理（見出しの走査・メタの切り出し・詳細のHTML化）は
// mdImport/parseCommon に置いてタスクの取り込みと共有している。ここが持つのは
// 「チケット固有の項目をどう解釈するか」だけ。
//
// 未記載の項目は空欄（null）で登録する。ただし status / priority は型・DB制約上
// 「空」を表現できないため既定値（未着手 / 中）、見積工数は既存の表からの一括作成と
// 揃えて 0 が入る。詳細は docs/md-bulk-create-design.md を参照。
import {
  splitMdSections, extractMeta, bodyToDescription,
  normalizeValue, parseDate, parseHours, parsePriority, matchMember,
  MD_PRIORITY_LABELS, type MdSection,
} from "@/app/lib/mdImport/parseCommon";
import type { TicketStatus } from "@/app/types";
import type { ParsedTicket, ParseWarning, ParseResult, ParseContext } from "./types";

// ── 値の候補（既存の一括作成ダイアログと同じ写像） ─────────────────────────

export const MD_STATUS_LABELS = ["未着手", "進行中", "レビュー中", "レビュー完了", "STG完了", "UAT完了", "クローズ"] as const;
export { MD_PRIORITY_LABELS };

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

// ── 値の解釈 ──────────────────────────────────────────────────────────────

/** 分類名をプロジェクトのカテゴリへ照合する */
function matchCategory(raw: string, categories: { id: string; name: string }[]) {
  const name = raw.trim();
  if (!name || categories.length === 0) return null;
  const exact = categories.find(c => c.name === name);
  if (exact) return exact;
  const key = normalizeValue(name);
  return categories.find(c => normalizeValue(c.name) === key) ?? null;
}

// ── 本体 ──────────────────────────────────────────────────────────────────

let uidSeq = 0;

function buildTicket(section: MdSection, ctx: ParseContext, warnings: ParseWarning[]): ParsedTicket {
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

  const { meta, bodyLines } = extractMeta(section.lines, META_KEYS);

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
        const priority = parsePriority(value);
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

  const { html, excerpt } = bodyToDescription(bodyLines);
  ticket.descriptionHtml = html;
  ticket.descriptionExcerpt = excerpt;

  return ticket;
}

/**
 * Markdown テキストをチケットの配列へ変換する。
 * 取り込みをブロックする失敗は無く、読めなかった項目は warnings に積んで空欄で返す。
 */
export function mdTextToTickets(text: string, ctx: ParseContext): ParseResult {
  const warnings: ParseWarning[] = [];
  const sections = splitMdSections(text, key => !!META_KEYS[key]);
  if (sections.length === 0) return { tickets: [], warnings };

  const tickets: ParsedTicket[] = [];
  for (const section of sections) {
    if (!section.title) {
      warnings.push({ ticketTitle: null, message: "タイトルが空の見出しがあったため除外しました" });
      continue;
    }
    const ticket = buildTicket(section, ctx, warnings);

    if (!section.isChild) {
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
