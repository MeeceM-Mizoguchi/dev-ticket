// KAIZEN2611-016 インポートの「変わったところだけ反映する」。
//
// ファイルの行（wbsImport.ts の parseWbsTable の結果）を、「ID」の列で今の行と結びつけ、
// 違うところだけを DB の関数 wbs_api_apply に渡す形の操作（wbsDiff.ts の WbsDiffOp）にする。
// 比べる画面（WbsDiffView）は、この操作を buildWbsDiff に渡して新旧を出す。
//
//   ・ID が今の行と一致する行 … 項目・担当者・開始予定日・終了予定日・進捗率・ステータス・チケット・備考を比べ、
//     違う項目だけを変える。大項目・中項目の行は項目名だけ。進捗率は一番右の段の行だけ
//   ・ID が空の行 … 足す行（ファイルの並びの位置で、上の段の行の下に足す）
//   ・ID がこの WBS に無い行（別の WBS の ID・書き換えられた ID） … 反映せず warnings
//   ・今の WBS にあってファイルに無い行 … 消さない。warnings に件数
//   ・段・親が変わった行（行の移動） … 反映せず warnings
//
// Excel では日付・数値の書式が変わって読まれることがあるので、比べる前に形をそろえる
// （日付は YYYY-MM-DD、進捗は整数、空は空文字）。チケットは番号の並びが違うだけなら「変わらない」。
import type { WbsItem, WbsStatus } from "@/app/types";
import type { WbsImportItem } from "@/app/lib/wbsImport";
import type { WbsDiffOp } from "@/app/lib/wbsDiff";
import { WBS_LEVEL_LABELS, WBS_SORT_GAP } from "@/app/lib/wbsService";

function normDate(v: string | null | undefined): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(v ?? "").trim());
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : String(v ?? "").trim();
}
const normText = (v: string | null | undefined) => String(v ?? "").trim();

export interface WbsImportDiffResult {
  ops: WbsDiffOp[];
  warnings: string[];
}

