// チケットの引継ぎ（担当交代）と、実績工数の担当者別按分。
//
// 【背景】sprint_tickets は「現在の担当者」しか持たないため、
//   calcTicketActualHours が出したチケット合計を集計側が丸ごと現 assignee に付けていた。
//   担当を交代すると元担当の実績が消えるので、「誰がいつからいつまで担当したか」の区間
//   (ticket_assignments) を持ち、チケット合計をその区間で按分する。
//
// 【不変条件】按分の合計は必ずチケット実績と一致する。
//   実績モニタの手入力値 (actual_work_hours) を割り直すだけなので、
//   どこから見ても「チケットの実績」と「担当者別の合計」がズレない。
//
// 区間テーブルの維持は DB トリガ (supabase/add_ticket_handover.sql) が担当する。
// ここは読み取りと按分、そして引継ぎ時の付加情報（理由・実績の手修正）の書き込みだけ。

import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { calcWorkingHours } from "@/app/lib/helpers";
import { calcHoldHours, type HoldCommentLike } from "@/app/lib/holdHours";

/** ticket_assignments の1行 = 1人が担当していた区間 */
export interface AssignmentSegment {
  id: string;
  ticketId: string;
  assignee: string;
  startedAt: string;
  /** null = 現担当 */
  endedAt: string | null;
  /** 按分値を人が修正したとき入る（時間）。null なら自動按分 */
  hoursOverride: number | null;
  handoverNote: string;
  handedOverBy: string;
}

