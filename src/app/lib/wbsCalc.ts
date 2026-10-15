// ENHA2-053 WBS（作業分解表）の画面側の計算。
//
// 進捗率の自動計算・予定日数・遅延の判定は DB に保存せず、ここで行のデータから計算する。
// BRU20-015 既定のステータス（WBS_DEFAULT_STATUS_NAMES の6つ）は名前を変更できないので、
// その名前で判定してよい。利用者が後から足したステータスは名前が変わりうるので、名前で判定しないこと。
import type { WbsItem, WbsStatus } from "@/app/types";

// ── 既定のステータス ──────────────────────────────────────────

/**
 * 既定のステータスの名前。ステータス設定で名前を変更できない（色・並べ替え・削除はできる）。
 * 新しいWBSの既定ステータス（wbsService.DEFAULT_WBS_STATUSES）もこの6つ。
 */
export const WBS_DEFAULT_STATUS_NAMES = ["未着手", "着手中", "進行中", "完了", "取下", "保留"] as const;

/** 名前を変更できない既定のステータスか */
export function isWbsDefaultStatusName(name: string): boolean {
  return (WBS_DEFAULT_STATUS_NAMES as readonly string[]).includes(name);
}

/** 遅延として扱わないステータスか（取下） */
export function isWbsDelayExemptStatus(name: string): boolean {
  return name === "取下";
}

// ── 日付 ──────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, "0"); }

