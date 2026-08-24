// 「リリース待ち以降なのに関連PRが1件も無い」チケットの検出（BRU13-013）。
//
// チケット詳細で「対応完了してリリースノートに追加」を押した時点でPRの紐付けを促すが、
// 案内を閉じて離脱することもできる。取り残しに後から気づけるよう、一覧側は
// DBの状態から毎回導出して行を赤くする。フラグを立てて回るのではなく導出にしているので、
// 一括ステータス変更など詳細画面を通らない経路で進んだチケットも同じように拾える。
//
// 例外は pr_link_waived（PR不要と人が確定したもの）だけ。PRを紐付ければ、
// waived の値に関わらずアラートは消える。
import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { SprintTicket, TicketStatus } from "@/app/types";

/** この状態まで来ていればPRが紐付いているはず、という段階 */
const ALERT_STATUSES: TicketStatus[] = ["waiting-release", "released"];

export function isPrLinkAlertStatus(status: TicketStatus): boolean {
  return ALERT_STATUSES.includes(status);
}

/**
 * このチケットの行を赤くするか。
 *
 * @param linkedTicketIds PRが1件以上紐付いているチケットIDの集合（未取得なら null を渡す＝アラートを出さない）
 */
export function needsPrLink(
  ticket: Pick<SprintTicket, "id" | "status" | "prLinkWaived">,
  linkedTicketIds: Set<string> | null,
): boolean {
  if (!linkedTicketIds) return false;
  if (!isPrLinkAlertStatus(ticket.status)) return false;
  if (ticket.prLinkWaived) return false;
  return !linkedTicketIds.has(ticket.id);
}

/**
 * プロジェクト内で「PRが紐付いているチケット」を一括で引く。
 *
 * 一覧は行数が多いのでチケット1件ずつAPIを叩かない。ticket_github_links の select は
 * can_access_project で許可されているため、ここは Supabase から直接読む。
 *
 * @param enabled リポジトリが紐付いていないプロジェクトでは false。未取得(null)のまま返し、赤くしない
 */
export function usePrLinkedTickets(projectId: string | undefined, enabled: boolean) {
  const [linkedTicketIds, setLinkedTicketIds] = useState<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    if (!isSupabaseEnabled || !projectId || !enabled) { setLinkedTicketIds(null); return; }
    const { data, error } = await supabase!
      .from("ticket_github_links")
      .select("ticket_id")
      .eq("project_id", projectId)
      .eq("kind", "pull");
    // 取れなかったときは「紐付け無し」と断定しない。誤って全行を赤くしないため null に戻す
    if (error) { setLinkedTicketIds(null); return; }
    setLinkedTicketIds(new Set((data ?? []).map((r: { ticket_id: string }) => r.ticket_id)));
  }, [projectId, enabled]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { linkedTicketIds, refreshPrLinks: refresh };
}

/** 行に出す「!」の説明。工数未入力と同じマークを共用するので、理由を並べて出す */
export function prLinkAlertTitle(): string {
  return "プルリクエストが紐付いていません";
}
