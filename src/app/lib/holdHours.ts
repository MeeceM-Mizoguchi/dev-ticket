import { calcWorkingHours } from "@/app/lib/helpers";

// 保留の開始／終了は専用カラムを持たず、status_change コメントの本文で判定している。
// 文言がズレると保留時間が丸ごと計上されなくなるため、記録側（TicketDetailPanel）と
// 集計側（ProjectMonitor / 子チケットの実績工数）で同じ定数を参照する。
export const HOLD_START_MARKER = "チケットを保留にしました";
export const HOLD_END_MARKER = "保留を解除しました";

/** DB生行（snake_case）とマッパー通過後（camelCase）の両方を受けられるようにする */
export interface HoldCommentLike {
  content?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  comment_type?: string | null;
  commentType?: string | null;
}

function commentTime(c: HoldCommentLike): number {
  return new Date(c.created_at || c.createdAt || 0).getTime();
}

function isStatusChange(c: HoldCommentLike): boolean {
  return c.commentType === "status_change" || c.comment_type === "status_change";
}

/**
 * コメント履歴から [startMs, endMs] 区間の保留累計時間（営業時間ベース）を返す。
 *
 * @param includeOngoing 区間内で保留が始まったまま解除されていない場合に、endMs までを保留として加算するか。
 *                       現在も保留中のチケットを表示・計測する時だけ true にする。
 */
export function calcHoldHours(
  comments: HoldCommentLike[],
  startMs: number,
  endMs: number,
  includeOngoing = false,
): number {
  const inRange = comments
    .filter(c => {
      const t = commentTime(c);
      return t >= startMs && t <= endMs && isStatusChange(c);
    })
    .sort((a, b) => commentTime(a) - commentTime(b));

  let total = 0;
  let holdStart: number | null = null;

  for (const c of inRange) {
    const t = commentTime(c);
    const body = c.content ?? "";
    if (body.includes(HOLD_START_MARKER)) {
      holdStart = t;
    } else if (body.includes(HOLD_END_MARKER) && holdStart !== null) {
      total += calcWorkingHours(holdStart, t);
      holdStart = null;
    }
  }

  if (includeOngoing && holdStart !== null) {
    total += calcWorkingHours(holdStart, endMs);
  }

  return Math.max(0, total);
}