/** ローカルのタイムゾーンで YYYY-MM-DD にする（toISOString は UTC なので日付がずれる） */
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD をローカルの0時の Date にする。形が違えば null */
export function parseDateStr(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function todayStr(): string { return toDateStr(new Date()); }

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** 土日か、登録した祝日か */
export function isOffDay(d: Date, holidays: ReadonlySet<string>): boolean {
  const dow = d.getDay();
  return dow === 0 || dow === 6 || holidays.has(toDateStr(d));
}

/**
 * 開始予定日〜終了予定日の営業日数（土日と登録した祝日を除く。両端を含む）。
 * どちらかの日付が無いとき・終了が開始より前のときは null（空欄にする）。
 */
export function businessDays(start: string, end: string, holidays: ReadonlySet<string>): number | null {
  const s = parseDateStr(start);
  const e = parseDateStr(end);
  if (!s || !e || e < s) return null;
  let count = 0;
  for (let d = s; d <= e; d = addDays(d, 1)) {
    if (!isOffDay(d, holidays)) count++;
  }
  return count;
}

// ── 行の組み立て ──────────────────────────────────────────────

export interface WbsRow {
  item: WbsItem;
  /** 段に関係なく上から順の連番 */
  no: number;
  /** 大項目・中項目・小項目の列に出す名前。添字は level - 1。自分より下の段は null */
  names: (string | null)[];
  /** 大項目のまとまりの番号（背景を交互に変えるのに使う） */
  group: number;
  /** 下にある行の数（削除の確認に出す） */
  descendantCount: number;
  /** 一番右の段の行か（進捗率を手で入力できる行） */
  isLeafLevel: boolean;
  /**
   * 表示する進捗率。一番右の段は手で入力した値。それより左の段は、下にある
   * 一番右の段の行すべての平均（中項目の平均の平均にはしない）。下に行が無ければ null（「—」）。
   */
  progress: number | null;
  /** 終了予定日を過ぎていて進捗率が100%でない。取下の行（見出し行は配下の一番右の段がすべて取下）は除く */
  delayed: boolean;
  /** 取下の行か。見出し行は、配下に一番右の段の行が1つ以上あり、すべて取下のとき true */
  withdrawn: boolean;
}

/**
 * 行を親と段の情報から木の形に組み立て、上から順に並べる。
 * levels はそのWBSの段数（1〜3）。一番右の段＝ level === levels の行。
 * statuses はそのWBSのステータス（並び順）。取下の行を遅延から外すのに使う。
 * ステータスを選んでいない行は、表の表示と同じく先頭のステータスとして扱う。
 */
export function buildWbsRows(items: WbsItem[], levels: number, today: string, statuses: WbsStatus[]): WbsRow[] {
  const nameOf = new Map(statuses.map(s => [s.id, s.name]));
  const fallback = statuses[0]?.name ?? "";
  const isWithdrawn = (it: WbsItem) => isWbsDelayExemptStatus((it.statusId && nameOf.get(it.statusId)) || fallback);
  const byParent = new Map<string | null, WbsItem[]>();
  const ids = new Set(items.map(i => i.id));
  for (const it of items) {
    // 親が見つからない行（取りこぼし）は大項目の並びに置いて、画面から消えないようにする
    const key = it.parentId && ids.has(it.parentId) ? it.parentId : null;
    const list = byParent.get(key);
    if (list) list.push(it); else byParent.set(key, [it]);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  }

  const rows: WbsRow[] = [];
  let group = -1;

  // 戻り値: その行から下にある「一番右の段の行」の進捗率の一覧と、そのうち取下でない行の数、下の行の数
  const walk = (it: WbsItem, ancestors: string[]): { leaves: number[]; active: number; count: number } => {
    if (ancestors.length === 0) group++;
    const names: (string | null)[] = [null, null, null];
    ancestors.forEach((n, i) => { names[i] = n; });
    names[Math.min(Math.max(it.level, 1), 3) - 1] = it.name;

    const isLeafLevel = it.level >= levels;
    const row: WbsRow = {
      item: it, no: rows.length + 1, names, group,
      descendantCount: 0, isLeafLevel, progress: null, delayed: false, withdrawn: false,
    };
    rows.push(row);

    const leaves: number[] = isLeafLevel ? [it.progress] : [];
    let active = isLeafLevel && !isWithdrawn(it) ? 1 : 0;
    let count = 0;
    for (const child of byParent.get(it.id) ?? []) {
      const r = walk(child, [...ancestors, it.name]);
      count += 1 + r.count;
      if (!isLeafLevel) { leaves.push(...r.leaves); active += r.active; }
    }
    row.descendantCount = count;
    // 進捗率は取下の行も含めて出す（集計と同じ）。外すのは遅延の判定だけ
    row.progress = leaves.length ? Math.round(leaves.reduce((a, b) => a + b, 0) / leaves.length) : null;
    row.withdrawn = leaves.length > 0 && active === 0;
    // 進捗率が出せない行（下に行が無い左の段）は、遅延の判定をしない
    row.delayed = !row.withdrawn && !!it.endDate && it.endDate < today && row.progress !== null && row.progress < 100;
    return { leaves, active, count };
  };

  for (const top of byParent.get(null) ?? []) walk(top, []);
  return rows;
}

/** 同じ親の下にある行を並び順で返す（並べ替え・追加位置の計算に使う） */
export function siblingsOf(items: WbsItem[], parentId: string | null): WbsItem[] {
  return items
    .filter(i => (i.parentId ?? null) === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

// ── 色 ────────────────────────────────────────────────────────

/** 背景色の上に載せる文字色。明るい背景には濃い文字、暗い背景には白 */
export function textColorOn(bg: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(bg || "");
  if (!m) return "#1E293A";
  const [r, g, b] = [m[1], m[2], m[3]].map(h => parseInt(h, 16));
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1E293A" : "#FFFFFF";
}

// ── ガント ────────────────────────────────────────────────────

/** 表示する日数の上限（約3年）。日付の打ち間違いで列が何千本にもならないようにする */
const GANTT_MAX_DAYS = 1100;
/** 表示する月数の下限 */
const GANTT_MIN_MONTHS = 3;

export interface WbsGanttDay {
  /** YYYY-MM-DD */
  str: string;
  /** 日（1〜31） */
  day: number;
  /** 0=日 〜 6=土 */
  dow: number;
  /** 土日か、登録した祝日 */
  off: boolean;
  /** 休日設定で登録した日か（土日とは別。名前が空でも true） */
  isHoliday: boolean;
  /** 登録した休日の名前（登録していない日・名前を付けていない休日は ""） */
  holidayName: string;
  isToday: boolean;
  /** その日に期間がかかっている一番右の段の行の数。土日と祝日は 0 */
  count: number;
}

export interface WbsGanttModel {
  days: WbsGanttDay[];
  /** 年月の見出し。span はその月の列数 */
  months: { label: string; span: number }[];
  /** 最大並行タスク数 */
  maxConcurrent: number;
  /** 負荷状況 */
  loadLabel: string;
  /** 総稼働日数（並行タスク数が1以上の日の数） */
  workingDays: number;
}

/** a から b までの日数（b が後なら正）。UTC で引くので夏時間の影響を受けない */
export function dayDiff(a: Date, b: Date): number {
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
}

/** YYYY-MM-DD がガントの何列目か。範囲の外・形が違うときは null */
export function ganttIndexOf(model: WbsGanttModel, dateStr: string): number | null {
  const first = parseDateStr(model.days[0]?.str ?? "");
  const d = parseDateStr(dateStr);
  if (!first || !d) return null;
  const i = dayDiff(first, d);
  return i < 0 || i >= model.days.length ? null : i;
}

/**
 * ガントに出す日付の並びと、日ごとの並行タスク数を作る。
 * 表示する期間は、行の開始予定日・終了予定日の最小〜最大を含む月の、月初〜月末。
 * 日付の入った行が無いときは今日を含む月から。どちらの場合も、最低3か月ぶんは出す。
 *
 * 日付の最小〜最大ぴったりにすると、日付が1つしか入っていないWBSではガントが1日ぶん
 * （1列）しか出ず、壊れて見える。横にスクロールする余地も無くなる。月の単位に広げ、
 * 最低の長さを決めておくことで、入力し始めの段階でもガントとして読める幅を保つ。
 * holidays は「日付 → 祝日名」。
 */
export function buildWbsGantt(rows: WbsRow[], holidays: ReadonlyMap<string, string>, today: string): WbsGanttModel {
  let min: Date | null = null;
  let max: Date | null = null;
  for (const r of rows) {
    for (const s of [r.item.startDate, r.item.endDate]) {
      const d = parseDateStr(s);
      if (!d) continue;
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }
  }
  if (!min || !max) {
    min = max = parseDateStr(today) ?? new Date();
  }
  // 月初〜月末に広げ、最低 GANTT_MIN_MONTHS か月ぶんになるまで後ろへ伸ばす
  min = new Date(min.getFullYear(), min.getMonth(), 1);
  const monthSpan = (max.getFullYear() - min.getFullYear()) * 12 + (max.getMonth() - min.getMonth()) + 1;
  max = new Date(min.getFullYear(), min.getMonth() + Math.max(monthSpan, GANTT_MIN_MONTHS), 0);
  const length = Math.min(dayDiff(min, max) + 1, GANTT_MAX_DAYS);

  const days: WbsGanttDay[] = [];
  const months: { label: string; span: number }[] = [];
  for (let i = 0; i < length; i++) {
    const d = addDays(min, i);
    const str = toDateStr(d);
    const dow = d.getDay();
    const holidayName = holidays.get(str) ?? "";
    const isHoliday = holidays.has(str);
    days.push({ str, day: d.getDate(), dow, off: dow === 0 || dow === 6 || isHoliday, isHoliday, holidayName, isToday: str === today, count: 0 });
    const label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    const last = months[months.length - 1];
    if (last && last.label === label) last.span++; else months.push({ label, span: 1 });
  }

  // 並行タスク数は一番右の段の行だけで数える（集計と同じ）
  for (const r of rows) {
    if (!r.isLeafLevel) continue;
    const s = parseDateStr(r.item.startDate);
    const e = parseDateStr(r.item.endDate);
    if (!s || !e || e < s) continue;
    const from = Math.max(0, dayDiff(min, s));
    const to = Math.min(length - 1, dayDiff(min, e));
    for (let i = from; i <= to; i++) {
      if (!days[i].off) days[i].count++;
    }
  }

  const maxConcurrent = days.reduce((m, d) => Math.max(m, d.count), 0);
  return {
    days, months, maxConcurrent,
    loadLabel: maxConcurrent >= 3 ? "要調整（高負荷）" : maxConcurrent === 2 ? "適正（並行作業あり）" : "標準（単独作業）",
    workingDays: days.filter(d => d.count >= 1).length,
  };
}

// ── マスタースケジュール ──────────────────────────────────────

export interface WbsMasterRow {
  /** 大項目の行 */
  item: WbsItem;
  /** 大項目だけで数えた連番 */
  no: number;
  /** 下にある一番右の段の行の、最も早い開始予定日（YYYY-MM-DD）。1つも無ければ "" */
  start: string;
  /** 同じく、最も遅い終了予定日。1つも無ければ "" */
  end: string;
  /** 大項目のステータス。一番右の段の行が1つも無ければ null（「—」） */
  status: WbsMasterStatus | null;
  /** 下にある中項目の名前（WBS画面と同じ順）。矢羽根のツールチップに出す */
  children: string[];
}

/** マスタースケジュールに出す大項目のステータス */
export type WbsMasterStatus = "未着手" | "着手中" | "完了" | "完了（一部保留あり）" | "保留";

/**
 * 一番右の段の行のステータスを、判定用の4種類に分ける。
 * 名前を変更できない既定のステータス（WBS_DEFAULT_STATUS_NAMES）の名前で見分ける。
 * 「着手中」「進行中」と、それ以外の名前（「レビュー中」など、利用者が足したもの）は、作業中とみなして「着手中」に数える。
 */
function leafStatusKind(name: string): "notStarted" | "inProgress" | "done" | "hold" {
  if (name === "未着手") return "notStarted";
  if (name === "完了" || name === "取下") return "done";
  if (name === "保留") return "hold";
  return "inProgress";
}

/**
 * 一番右の段の行のステータスから、大項目のステータスを決める。
 *   ・1つでも着手中があれば「着手中」
 *   ・保留を除いて全部が完了（取下を含む）なら「完了」。保留が混ざっていれば「完了（一部保留あり）」
 *   ・保留を除いて全部が未着手なら「未着手」
 *   ・完了と未着手が混ざっていれば、作業は始まっているので「着手中」
 *   ・全部が保留なら「保留」
 */
function masterStatusOf(kinds: ReturnType<typeof leafStatusKind>[]): WbsMasterStatus | null {
  if (kinds.length === 0) return null;
  if (kinds.includes("inProgress")) return "着手中";
  const active = kinds.filter(k => k !== "hold");
  if (active.length === 0) return "保留";
  if (active.every(k => k === "done")) return active.length < kinds.length ? "完了（一部保留あり）" : "完了";
  if (active.every(k => k === "notStarted")) return "未着手";
  return "着手中";
}

/**
 * 大項目ごとの期間・ステータス・中項目の一覧を出す。
 * 期間とステータスに使うのは一番右の段の行（3段なら小項目、2段なら中項目、1段なら大項目自身）。
 * 開始予定日と終了予定日は別々に集めるので、片方しか入っていない行も、入っている方の日付は使う。
 * rows は buildWbsRows の結果（大項目のまとまりごとに group が振られている）。
 * statuses はそのWBSのステータス（並び順）。ステータスを選んでいない行は、WBS画面と同じく先頭のステータスとして数える。
 */
export function buildWbsMasterRows(rows: WbsRow[], statuses: WbsStatus[]): WbsMasterRow[] {
  const nameOf = new Map(statuses.map(s => [s.id, s.name]));
  const fallback = statuses[0]?.name ?? "未着手";
  const result: WbsMasterRow[] = [];
  const kinds: ReturnType<typeof leafStatusKind>[][] = [];
  let current: WbsMasterRow | null = null;
  let group = -1;
  for (const r of rows) {
    if (r.group !== group) {
      group = r.group;
      current = { item: r.item, no: result.length + 1, start: "", end: "", status: null, children: [] };
      result.push(current);
      kinds.push([]);
    }
    if (!current) continue;
    if (r.item.level === 2 && r.item !== current.item) current.children.push(r.item.name);
    if (!r.isLeafLevel) continue;
    const { startDate, endDate } = r.item;
    if (startDate && (!current.start || startDate < current.start)) current.start = startDate;
    if (endDate && (!current.end || endDate > current.end)) current.end = endDate;
    kinds[kinds.length - 1].push(leafStatusKind((r.item.statusId && nameOf.get(r.item.statusId)) || fallback));
  }
  result.forEach((m, i) => { m.status = masterStatusOf(kinds[i]); });
  return result;
}

export type WbsMasterScale = "day" | "week" | "month";

/** 1日あたりの幅（px）。日＝WBS画面のガントと同じ / 週＝1週 56px / 月＝1か月 約90px */
export const WBS_MASTER_PX_PER_DAY: Record<WbsMasterScale, number> = { day: 24, week: 8, month: 3 };

/** 表示する日数の上限。日は WBS画面と同じ約3年、週と月は全体を見渡すため約10年まで */
const MASTER_MAX_DAYS: Record<WbsMasterScale, number> = { day: GANTT_MAX_DAYS, week: 3660, month: 3660 };

/** 見出しの1マス。from と span は日数（先頭の日からの列の番号と、その長さ） */
export interface WbsMasterSpan { label: string; from: number; span: number }

export interface WbsMasterTimeline {
  scale: WbsMasterScale;
  /** 先頭の日（YYYY-MM-DD） */
  start: string;
  /** 表示する日数 */
  length: number;
  pxPerDay: number;
  /** 見出しの上の段（日・週＝年月 / 月＝年） */
  top: WbsMasterSpan[];
  /** 見出しの下の段（日＝日付 / 週＝週の初めの月/日 / 月＝何月） */
  units: WbsMasterSpan[];
  /** 土日・祝日の列の番号。月の目盛りでは細かすぎて縞になるので出さない */
  offDays: number[];
  /** 今日の列の番号。範囲の外なら null */
  todayIndex: number | null;
}

/**
 * マスタースケジュールの目盛りを作る。
 * 表示する期間は、矢羽根の日付の最小〜最大を含む月の、月初〜月末（WBS画面のガントと同じ考え方で、最低3か月）。
 * 週の目盛りでは、週の区切り（月曜はじまり）にそろうよう前後を広げる。
 */
export function buildWbsMasterTimeline(
  rows: WbsMasterRow[], scale: WbsMasterScale, holidays: ReadonlySet<string>, today: string,
): WbsMasterTimeline {
  let min: Date | null = null;
  let max: Date | null = null;
  for (const r of rows) {
    for (const s of [r.start, r.end]) {
      const d = parseDateStr(s);
      if (!d) continue;
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }
  }
  if (!min || !max) min = max = parseDateStr(today) ?? new Date();
  min = new Date(min.getFullYear(), min.getMonth(), 1);
  const monthSpan = (max.getFullYear() - min.getFullYear()) * 12 + (max.getMonth() - min.getMonth()) + 1;
  max = new Date(min.getFullYear(), min.getMonth() + Math.max(monthSpan, GANTT_MIN_MONTHS), 0);
  if (scale === "week") {
    min = addDays(min, -((min.getDay() + 6) % 7));
    max = addDays(max, (7 - max.getDay()) % 7);
  }
  const length = Math.min(dayDiff(min, max) + 1, MASTER_MAX_DAYS[scale]);

  const top: WbsMasterSpan[] = [];
  const units: WbsMasterSpan[] = [];
  const offDays: number[] = [];
  const push = (list: WbsMasterSpan[], label: string, i: number) => {
    const last = list[list.length - 1];
    if (last && last.label === label) last.span++; else list.push({ label, from: i, span: 1 });
  };
  for (let i = 0; i < length; i++) {
    const d = addDays(min, i);
    const ym = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    if (scale === "day") {
      push(top, ym, i);
      units.push({ label: String(d.getDate()), from: i, span: 1 });
    } else if (scale === "week") {
      push(top, ym, i);
      if (i % 7 === 0) units.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, from: i, span: Math.min(7, length - i) });
    } else {
      push(top, `${d.getFullYear()}年`, i);
      push(units, ym, i);
    }
    if (scale !== "month" && isOffDay(d, holidays)) offDays.push(i);
  }
  // 月の目盛りの下の段は「何月」だけにする（年は上の段に出ている）
  if (scale === "month") for (const u of units) u.label = u.label.replace(/^\d+年/, "");

  const t = parseDateStr(today);
  const ti = t ? dayDiff(min, t) : -1;
  return {
    scale, start: toDateStr(min), length, pxPerDay: WBS_MASTER_PX_PER_DAY[scale],
    top, units, offDays, todayIndex: ti >= 0 && ti < length ? ti : null,
  };
}
