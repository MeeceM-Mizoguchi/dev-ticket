import { supabase, isSupabaseEnabled } from "@/lib/supabase";

// BRU10-068 スプリント並び替え
// 並び順の適用範囲。"all" = プロジェクトのメンバー全員 / "personal" = 保存した本人のみ
export type SprintOrderScope = "all" | "personal";

/**
 * このユーザーに適用される並び順（sprints.id の配列）を取得する。
 * 個人設定があれば個人設定を、無ければプロジェクト共通の設定を返す。
 * 未設定・Supabase無効時は空配列（＝これまで通り開始日順）。
 */
export async function fetchSprintOrder(projectId: string, userId: string | null): Promise<string[]> {
  if (!isSupabaseEnabled || !projectId) return [];
  const { data } = await supabase!
    .from("sprint_orders")
    .select("member_id, sprint_ids")
    .eq("project_id", projectId);
  if (!data?.length) return [];
  const personal = userId ? data.find(r => r.member_id === userId) : undefined;
  const shared = data.find(r => r.member_id === null);
  const ids = (personal ?? shared)?.sprint_ids;
  return Array.isArray(ids) ? (ids as string[]) : [];
}

/**
 * 取得済みのスプリント配列へ並び順を適用する。
 * 並び順に含まれないスプリント（保存後に作成されたもの）は末尾へ回し、
 * 元の順序（開始日順）を保つ。Array#sort は安定ソートなので同順位は入力順のまま。
 */
export function applySprintOrder<T extends { id: string }>(sprints: T[], order: string[]): T[] {
  if (!order.length) return sprints;
  const rank = new Map(order.map((id, i) => [id, i]));
  const last = Number.MAX_SAFE_INTEGER;
  return [...sprints].sort((a, b) => (rank.get(a.id) ?? last) - (rank.get(b.id) ?? last));
}

/**
 * 並び順を保存する。
 * "all"      … プロジェクトの並び順を一度すべて消してから共通の1件を入れる。
 *               （個人設定が残っていると「全員が同じ表示になる」を満たせないため）
 * "personal" … 自分の行だけを入れ替える。他メンバーの表示は変わらない。
 */
export async function saveSprintOrder(
  projectId: string,
  userId: string | null,
  sprintIds: string[],
  scope: SprintOrderScope,
  userName = "",
): Promise<void> {
  if (!isSupabaseEnabled || !projectId) return;
  if (scope === "all") {
    await supabase!.from("sprint_orders").delete().eq("project_id", projectId);
    await supabase!.from("sprint_orders").insert({
      project_id: projectId, member_id: null, sprint_ids: sprintIds, updated_by: userName,
    });
    return;
  }
  if (!userId) return;
  await supabase!.from("sprint_orders").delete().eq("project_id", projectId).eq("member_id", userId);
  await supabase!.from("sprint_orders").insert({
    project_id: projectId, member_id: userId, sprint_ids: sprintIds, updated_by: userName,
  });
}
