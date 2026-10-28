// BRU22-006 議事録・クライアントメモの公開範囲（全員 / 指定したメンバーのみ）。
// 見られる人の判定は DB（RLS。supabase/add_minutes_client_notes_visibility.sql）が行う。
// ここは公開先の読み書きと、画面の出し分けの補助だけを持つ。
//
// ★ 登録（insert）では visibility・owner_id を送らないこと。owner_id はトリガーで入る。
//   SQL 未適用の環境（列が無い）で送ると、登録そのものが失敗する（BRU21-002 の事故と同じ）。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { DocVisibility } from "@/app/types";

export type DocVisibilityKind = "minute" | "client-note";

const TABLES: Record<DocVisibilityKind, { table: string; members: string; fk: string }> = {
  minute: { table: "meeting_minutes", members: "meeting_minute_members", fk: "meeting_minute_id" },
  "client-note": { table: "client_notes", members: "client_note_members", fk: "client_note_id" },
};

/** 公開先に選べる人。role はオーナー（常に見られる）を見分けるのに使う */
export interface DocMemberCandidate { id: string; name: string; role: string }

/** 公開範囲を持つ行（議事録・クライアントメモ）の、ここで使う項目だけ */
export interface DocVisibilityItem {
  id: string;
  parentId: string | null;
  title: string;
  isFolder: boolean;
  visibility: DocVisibility;
  ownerId: string | null;
}

/**
 * 公開範囲の列があるか（SQL 適用済みか）。一覧を select("*") で読んだ生の行から判定する。
 * 列が無い環境では、公開範囲のメニューも鍵の印も出さない（今の挙動のまま）。
 */
export function hasVisibilityColumn(rows: readonly unknown[] | null | undefined): boolean {
  const first = rows?.[0];
  return !!first && typeof first === "object" && "visibility" in first;
}

/** 公開範囲を変えられるか（作成者とオーナー）。owner_id が空の既存の行は、オーナーだけ */
export function canManageDocVisibility(item: { ownerId: string | null }, userId: string | null | undefined, userRole: string | null | undefined): boolean {
  return userRole === "owner" || (!!item.ownerId && item.ownerId === userId);
}

/**
 * 上のフォルダのうち「指定したメンバーのみ」のものを、近い順に返す。
 * フォルダの公開範囲は中身すべてに効くので、本文の上のバッジと、外へ移すときの確認に使う。
 */
export function restrictedAncestors<T extends DocVisibilityItem>(byId: Map<string, T>, item: { parentId: string | null }): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  let cur = item.parentId ? byId.get(item.parentId) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.visibility === "members") out.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

/**
 * item を targetParentId の下へ移したときに外れる「指定したメンバーのみ」のフォルダ。
 * 1つでもあれば、移すと今より多くの人に見えるようになる。
 */
export function restrictionsLostByMove<T extends DocVisibilityItem>(byId: Map<string, T>, item: { parentId: string | null }, targetParentId: string | null): T[] {
  const target = targetParentId ? byId.get(targetParentId) : undefined;
  const kept = new Set<string>();
  if (target) {
    kept.add(target.id);
    for (const f of restrictedAncestors(byId, target)) kept.add(f.id);
  }
  return restrictedAncestors(byId, item).filter(f => !kept.has(f.id));
}

/**
 * 「指定したメンバーのみ」のフォルダの外へ移すときの確認の文言。
 * 外れるフォルダが1つで、その公開先を読める（作成者・オーナー）ときは「○○さん以外にも見えるようになります」と名前を出す。
 * 読めないときは、フォルダの名前だけで伝える（公開先の一覧は作成者とオーナーしか読めないため）。
 */
export async function moveOutConfirmMessage(
  kind: DocVisibilityKind,
  itemTitle: string,
  lost: (DocVisibilityItem & { createdBy: string })[],
  canRead: (folder: DocVisibilityItem) => boolean,
): Promise<string> {
  const folders = lost.map(f => `「${f.title || "無題のフォルダ"}」`).join("");
  if (lost.length === 1 && canRead(lost[0])) {
    const members = await loadDocMembers(kind, lost[0].id);
    if (members) {
      const names = [...new Set([lost[0].createdBy, ...members.map(m => m.name)].filter(Boolean))];
      if (names.length > 0) {
        return `「${itemTitle}」をフォルダ${folders}の外へ移します。移すと${names.map(n => `${n}さん`).join("・")}以外にも見えるようになります。移動しますか？`;
      }
    }
  }
  return `「${itemTitle}」をフォルダ${folders}の外へ移します。このフォルダは公開範囲が「指定したメンバーのみ」のため、移すと今より多くの人に見えるようになります。移動しますか？`;
}

/**
 * 削除のエラーを、画面に出す案内へ読み替える（DB のトリガーが付けた目印を見る）。
 * @param label 「議事録」「メモ」
 */
