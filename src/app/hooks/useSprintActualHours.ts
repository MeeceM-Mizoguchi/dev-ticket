import { useEffect, useState } from "react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { calcTicketActualHours } from "@/app/lib/helpers";

export function useSprintActualHours(sprintId: string | null | undefined) {
  const [actualHours, setActualHours] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sprintId || !isSupabaseEnabled) {
      setActualHours(null);
      return;
    }
    setLoading(true);
    supabase!
      .from("sprint_tickets")
      .select("started_at, review_requested_at, review_approved_at, stg_completed_at, uat_completed_at, released_at")
      .eq("sprint_id", sprintId)
      .then(({ data }) => {
        if (!data) { setActualHours(null); return; }
        const total = data.reduce(
          (sum, t) => sum + calcTicketActualHours({
            startedAt: t.started_at,
            reviewRequestedAt: t.review_requested_at,
            reviewApprovedAt: t.review_approved_at,
            stgCompletedAt: t.stg_completed_at,
            uatCompletedAt: t.uat_completed_at,
            releasedAt: t.released_at,
          }),
          0
        );
        setActualHours(Math.round(total * 10) / 10);
      })
      .finally(() => setLoading(false));
  }, [sprintId]);

  return { actualHours, loading };
}
