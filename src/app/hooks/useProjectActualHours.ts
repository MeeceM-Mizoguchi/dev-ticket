import { useEffect, useState } from "react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { calcTicketActualHours } from "@/app/lib/helpers";

export function useProjectActualHours(projectId: string | null | undefined) {
  const [actualHours, setActualHours] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId || !isSupabaseEnabled) {
      setActualHours(null);
      return;
    }
    setLoading(true);
    // N+1を避けるため、スプリントとチケットのマイルストーンを1回のJOINクエリで取得
    supabase!
      .from("sprints")
      .select("sprint_tickets(started_at, review_requested_at, review_approved_at, stg_completed_at, uat_completed_at, released_at, actual_work_hours)")
      .eq("project_id", projectId)
      .then(({ data }) => {
        if (!data) { setActualHours(null); return; }
        let total = 0;
        for (const sprint of data) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tickets = (sprint.sprint_tickets as any[]) ?? [];
          for (const t of tickets) {
            total += calcTicketActualHours({
              startedAt: t.started_at,
              reviewRequestedAt: t.review_requested_at,
              reviewApprovedAt: t.review_approved_at,
              stgCompletedAt: t.stg_completed_at,
              uatCompletedAt: t.uat_completed_at,
              releasedAt: t.released_at,
              actualWorkHours: t.actual_work_hours ?? null,
            });
          }
        }
        setActualHours(Math.round(total * 10) / 10);
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  return { actualHours, loading };
}
