// ENHA2-053 WBS（作業分解表）のデータ操作。
//
// ここでいう「WBS」は作業分解表のこと。チケット番号（SprintTicket.wbs）とは別物。
// テーブルと RLS は supabase/add_wbs.sql。可視範囲（公開設定）は RLS が絞るので、
// ここに組織やメンバーの条件は要らない。「閲覧のみ／編集可」の出し分けは画面側で行う。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { mapWbsSheet } from "@/app/lib/mappers";
import type { AccessLevel, UserPermissions, WbsLevels, WbsSheet, WbsVisibility } from "@/app/types";

/** 並びの初期間隔。追加は末尾に積み、並べ替えは前後の中点を採る（tasks.sort_order と同じ） */
export const WBS_SORT_GAP = 1024;

/** 段の名前。添字は level - 1 */
export const WBS_LEVEL_LABELS = ["大項目", "中項目", "小項目"] as const;

export const WBS_LEVEL_OPTIONS: { value: WbsLevels; label: string }[] = [
  { value: 3, label: "3段（大・中・小）" },
  { value: 2, label: "2段（大・中）" },
  { value: 1, label: "1段（大のみ）" },
];

/**
 * 新しいWBSに入れる既定のステータス。色は参考の Excel に合わせてある
 * （未着手=薄いグレー / 着手中=薄い青紫 / 完了=薄い緑 / 保留=薄い黄）。
 * 取下は Excel に無いので、未着手より一段濃いグレーにした。
 */
export const DEFAULT_WBS_STATUSES: { name: string; color: string }[] = [
  { name: "未着手", color: "#EDECF4" },
  { name: "着手中", color: "#DCE0FF" },
  { name: "完了", color: "#D1F9E4" },
  { name: "取下", color: "#D5D9E0" },
  { name: "保留", color: "#FDF3C6" },
];

// ── 権限 ──────────────────────────────────────────────────────

/**
 * WBSの権限（権限なし／閲覧のみ／編集可）。他のページ権限と同じ解決:
 * owner・admin は編集可、それ以外はアサイン計画（project_member_permissions）の値。
 */
export async function loadWbsPermission(projectId: string, userId: string, isAdminRole: boolean): Promise<AccessLevel> {
  if (isAdminRole) return "edit";
  if (!isSupabaseEnabled || !projectId || !userId) return "none";
  const { data } = await supabase!
    .from("project_member_permissions").select("permissions")
    .eq("project_id", projectId).eq("member_id", userId).maybeSingle();
  const perms = data?.permissions as Partial<UserPermissions> | null | undefined;
  return (perms?.wbsPermission as AccessLevel | undefined) ?? "none";
}

// ── WBS本体 ───────────────────────────────────────────────────

/** そのプロジェクトで見られるWBSを並び順で取る */
export async function loadWbsSheets(projectId: string): Promise<WbsSheet[]> {
  if (!isSupabaseEnabled || !projectId) return [];
  const { data, error } = await supabase!
    .from("wbs_sheets").select("*").eq("project_id", projectId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) { console.error("[wbs] load sheets failed:", error.message); return []; }
  return (data ?? []).map(mapWbsSheet);
}

/**
 * WBSを作る。3段・全メンバー公開・既定の5ステータスで始まる。
 * ステータスが入らなかったときは本体ごと取り消す（ステータスの無いWBSを残さないため）。
 */
export async function createWbsSheet(input: {
  projectId: string; name: string; userId: string; userName: string;
  /** 末尾に積むための基準値（いまある中で最大の sort_order） */
  maxSortOrder: number | null;
}): Promise<WbsSheet | null> {
  if (!isSupabaseEnabled) return null;
  const { data, error } = await supabase!.from("wbs_sheets").insert({
    project_id: input.projectId,
    name: input.name,
    levels: 3,
    visibility: "project",
    created_by: input.userId,
    created_by_name: input.userName,
    sort_order: input.maxSortOrder == null ? 0 : input.maxSortOrder + WBS_SORT_GAP,
  }).select().single();
  if (error || !data) { console.error("[wbs] insert sheet failed:", error?.message); return null; }

  const { error: stErr } = await supabase!.from("wbs_statuses").insert(
    DEFAULT_WBS_STATUSES.map((s, i) => ({ wbs_sheet_id: data.id, name: s.name, color: s.color, sort_order: i * WBS_SORT_GAP })),
  );
  if (stErr) {
    console.error("[wbs] insert default statuses failed:", stErr.message);
    await supabase!.from("wbs_sheets").delete().eq("id", data.id);
    return null;
  }
  return mapWbsSheet(data);
}

