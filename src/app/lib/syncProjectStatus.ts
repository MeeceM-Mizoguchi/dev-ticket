import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { computeProjectStatus, countTicketBuckets } from "@/app/lib/helpers";
import type { ProjectStatus } from "@/app/types";

// チケットのステータス変更／追加／削除のたびに、所属プロジェクトの進行状況を
// computeProjectStatus で計算し直し、DBの projects.status へ反映する。
//
// 表示側（プロジェクト一覧・ダッシュボード）はライブ計算した値を出すが、
// 保存値を直接読む箇所（グローバル検索・編集ダイアログの初期値など）との
// 整合のためにDBへも書き戻す。
// is_manual_status が true のプロジェクトはユーザーの手動設定を尊重して触らない。

// 計算済みのステータスをDBへ書き戻す（差分がある場合のみ呼ぶ想定）
export async function writeProjectStatusInDb(projectId: string, status: ProjectStatus): Promise<void> {
  if (!isSupabaseEnabled || !projectId) return;
  try {
    // is_manual_status が null の旧データも自動設定扱いにする
    await supabase!.from("projects").update({ status }).eq("id", projectId)
      .or("is_manual_status.is.null,is_manual_status.eq.false");
  } catch (e) {
    // 同期失敗はユーザー操作を止めない（表示はライブ計算が担保する）
    console.error("writeProjectStatusInDb failed:", e);
  }
}

// プロジェクト配下の全チケットを読み直してステータスを再計算・保存する
export async function syncProjectStatusInDb(projectId?: string | null): Promise<void> {
  if (!isSupabaseEnabled || !projectId) return;
  try {
    const [{ data: projectRow }, { data: sprintRows }] = await Promise.all([
      supabase!.from("projects").select("status, is_manual_status").eq("id", projectId).single(),
      supabase!.from("sprints").select("id, sprint_tickets(*)").eq("project_id", projectId),
    ]);
    if (!projectRow || projectRow.is_manual_status) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tickets = (sprintRows ?? []).flatMap((s: any) => s.sprint_tickets ?? []);
    const counts = countTicketBuckets(tickets);
    const computed = computeProjectStatus({
      status: projectRow.status as ProjectStatus,
      isManualStatus: false,
      ...counts,
    });
    if (computed === projectRow.status) return;

    await writeProjectStatusInDb(projectId, computed);
  } catch (e) {
    console.error("syncProjectStatusInDb failed:", e);
  }
}

// スプリントIDしか手元に無い箇所（チケット詳細・スプリントボード）向け
export async function syncProjectStatusBySprintId(sprintId?: string | null): Promise<void> {
  if (!isSupabaseEnabled || !sprintId) return;
  try {
    const { data } = await supabase!.from("sprints").select("project_id").eq("id", sprintId).single();
    await syncProjectStatusInDb(data?.project_id);
  } catch (e) {
    console.error("syncProjectStatusBySprintId failed:", e);
  }
}
