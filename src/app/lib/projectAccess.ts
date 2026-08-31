// プロジェクト配下の画面（スプリント/チケット/Wiki/議事録/バックログ/ファイル/タスク等）に
// 入れるかどうかの共通判定。
//
// これまでは画面ごとに条件が微妙に違い、弾いた後は一律 /projects へリダイレクトしていた。
// 404 画面を出すようになって「何と表示するか」が結果に依存するため、ここに一本化する。
//
//   "ok"        … 表示してよい
//   "not-found" … 存在しない、または別組織 → 404。存在自体を明かさない
//   "no-access" … 同じ組織にあるが自分はアサインされていない → 403（アサイン依頼へ誘導）
//
// BRU14-001 以降、この判定は「DB側(RLS)の判定に、画面側でさらに念を入れたもの」になった。
// 以前は projects の RLS が authenticated 全許可で他組織の行まで読めていたため、
// ここが唯一の防波堤だったが、いまは supabase/fix_project_level_rls_BRU14-001.sql の
// project_visible_to() が同じ判定をDB側で行う。ここはもう最後の砦ではないので、
// 「二重に弾く」ことはあっても「ここを緩めれば見える」ことは無い。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";

export type ProjectAccess = "ok" | "not-found" | "no-access";

export interface ProjectAccessViewer {
  userRole: string;
  userName: string;
  userOrgId: string | null;
}

/** Project 型そのものでなくても、この2つさえ持っていれば判定できる。 */
export interface ProjectAccessTarget {
  organizationId?: string | null;
  members?: string[] | null;
}

export function checkProjectAccess(
  project: ProjectAccessTarget | null | undefined,
  viewer: ProjectAccessViewer,
): ProjectAccess {
  if (!project) return "not-found";
  // owner は全プロジェクトを見られる（従来どおり）
  if (viewer.userRole === "owner") return "ok";
  // organization_id が未設定の古いデータは組織チェックを素通りさせる（従来どおり）
  const sameOrg = !project.organizationId || !viewer.userOrgId || project.organizationId === viewer.userOrgId;
  if (!sameOrg) return "not-found";
  return (project.members ?? []).includes(viewer.userName) ? "ok" : "no-access";
}

// ── アサインされていないプロジェクトを開いたときの出し分け（BRU14-001） ──
//
// RLS で行ごと見えなくなったため、未アサインのプロジェクトは
// 画面側から見ると「存在しない」と区別がつかない。そのままだと
// 同じ組織の未アサインPJでも 404 になり、「管理者にアサインを依頼してください」の
// 案内（f6eca9d で入れた 403 画面）が出せなくなる。
//
// そこで判定だけをDBに聞く。RPC はプロジェクトの中身を一切返さず、
// 同じ組織のときに限って名前だけを返す。別組織なら not-found で、
// 存在も名前も返らない。
export interface ProjectAccessHint {
  access: ProjectAccess;
  projectName: string | null;
}

export async function fetchProjectAccessHint(
  slugOrId: string,
): Promise<ProjectAccessHint> {
  if (!isSupabaseEnabled || !supabase) return { access: "not-found", projectName: null };

  const { data, error } = await supabase.rpc("project_access_hint", { p_slug_or_id: slugOrId });
  // RPC 未適用・通信失敗のときは、存在を匂わせない側（404）に倒す。
  if (error) return { access: "not-found", projectName: null };

  const row = Array.isArray(data) ? data[0] : data;
  const access = row?.access as ProjectAccess | undefined;
  if (access !== "ok" && access !== "no-access") return { access: "not-found", projectName: null };
  return { access, projectName: (row?.project_name as string | null) ?? null };
}
