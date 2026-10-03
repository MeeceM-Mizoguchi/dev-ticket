// ファイルボックスの「見てよいか」「消してよいか」の判定（サーバー側API共通）。
//
// ── なぜ必要か ──────────────────────────────────────────────
// api/* は service_role で Supabase に繋ぐので RLS が効かない。限定公開（project_files.acl_id）は
// 画面からの読み出しなら RLS（supabase/add_file_box_private.sql）が絞るが、署名付きURLの発行・
// WebDAV・Googleドライブの操作はここを通るため、同じ規則を API 側でも毎回確かめる。
//
// 規則（RLS の dt_rls_project_files_acl と揃えること）:
//   見てよい人 … 限定公開でない / 所有者 / 共有先 / オーナー（role='owner'）
//   消してよい人 … 所有者 / オーナー / アサイン計画で「ファイルの削除」を付けたメンバー
import type { SupabaseClient } from "@supabase/supabase-js";

export type FileActor = { id: string; role?: string | null };
export type FileAclRow = { owner_id?: unknown; acl_id?: unknown };

export function isPlatformOwner(actor: FileActor): boolean {
  return actor.role === "owner";
}

export function isFileOwner(actor: FileActor, row: FileAclRow): boolean {
  return !!row.owner_id && String(row.owner_id) === actor.id;
}

/** id だけ分かっている相手（WebDAV のトークンなど）を、判定に使える形にする。見つからなければ null */
export async function fileActorById(sb: SupabaseClient, userId: string): Promise<FileActor | null> {
  if (!userId) return null;
  const { data } = await sb.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data ? { id: userId, role: (data.role as string | null) ?? null } : null;
}

/** その人が共有先になっている限定公開の id。何件も判定するときに1回だけ引いて使い回す */
export async function sharedAclIds(sb: SupabaseClient, actor: FileActor): Promise<Set<string>> {
  const { data } = await sb.from("project_file_acl_members").select("acl_id").eq("profile_id", actor.id);
  return new Set((data ?? []).map(r => String(r.acl_id)));
}

/** sharedAclIds を引いてある前提の、問い合わせなしの判定 */
export function seesFileRow(actor: FileActor, row: FileAclRow, shared: Set<string>): boolean {
  if (!row.acl_id) return true;
  return isPlatformOwner(actor) || isFileOwner(actor, row) || shared.has(String(row.acl_id));
}

export async function canSeeFile(sb: SupabaseClient, actor: FileActor, row: FileAclRow): Promise<boolean> {
  if (!row.acl_id) return true;
  if (isPlatformOwner(actor) || isFileOwner(actor, row)) return true;
  const { data } = await sb.from("project_file_acl_members")
    .select("profile_id").eq("acl_id", String(row.acl_id)).eq("profile_id", actor.id).maybeSingle();
  return !!data;
}

/** 自分のものでないファイルも削除できるか（オーナー、またはアサイン計画の「ファイルの削除」） */
export async function hasFileDeletePermission(
  sb: SupabaseClient, actor: FileActor, projectId: string,
): Promise<boolean> {
  if (isPlatformOwner(actor)) return true;
  const { data } = await sb.from("project_member_permissions")
    .select("permissions").eq("project_id", projectId).eq("member_id", actor.id).maybeSingle();
  return (data?.permissions as { canDeleteFiles?: unknown } | null)?.canDeleteFiles === true;
}

type TreeRow = { id: string; parent_id: string | null; owner_id: string | null; acl_id: string | null };

/**
 * そのファイル／フォルダを削除してよいか。だめなら利用者に見せる理由を返す（null なら削除してよい）。
 *
 * フォルダは行を消すと中身も DB のカスケードで消える。そのため中身まで見て、
 *   ・見えないファイル（他の人の限定公開）が1つでも入っていれば、誰であっても止める
 *   ・削除権限が無い人は、フォルダも中身もすべて自分のものであるときだけ消せる
 * とする。
 */
export async function fileDeleteBlocker(
  sb: SupabaseClient, actor: FileActor,
  target: { id: string; project_id: string; is_folder?: unknown } & FileAclRow,
): Promise<string | null> {
  const projectId = String(target.project_id);
  const isFolder = !!target.is_folder;
  if (!(await canSeeFile(sb, actor, target))) return "ファイルが見つかりません";

  const privileged = await hasFileDeletePermission(sb, actor, projectId);
  if (!isFolder) {
    return privileged || isFileOwner(actor, target)
      ? null
      : "このファイルを削除できるのは、追加した人と、削除の権限を持つメンバーだけです";
  }

  // 1回で全件引いてメモリ上で辿る（階層ごとに問い合わせると深さの分だけ往復が増える）
  const { data: rows } = await sb.from("project_files")
    .select("id, parent_id, owner_id, acl_id").eq("project_id", projectId);
  const byParent = new Map<string, TreeRow[]>();
  for (const r of (rows ?? []) as TreeRow[]) {
    const key = String(r.parent_id ?? "");
    const bucket = byParent.get(key);
    if (bucket) bucket.push(r); else byParent.set(key, [r]);
  }
  const shared = await sharedAclIds(sb, actor);
  let allMine = isFileOwner(actor, target);
  const visited = new Set<string>();
  const stack = [String(target.id)];
  while (stack.length) {
    const current = stack.pop() as string;
    if (visited.has(current)) continue; // 万一 parent_id に循環があっても止まる
    visited.add(current);
    for (const child of byParent.get(current) ?? []) {
      if (!seesFileRow(actor, child, shared)) {
        return "ほかのメンバーが限定公開にしているファイルが含まれているため、このフォルダは削除できません";
      }
      if (!isFileOwner(actor, child)) allMine = false;
      stack.push(String(child.id));
    }
  }
  return privileged || allMine
    ? null
    : "このフォルダには、ほかのメンバーが追加したフォルダやファイルが含まれています。削除できるのは、削除の権限を持つメンバーだけです";
}