export function buildWbsImportDiff(input: {
  fileItems: WbsImportItem[];
  items: WbsItem[];
  statuses: WbsStatus[];
  levels: number;
  /** 行の id → 紐づいたチケットの id */
  links: Map<string, string[]>;
  /** チケット番号 → チケットの id（このプロジェクトのもの） */
  ticketIdByNumber: ReadonlyMap<string, string>;
}): WbsImportDiffResult {
  const { fileItems, items, statuses, levels, links, ticketIdByNumber } = input;
  const ops: WbsDiffOp[] = [];
  const warnings: string[] = [];
  const current = new Map(items.map(i => [i.id, i]));
  const statusIdByName = new Map(statuses.map(s => [s.name, s.id]));
  const statusNameById = new Map(statuses.map(s => [s.id, s.name]));
  const firstStatus = statuses[0] ?? null;
  const statusNameOf = (id: string | null) => (id && statusNameById.get(id)) || firstStatus?.name || "";
  const ticketWbsById = new Map([...ticketIdByNumber].map(([n, id]) => [id, n]));

  // ファイルの行（parseWbsTable が振った仮の id）→ 今の WBS の行の id（結びついた行・足す行）。
  // 反映しない行は skipped に入れ、その下の行もどこに置くか決められないので反映しない
  const resolved = new Map<string, string>();
  const skipped = new Set<string>();
  const seen = new Set<string>();
  const unknownTickets = new Set<string>();
  const unknownStatuses = new Set<string>();

  // 並び順は、足した行も含めて今の状態で計算する（同じ親の下に続けて足すとき、前に足した行の後ろへ置く）
  const order = new Map(items.map(i => [i.id, { parentId: i.parentId ?? null, sortOrder: i.sortOrder }]));
  const siblings = (parentId: string | null) => [...order].filter(([, v]) => v.parentId === parentId)
    .sort((a, b) => a[1].sortOrder - b[1].sortOrder || a[0].localeCompare(b[0]));
  // ファイルの中で、親ごとに直前に出てきた行（今の行の id）
  const lastInFile = new Map<string | null, string>();

  const where = (f: WbsImportItem) => `${f.line}行目（「${f.name}」）`;

  /** ファイルのチケット番号を、紐づけるチケットの id にする（このプロジェクトに無い番号は外して知らせる） */
  const fileTicketIds = (f: WbsImportItem): string[] => {
    const out: string[] = [];
    for (const n of f.ticketNumbers) {
      const id = ticketIdByNumber.get(n);
      if (id) out.push(id); else unknownTickets.add(n);
    }
    return [...new Set(out)];
  };

  /** ファイルのステータスの名前を id にする。"" は先頭のステータス。無い名前は undefined（変えない） */
  const fileStatusId = (f: WbsImportItem): string | null | undefined => {
    if (!f.statusName) return firstStatus?.id ?? null;
    const id = statusIdByName.get(f.statusName);
    if (!id) { unknownStatuses.add(f.statusName); return undefined; }
    return id;
  };

  for (const f of fileItems) {
    const fileParent = f.parentId;
    if (fileParent && skipped.has(fileParent)) {
      skipped.add(f.id);
      warnings.push(`${where(f)}：上の段の行を反映しないため、この行も反映しません`);
      continue;
    }
    const parentId = fileParent ? (resolved.get(fileParent) ?? null) : null;
    const leaf = f.level >= levels;
    const rowId = normText(f.fileRowId);

    if (rowId) {
      const cur = current.get(rowId);
      if (!cur) {
        skipped.add(f.id);
        warnings.push(`${where(f)}：ID「${rowId}」の行がこの WBS にありません（別の WBS の行か、ID が書き換えられています）。反映しません`);
        continue;
      }
      if (seen.has(rowId)) {
        skipped.add(f.id);
        warnings.push(`${where(f)}：ID が前の行と同じです（行をコピーしたときは、ID の列を空にすると足す行になります）。反映しません`);
        continue;
      }
      seen.add(rowId);
      resolved.set(f.id, rowId);
      lastInFile.set(cur.parentId ?? null, rowId);
      if (cur.level !== f.level || (cur.parentId ?? null) !== parentId) {
        // 行の移動はしない。下の行は、今の行の下にあるものとして比べ続ける
        warnings.push(`${where(f)}：段か、属している上の段の行が変わっています。行の移動は反映しません（移すときは画面の「行を移動」を使ってください）`);
        continue;
      }

      const set: Record<string, unknown> = {};
      if (normText(f.name) !== normText(cur.name)) set.name = normText(f.name);
      if (leaf) {
        if (normText(f.assignee) !== normText(cur.assignee)) set.assignee = normText(f.assignee);
        if (normDate(f.startDate) !== normDate(cur.startDate)) set.start_date = normDate(f.startDate) || null;
        if (normDate(f.endDate) !== normDate(cur.endDate)) set.end_date = normDate(f.endDate) || null;
        if (Math.round(f.progress) !== Math.round(cur.progress)) set.progress = Math.round(f.progress);
        const sid = fileStatusId(f);
        if (sid !== undefined && (f.statusName || firstStatus?.name || "") !== statusNameOf(cur.statusId)) set.status_id = sid;
        if (normText(f.note) !== normText(cur.note)) set.note = f.note;
      }
      if (Object.keys(set).length > 0) ops.push({ t: "update", id: rowId, set });

      if (leaf) {
        const want = new Set(fileTicketIds(f));
        const have = new Set(links.get(rowId) ?? []);
        for (const t of want) if (!have.has(t)) ops.push({ t: "link", item_id: rowId, ticket_id: t, ticket_wbs: ticketWbsById.get(t) });
        for (const t of have) if (!want.has(t)) ops.push({ t: "unlink", item_id: rowId, ticket_id: t, ticket_wbs: ticketWbsById.get(t) });
      }
      continue;
    }

    // ── ID が空の行：足す行 ──
    if (f.level > 1 && !parentId) {
      skipped.add(f.id);
      warnings.push(`${where(f)}：どの${WBS_LEVEL_LABELS[f.level - 2]}の下に足すかが分かりません。反映しません`);
      continue;
    }
    // ファイルで直前にある同じ親の下の行の後ろに置く。無ければ、同じ親の下の先頭に置く
    const sibs = siblings(parentId);
    const prev = lastInFile.get(parentId);
    let sortOrder: number;
    const idx = prev ? sibs.findIndex(([id]) => id === prev) : -1;
    if (idx >= 0) {
      const next = sibs[idx + 1];
      sortOrder = next ? (sibs[idx][1].sortOrder + next[1].sortOrder) / 2 : sibs[idx][1].sortOrder + WBS_SORT_GAP;
    } else {
      sortOrder = sibs.length ? sibs[0][1].sortOrder - WBS_SORT_GAP : 0;
    }
    const id = crypto.randomUUID();
    const sid = leaf ? fileStatusId(f) : undefined;
    ops.push({
      t: "insert", id, parent_id: parentId, level: f.level, name: normText(f.name),
      assignee: leaf ? normText(f.assignee) : "",
      start_date: leaf ? (normDate(f.startDate) || null) : null,
      end_date: leaf ? (normDate(f.endDate) || null) : null,
      progress: leaf ? Math.round(f.progress) : 0,
      status_id: sid ?? firstStatus?.id ?? null,
      note: leaf ? f.note : "",
      sort_order: sortOrder,
    });
    order.set(id, { parentId, sortOrder });
    resolved.set(f.id, id);
    lastInFile.set(parentId, id);
    if (leaf) for (const t of fileTicketIds(f)) ops.push({ t: "link", item_id: id, ticket_id: t, ticket_wbs: ticketWbsById.get(t) });
  }

  const missing = items.filter(i => !seen.has(i.id)).length;
  if (missing > 0) warnings.push(`ファイルに無い行が ${missing} 件あります（消しません。消すときは画面で削除してください）`);
  if (unknownStatuses.size > 0) {
    warnings.push(`この WBS に無いステータスは反映しません（ステータスは今のまま・足す行は先頭のステータス）：${[...unknownStatuses].join("、")}`);
  }
  if (unknownTickets.size > 0) {
    const list = [...unknownTickets];
    warnings.push(`このプロジェクトに無いチケット番号は紐づけません：${list.slice(0, 10).join("、")}${list.length > 10 ? ` ほか${list.length - 10}件` : ""}`);
  }
  return { ops, warnings };
}
