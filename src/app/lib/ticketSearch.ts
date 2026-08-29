import type { Sprint, SprintTicket } from "@/app/types";
import { TICKET_STATUSES, calcTicketActualHours, compareWbs, formatDate, formatPersonDays, getTicketStatusMeta, htmlToText } from "@/app/lib/helpers";

// ENHA2-048 チケット一覧検索。
// プロジェクト配下の全スプリントのチケットを1枚の表に並べ、上部で選んだ条件で絞り込む。
// 絞り込みの条件と当て方はこのファイルに集約し、画面側は表示だけを持つ。

/** この画面のURL（サブナビ・詳細パネルを閉じたときの戻り先で共有する） */
export const TICKET_SEARCH_PATH = "ticket-search";

// 期間で絞れる日付の種類。日付ごとに独立した「いつから〜いつまで」を持たせる。
// 開始日・期限日は列見出しの絞り込み（値のチェックボックス）で足りるので期間欄は置かない。
export type SearchDateField = "closedDate" | "createdAt";

export const DATE_FIELD_OPTIONS: { value: SearchDateField; label: string }[] = [
  { value: "closedDate", label: "クローズ日" },
  { value: "createdAt", label: "作成日" },
];

/** YYYY-MM-DD。空文字は「指定なし」 */
export interface DateRange { from: string; to: string }

export type DateRanges = Record<SearchDateField, DateRange>;

export interface TicketSearchCriteria {
  /** チケットNo・チケット名・詳細・担当者に対する部分一致 */
  keyword: string;
  /**
   * チケットの作業期間。from は開始日の下限、to は期限日の上限。
   * 「この期間に収まっているチケット」を出すための条件で、片側だけの指定もできる。
   */
  span: DateRange;
  /** 日付の種類ごとの期間。どれも同時に指定でき、指定したものはANDで効く */
  dateRanges: DateRanges;
  statuses: string[];
  priorities: string[];
  /** 担当者名。空文字("")は「未割当」を表す */
  assignees: string[];
  /** 分類名（IDではなく表示名でそろえる。旧データがIDしか持たないため） */
  categories: string[];
  sprintIds: string[];
  /** 子チケットも1行として並べるか */
  includeChildren: boolean;
}

/** まっさらな条件。中に入れ子のオブジェクトを持つので、使うたびに作り直す。 */
export function emptyCriteria(): TicketSearchCriteria {
  return {
    keyword: "",
    span: { from: "", to: "" },
    dateRanges: {
      closedDate: { from: "", to: "" },
      createdAt: { from: "", to: "" },
    },
    statuses: [],
    priorities: [],
    assignees: [],
    categories: [],
    sprintIds: [],
    includeChildren: true,
  };
}

/** 1つでも条件が入っているか（「条件をクリア」ボタンの出し分けに使う） */
export function hasAnyCriteria(c: TicketSearchCriteria): boolean {
  const anyDate = DATE_FIELD_OPTIONS.some(({ value }) => {
    const r = c.dateRanges[value];
    return !!r && (r.from !== "" || r.to !== "");
  });
  const anySpan = c.span.from !== "" || c.span.to !== "";
  return c.keyword.trim() !== "" || anySpan || anyDate
    || c.statuses.length > 0 || c.priorities.length > 0 || c.assignees.length > 0
    || c.categories.length > 0 || c.sprintIds.length > 0 || !c.includeChildren;
}

/** 表の1行。チケット単体では出せない情報（スプリント名・分類名・実績）を添えて持ち回る。 */
export interface TicketSearchRow {
  ticket: SprintTicket;
  sprint: Sprint;
  categoryLabel: string;
  /** チケット詳細の本文（HTMLタグを落としたもの）。キーワード検索で毎回作り直さないよう持たせる */
  descriptionText: string;
  /** クローズ日（YYYY-MM-DD）。未クローズなら "" */
  closedDate: string;
  actualHours: number;
  isChild: boolean;
}

export type SearchSortCol =
  | "wbs" | "title" | "category" | "status" | "priority"
  | "assignee" | "sprint" | "startDate" | "dueDate" | "closedDate" | "actual";

export type SortDir = "asc" | "desc";

/** ISO文字列でも YYYY-MM-DD でも、先頭10文字の日付だけを取り出す。 */
export function toDateOnly(v: string | null | undefined): string {
  return v ? String(v).slice(0, 10) : "";
}

/** 完了とみなす日時（closedAt || releasedAt）。 */
export function closedDateOf(t: SprintTicket): string {
  return toDateOnly(t.closedAt || t.releasedAt);
}

/**
 * バッジ表示と同じ値に寄せたステータス。
 * 子チケットの "closed" などは独立した表示を持たないので、絞り込みも見た目に合わせる。
 */
export function normalizedStatus(t: SprintTicket): string {
  return getTicketStatusMeta(t.status, t.progress).value;
}

