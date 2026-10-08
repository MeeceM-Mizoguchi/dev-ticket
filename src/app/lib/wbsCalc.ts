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
