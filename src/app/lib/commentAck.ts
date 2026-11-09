// コメントの「確認済み」チェック（BRU25-002）。
//
// 対象は comment_type = comment のコメント（文字を入力して書くコメントと返信。AI が API で登録したものを含む）だけ。
// ステータス変更・引継ぎ・レビューの記録は対象外。
// ticket_comments.resolved_at が null なら未確認、値があれば確認済み。
//
// 本番に列が無い（supabase/add_comment_resolved_BRU25-002.sql の適用前）ときは、
// すべてのコメントを確認済みとして扱い、未確認の表示を出さない。
// mapComment は列が無いと resolvedAt を undefined にするので、それで見分ける。

import { useEffect, useState } from "react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { TicketComment } from "@/app/types";

/** チェックの対象のコメントか（列が無い環境では常に false） */
export function isAckTarget(c: TicketComment): boolean {
  return c.commentType === "comment" && c.resolvedAt !== undefined;
}

/** 未確認のコメントか */
export function isUnackedComment(c: TicketComment): boolean {
  return isAckTarget(c) && c.resolvedAt === null;
}

/** 既存のコメントを確認済みにしたときの resolved_by（SQL と同じ値） */
export const LEGACY_RESOLVED_BY = "（既存のコメント）";

/** チェックを付ける／外す。失敗したらエラー文を返す */
export async function setCommentAck(commentId: string, on: boolean, userName: string): Promise<{ resolvedAt: string | null; resolvedBy: string | null } | { error: string }> {
  const patch = on
    ? { resolved_at: new Date().toISOString(), resolved_by: userName || null }
    : { resolved_at: null, resolved_by: null };
  if (!isSupabaseEnabled) return { resolvedAt: patch.resolved_at, resolvedBy: patch.resolved_by };
  const { error } = await supabase!.from("ticket_comments").update(patch).eq("id", commentId);
  if (error) return { error: error.message };
  emitCommentAckChanged();
  return { resolvedAt: patch.resolved_at, resolvedBy: patch.resolved_by };
}

// ── 一覧へ知らせる ──
// 詳細でチェックを切り替えた・コメントを書いたときに、スプリント一覧の件数を取り直させる。
const listeners = new Set<() => void>();

export function subscribeCommentAck(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function emitCommentAckChanged(): void {
  for (const fn of Array.from(listeners)) fn();
}

/**
 * チケットごとの未確認のコメントの件数（ticketId → 件数。0件のチケットは入らない）。
 * 列が無い環境などでエラーになったら null を返す（呼び出し側は前の件数のまま。一覧の表示は止めない）。
 */
export async function fetchUnackedCommentCounts(ticketIds: string[]): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  if (!isSupabaseEnabled || ticketIds.length === 0) return out;
  const CHUNK = 200;
  for (let i = 0; i < ticketIds.length; i += CHUNK) {
    const { data, error } = await supabase!
      .from("ticket_comments")
      .select("ticket_id")
      .in("ticket_id", ticketIds.slice(i, i + CHUNK))
      .eq("comment_type", "comment")
      .is("resolved_at", null)
      // BUG-01
      .order("ticket_id", { ascending: true })
      .order("id", { ascending: true });
    if (error) return null;
    for (const row of data ?? []) out.set(row.ticket_id, (out.get(row.ticket_id) ?? 0) + 1);
  }
  return out;
}

/**
 * スプリント一覧用。ticketIds が変わったとき・reloadKey が変わったとき（定期更新）・
 * 詳細でチェックを切り替えたときに取り直す。
 * BUG-02/03: 取り直しの間も前の件数を出したままにし、取れたら静かに差し替える。
 */
export function useUnackedCommentCounts(ticketIds: string[], reloadKey: unknown): Map<string, number> {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const key = ticketIds.join(",");
  const [tick, setTick] = useState(0);

  useEffect(() => subscribeCommentAck(() => setTick(n => n + 1)), []);

  useEffect(() => {
    if (!key) { setCounts(new Map()); return; }
    let alive = true;
    fetchUnackedCommentCounts(key.split(",")).then(m => { if (alive && m) setCounts(m); });
    return () => { alive = false; };
  }, [key, reloadKey, tick]);

  return counts;
}
