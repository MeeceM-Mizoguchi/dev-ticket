// BRU20-008-2 WBSの表の、列ごとの絞り込み。
//
// 列の見出し（ColumnFilter）でチェックした値の行だけを表に出す。
//   ・値で判定するのは一番右の段の行だけ（見出し行は、担当者・日付などの欄を持たないため）。
//   ・合った行の上の見出し行（大項目・中項目）は一緒に出す。合う行が1つも無い見出し行は隠す。
//   ・「項目」の列だけは見出し行の名前も選べる。選んだ見出しの下の行は、まとめて出す。
// 絞り込みは保存しない（WBSを切り替える・画面を開き直すと解除される）。
import { businessDays, type WbsRow } from "@/app/lib/wbsCalc";
import type { WbsStatus } from "@/app/types";
import type { ColumnFilterOption } from "@/app/components/shared/ColumnFilter";

/** 絞り込める列。チェックボックスの列と No. の列には付けない */
export type WbsFilterCol = "name" | "assignee" | "start" | "end" | "days" | "progress" | "status" | "tickets" | "note";
export const WBS_FILTER_COLS: readonly WbsFilterCol[] = ["name", "assignee", "start", "end", "days", "progress", "status", "tickets", "note"];

/** 列ごとにチェックした値。空、または列が無いときは、その列では絞り込まない */
export type WbsFilters = Partial<Record<WbsFilterCol, Set<string>>>;

/** 空欄（チケットの列では「なし」）を表す値。行の値と重ならない文字にする */
const BLANK = "\u0000blank";

export interface WbsFilterCtx {
  statuses: WbsStatus[];
  /** 担当者に選べる人（プロジェクトのメンバーの名前） */
  members: string[];
  holidays: ReadonlySet<string>;
  /** その行に紐づいたチケット番号 */
  ticketNumbersOf: (itemId: string) => string[];
}

/** 行のその列の値（一覧の value と同じ形）。どれか1つがチェックされていれば合う */
function cellValues(col: Exclude<WbsFilterCol, "name">, row: WbsRow, ctx: WbsFilterCtx): string[] {
  const { item } = row;
  switch (col) {
    case "assignee": return [item.assignee || BLANK];
    case "start": return [item.startDate || BLANK];
    case "end": return [item.endDate || BLANK];
    case "days": {
      const d = businessDays(item.startDate, item.endDate, ctx.holidays);
      return d === null ? [] : [String(d)];
    }
    case "progress": return [String(item.progress)];
    case "status": {
      // status_id が空の行は、先頭のステータスとして扱う（表の表示と同じ）
      const s = ctx.statuses.find(x => x.id === item.statusId) ?? ctx.statuses[0];
      return s ? [s.id] : [];
    }
    case "tickets": {
      const nums = ctx.ticketNumbersOf(item.id);
      return nums.length ? nums : [BLANK];
    }
    case "note": return [item.note || BLANK];
  }
}

const unique = (values: string[]) => [...new Set(values)];
const byNumber = (a: string, b: string) => Number(a) - Number(b);

/** 列ごとの、一覧に出す値 */
export function wbsFilterOptions(rows: WbsRow[], ctx: WbsFilterCtx): Record<WbsFilterCol, ColumnFilterOption[]> {
  const leaves = rows.filter(r => r.isLeafLevel);
  const values = (col: Exclude<WbsFilterCol, "name">) => unique(leaves.flatMap(r => cellValues(col, r, ctx))).filter(v => v !== BLANK);
  const blank = (label: string): ColumnFilterOption => ({ value: BLANK, label });
  const dates = (col: "start" | "end") => [
    ...values(col).sort().map(v => ({ value: v, label: v.replace(/-/g, "/") })),
    blank("（空欄）"),
  ];
  // プロジェクトから外れた人が担当のままの行も、選べるようにする
  const assignees = unique([...ctx.members, ...values("assignee")]);
  return {
    name: unique(rows.map(r => r.item.name).filter(Boolean)).map(v => ({ value: v, label: v })),
    assignee: [...assignees.map(v => ({ value: v, label: v })), blank("（空欄）")],
    start: dates("start"),
    end: dates("end"),
    days: values("days").sort(byNumber).map(v => ({ value: v, label: v })),
    progress: values("progress").sort(byNumber).map(v => ({ value: v, label: `${v}%` })),
    // ステータス設定の順で、すべて
    status: ctx.statuses.map(s => ({ value: s.id, label: s.name })),
    tickets: [
      ...values("tickets").sort((a, b) => a.localeCompare(b, "ja", { numeric: true })).map(v => ({ value: v, label: v })),
      blank("（なし）"),
    ],
    note: [...values("note").map(v => ({ value: v, label: v })), blank("（空欄）")],
  };
}

/** 絞り込みで表に出す行の id。どの列でも絞り込んでいないときは null */
export function filterWbsRows(rows: WbsRow[], filters: WbsFilters, ctx: WbsFilterCtx): ReadonlySet<string> | null {
  const active = WBS_FILTER_COLS.filter(c => (filters[c]?.size ?? 0) > 0);
  if (active.length === 0) return null;
  const byId = new Map(rows.map(r => [r.item.id, r]));

  // 「項目」は、その行か上の見出し行の名前が選ばれていれば合う
  const names = filters.name;
  const nameHit = (row: WbsRow) => {
    if (!names?.size) return true;
    for (let r: WbsRow | undefined = row; r; r = r.item.parentId ? byId.get(r.item.parentId) : undefined) {
      if (names.has(r.item.name)) return true;
    }
    return false;
  };
  const others = active.filter((c): c is Exclude<WbsFilterCol, "name"> => c !== "name");

  const shown = new Set<string>();
  for (const row of rows) {
    const hit = row.isLeafLevel
      ? nameHit(row) && others.every(c => cellValues(c, row, ctx).some(v => filters[c]!.has(v)))
      // 見出し行は「項目」だけで判定する（下に行が無い見出し行も、名前を選べば出す）
      : others.length === 0 && nameHit(row);
    if (!hit) continue;
    shown.add(row.item.id);
    // 上の見出し行も出す
    for (let p = row.item.parentId; p && !shown.has(p); p = byId.get(p)?.item.parentId ?? null) shown.add(p);
  }
  return shown;
}
