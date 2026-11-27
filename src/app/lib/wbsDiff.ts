// KAIZEN2611-015 WBS の「比べる画面」に出す、新旧の違いの組み立て。
//
// AI からの更新の案（wbs_proposals.ops）と、インポートの「変わったところだけ反映する」（KAIZEN2611-016）の
// どちらも、DB の関数 wbs_api_apply に渡す形の操作（ops）で変更を持つ。ここでは、今の行にその操作を当てはめて
// 「変えたあとの行」を作り、行ごと・項目ごとに今の値と比べる。画面の部品（WbsDiffView）はこの結果を出すだけ。
//
// 大項目・中項目（一番右の段より上）の行は、いつもの WBS の表と同じく No と項目名だけを出す。
// 名前のほかの値は比べない（画面に出ない値のため。KAIZEN2611-017）。
import type { WbsItem, WbsStatus } from "@/app/types";
import { buildWbsRows, todayStr } from "@/app/lib/wbsCalc";

/** wbs_api_apply（supabase/add_wbs_api_KAIZEN2611-013.sql）に渡す形の操作 */
export type WbsDiffOp =
  | {
    t: "insert"; id: string; parent_id: string | null; level: number; name: string; assignee?: string;
    start_date?: string | null; end_date?: string | null; progress?: number; status_id?: string | null; note?: string; sort_order: number;
  }
  | { t: "update"; id: string; set: Record<string, unknown> }
  | { t: "link" | "unlink"; item_id: string; ticket_id: string; ticket_wbs?: string };

export const WBS_DIFF_FIELDS = ["name", "assignee", "startDate", "endDate", "progress", "status", "tickets", "note"] as const;
export type WbsDiffField = typeof WBS_DIFF_FIELDS[number];

export interface WbsDiffCell { before: string; after: string; changed: boolean }

export interface WbsDiffRow {
  id: string;
  parentId: string | null;
  /** 変えたあとの並びでの連番（いつもの表の No と同じ決め方） */
  no: number;
  level: number;
  /** 一番右の段の行か。違う行は No と項目名だけを出す */
  isLeaf: boolean;
  kind: "added" | "changed" | "same";
  /** 親・並び順が変わる行 */
  moved: boolean;
  cells: Record<WbsDiffField, WbsDiffCell>;
}

export interface WbsDiffModel {
  rows: WbsDiffRow[];
  changedCount: number;
  addedCount: number;
}

/** 日付は YYYY-MM-DD の形にそろえる（Excel から読んだ値・日時の値が混ざっても同じ値として比べるため） */
function normDate(v: unknown): string {
  if (v === null || v === undefined) return "";
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(v).trim());
  if (!m) return String(v).trim();
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

/** 画面に出す日付。「2026/12/05」 */
export function wbsDiffDateText(s: string): string {
  return s ? s.replace(/-/g, "/") : "";
}