export async function updateWbsSheet(id: string, patch: { name?: string; levels?: WbsLevels }): Promise<boolean> {
  if (!isSupabaseEnabled) return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.levels !== undefined) row.levels = patch.levels;
  const { error } = await supabase!.from("wbs_sheets").update(row).eq("id", id);
  if (error) { console.error("[wbs] update sheet failed:", error.message); return false; }
  return true;
}

/** WBSを消す。行・ステータス・紐づけ・公開先は on delete cascade で一緒に消える */
export async function deleteWbsSheet(id: string): Promise<boolean> {
  if (!isSupabaseEnabled) return true;
  const { error } = await supabase!.from("wbs_sheets").delete().eq("id", id);
  if (error) { console.error("[wbs] delete sheet failed:", error.message); return false; }
  return true;
}

/** 指定した段より下にある行（段数を減らせるかの判定と、対象行の強調に使う） */
export async function loadWbsItemsBelowLevel(sheetId: string, levels: number): Promise<{ id: string; level: number }[]> {
  if (!isSupabaseEnabled) return [];
  const { data, error } = await supabase!
    .from("wbs_items").select("id, level").eq("wbs_sheet_id", sheetId).gt("level", levels)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) { console.error("[wbs] load items below level failed:", error.message); return []; }
  return (data ?? []) as { id: string; level: number }[];
}

// ── 公開設定 ──────────────────────────────────────────────────

export interface WbsMemberCandidate { id: string; name: string }

/**
 * 公開先に選べるメンバー（＝そのプロジェクトにアサインされている人）。
 * projects.members は「名前」の配列なので、組織の profiles と名前で突き合わせて id を得る
 * （wbs_sheet_members.profile_id は profiles.id）。whiteboardService の loadShareCandidates と同じ引き方。
 */
export async function loadWbsMemberCandidates(projectId: string, orgId: string | null): Promise<WbsMemberCandidate[]> {
  if (!isSupabaseEnabled || !projectId) return [];
  const { data: proj } = await supabase!.from("projects").select("members").eq("id", projectId).maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memberNames = new Set((((proj as any)?.members ?? []) as string[]).filter(Boolean));
  if (memberNames.size === 0) return [];

  let q = supabase!.from("profiles").select("id, name").neq("status", "inactive");
  if (orgId) q = q.eq("organization_id", orgId);
  const { data: profiles } = await q.order("name", { ascending: true }).order("id", { ascending: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((profiles ?? []) as any[])
    .filter(p => p.name && memberNames.has(p.name))
    .map(p => ({ id: p.id as string, name: p.name as string }));
}

/** そのWBSの公開先（profiles.id の配列）。作成者とオーナーだけが全件を読める */
export async function loadWbsSheetMemberIds(sheetId: string): Promise<string[]> {
  if (!isSupabaseEnabled) return [];
  const { data, error } = await supabase!
    .from("wbs_sheet_members").select("profile_id").eq("wbs_sheet_id", sheetId)
    .order("created_at", { ascending: true })
    .order("profile_id", { ascending: true });
  if (error) { console.error("[wbs] load sheet members failed:", error.message); return []; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(r => r.profile_id as string);
}

/**
 * 公開設定を保存する。公開先を先に入れ替えてから visibility を書く
 * （逆順だと、絞った瞬間に「指定したはずの人」から一瞬見えなくなる）。
 * 「プロジェクトの全メンバー」に戻すときも公開先は消さず残す（もう一度絞るときに選び直さなくて済む）。
 */
export async function saveWbsVisibility(sheetId: string, visibility: WbsVisibility, profileIds: string[]): Promise<boolean> {
  if (!isSupabaseEnabled) return true;
  if (visibility === "members") {
    const current = await loadWbsSheetMemberIds(sheetId);
    const next = new Set(profileIds);
    const toRemove = current.filter(id => !next.has(id));
    const toAdd = profileIds.filter(id => !current.includes(id));
    if (toRemove.length) {
      const { error } = await supabase!.from("wbs_sheet_members").delete().eq("wbs_sheet_id", sheetId).in("profile_id", toRemove);
      if (error) { console.error("[wbs] remove sheet members failed:", error.message); return false; }
    }
    if (toAdd.length) {
      const { error } = await supabase!.from("wbs_sheet_members")
        .upsert(toAdd.map(id => ({ wbs_sheet_id: sheetId, profile_id: id })), { onConflict: "wbs_sheet_id,profile_id", ignoreDuplicates: true });
      if (error) { console.error("[wbs] add sheet members failed:", error.message); return false; }
    }
  }
  const { error } = await supabase!.from("wbs_sheets")
    .update({ visibility, updated_at: new Date().toISOString() }).eq("id", sheetId);
  if (error) { console.error("[wbs] update visibility failed:", error.message); return false; }
  return true;
}