export function docDeleteErrorMessage(message: string | undefined, isFolder: boolean, label: string): string {
  if (message?.includes("DT_DOC_DELETE_HIDDEN")) return `見られない${label}が入っているため削除できません`;
  if (message?.includes("DT_DOC_DELETE_PROTECTED")) {
    return isFolder
      ? `公開範囲が「指定したメンバーのみ」の、ほかの人の${label}が入っているため削除できません`
      : `この${label}は、作成者とオーナーだけが削除できます`;
  }
  return "削除に失敗しました";
}

/**
 * 議事録の公開先に選べる人（＝そのプロジェクトにアサインされている人）。
 * projects.members は「名前」の配列なので、組織の profiles と名前で突き合わせて id を得る
 * （wbsService の loadWbsMemberCandidates と同じ引き方）。
 */
export async function loadMinuteMemberCandidates(projectId: string, orgId: string | null): Promise<DocMemberCandidate[]> {
  if (!isSupabaseEnabled || !projectId) return [];
  const { data: proj } = await supabase!.from("projects").select("members").eq("id", projectId).maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memberNames = new Set((((proj as any)?.members ?? []) as string[]).filter(Boolean));
  if (memberNames.size === 0) return [];

  let q = supabase!.from("profiles").select("id, name, role").neq("status", "inactive");
  if (orgId) q = q.eq("organization_id", orgId);
  const { data: profiles } = await q.order("name", { ascending: true }).order("id", { ascending: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((profiles ?? []) as any[])
    .filter(p => p.name && memberNames.has(p.name))
    .map(p => ({ id: p.id as string, name: p.name as string, role: (p.role as string) ?? "" }));
}

/**
 * クライアントメモの公開先に選べる人（＝同じ組織の admin・project-manager・owner。無効になった人は除く）。
 * クライアントメモはプロジェクトに属さないので、projects.members ではなく組織の profiles から role で絞る。
 */
export async function loadClientNoteMemberCandidates(orgId: string | null): Promise<DocMemberCandidate[]> {
  if (!isSupabaseEnabled) return [];
  let q = supabase!.from("profiles").select("id, name, role")
    .in("role", ["admin", "project-manager", "owner"]).neq("status", "inactive");
  if (orgId) q = q.eq("organization_id", orgId);
  const { data } = await q.order("name", { ascending: true }).order("id", { ascending: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[])
    .filter(p => p.name)
    .map(p => ({ id: p.id as string, name: p.name as string, role: (p.role as string) ?? "" }));
}

/**
 * その行の公開先（profiles.id と名前）。作成者とオーナーは全件、それ以外は自分宛ての行だけが返る（RLS）。
 * 読めなかったときは null（空の一覧と区別する。保存で「今の公開先」を誤って空と見なさないため）。
 */
export async function loadDocMembers(kind: DocVisibilityKind, id: string): Promise<{ id: string; name: string }[] | null> {
  if (!isSupabaseEnabled) return [];
  const t = TABLES[kind];
  const { data, error } = await supabase!
    .from(t.members).select("profile_id, profiles(name)").eq(t.fk, id)
    .order("created_at", { ascending: true })
    .order("profile_id", { ascending: true });
  if (error) { console.error("[docVisibility] load members failed:", error.message); return null; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(r => ({
    id: r.profile_id as string,
    name: ((Array.isArray(r.profiles) ? r.profiles[0]?.name : r.profiles?.name) as string | undefined) ?? "",
  }));
}

/**
 * 公開範囲を保存する。公開先を先に入れ替えてから visibility を書く
 * （wbsService の saveWbsVisibility と同じ順。逆だと、絞った瞬間に「指定したはずの人」から一瞬見えなくなる）。
 * 「全員」に戻すときは公開先を外す（残すと、次に絞ったとき前の公開先が黙って復活する）。
 */
export async function saveDocVisibility(kind: DocVisibilityKind, id: string, visibility: DocVisibility, profileIds: string[]): Promise<boolean> {
  if (!isSupabaseEnabled) return true;
  const t = TABLES[kind];
  const current = await loadDocMembers(kind, id);
  if (current === null) return false;
  const next = new Set(visibility === "members" ? profileIds : []);
  const toRemove = current.map(m => m.id).filter(pid => !next.has(pid));
  const toAdd = [...next].filter(pid => !current.some(m => m.id === pid));
  if (toRemove.length) {
    const { error } = await supabase!.from(t.members).delete().eq(t.fk, id).in("profile_id", toRemove);
    if (error) { console.error("[docVisibility] remove members failed:", error.message); return false; }
  }
  if (toAdd.length) {
    // 主キー（行・profile_id）で重複を無視する。連打で二重に送られても公開先は1件のまま
    const { error } = await supabase!.from(t.members)
      .upsert(toAdd.map(pid => ({ [t.fk]: id, profile_id: pid })), { onConflict: `${t.fk},profile_id`, ignoreDuplicates: true });
    if (error) { console.error("[docVisibility] add members failed:", error.message); return false; }
  }
  const { data, error } = await supabase!.from(t.table).update({ visibility }).eq("id", id).select("id");
  if (error || !data || data.length === 0) {
    console.error("[docVisibility] update visibility failed:", error?.message ?? "no row updated");
    return false;
  }
  return true;
}
