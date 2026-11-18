// PR不要のチケットの自動クローズと、「リリース不要」でのクローズ（KAIZEN2611-006）。
//
// 「リリース待ち」→「クローズ」へ自動で進める定期処理（api/github の sync-released）は、
// マージ済みのPRが紐付いているチケットだけを進める。PR不要のチケットはPRが無いので進まず、
// リリース日になってもリリース待ちのまま残っていた。
//
// そこで「PR不要・リリース待ち・リリース日が日本時間の今日以前」の親チケットはクローズにする。
// 判定と更新はここにまとめ、詳細パネル・関連PRの枠・リリースノートで同じものを使う。
// リリース日が未来のものは、その日になったら定期処理（サーバー側）がクローズにする。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { recordMilestoneFromTicketStatus } from "@/app/hooks/useProject";
import type { TicketStatus } from "@/app/types";

/**
 * 日本時間の今日（"2026-11-18"）。
 * new Date().toISOString().slice(0, 10) は UTC の日付になり、日本時間の 0:00〜8:59 は前日になるため使わない。
 */
export function todayJst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/** 履歴に書く日付（"2026-11-18" → "11/18"） */
function shortDate(date: string): string {
  return date.slice(5).replace("-", "/");
}

export interface WaivedReleaseTarget {
  status: TicketStatus | string;
  prLinkWaived?: boolean;
  releaseDate?: string | null;
  isReleaseDateUndecided?: boolean;
  parentId?: string | null;
}

/**
 * PR不要のチケットを、いまクローズにしてよいか。
 * 親チケット・リリース待ち・PR不要・リリース日が決まっていて日本時間の今日以前、のすべてを満たすとき。
 * リリース日が「未定」のものは、PR不要でも自動ではクローズにしない。
 */
export function isWaivedReleaseDue(t: WaivedReleaseTarget): boolean {
  if (t.parentId) return false;
  if (t.status !== "waiting-release") return false;
  if (!t.prLinkWaived) return false;
  if (t.isReleaseDateUndecided || !t.releaseDate) return false;
  return t.releaseDate <= todayJst();
}

/** PR不要・リリース日の到来でクローズにしたときの履歴の文 */
export function waivedReleaseHistoryHtml(releaseDate: string): string {
  return `<p>PR不要・リリース日（${shortDate(releaseDate)}）到来のためクローズにしました</p>`;
}

/**
 * 親チケットをクローズ（released・progress 100）にし、完了時刻（マイルストーン）を記録する。
 * 画面からクローズにしたとき（handleStatusAction）と同じ書き方。
 *
 * @param expectStatus 読んでから書くまでの間に人が別のステータスへ動かしていたら上書きしないよう、条件に入れる今のステータス
 * @param extra 一緒に書く列（リリース不要のチェックなど）
 * @returns 更新できたら true。条件に合わず更新しなかった・失敗したら false
 */
export async function closeAsReleased(
  ticketId: string,
  opts: { expectStatus?: string; extra?: Record<string, unknown> } = {},
): Promise<{ ok: true } | { ok: false; error?: string }> {
  if (!isSupabaseEnabled) return { ok: true };
  let q = supabase!.from("sprint_tickets")
    .update({ status: "released", progress: 100, ...(opts.extra ?? {}) })
    .eq("id", ticketId);
  if (opts.expectStatus) q = q.eq("status", opts.expectStatus);
  const { data, error } = await q.select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false };
  await recordMilestoneFromTicketStatus(ticketId, "released");
  return { ok: true };
}

/** コメント欄にステータス変更の履歴を1件残す（詳細パネルの外で使う。詳細パネルは addComment を使う） */
export async function insertStatusHistory(ticketId: string, userName: string, html: string): Promise<void> {
  if (!isSupabaseEnabled) return;
  const { error } = await supabase!.from("ticket_comments").insert({
    id: `CMT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ticket_id: ticketId, user_name: userName, content: html,
    ticket_status: "released", comment_type: "status_change", images: [],
  });
  if (error) console.error("[releaseAutoClose] history insert failed:", error.message);
}

/**
 * PR不要でリリース日が来ていれば、その場でクローズにする（詳細パネルの外から使う）。
 * クローズにしたら true を返す。
 */
export async function closeWaivedIfDue(
  ticketId: string, t: WaivedReleaseTarget, userName: string,
): Promise<boolean> {
  if (!isWaivedReleaseDue(t)) return false;
  const r = await closeAsReleased(ticketId, { expectStatus: "waiting-release" });
  if (!r.ok) return false;
  await insertStatusHistory(ticketId, userName, waivedReleaseHistoryHtml(t.releaseDate as string));
  return true;
}