/** 按分結果。担当者1人ぶん */
export interface AssigneeShare {
  assignee: string;
  /** 按分後の実績（時間） */
  hours: number;
  /** 手修正された値か（画面で「手入力」と出す） */
  isOverride: boolean;
  /** この人が担当していた区間（複数回担当し直すこともある） */
  segments: AssignmentSegment[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapSegment(r: any): AssignmentSegment {
  return {
    id: String(r.id),
    ticketId: r.ticket_id,
    assignee: r.assignee ?? "",
    startedAt: r.started_at,
    endedAt: r.ended_at ?? null,
    hoursOverride: r.hours_override == null ? null : Number(r.hours_override),
    handoverNote: r.handover_note ?? "",
    handedOverBy: r.handed_over_by ?? "",
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * チケットの担当区間を古い順に取得する。
 * BUG-01: DB は .order() が無いと毎回違う順序で返す。区間は前後関係が意味を持つので
 *         started_at と id の2段で安定ソートにする。
 */
export async function fetchAssignmentSegments(ticketId: string): Promise<AssignmentSegment[]> {
  if (!isSupabaseEnabled || !ticketId) return [];
  const { data, error } = await supabase!
    .from("ticket_assignments")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("started_at", { ascending: true })
    .order("id", { ascending: true });
  if (error || !data) return [];
  return data.map(mapSegment);
}

/** 複数チケットぶんをまとめて取得する（一覧・レポート・CSV 用）。ticketId → 区間 */
export async function fetchAssignmentSegmentsFor(
  ticketIds: string[],
): Promise<Map<string, AssignmentSegment[]>> {
  const out = new Map<string, AssignmentSegment[]>();
  if (!isSupabaseEnabled || ticketIds.length === 0) return out;
  // URL 長の上限があるので in() は分割して投げる
  const CHUNK = 200;
  for (let i = 0; i < ticketIds.length; i += CHUNK) {
    const { data, error } = await supabase!
      .from("ticket_assignments")
      .select("*")
      .in("ticket_id", ticketIds.slice(i, i + CHUNK))
      .order("started_at", { ascending: true })
      .order("id", { ascending: true });
    if (error || !data) continue;
    for (const row of data) {
      const seg = mapSegment(row);
      const list = out.get(seg.ticketId);
      if (list) list.push(seg);
      else out.set(seg.ticketId, [seg]);
    }
  }
  return out;
}

/**
 * 一覧の担当者セル用に「担当した人の並び（古い順）」だけを軽く引く。
 *
 * 区間そのものは要らないので列を絞ってある（一覧は数百チケットぶん一度に引くため）。
 * 引継ぎが1度も無いチケットは呼び出し側で sprint_tickets.assignee を使えばよいので
 * 返さない ＝ Map に入るのは「2人以上が関わったチケット」だけ。
 *
 * 同じ名前が連続する行はまとめる。メンバー改名時に区間が2本に割れることがあり、
 * そのまま出すと「溝口雅登 / 溝口雅登」と同じ名前が並んでしまう。
 */
export async function fetchAssigneeHistory(ticketIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!isSupabaseEnabled || ticketIds.length === 0) return out;
  const CHUNK = 200;
  for (let i = 0; i < ticketIds.length; i += CHUNK) {
    const { data, error } = await supabase!
      .from("ticket_assignments")
      .select("ticket_id, assignee")
      .in("ticket_id", ticketIds.slice(i, i + CHUNK))
      // BUG-01: .order() が無いと毎回違う順序で返る。並び＝引き継いだ順なので必須
      .order("started_at", { ascending: true })
      .order("id", { ascending: true });
    if (error || !data) continue;
    for (const row of data) {
      if (!row.assignee) continue;
      const list = out.get(row.ticket_id);
      if (!list) { out.set(row.ticket_id, [row.assignee]); continue; }
      if (list[list.length - 1] !== row.assignee) list.push(row.assignee);
    }
  }
  // 1人しか担当していないチケットは履歴として出す意味が無い
  for (const [id, names] of [...out]) if (names.length < 2) out.delete(id);
  return out;
}

/** 引継ぎが起きたチケット（担当が2人以上いる）の ID だけを返す */
export function ticketsWithHandover(byTicket: Map<string, AssignmentSegment[]>): string[] {
  const out: string[] = [];
  for (const [ticketId, segs] of byTicket) {
    if (new Set(segs.map(s => s.assignee)).size > 1) out.push(ticketId);
  }
  return out;
}

/**
 * 按分の重みから保留時間を引くために必要な status_change コメントだけを取る。
 *
 * 一覧・レポート・CSV は対象チケットが数百件になるので全コメントは引けない。
 * 引継ぎが起きたチケット（ticketsWithHandover）に絞って呼ぶこと。
 * 渡さなかった場合は保留時間を引かないだけで、按分の合計は変わらない。
 */
export async function fetchHoldComments(ticketIds: string[]): Promise<Map<string, HoldCommentLike[]>> {
  const out = new Map<string, HoldCommentLike[]>();
  if (!isSupabaseEnabled || ticketIds.length === 0) return out;
  const CHUNK = 200;
  for (let i = 0; i < ticketIds.length; i += CHUNK) {
    const { data, error } = await supabase!
      .from("ticket_comments")
      .select("ticket_id, content, created_at, comment_type")
      .in("ticket_id", ticketIds.slice(i, i + CHUNK))
      .eq("comment_type", "status_change")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (error || !data) continue;
    for (const row of data) {
      const list = out.get(row.ticket_id);
      if (list) list.push(row);
      else out.set(row.ticket_id, [row]);
    }
  }
  return out;
}

/**
 * 実績を計測している期間。開始〜（最後に記録されたマイルストーン or 現在）。
 * この窓の外にはみ出した区間は按分の重みに数えない。
 * 例: リリース済みチケットの担当をあとから付け替えても、新しい担当の重みは 0 になり、
 *     実績は実際に作業していた元担当に残る。
 */
function actualWindow(ticket: TicketTimestamps, now: number): { start: number; end: number } | null {
  if (!ticket.startedAt) return null;
  const start = new Date(ticket.startedAt).getTime();
  let end = start;
  for (const e of [
    ticket.reviewRequestedAt, ticket.reviewApprovedAt, ticket.stgCompletedAt,
    ticket.uatCompletedAt, ticket.releasedAt,
  ]) {
    if (!e) continue;
    const t = new Date(e).getTime();
    if (t > end) end = t;
  }
  // まだ完了していないチケットは「今」までを計測中とみなす
  if (end <= start) end = Math.max(start, now);
  return { start, end };
}

export interface TicketTimestamps {
  startedAt?: string | null;
  reviewRequestedAt?: string | null;
  reviewApprovedAt?: string | null;
  stgCompletedAt?: string | null;
  uatCompletedAt?: string | null;
  releasedAt?: string | null;
}

/**
 * 区間1本ぶんの「稼働時間」= 計測窓と重なった部分の営業時間 − その間の保留時間。
 * 保留の判定は既存の status_change コメント方式をそのまま使う（holdHours.ts）。
 */
export function segmentWeight(
  seg: AssignmentSegment,
  window: { start: number; end: number },
  comments: HoldCommentLike[],
  now: number,
): number {
  const segStart = new Date(seg.startedAt).getTime();
  const segEnd = seg.endedAt ? new Date(seg.endedAt).getTime() : now;
  const from = Math.max(segStart, window.start);
  const to = Math.min(segEnd, window.end);
  if (to <= from) return 0;
  const worked = calcWorkingHours(from, to);
  const held = calcHoldHours(comments, from, to, false);
  return Math.max(0, worked - held);
}

/**
 * チケットの実績合計を担当区間で按分する。
 *
 * @param totalHours  calcTicketActualHours が出したチケット合計（手入力値があればその値）
 * @param segments    fetchAssignmentSegments の結果（古い順）
 * @param currentAssignee 現在の担当者。区間が無い既存チケットのフォールバックに使う
 *
 * 返り値の hours の合計は totalHours と一致する（端数は最大の人で吸収する）。
 */
export function splitActualHours(
  totalHours: number,
  segments: AssignmentSegment[],
  ticket: TicketTimestamps,
  comments: HoldCommentLike[],
  currentAssignee: string,
  now: number = Date.now(),
): AssigneeShare[] {
  // 区間が無い＝このSQLを流す前のチケット。今までどおり現担当の実績とする
  if (segments.length === 0) {
    if (!currentAssignee || totalHours <= 0) return [];
    return [{ assignee: currentAssignee, hours: totalHours, isOverride: false, segments: [] }];
  }

  const window = actualWindow(ticket, now);
  const weights = segments.map(s => (window ? segmentWeight(s, window, comments, now) : 0));

  // 手修正された区間は按分から外し、残りを他へ配る。
  // 元担当の実績だけ「実際はこれだけやった」と直せるようにするため。
  //
  // 手修正の合計がチケット実績を超えたとき（実績モニタであとから合計を小さく直した場合など）は
  // remaining が 0 になり、最後の丸め調整が超過ぶんを一番多い人から差し引く。
  // 手修正の値は目減りするが、「担当者別の合計＝チケット実績」の不変条件を優先する。
  const overrideTotal = segments.reduce((sum, s) => sum + (s.hoursOverride ?? 0), 0);
  const free = segments.map((s, i) => (s.hoursOverride == null ? i : -1)).filter(i => i >= 0);
  const remaining = Math.max(0, totalHours - overrideTotal);
  const freeWeightTotal = free.reduce((sum, i) => sum + weights[i], 0);

  const hoursBySegment = segments.map(s => s.hoursOverride ?? 0);
  if (free.length > 0) {
    if (freeWeightTotal > 0) {
      for (const i of free) hoursBySegment[i] = (remaining * weights[i]) / freeWeightTotal;
    } else {
      // 重みが全部 0（着手前・同時刻の付け替えなど）。今までの挙動に合わせて最後の区間＝現担当に寄せる
      hoursBySegment[free[free.length - 1]] = remaining;
    }
  }

  // 同じ人が担当 → 別の人 → また戻る、というケースがあるので名前でまとめる
  const byName = new Map<string, AssigneeShare>();
  segments.forEach((seg, i) => {
    if (!seg.assignee) return;
    const cur = byName.get(seg.assignee);
    if (cur) {
      cur.hours += hoursBySegment[i];
      cur.isOverride = cur.isOverride || seg.hoursOverride != null;
      cur.segments.push(seg);
    } else {
      byName.set(seg.assignee, {
        assignee: seg.assignee,
        hours: hoursBySegment[i],
        isOverride: seg.hoursOverride != null,
        segments: [seg],
      });
    }
  });

  const shares = [...byName.values()].map(s => ({ ...s, hours: Math.round(s.hours * 100) / 100 }));

  // 丸め誤差で「担当者別の合計 ≠ チケット実績」にならないよう、一番多い人で吸収する
  if (shares.length > 0) {
    const sum = shares.reduce((a, s) => a + s.hours, 0);
    const drift = Math.round((totalHours - sum) * 100) / 100;
    if (drift !== 0) {
      const top = shares.reduce((a, b) => (b.hours > a.hours ? b : a));
      top.hours = Math.round((top.hours + drift) * 100) / 100;
    }
  }

  return shares;
}

/**
 * 引継ぎダイアログの初期表示用。「今この瞬間に交代したら元担当の実績はいくつか」を返す。
 * 実際の交代前に呼ぶので、開いている区間（＝元担当）の按分値を取り出す。
 */
export function previewCurrentShare(
  totalHours: number,
  segments: AssignmentSegment[],
  ticket: TicketTimestamps,
  comments: HoldCommentLike[],
  currentAssignee: string,
  now: number = Date.now(),
): number {
  const shares = splitActualHours(totalHours, segments, ticket, comments, currentAssignee, now);
  return shares.find(s => s.assignee === currentAssignee)?.hours ?? 0;
}

/**
 * 引継ぎの付加情報を、DB トリガが締めた直前の区間へ書き足す。
 *
 * 呼ぶ順番は必ず「sprint_tickets.assignee を更新 → これ」。
 * 先に呼ぶと、まだ区間が締まっていないので対象行が見つからない。
 */
export async function applyHandoverDetails(
  ticketId: string,
  prevAssignee: string,
  detail: { hoursOverride: number | null; note: string; handedOverBy: string },
): Promise<void> {
  if (!isSupabaseEnabled || !ticketId || !prevAssignee) return;
  // 直前に締められた区間 = ended_at が入っていて、その人のもので、いちばん新しいもの
  const { data } = await supabase!
    .from("ticket_assignments")
    .select("id")
    .eq("ticket_id", ticketId)
    .eq("assignee", prevAssignee)
    .not("ended_at", "is", null)
    .order("ended_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  const target = data?.[0]?.id;
  if (!target) return;
  await supabase!.from("ticket_assignments").update({
    hours_override: detail.hoursOverride,
    handover_note: detail.note,
    handed_over_by: detail.handedOverBy,
  }).eq("id", target);
}

/**
 * チケット一覧ぶんの担当者別実績をまとめて作る（CSV / Word / Markdown 出力用）。
 *
 * 区間と保留コメントの取得をここで完結させているので、呼び出し側は
 * チケットの配列を渡すだけでよい。取得に失敗しても空の Map が返るだけで、
 * 出力そのものは成立する（担当者別の列が空になる）。
 */
export async function buildSharesFor<T extends TicketTimestamps & { id: string; assignee: string }>(
  tickets: T[],
  calcTotal: (ticket: T) => number,
): Promise<Map<string, AssigneeShare[]>> {
  const out = new Map<string, AssigneeShare[]>();
  if (!isSupabaseEnabled || tickets.length === 0) return out;
  const segsByTicket = await fetchAssignmentSegmentsFor(tickets.map(t => t.id));
  const holds = await fetchHoldComments(ticketsWithHandover(segsByTicket));
  for (const t of tickets) {
    const segs = segsByTicket.get(t.id) ?? [];
    // 担当が替わっていないチケットは「現担当が全部」なので、列に出す情報が無い
    if (new Set(segs.map(s => s.assignee)).size < 2) continue;
    out.set(t.id, splitActualHours(calcTotal(t), segs, t, holds.get(t.id) ?? [], t.assignee));
  }
  return out;
}

/**
 * 担当者別に入力された実績を、その人の区間へ書き戻す（実績入力／修正画面から呼ぶ）。
 *
 * 1人が複数の区間を持つことがある（A → B → また A）ので、その人ぶんの入力値を
 * 自分の区間の稼働時間比で割って hours_override に入れる。稼働時間が全部 0 のときは
 * 最後の区間にまとめる。
 *
 * 全区間に override が入るので、以後この チケットは按分ではなく入力値そのままで集計される。
 */
export async function saveAssigneeHours(
  ticketId: string,
  hoursByAssignee: Map<string, number>,
  segments: AssignmentSegment[],
  ticket: TicketTimestamps,
  comments: HoldCommentLike[],
  now: number = Date.now(),
): Promise<void> {
  if (!isSupabaseEnabled || segments.length === 0) return;
  const window = actualWindow(ticket, now);

  const updates: { id: string; hours: number }[] = [];
  for (const [assignee, hours] of hoursByAssignee) {
    const mine = segments.filter(s => s.assignee === assignee);
    if (mine.length === 0) continue;
    if (mine.length === 1) { updates.push({ id: mine[0].id, hours }); continue; }
    const weights = mine.map(s => (window ? segmentWeight(s, window, comments, now) : 0));
    const weightTotal = weights.reduce((a, b) => a + b, 0);
    if (weightTotal > 0) {
      mine.forEach((s, i) => updates.push({ id: s.id, hours: Math.round((hours * weights[i]) / weightTotal * 100) / 100 }));
    } else {
      mine.forEach((s, i) => updates.push({ id: s.id, hours: i === mine.length - 1 ? hours : 0 }));
    }
  }

  await Promise.all(updates.map(u =>
    supabase!.from("ticket_assignments").update({ hours_override: u.hours }).eq("id", u.id)
  ));
}

/** 「1.5」→ 1.5、空文字や不正値は null。引継ぎダイアログの実績入力欄用 */
export function parseHoursInput(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}
