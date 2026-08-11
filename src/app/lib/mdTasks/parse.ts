// Markdown テキスト → タスクへの写像。
//
// 書式はチケットのMD取り込みと同じ:
//   1. 見出し = タイトル。最も浅い見出しレベルが親、その1段下がサブタスク。
//   2. 見出し直後の「- キー: 値」がメタ情報。
//   3. 残りはすべて詳細メモ（HTML化して description に入る）。
// 行レベルの処理は mdImport/parseCommon と共有し、ここはタスク固有の項目
// （3つのステータス・優先度・分類・担当者・日程）の解釈だけを担う。
//
// チケットとの違い:
//   ・ステータスは 未着手 / 進行中 / 完了 の3つだけ
//   ・分類はプロジェクトのマスタではなく自由入力（複数可）。区切り文字で分ける
//   ・見積工数は持たない（タスクは軽い記録なので、時間は追わない）
import {
  splitMdSections, extractMeta, bodyToDescription,
  normalizeValue, parseDate, parsePriority, matchMember,
  MD_PRIORITY_LABELS, type MdSection,
} from "@/app/lib/mdImport/parseCommon";
import type { TaskStatus } from "@/app/types";
import type { ParsedTask, ParseWarning, ParseResult, ParseContext } from "./types";

// ── 値の候補 ──────────────────────────────────────────────────────────────

export const MD_TASK_STATUS_LABELS = ["未着手", "進行中", "完了"] as const;
export { MD_PRIORITY_LABELS };

const STATUS_BY_LABEL: Record<string, TaskStatus> = {
  "未着手": "todo",
  "進行中": "in-progress",
  "完了": "done",
  // 表記ゆれ・チケット側のラベル・英語の受け皿。
  // レビュー中などチケットにしか無い状態は「進行中」に寄せる（タスクは3状態しかない）
  "未対応": "todo",
  "todo": "todo",
  "notstarted": "todo",
  "not-started": "todo",
  "backlog": "todo",
  "作業中": "in-progress",
  "対応中": "in-progress",
  "着手": "in-progress",
  "レビュー中": "in-progress",
  "inprogress": "in-progress",
  "doing": "in-progress",
  "wip": "in-progress",
  "review": "in-progress",
  "inreview": "in-progress",
  "完了済み": "done",
  "済": "done",
  "クローズ": "done",
  "done": "done",
  "closed": "done",
  "complete": "done",
  "completed": "done",
  "finished": "done",
};

type MetaField = "status" | "priority" | "categories" | "assignee" | "startDate" | "dueDate";

/** メタのキー名 → 内部フィールド名 */
const META_KEYS: Record<string, MetaField> = {
  "ステータス": "status", "状態": "status", "status": "status",
  "優先度": "priority", "priority": "priority",
  "分類": "categories", "カテゴリ": "categories", "カテゴリー": "categories",
  "種別": "categories", "タグ": "categories", "category": "categories", "categories": "categories", "tag": "categories", "tags": "categories",
  "担当者": "assignee", "担当": "assignee", "assignee": "assignee", "owner": "assignee",
  "開始日": "startDate", "開始": "startDate", "start": "startDate", "startdate": "startDate",
  "期限日": "dueDate", "期限": "dueDate", "締切": "dueDate", "終了日": "dueDate", "due": "dueDate", "duedate": "dueDate",
};

/** AI用プロンプトに出す、メタとして使えるキーの表示名 */
export const MD_TASK_META_KEY_LABELS = ["ステータス", "優先度", "分類", "担当者", "開始日", "期限日"] as const;

/** 分類の区切り。読点・カンマ・中黒・スラッシュ・セミコロンで分ける（空白では分けない） */
const CATEGORY_SPLIT_RE = /[,、，・;；/／|｜]/;

/**
 * 「バグ, 調査」のような1行を分類の要素へ分ける。
 * 既に使われている分類と綴りが同じなら、そちらの表記に寄せる（表記ゆれを増やさない）。
 */
