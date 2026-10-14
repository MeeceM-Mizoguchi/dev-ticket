// ENHA2-053 WBSのインポート（Excel / CSV → 行）の読み取り。
//
// ここはファイルの形式に依らない部分だけを持つ（表を「セルの2次元配列」として受け取り、
// 追加する行の一覧にする）。Excel の読み書きそのものは lib/wbsExcel.ts。
//
// ファイルの形（テンプレートと、画面からエクスポートしたファイルで共通。画面と同じ並び）:
//   見出しの行に「No.／段／項目／担当者／開始予定日／終了予定日／予定日数／進捗率／ステータス／チケット／備考」
//   がある表。見出しは名前で探すので、列の順番が違っても、関係ない列（No.・予定日数・ガント）が
//   混ざっていてもよい。見出しより上の行（題名など）は読み飛ばす。
//
// 1行が1つの項目。「段」の列（大／中／小）で、その行がどの段かを決める。
//   大 → 大項目。中 → 直前の大項目の下の中項目。小 → 直前の中項目の下の小項目。
// 一番右の段より上の行（3段なら大項目・中項目）は見出し行で、名前だけを読む
// （画面でも、見出し行には担当者・日付・ステータスなどを出さない）。
// 「段」が空の行はエラーにする（字下げなどから段を推測しない）。
//
// 以前の形（「大項目／中項目／小項目」を3列に分けた表）も、そのまま読める。
import { parseHolidayDate } from "@/app/lib/wbsHolidayCsv";

/** 読み取った1セル。Excel の日付・数値は、文字にする前の値も持つ */
export interface WbsFileCell {
  text: string;
  /** Excel で日付だったセル（YYYY-MM-DD） */
  date?: string;
  /** Excel で数値だったセル */
  num?: number;
  /** Excel でパーセント表示だったセル（0.5 = 50%） */
  percent?: boolean;
}

/** 追加する行。id は取り込みの前に採番しておく（親子を1回でまとめて登録するため） */
export interface WbsImportItem {
  id: string;
  parentId: string | null;
  level: number;
  name: string;
  assignee: string;
  startDate: string;
  endDate: string;
  progress: number;
  /** ステータスの名前。"" は先頭のステータス */
  statusName: string;
  note: string;
  /** 紐づけるチケット番号 */
  ticketNumbers: string[];
}

export interface WbsImportResult {
  items: WbsImportItem[];
  /** 取り込めない理由。1つでもあれば取り込まない */
  errors: string[];
  /** 取り込めるが、知らせておきたいこと */
  warnings: string[];
  /** このWBSにまだ無いステータスの名前（取り込むときに追加する） */
  newStatuses: string[];
  /** 段ごとの行数（添字は level - 1） */
  counts: [number, number, number];
}

/** ファイルの見出し。テンプレート・エクスポートの列の並びにも使う（画面の表と同じ並び） */
export const WBS_FILE_HEADERS = ["No.", "段", "項目", "担当者", "開始予定日", "終了予定日", "予定日数", "進捗率", "ステータス", "チケット", "備考"] as const;

/** 「段」の列に書く文字。添字は level - 1 */
export const WBS_FILE_LEVEL_MARKS = ["大", "中", "小"] as const;

type Field = "level" | "name" | "l1" | "l2" | "l3" | "assignee" | "start" | "end" | "progress" | "status" | "tickets" | "note";

/** 見出しの書き方のゆれ。空白と全角・半角の違いは比べる前に落とす */
const HEADER_ALIASES: Record<Field, string[]> = {
  level: ["段", "階層", "レベル"],
  name: ["項目", "項目名", "名前"],
  // 以前の形（3列に分けた表）
  l1: ["大項目", "大分類"],
  l2: ["中項目", "中分類"],
  l3: ["小項目", "小分類", "タスク", "タスク名"],
  assignee: ["担当者", "担当"],
  start: ["開始予定日", "開始日", "開始"],
  end: ["終了予定日", "終了日", "終了", "期限", "期限日"],
  progress: ["進捗率", "進捗", "進捗率(%)", "進捗(%)"],
  status: ["ステータス", "状態"],
  tickets: ["チケット", "チケット番号"],
  note: ["備考", "メモ"],
};

const LEVEL_LABELS = ["大項目", "中項目", "小項目"];
const MAX_ERRORS = 30;

function norm(s: string): string {
  return s.replace(/[\s　]/g, "").replace(/（/g, "(").replace(/）/g, ")").replace(/％/g, "%");
}

function newId(): string {
  return crypto.randomUUID();
}

