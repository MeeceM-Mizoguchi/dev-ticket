// サブタスクから親タスクへ集計する値（BRU15-005）。
//
// サブタスクを持つ親タスクは、担当者と期間を自分では持たず、子から決まる：
//   担当者 … 子の担当者を全員（重複なし・子の並び順）。表示は「A/B/C」
//   開始日 … 子の中で一番早い開始日
//   期限   … 子の中で一番遅い期限
//
// DB には書き戻さず、表示のたびに手元のタスクから計算する。
//   ・担当者は1人ぶんの列（assignee）なので「A/B/C」を入れると、担当者の絞り込み・
//     共有の自動付与・お知らせが全部壊れる
//   ・期間も書き戻すと、子の編集権限はあるが親は無い人（共有された子だけ直せる人）の
//     操作で親の更新が RLS に弾かれ、表示と DB が食い違う
// tasks の日付を読むのはタスク画面だけ（taskService / bulkTaskInsert）なので、表示側で揃えれば足りる。
//
// 子の中にその値を持つものが1件も無いとき（子が全員未割当・日付未設定）は、
// 親が自分で持っている値をそのまま使い、親の欄も直せるままにする。
import type { Task } from "@/app/types";

export interface TaskRollup {
  childCount: number;
  /** 子の担当者（重複なし・空は除く）。空配列なら親自身の担当者を使う */
  assignees: string[];
  /** 子の最も早い開始日。"" なら親自身の開始日を使う */
  startDate: string;
  /** 子の最も遅い期限。"" なら親自身の期限を使う */
  dueDate: string;
}

/** 親の id → 集計値。子を持たないタスクは入らない */
export type TaskRollups = Map<string, TaskRollup>;

/** 担当者を並べるときの区切り */
export const ASSIGNEE_SEP = "/";

/**
 * 絞り込み前の全タスクから集計する（完了を隠していても親の値が変わらないように）。
 * 子は1階層のみなので、parentId を1回たどれば足りる。
 */
export function buildTaskRollups(all: Task[]): TaskRollups {
  const out: TaskRollups = new Map();
  for (const t of all) {
    if (!t.parentId) continue;
    let r = out.get(t.parentId);
    if (!r) {
      r = { childCount: 0, assignees: [], startDate: "", dueDate: "" };
      out.set(t.parentId, r);
    }
    r.childCount += 1;
    if (t.assignee && !r.assignees.includes(t.assignee)) r.assignees.push(t.assignee);
    if (t.startDate && (!r.startDate || t.startDate < r.startDate)) r.startDate = t.startDate;
    if (t.dueDate && (!r.dueDate || t.dueDate > r.dueDate)) r.dueDate = t.dueDate;
  }
  return out;
}

/** 表示に使う期間。子から決まる側は子の値、決まらない側は親自身の値 */
export function effectiveDates(t: Task, r: TaskRollup | undefined): { startDate: string; dueDate: string } {
  return {
    startDate: r?.startDate || t.startDate,
    dueDate: r?.dueDate || t.dueDate,
  };
}

/** 期間を表示用に差し替えたタスク。変わらなければ同じオブジェクトを返す（memo を無駄に崩さない） */
export function withEffectiveDates(t: Task, r: TaskRollup | undefined): Task {
  const d = effectiveDates(t, r);
  return d.startDate === t.startDate && d.dueDate === t.dueDate ? t : { ...t, ...d };
}

/** 期間のどちらかが子から決まっているか（＝親の日付は手で動かせない） */
export function hasRolledUpDates(r: TaskRollup | undefined): boolean {
  return !!(r && (r.startDate || r.dueDate));
}