/** その行の、指定した種類の日付（YYYY-MM-DD）。入っていなければ "" */
export function dateValueOf(row: TicketSearchRow, field: SearchDateField): string {
  switch (field) {
    case "closedDate": return row.closedDate;
    case "createdAt": return toDateOnly(row.ticket.createdAt);
  }
}

/** 条件に当てはまる行だけを残す。 */
export function filterRows(rows: TicketSearchRow[], c: TicketSearchCriteria): TicketSearchRow[] {
  const kw = c.keyword.trim().toLowerCase();
  const statuses = new Set(c.statuses);
  const priorities = new Set(c.priorities);
  const assignees = new Set(c.assignees);
  const categories = new Set(c.categories);
  const sprintIds = new Set(c.sprintIds);

  return rows.filter(row => {
    const t = row.ticket;
    if (!c.includeChildren && row.isChild) return false;

    if (kw) {
      const haystack = [
        t.wbs, t.title, row.descriptionText, t.assignee, row.sprint.name, row.categoryLabel,
      ].join("\n").toLowerCase();
      if (!haystack.includes(kw)) return false;
    }

    // 開始日〜期限日。左は開始日の下限、右は期限日の上限を見る。
    // 日付が入っていないチケットは、その側を指定した時点で対象外にする。
    if (c.span.from) {
      const v = toDateOnly(t.startDate);
      if (!v || v < c.span.from) return false;
    }
    if (c.span.to) {
      const v = toDateOnly(t.dueDate);
      if (!v || v > c.span.to) return false;
    }

    // 期間は日付の種類ごとに独立。指定されているものだけを見る（複数指定はAND）
    for (const { value: field } of DATE_FIELD_OPTIONS) {
      const r = c.dateRanges[field];
      if (!r || (!r.from && !r.to)) continue;
      const v = dateValueOf(row, field);
      // 日付が入っていないチケットは「期間で絞った」時点で対象外にする
      if (!v) return false;
      if (r.from && v < r.from) return false;
      if (r.to && v > r.to) return false;
    }

    if (statuses.size > 0 && !statuses.has(normalizedStatus(t))) return false;
    if (priorities.size > 0 && !priorities.has(t.priority)) return false;
    if (assignees.size > 0 && !assignees.has(t.assignee || "")) return false;
    if (categories.size > 0 && !categories.has(row.categoryLabel)) return false;
    if (sprintIds.size > 0 && !sprintIds.has(row.sprint.id)) return false;

    return true;
  });
}

// 並び替えの基準値。文字列は localeCompare、数値はそのまま引き算で比べる。
function sortValueOf(row: TicketSearchRow, col: SearchSortCol): string | number {
  const t = row.ticket;
  switch (col) {
    case "wbs": return t.wbs;
    case "title": return t.title;
    case "category": return row.categoryLabel;
    case "status": return getTicketStatusMeta(t.status, t.progress).label;
    // 優先度は「高→中→低」で並べたいので、名前ではなく重みで比べる
    case "priority": return t.priority === "high" ? 3 : t.priority === "medium" ? 2 : 1;
    case "assignee": return t.assignee || "";
    case "sprint": return row.sprint.name;
    case "startDate": return toDateOnly(t.startDate);
    case "dueDate": return toDateOnly(t.dueDate);
    case "closedDate": return row.closedDate;
    case "actual": return row.actualHours;
  }
}

/**
 * 並び替え。未指定(col が空)のときは「スプリントの並び順 → WBSの自然順」。
 * WBSの自然順は子チケット(T-001-2)を親(T-001)の直後に並べるので、既定では親子が隣り合う。
 */
export function sortRows(
  rows: TicketSearchRow[],
  col: SearchSortCol | "",
  dir: SortDir,
  sprintOrderIndex: Map<string, number>,
): TicketSearchRow[] {
  const dirSign = dir === "asc" ? 1 : -1;
  const byDefault = (a: TicketSearchRow, b: TicketSearchRow) => {
    const sa = sprintOrderIndex.get(a.sprint.id) ?? 0;
    const sb = sprintOrderIndex.get(b.sprint.id) ?? 0;
    if (sa !== sb) return sa - sb;
    return compareWbs(a.ticket.wbs, b.ticket.wbs);
  };

  const sorted = [...rows];
  if (!col) {
    sorted.sort(byDefault);
    return sorted;
  }
  sorted.sort((a, b) => {
    const av = sortValueOf(a, col);
    const bv = sortValueOf(b, col);
    let d: number;
    if (typeof av === "number" && typeof bv === "number") d = av - bv;
    else {
      // 空欄は常に末尾へ（昇順/降順どちらでも「未設定が先頭に並ぶ」のを避ける）
      const as = String(av), bs = String(bv);
      if (as === "" && bs !== "") return 1;
      if (bs === "" && as !== "") return -1;
      d = as.localeCompare(bs, "ja");
    }
    return d !== 0 ? d * dirSign : byDefault(a, b);
  });
  return sorted;
}

