// ENHA2-053 WBS（作業分解表）の画面側の計算。
//
// 進捗率の自動計算・予定日数・遅延の判定は DB に保存せず、ここで行のデータから計算する。
// ステータスの名前は利用者が自由に変えられるので、判定をステータスの名前に頼らないこと。
import type { WbsItem } from "@/app/types";

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
  /** 終了予定日を過ぎていて進捗率が100%でない */
  delayed: boolean;
}

/**
 * 行を親と段の情報から木の形に組み立て、上から順に並べる。
 * levels はそのWBSの段数（1〜3）。一番右の段＝ level === levels の行。
 */
export function buildWbsRows(items: WbsItem[], levels: number, today: string): WbsRow[] {
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

  // 戻り値: その行から下にある「一番右の段の行」の進捗率の一覧と、下の行の数
  const walk = (it: WbsItem, ancestors: string[]): { leaves: number[]; count: number } => {
    if (ancestors.length === 0) group++;
    const names: (string | null)[] = [null, null, null];
    ancestors.forEach((n, i) => { names[i] = n; });
    names[Math.min(Math.max(it.level, 1), 3) - 1] = it.name;

    const isLeafLevel = it.level >= levels;
    const row: WbsRow = {
      item: it, no: rows.length + 1, names, group,
      descendantCount: 0, isLeafLevel, progress: null, delayed: false,
    };
    rows.push(row);

    const leaves: number[] = isLeafLevel ? [it.progress] : [];
    let count = 0;
    for (const child of byParent.get(it.id) ?? []) {
      const r = walk(child, [...ancestors, it.name]);
      count += 1 + r.count;
      if (!isLeafLevel) leaves.push(...r.leaves);
    }
    row.descendantCount = count;
    row.progress = leaves.length ? Math.round(leaves.reduce((a, b) => a + b, 0) / leaves.length) : null;
    // 進捗率が出せない行（下に行が無い左の段）は、遅延の判定をしない
    row.delayed = !!it.endDate && it.endDate < today && row.progress !== null && row.progress < 100;
    return { leaves, count };
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

export interface WbsGanttDay {
  /** YYYY-MM-DD */
  str: string;
  /** 日（1〜31） */
  day: number;
  /** 0=日 〜 6=土 */
  dow: number;
  /** 土日か、登録した祝日 */
  off: boolean;
  /** 登録した祝日の名前（祝日でなければ ""） */
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
function dayDiff(a: Date, b: Date): number {
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
 * 表示する期間は、行の開始予定日・終了予定日の最小〜最大。日付の入った行が無いときは今日を含む月。
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
    const t = parseDateStr(today) ?? new Date();
    min = new Date(t.getFullYear(), t.getMonth(), 1);
    max = new Date(t.getFullYear(), t.getMonth() + 1, 0);
  }
  const length = Math.min(dayDiff(min, max) + 1, GANTT_MAX_DAYS);

  const days: WbsGanttDay[] = [];
  const months: { label: string; span: number }[] = [];
  for (let i = 0; i < length; i++) {
    const d = addDays(min, i);
    const str = toDateStr(d);
    const dow = d.getDay();
    const holidayName = holidays.get(str) ?? "";
    days.push({ str, day: d.getDate(), dow, off: dow === 0 || dow === 6 || holidays.has(str), holidayName, isToday: str === today, count: 0 });
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