/** 「段」のセルを 1〜3 にする。空は 0、読めなければ null */
function parseLevelMark(raw: string): number | null {
  const s = norm(raw).replace(/[１-３]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  if (s === "") return 0;
  if (["大", "大項目", "大分類", "1"].includes(s)) return 1;
  if (["中", "中項目", "中分類", "2"].includes(s)) return 2;
  if (["小", "小項目", "小分類", "3"].includes(s)) return 3;
  return null;
}

/** 進捗率を 0〜100 の整数にする。空は 0。読めなければ null */
function parseProgress(cell: WbsFileCell | undefined): number | null {
  if (!cell || cell.text.trim() === "" || cell.text.trim() === "—" || cell.text.trim() === "-") return 0;
  let v: number;
  if (cell.num !== undefined) {
    v = cell.percent ? cell.num * 100 : cell.num;
  } else {
    const m = /^(\d+(?:\.\d+)?)\s*[%％]?$/.exec(cell.text.trim());
    if (!m) return null;
    v = Number(m[1]);
  }
  if (!Number.isFinite(v) || v < 0 || v > 100) return null;
  return Math.round(v);
}

/** 日付を YYYY-MM-DD にする。空は ""。読めなければ null */
function parseDate(cell: WbsFileCell | undefined): string | null {
  if (!cell || cell.text.trim() === "") return "";
  if (cell.date) return cell.date;
  return parseHolidayDate(cell.text);
}

/**
 * 表を、追加する行の一覧にする。
 * levels はそのWBSの段数。statusNames はそのWBSにいまあるステータスの名前。
 */
export function parseWbsTable(table: WbsFileCell[][], levels: number, statusNames: string[]): WbsImportResult {
  const result: WbsImportResult = { items: [], errors: [], warnings: [], newStatuses: [], counts: [0, 0, 0] };
  const error = (msg: string) => { if (result.errors.length < MAX_ERRORS) result.errors.push(msg); else if (result.errors.length === MAX_ERRORS) result.errors.push("…ほかにもエラーがあります。"); };

  // ── 見出しの行を探す（「項目」か「大項目」のセルがある最初の行） ──
  const isHeader = (row: WbsFileCell[]) => row.some(c => HEADER_ALIASES.name.includes(norm(c.text)) || HEADER_ALIASES.l1.includes(norm(c.text)));
  const headerIdx = table.findIndex(isHeader);
  if (headerIdx < 0) {
    result.errors.push("見出しの行（「項目」の列）が見つかりません。テンプレートをダウンロードして、その形に合わせてください。");
    return result;
  }
  const col: Partial<Record<Field, number>> = {};
  table[headerIdx].forEach((c, i) => {
    const label = norm(c.text);
    for (const f of Object.keys(HEADER_ALIASES) as Field[]) {
      if (col[f] === undefined && HEADER_ALIASES[f].map(norm).includes(label)) col[f] = i;
    }
  });
  const get = (row: WbsFileCell[], f: Field): WbsFileCell | undefined => (col[f] === undefined ? undefined : row[col[f]!]);
  const text = (row: WbsFileCell[], f: Field): string => (get(row, f)?.text ?? "").trim();
  // 「項目」の列があればいまの形、無ければ以前の形（大項目／中項目／小項目の3列）
  const single = col.name !== undefined;

  const known = new Set(statusNames);
  const fresh = new Set<string>();
  // いま読んでいる位置の、各段の行（添字は level - 1）。implicit = 名前から自動で作っただけの行
  const cur: ({ item: WbsImportItem; implicit: boolean } | null)[] = [null, null, null];

  const create = (level: number, name: string, implicit: boolean) => {
    const item: WbsImportItem = {
      id: newId(), parentId: level > 1 ? cur[level - 2]!.item.id : null, level, name,
      assignee: "", startDate: "", endDate: "", progress: 0, statusName: "", note: "", ticketNumbers: [],
    };
    result.items.push(item);
    result.counts[level - 1]++;
    cur[level - 1] = { item, implicit };
    for (let i = level; i < 3; i++) cur[i] = null;
    return item;
  };

  /** 担当者・日付・進捗率・ステータス・チケット・備考を、その行の項目に入れる */
  const readDetails = (row: WbsFileCell[], item: WbsImportItem, line: number) => {
    item.assignee = text(row, "assignee");
    item.note = text(row, "note");

    const start = parseDate(get(row, "start"));
    const end = parseDate(get(row, "end"));
    if (start === null) error(`${line}行目：開始予定日「${text(row, "start")}」を日付として読めません（例：2026/10/12）。`);
    if (end === null) error(`${line}行目：終了予定日「${text(row, "end")}」を日付として読めません（例：2026/10/12）。`);
    if (start && end && end < start) error(`${line}行目：終了予定日が開始予定日より前になっています。`);
    item.startDate = start ?? "";
    item.endDate = end ?? "";

    // 進捗率を持つのは一番右の段の行だけ。それより左の段は画面で自動計算するので読まない
    if (item.level === levels) {
      const p = parseProgress(get(row, "progress"));
      if (p === null) error(`${line}行目：進捗率「${text(row, "progress")}」を 0〜100 の数字として読めません。`);
      item.progress = p ?? 0;
    }

    const status = text(row, "status");
    item.statusName = status;
    if (status && !known.has(status)) fresh.add(status);

    item.ticketNumbers = text(row, "tickets").split(/[,、\s]+/).map(s => s.trim()).filter(Boolean);
  };

  const hasDetails = (row: WbsFileCell[]) => (["assignee", "start", "end", "status", "note"] as Field[]).some(f => text(row, f) !== "");

  for (let r = headerIdx + 1; r < table.length; r++) {
    const row = table[r];
    const line = r + 1;   // ファイル上の行番号（1始まり）

    if (single) {
      // ── いまの形：「段」と「項目」 ──
      const name = text(row, "name");
      if (!name) {
        if (hasDetails(row)) result.warnings.push(`${line}行目：項目の名前が無いため、読み飛ばしました。`);
        continue;
      }
      const level = parseLevelMark(text(row, "level"));
      if (level === null) { error(`${line}行目：段「${text(row, "level")}」を読めません。大・中・小のどれかを入れてください。`); continue; }
      // 段が空の行は取り込まない。字下げなどから推測すると、段を入れ忘れただけの行が
      // 黙って大項目として入ってしまう
      if (level === 0) { error(`${line}行目：段が空です。大・中・小のどれかを入れてください。`); continue; }
      if (level > levels) {
        error(`${line}行目：このWBSは${levels}段のため、${LEVEL_LABELS[level - 1]}は取り込めません（先にWBSの段数を増やしてください）。`);
        continue;
      }
      if (level > 1 && !cur[level - 2]) {
        error(`${line}行目：${LEVEL_LABELS[level - 1]}の前に、${LEVEL_LABELS[level - 2]}の行がありません（どこに属するかが分かりません）。`);
        continue;
      }
      const item = create(level, name, false);
      // 一番右の段より上の行は見出し行。名前だけを読む
      if (level === levels) readDetails(row, item, line);
      continue;
    }

    // ── 以前の形：大項目／中項目／小項目の3列。いちばん右に名前が入っている段が、その行の項目 ──
    const names = [text(row, "l1"), text(row, "l2"), text(row, "l3")];
    let depth = 0;
    names.forEach((n, i) => { if (n) depth = i + 1; });
    if (depth === 0) {
      if (hasDetails(row)) result.warnings.push(`${line}行目：項目の名前が無いため、読み飛ばしました。`);
      continue;
    }
    if (depth > levels) {
      error(`${line}行目：このWBSは${levels}段のため、${LEVEL_LABELS[depth - 1]}は取り込めません（先にWBSの段数を増やしてください）。`);
      continue;
    }
    // 上の段をそろえる（空欄は「上の行と同じ」。無ければ名前から作る）
    let broken = false;
    for (let lv = 1; lv < depth; lv++) {
      const given = names[lv - 1];
      const now = cur[lv - 1];
      if (!given) {
        if (!now) { error(`${line}行目：${LEVEL_LABELS[lv - 1]}が空で、上の行にもありません（${LEVEL_LABELS[depth - 1]}がどこに属するかが分かりません）。`); broken = true; break; }
        continue;
      }
      if (!now || now.item.name !== given) create(lv, given, true);
    }
    if (broken) continue;

    const name = names[depth - 1];
    const same = cur[depth - 1];
    // 直前に名前から自動で作った行と同じ名前なら、その行の中身として扱う（二重に作らない）
    const item = same && same.implicit && same.item.name === name
      ? (same.implicit = false, same.item)
      : create(depth, name, false);
    if (depth === levels) readDetails(row, item, line);
  }

  result.newStatuses = [...fresh];
  if (result.items.length === 0 && result.errors.length === 0) {
    result.errors.push("取り込める行がありません。見出しの下に、項目の名前を入れてください。");
  }
  return result;
}