function parseCategories(raw: string, options: string[]): string[] {
  const out: string[] = [];
  for (const part of raw.split(CATEGORY_SPLIT_RE)) {
    const name = part.trim().replace(/^[#＃]/, "").trim();
    if (!name) continue;
    const key = normalizeValue(name);
    const known = options.find(o => normalizeValue(o) === key);
    const value = known ?? name;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

// ── 本体 ──────────────────────────────────────────────────────────────────

let uidSeq = 0;

function buildTask(section: MdSection, ctx: ParseContext, warnings: ParseWarning[]): ParsedTask {
  const task: ParsedTask = {
    uid: `mdt-${++uidSeq}`,
    title: section.title,
    status: "todo",
    priority: "medium",
    categories: [],
    assignee: null,
    startDate: null,
    dueDate: null,
    descriptionHtml: null,
    descriptionExcerpt: null,
    filled: {
      status: false, priority: false, categories: false,
      assignee: false, startDate: false, dueDate: false,
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
        if (status) { task.status = status; task.filled.status = true; }
        else warn(`ステータス「${value}」は候補にないため未着手にしました`);
        break;
      }
      case "priority": {
        const priority = parsePriority(value);
        if (priority) { task.priority = priority; task.filled.priority = true; }
        else warn(`優先度「${value}」は候補にないため中にしました`);
        break;
      }
      case "categories": {
        const categories = parseCategories(value, ctx.categoryOptions);
        if (categories.length > 0) { task.categories = categories; task.filled.categories = true; }
        break;
      }
      case "assignee": {
        const member = matchMember(value, ctx.memberNames);
        if (member) { task.assignee = member; task.filled.assignee = true; }
        else warn(`担当者「${value}」はメンバーに見つからないため未割当にしました`);
        break;
      }
      case "startDate": {
        const date = parseDate(value);
        if (date) { task.startDate = date; task.filled.startDate = true; }
        else warn(`開始日「${value}」を日付として読めませんでした`);
        break;
      }
      case "dueDate": {
        const date = parseDate(value);
        if (date) { task.dueDate = date; task.filled.dueDate = true; }
        else warn(`期限日「${value}」を日付として読めませんでした`);
        break;
      }
    }
  }

  if (task.startDate && task.dueDate && task.dueDate < task.startDate) {
    warn("期限日が開始日より前です");
  }

  const { html, excerpt } = bodyToDescription(bodyLines);
  task.descriptionHtml = html;
  task.descriptionExcerpt = excerpt;

  return task;
}

/**
 * Markdown テキストをタスクの配列へ変換する。
 * 取り込みをブロックする失敗は無く、読めなかった項目は warnings に積んで空欄で返す。
 */
export function mdTextToTasks(text: string, ctx: ParseContext): ParseResult {
  const warnings: ParseWarning[] = [];
  const sections = splitMdSections(text, key => !!META_KEYS[key]);
  if (sections.length === 0) return { tasks: [], warnings };

  const tasks: ParsedTask[] = [];
  for (const section of sections) {
    if (!section.title) {
      warnings.push({ ticketTitle: null, message: "タイトルが空の見出しがあったため除外しました" });
      continue;
    }
    const task = buildTask(section, ctx, warnings);

    if (!section.isChild) {
      tasks.push(task);
      continue;
    }
    // 子見出しだが親がまだ無い（＝いきなり ### から始まった）場合は親として扱う
    const parent = tasks[tasks.length - 1];
    if (parent) parent.children.push(task);
    else tasks.push(task);
  }

  return { tasks, warnings };
}

/** 親子構造を解いて、すべて親タスクとして1列に並べ直す（確認画面の階層トグル用） */
export function flattenTasks(tasks: ParsedTask[]): ParsedTask[] {
  const out: ParsedTask[] = [];
  for (const t of tasks) {
    out.push({ ...t, children: [] });
    for (const c of t.children) out.push({ ...c, children: [] });
  }
  return out;
}

/** 親＋サブタスクの総数 */
export function countTasks(tasks: ParsedTask[]): number {
  return tasks.reduce((n, t) => n + 1 + t.children.length, 0);
}