/** スプリント群から表の行を組み立てる。 */
export function buildRows(
  sprints: Sprint[],
  categoryLabelOf: (t: SprintTicket) => string,
): TicketSearchRow[] {
  return sprints.flatMap(sprint => sprint.tickets.map(ticket => ({
    ticket,
    sprint,
    categoryLabel: categoryLabelOf(ticket),
    descriptionText: htmlToText(ticket.description),
    closedDate: closedDateOf(ticket),
    actualHours: calcTicketActualHours(ticket),
    isChild: !!ticket.parentId,
  })));
}

// ── 列見出しの絞り込み（スプリント一覧の表と同じ操作感） ──────────────
// 上部の条件エリアで絞ったあと、さらに列ごとの値で絞り込む。
// 値そのものは columnValueOf に集約し、候補作り・当て込み・表示ラベルで取り違えないようにする。

/** 列 → 選ばれている値。値が空配列／未設定の列は「絞り込まない」 */
export type ColumnFilters = Partial<Record<SearchSortCol, string[]>>;

export const BLANK_LABEL = "（空白）";

/** その列の生の値。候補の value と突き合わせるのはこの文字列。 */
export function columnValueOf(row: TicketSearchRow, col: SearchSortCol): string {
  const t = row.ticket;
  switch (col) {
    case "wbs": return t.wbs;
    case "title": return t.title;
    case "category": return row.categoryLabel;
    case "status": return normalizedStatus(t);
    case "priority": return t.priority;
    case "assignee": return t.assignee || "";
    // スプリントは同名が作れてしまうのでIDで持つ（表示だけ名前にする）
    case "sprint": return row.sprint.id;
    case "startDate": return toDateOnly(t.startDate);
    case "dueDate": return toDateOnly(t.dueDate);
    case "closedDate": return row.closedDate;
    case "actual": return row.actualHours > 0 ? String(row.actualHours) : "";
  }
}

/** その列の表示ラベル。空欄は「（空白）」に寄せる。 */
export function columnLabelOf(row: TicketSearchRow, col: SearchSortCol): string {
  const t = row.ticket;
  switch (col) {
    case "status": return getTicketStatusMeta(t.status, t.progress).label;
    case "priority": return t.priority === "high" ? "高" : t.priority === "medium" ? "中" : "低";
    case "sprint": return row.sprint.name;
    case "startDate": case "dueDate": case "closedDate": {
      const v = columnValueOf(row, col);
      return v ? formatDate(v) : BLANK_LABEL;
    }
    case "actual": return row.actualHours > 0 ? formatPersonDays(row.actualHours) : BLANK_LABEL;
    default: return columnValueOf(row, col) || BLANK_LABEL;
  }
}

/**
 * 列の絞り込み候補。いま表(上部の条件で絞ったあと)に出ている値だけを並べる。
 * 「（空白）」は末尾、それ以外は日付なら日付順・その他は五十音順。
 */
export function columnOptionsOf(rows: TicketSearchRow[], col: SearchSortCol): { value: string; label: string }[] {
  const byValue = new Map<string, string>();
  rows.forEach(row => {
    const v = columnValueOf(row, col);
    if (!byValue.has(v)) byValue.set(v, columnLabelOf(row, col));
  });
  const hasBlank = byValue.has("");
  byValue.delete("");

  const isDate = col === "startDate" || col === "dueDate" || col === "closedDate";
  const opts = [...byValue.entries()].map(([value, label]) => ({ value, label }));
  if (isDate) opts.sort((a, b) => a.value.localeCompare(b.value));
  else if (col === "wbs") opts.sort((a, b) => compareWbs(a.value, b.value));
  else if (col === "actual") opts.sort((a, b) => Number(a.value) - Number(b.value));
  else if (col === "priority") opts.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.value] ?? 3) - ({ high: 0, medium: 1, low: 2 }[b.value] ?? 3));
  else if (col === "status") {
    const rank = new Map(TICKET_STATUSES.map((s, i) => [s.value, i]));
    opts.sort((a, b) => (rank.get(a.value) ?? 99) - (rank.get(b.value) ?? 99));
  } else opts.sort((a, b) => a.label.localeCompare(b.label, "ja"));

  if (hasBlank) opts.push({ value: "", label: BLANK_LABEL });
  return opts;
}

/** 列の絞り込みを当てる。列どうしはAND、同じ列の複数選択はOR。 */
export function applyColumnFilters(rows: TicketSearchRow[], filters: ColumnFilters): TicketSearchRow[] {
  const active = (Object.entries(filters) as [SearchSortCol, string[] | undefined][])
    .filter(([, vs]) => vs && vs.length > 0)
    .map(([col, vs]) => [col, new Set(vs)] as const);
  if (active.length === 0) return rows;
  return rows.filter(row => active.every(([col, set]) => set.has(columnValueOf(row, col))));
}

/** 1列でも絞り込まれているか */
export function hasColumnFilters(filters: ColumnFilters): boolean {
  return Object.values(filters).some(vs => vs && vs.length > 0);
}
