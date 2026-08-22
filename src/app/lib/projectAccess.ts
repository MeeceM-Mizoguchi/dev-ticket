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
// 別組織を 404 に寄せるのは、projects の RLS が authenticated 全許可で
// 他組織の行も読めてしまうため。プロジェクト名を画面に出す前にここで落とす。
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
