import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { computeSprintStatus } from "@/app/lib/helpers";
import type { Sprint, SprintTicket } from "@/app/types";

// チケットのステータス変更／保留／取下のたびに、所属スプリントの完了判定を
// computeSprintStatus で計算し直し、DBの sprints.status へ反映する。
//
// 表示側は常に computeSprintStatus（ライブ計算）を使うため、この同期は主に
// EditSprintDialog のプリセット値など「DB保存値を直接読む箇所」との整合のために行う。
//
// 注意: DBの sprints.status 制約は planning / active / completed / cancelled のみ。
// computeSprintStatus が返す "delayed"（締切超過の表示専用値）は保存できないため
// active に丸める（EditSprintDialog が delayed→planning に丸めるのと同じく表示専用扱い）。
export async function syncSprintStatusInDb(sprintId?: string): Promise<void> {
  if (!isSupabaseEnabled || !sprintId) return;
  try {
    const [{ data: sprintRow }, { data: ticketRows }] = await Promise.all([
      supabase!.from("sprints").select("end_date").eq("id", sprintId).single(),
      supabase!.from("sprint_tickets").select("status, progress").eq("sprint_id", sprintId),
    ]);
    if (!ticketRows) return;

    const tickets = ticketRows.map(r => ({
      status: r.status as SprintTicket["status"],
      progress: r.progress as number,
    })) as SprintTicket[];

    const computed = computeSprintStatus({
      tickets,
      endDate: sprintRow?.end_date ?? "",
    } as Sprint);

    // delayed はDB制約に無いため active として保存
    const dbStatus = computed === "delayed" ? "active" : computed;

    await supabase!.from("sprints").update({ status: dbStatus }).eq("id", sprintId);
  } catch (e) {
    // 同期失敗はユーザー操作を止めない（表示は computeSprintStatus が担保する）
    console.error("syncSprintStatusInDb failed:", e);
  }
}
