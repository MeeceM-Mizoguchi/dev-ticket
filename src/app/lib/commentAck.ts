// コメントの「確認済み」チェック（BRU25-002）。
//
// 対象は comment_type = comment のコメント（文字を入力して書くコメントと返信。AI が API で登録したものを含む）のうち、
// 本文にメンションの印（「@」から候補を選んだときに入る class="mention" の span）があるものだけ（BRU25-006）。
// メンションの無いコメントは誰宛てでもなく、誰がチェックを付けるのかが決まらないため。
// ステータス変更・引継ぎ・レビューの記録は対象外。
// ticket_comments.resolved_at が null なら未確認、値があれば確認済み。
// 未確認の表示（一覧の件数・詳細の件数とオレンジの枠・「☐ 確認済みにする」）は、メンションされた本人の画面にだけ出す（BRU25-010）。
//
// 本番に列が無い（supabase/add_comment_resolved_BRU25-002.sql の適用前）ときは、
// すべてのコメントを確認済みとして扱い、未確認の表示を出さない。
// mapComment は列が無いと resolvedAt を undefined にするので、それで見分ける。

import { useEffect, useState } from "react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { TicketComment } from "@/app/types";

/** 本文にメンションの印があるか。# のチケット・% のファイルなどの印は class が違うので当たらない */
export const MENTION_MARK = 'class="mention"';

/** チェックの対象のコメントか（列が無い環境では常に false） */
export function isAckTarget(c: TicketComment): boolean {
  return c.commentType === "comment" && c.resolvedAt !== undefined && (c.content ?? "").includes(MENTION_MARK);
}

/** 未確認のコメントか */
export function isUnackedComment(c: TicketComment): boolean {
  return isAckTarget(c) && c.resolvedAt === null;
}

// ── 自分宛てか（BRU25-010） ──
// 未確認の表示は、メンションされた本人の画面にだけ出す。
// 宛先はメンションの印の data-id（<span class="mention" data-id="佐藤瑛">。RichEditor の Mention と、API の ticket-comment が入れる）。
// 本文の文字（@佐藤）での部分一致にすると、名前の前方が同じ別の人にも当たるので、data-id の名前と完全一致で見る。
// 1つのコメントで2人以上にメンションしたときも、確認済みのチェックは1つを共有する（resolved_at はコメントに1つ）。

const SPAN_TAG_RE = /<span\b[^>]*>/gi;
const decodeAttr = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** 本文のメンションの宛先の名前（class="mention" の span の data-id）。# のチケット・% のファイルなどの印は含まない */
export function mentionedNames(content: string): string[] {
  const names: string[] = [];
  for (const tag of content.match(SPAN_TAG_RE) ?? []) {
    if (!/\bclass="mention"/.test(tag)) continue;
    const m = tag.match(/\bdata-id="([^"]*)"/);
    if (m) names.push(decodeAttr(m[1]));
  }
  return names;
}

/** 本文で myName がメンションされているか */
export function isMentionedTo(content: string | null | undefined, myName: string): boolean {
  if (!myName || !content) return false;
  return mentionedNames(content).includes(myName);
}

/** 自分宛ての未確認のコメントか（オレンジの枠・件数・「☐ 確認済みにする」はこれで出し分ける） */
export function isUnackedForMe(c: TicketComment, myName: string): boolean {
  return isUnackedComment(c) && isMentionedTo(c.content, myName);
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
 * チケットごとの、myName 宛ての未確認のコメントの件数（ticketId → 件数。0件のチケットは入らない）。
 * myName が空なら誰宛てでもないので、何も数えない（BRU25-010）。
 * 列が無い環境などでエラーになったら null を返す（呼び出し側は前の件数のまま。一覧の表示は止めない）。
 */
export async function fetchUnackedCommentCounts(ticketIds: string[], myName: string): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  if (!isSupabaseEnabled || ticketIds.length === 0 || !myName) return out;
  const CHUNK = 200;
  for (let i = 0; i < ticketIds.length; i += CHUNK) {
    const { data, error } = await supabase!
      .from("ticket_comments")
      // 宛先を見るため本文も取る。対象は未確認かつメンション付きのコメントだけなので件数は少ない
      .select("ticket_id, content")
      .in("ticket_id", ticketIds.slice(i, i + CHUNK))
      .eq("comment_type", "comment")
      .is("resolved_at", null)
      .like("content", `%${MENTION_MARK}%`) // メンション付きのコメントだけ数える（BRU25-006）
      // BUG-01
      .order("ticket_id", { ascending: true })
      .order("id", { ascending: true });
    if (error) return null;
    for (const row of data ?? []) {
      if (!isMentionedTo(row.content, myName)) continue; // 自分宛てだけ数える（BRU25-010）
      out.set(row.ticket_id, (out.get(row.ticket_id) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * スプリント一覧用。myName（ログイン中の人の名前）宛ての件数を数える（BRU25-010）。
 * ticketIds・myName が変わったとき・reloadKey が変わったとき（定期更新）・
 * 詳細でチェックを切り替えたときに取り直す。
 * BUG-02/03: 取り直しの間も前の件数を出したままにし、取れたら静かに差し替える。
 */
export function useUnackedCommentCounts(ticketIds: string[], reloadKey: unknown, myName: string): Map<string, number> {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const key = ticketIds.join(",");
  const [tick, setTick] = useState(0);

  useEffect(() => subscribeCommentAck(() => setTick(n => n + 1)), []);

  useEffect(() => {
    if (!key) { setCounts(new Map()); return; }
    let alive = true;
    fetchUnackedCommentCounts(key.split(","), myName).then(m => { if (alive && m) setCounts(m); });
    return () => { alive = false; };
  }, [key, reloadKey, tick, myName]);

  return counts;
}
