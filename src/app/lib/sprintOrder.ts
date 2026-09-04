import { supabase, isSupabaseEnabled } from "@/lib/supabase";

// BRU10-068 スプリント並び替え
// 並び順の適用範囲。"all" = プロジェクトのメンバー全員 / "personal" = 保存した本人のみ
export type SprintOrderScope = "all" | "personal";

// ── 保存先が2つに分かれている理由 ─────────────────────────────
// projects.sprint_order … 「全員に適用」の並び順。プロジェクトの属性として持つ。
// sprint_orders         … 「個人のみに適用」の並び順（member_id = 本人）。
//
// 当初は共通ぶんも sprint_orders（member_id is null の1行）に置いていたが、
// それだと「プロジェクトは見えるのに、その並び順の行だけ読めない」状態があり得て、
// 後からアサインしたメンバーの画面だけ既定順（開始日順）に戻る不具合になっていた。
// 一覧を開けている＝projects 行は読めている、なので共通ぶんをそこへ移すと
// 「見えているのに並び順だけ届かない」が原理的に起きなくなる。
// 対応するスキーマは supabase/add_project_sprint_order.sql。

/** 旧保存先（sprint_orders の member_id is null）。移行SQL未適用の環境と、
 *  まだ更新前のコードで動いているクライアントを拾うためだけに残している。 */
type OrderRow = { member_id: string | null; sprint_ids: string[] | null };

function asIds(value: unknown): string[] | null {
  return Array.isArray(value) && value.length > 0 ? (value as string[]) : null;
}

/**
 * このユーザーに適用される並び順（sprints.id の配列）を取得する。
 * 個人設定があれば個人設定を、無ければプロジェクト共通の設定を返す。
 * 未設定・Supabase無効時は空配列（＝これまで通り開始日順）。
 */
export async function fetchSprintOrder(projectId: string, userId: string | null): Promise<string[]> {
  if (!isSupabaseEnabled || !projectId) return [];

  const [projectRes, personalRes] = await Promise.all([
    supabase!.from("projects").select("sprint_order").eq("id", projectId).maybeSingle(),
    supabase!.from("sprint_orders").select("member_id, sprint_ids").eq("project_id", projectId),
  ]);

  // 取れなかったときは既定順に落ちる。黙って落ちると「並び替えが効かない」の
  // 原因に辿り着けないので、必ずログへ残す（画面は開始日順のまま動く）。
  // 移行SQL未適用の環境では projects.sprint_order が無く、こちらだけが失敗する。
  if (projectRes.error) console.error("[sprintOrder] 共通の並び順を取得できませんでした:", projectRes.error.message);
  if (personalRes.error) console.error("[sprintOrder] 個人の並び順を取得できませんでした:", personalRes.error.message);

  const rows = (personalRes.data ?? []) as OrderRow[];

  // 優先度は 個人設定 > 共通設定。
  const personal = userId ? asIds(rows.find(r => r.member_id === userId)?.sprint_ids) : null;
  if (personal) return personal;

  const shared = asIds((projectRes.data as { sprint_order?: unknown } | null)?.sprint_order);
  if (shared) return shared;

  // 旧保存先。移行SQL未適用の環境と、更新前のクライアントが書いた行を拾う。
  return asIds(rows.find(r => r.member_id === null)?.sprint_ids) ?? [];
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
 * "all"      … projects.sprint_order へ書き、個人設定をすべて消す。
 *               （個人設定が残っていると「全員が同じ表示になる」を満たせないため）
 *               後からアサインされたメンバーも、この projects 行を読むだけで同じ並びになる。
 * "personal" … 自分の行だけを入れ替える。他メンバーの表示は変わらない。
 *
 * 失敗したら throw する。呼び出し側はエラーを出したうえで、保存後の再読み込みで
 * 「実際にDBに入っている並び順」を画面へ出し直すこと（成功したように見せない）。
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
    // 1) 共通の並び順。ここが正。
    const { error: projErr } = await supabase!
      .from("projects")
      .update({ sprint_order: sprintIds })
      .eq("id", projectId);

    // 2) このプロジェクトの個人設定を解除する（旧保存先の共通行もここで消える）。
    const { error: delErr } = await supabase!
      .from("sprint_orders")
      .delete()
      .eq("project_id", projectId);

    // 3) 旧保存先にも同じ内容を残す。更新前のコードで動いているクライアント向けで、
    //    2) のあとに入れるので一意制約（member_id is null は1件）とぶつからない。
    const { error: legacyErr } = await supabase!.from("sprint_orders").insert({
      project_id: projectId, member_id: null, sprint_ids: sprintIds, updated_by: userName,
    });

    if (projErr) console.error("[sprintOrder] projects.sprint_order の保存に失敗しました:", projErr.message);
    if (delErr) console.error("[sprintOrder] 個人設定の解除に失敗しました:", delErr.message);
    if (legacyErr) console.error("[sprintOrder] 旧保存先への保存に失敗しました:", legacyErr.message);

    // どちらの保存先にも書けなかったときだけ失敗。片方でも入っていれば
    // 他のメンバーの画面には並び順が届くので、成功として扱う。
    if (projErr && legacyErr) throw new Error(projErr.message);
    return;
  }

  if (!userId) return;
  await supabase!.from("sprint_orders").delete().eq("project_id", projectId).eq("member_id", userId);
  const { error } = await supabase!.from("sprint_orders").insert({
    project_id: projectId, member_id: userId, sprint_ids: sprintIds, updated_by: userName,
  });
  if (error) {
    console.error("[sprintOrder] 個人の並び順の保存に失敗しました:", error.message);
    throw new Error(error.message);
  }
}