export function buildWbsDiff(input: {
  items: WbsItem[];
  statuses: WbsStatus[];
  levels: number;
  /** 行の id → 紐づいたチケットの id */
  links: Map<string, string[]>;
  /** チケットの id → WBS 番号 */
  ticketWbs: Map<string, string>;
  ops: WbsDiffOp[];
}): WbsDiffModel {
  const { statuses, levels, ops } = input;
  const before = new Map(input.items.map(i => [i.id, i]));
  const after = new Map(input.items.map(i => [i.id, { ...i }]));
  const beforeLinks = new Map([...input.links].map(([k, v]) => [k, [...v]]));
  const afterLinks = new Map([...input.links].map(([k, v]) => [k, new Set(v)]));
  const ticketWbs = new Map(input.ticketWbs);
  const added = new Set<string>();
  const moved = new Set<string>();
  const sheetId = input.items[0]?.sheetId ?? "";

  for (const op of ops) {
    if (op.t === "insert") {
      after.set(op.id, {
        id: op.id, sheetId, parentId: op.parent_id ?? null, level: Number(op.level ?? 1),
        name: op.name ?? "", assignee: op.assignee ?? "", startDate: normDate(op.start_date), endDate: normDate(op.end_date),
        progress: Number(op.progress ?? 0), statusId: op.status_id ?? null, note: op.note ?? "", sortOrder: Number(op.sort_order ?? 0),
      });
      added.add(op.id);
    } else if (op.t === "update") {
      const it = after.get(op.id);
      if (!it) continue;
      const s = op.set ?? {};
      if ("name" in s) it.name = String(s.name ?? "");
      if ("assignee" in s) it.assignee = String(s.assignee ?? "");
      if ("start_date" in s) it.startDate = normDate(s.start_date);
      if ("end_date" in s) it.endDate = normDate(s.end_date);
      if ("progress" in s) it.progress = Number(s.progress ?? 0);
      if ("status_id" in s) it.statusId = (s.status_id as string | null) ?? null;
      if ("note" in s) it.note = String(s.note ?? "");
      if ("parent_id" in s) { it.parentId = (s.parent_id as string | null) ?? null; moved.add(op.id); }
      if ("sort_order" in s) { it.sortOrder = Number(s.sort_order ?? 0); moved.add(op.id); }
    } else {
      if (op.ticket_wbs) ticketWbs.set(op.ticket_id, op.ticket_wbs);
      const set = afterLinks.get(op.item_id) ?? new Set<string>();
      afterLinks.set(op.item_id, set);
      if (op.t === "link") set.add(op.ticket_id); else set.delete(op.ticket_id);
    }
  }

  const statusName = new Map(statuses.map(s => [s.id, s.name]));
  const fallback = statuses[0]?.name ?? "";
  const statusOf = (id: string | null) => (id && statusName.get(id)) || fallback;
  // チケットは番号の並びが違うだけなら「変わらない」とする
  const ticketText = (ids: Iterable<string>) =>
    [...ids].map(id => ticketWbs.get(id) ?? "").filter(Boolean).sort((a, b) => a.localeCompare(b, "ja", { numeric: true })).join(", ");

  const valuesOf = (it: WbsItem | undefined, linkIds: Iterable<string>): Record<WbsDiffField, string> => ({
    name: it?.name ?? "",
    assignee: it?.assignee ?? "",
    startDate: normDate(it?.startDate),
    endDate: normDate(it?.endDate),
    progress: it ? String(it.progress ?? 0) : "",
    status: it ? statusOf(it.statusId) : "",
    tickets: ticketText(linkIds),
    note: it?.note ?? "",
  });

  const rowsAfter = buildWbsRows([...after.values()], levels, todayStr(), statuses);
  let changedCount = 0;
  const rows: WbsDiffRow[] = rowsAfter.map(r => {
    const it = r.item;
    const isNew = added.has(it.id);
    const old = valuesOf(isNew ? undefined : before.get(it.id), isNew ? [] : (beforeLinks.get(it.id) ?? []));
    const now = valuesOf(it, afterLinks.get(it.id) ?? []);
    const cells = {} as Record<WbsDiffField, WbsDiffCell>;
    let anyChanged = false;
    for (const f of WBS_DIFF_FIELDS) {
      // 上の段の行は項目名だけを比べる
      const shown = r.isLeafLevel || f === "name";
      const b = shown ? old[f] : "";
      const a = shown ? now[f] : "";
      const changed = !isNew && shown && b !== a;
      if (changed) anyChanged = true;
      cells[f] = { before: b, after: a, changed };
    }
    const isMoved = !isNew && moved.has(it.id);
    const kind: WbsDiffRow["kind"] = isNew ? "added" : (anyChanged || isMoved) ? "changed" : "same";
    if (kind === "changed") changedCount++;
    return { id: it.id, parentId: it.parentId, no: r.no, level: it.level, isLeaf: r.isLeafLevel, kind, moved: isMoved, cells };
  });

  return { rows, changedCount, addedCount: added.size };
}
