// ENHA2-053 WBS（作業分解表）のデータ操作。
//
// ここでいう「WBS」は作業分解表のこと。チケット番号（SprintTicket.wbs）とは別物。
// テーブルと RLS は supabase/add_wbs.sql。可視範囲（公開設定）は RLS が絞るので、
// ここに組織やメンバーの条件は要らない。「閲覧のみ／編集可」の出し分けは画面側で行う。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { mapWbsHoliday, mapWbsItem, mapWbsSheet, mapWbsStatus } from "@/app/lib/mappers";
import type { AccessLevel, UserPermissions, WbsHoliday, WbsItem, WbsLevels, WbsSheet, WbsStatus, WbsVisibility } from "@/app/types";

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

// ── ステータス ────────────────────────────────────────────────

export async function loadWbsStatuses(sheetId: string): Promise<WbsStatus[]> {
  if (!isSupabaseEnabled || !sheetId) return [];
  const { data, error } = await supabase!
    .from("wbs_statuses").select("*").eq("wbs_sheet_id", sheetId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) { console.error("[wbs] load statuses failed:", error.message); return []; }
  return (data ?? []).map(mapWbsStatus);
}

export async function createWbsStatus(input: { sheetId: string; name: string; color: string; sortOrder: number }): Promise<WbsStatus | null> {
  if (!isSupabaseEnabled) return null;
  const { data, error } = await supabase!.from("wbs_statuses").insert({
    wbs_sheet_id: input.sheetId, name: input.name, color: input.color, sort_order: input.sortOrder,
  }).select().single();
  if (error || !data) { console.error("[wbs] insert status failed:", error?.message); return null; }
  return mapWbsStatus(data);
}

export async function updateWbsStatus(id: string, patch: { name?: string; color?: string }): Promise<boolean> {
  if (!isSupabaseEnabled) return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.color !== undefined) row.color = patch.color;
  const { error } = await supabase!.from("wbs_statuses").update(row).eq("id", id);
  if (error) { console.error("[wbs] update status failed:", error.message); return false; }
  return true;
}

/** ステータスの並び順を、渡した順に振り直す */
export async function reorderWbsStatuses(orderedIds: string[]): Promise<boolean> {
  if (!isSupabaseEnabled) return true;
  const results = await Promise.all(orderedIds.map((id, i) =>
    supabase!.from("wbs_statuses").update({ sort_order: i * WBS_SORT_GAP }).eq("id", id),
  ));
  const failed = results.find(r => r.error);
  if (failed?.error) { console.error("[wbs] reorder statuses failed:", failed.error.message); return false; }
  return true;
}

/**
 * ステータスを消す。行で使われているときは、先に該当する行を移し先へ付け替える
 * （付け替えずに消すと status_id が空になり、どのステータスだったかが失われる）。
 * includeUnset: status_id が空の行（画面では先頭のステータスとして扱っている）も一緒に移す。
 *   先頭のステータスを消すときに true を渡す。
 */
export async function deleteWbsStatus(input: {
  sheetId: string; statusId: string; moveToId: string | null; includeUnset: boolean;
}): Promise<boolean> {
  if (!isSupabaseEnabled) return true;
  if (input.moveToId) {
    const { error } = await supabase!.from("wbs_items")
      .update({ status_id: input.moveToId }).eq("wbs_sheet_id", input.sheetId).eq("status_id", input.statusId);
    if (error) { console.error("[wbs] move items to status failed:", error.message); return false; }
    if (input.includeUnset) {
      const { error: e2 } = await supabase!.from("wbs_items")
        .update({ status_id: input.moveToId }).eq("wbs_sheet_id", input.sheetId).is("status_id", null);
      if (e2) { console.error("[wbs] move unset items to status failed:", e2.message); return false; }
    }
  }
  const { error } = await supabase!.from("wbs_statuses").delete().eq("id", input.statusId);
  if (error) { console.error("[wbs] delete status failed:", error.message); return false; }
  return true;
}

// ── 行 ────────────────────────────────────────────────────────

/** そのWBSの行を全部取る。木の形への組み立ては画面側（wbsCalc.buildWbsRows）で行う */
export async function loadWbsItems(sheetId: string): Promise<WbsItem[]> {
  if (!isSupabaseEnabled || !sheetId) return [];
  const { data, error } = await supabase!
    .from("wbs_items").select("*").eq("wbs_sheet_id", sheetId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) { console.error("[wbs] load items failed:", error.message); return []; }
  return (data ?? []).map(mapWbsItem);
}

export async function createWbsItem(input: {
  sheetId: string; parentId: string | null; level: number; statusId: string | null; sortOrder: number;
}): Promise<WbsItem | null> {
  if (!isSupabaseEnabled) return null;
  const { data, error } = await supabase!.from("wbs_items").insert({
    wbs_sheet_id: input.sheetId,
    parent_id: input.parentId,
    level: input.level,
    status_id: input.statusId,
    sort_order: input.sortOrder,
  }).select().single();
  if (error || !data) { console.error("[wbs] insert item failed:", error?.message); return null; }
  return mapWbsItem(data);
}

/** 画面の WbsItem 形（camelCase）を受け取り、変更分だけを DB 形へ移して更新する */
export async function updateWbsItem(id: string, patch: Partial<WbsItem>): Promise<boolean> {
  if (!isSupabaseEnabled) return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: Record<string, any> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined)      row.name = patch.name;
  if (patch.assignee !== undefined)  row.assignee = patch.assignee;
  if (patch.startDate !== undefined) row.start_date = patch.startDate || null;
  if (patch.endDate !== undefined)   row.end_date = patch.endDate || null;
  if (patch.progress !== undefined)  row.progress = Math.max(0, Math.min(100, Math.round(patch.progress)));
  if (patch.statusId !== undefined)  row.status_id = patch.statusId;
  if (patch.note !== undefined)      row.note = patch.note;
  if (patch.parentId !== undefined)  row.parent_id = patch.parentId;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
  const { error } = await supabase!.from("wbs_items").update(row).eq("id", id);
  if (error) { console.error("[wbs] update item failed:", error.message); return false; }
  return true;
}

/** 行を消す。下の行と紐づけは on delete cascade で一緒に消える */
export async function deleteWbsItem(id: string): Promise<boolean> {
  if (!isSupabaseEnabled) return true;
  const { error } = await supabase!.from("wbs_items").delete().eq("id", id);
  if (error) { console.error("[wbs] delete item failed:", error.message); return false; }
  return true;
}

/** 中点が潰れたときの採番し直し。渡した順に間隔を空けて振り直す */
export async function renumberWbsItems(orderedIds: string[]): Promise<boolean> {
  if (!isSupabaseEnabled) return true;
  const results = await Promise.all(orderedIds.map((id, i) =>
    supabase!.from("wbs_items").update({ sort_order: i * WBS_SORT_GAP }).eq("id", id),
  ));
  const failed = results.find(r => r.error);
  if (failed?.error) { console.error("[wbs] renumber items failed:", failed.error.message); return false; }
  return true;
}

// ── 祝日（プロジェクトごと） ──────────────────────────────────

export async function loadWbsHolidays(projectId: string): Promise<WbsHoliday[]> {
  if (!isSupabaseEnabled || !projectId) return [];
  const { data, error } = await supabase!
    .from("wbs_holidays").select("*").eq("project_id", projectId)
    .order("holiday_date", { ascending: true })
    .order("id", { ascending: true });
  if (error) { console.error("[wbs] load holidays failed:", error.message); return []; }
  return (data ?? []).map(mapWbsHoliday);
}

export async function createWbsHoliday(input: { projectId: string; date: string; name: string }): Promise<WbsHoliday | null> {
  if (!isSupabaseEnabled) return null;
  const { data, error } = await supabase!.from("wbs_holidays")
    .insert({ project_id: input.projectId, holiday_date: input.date, name: input.name }).select().single();
  if (error || !data) { console.error("[wbs] insert holiday failed:", error?.message); return null; }
  return mapWbsHoliday(data);
}

export async function deleteWbsHoliday(id: string): Promise<boolean> {
  if (!isSupabaseEnabled) return true;
  const { error } = await supabase!.from("wbs_holidays").delete().eq("id", id);
  if (error) { console.error("[wbs] delete holiday failed:", error.message); return false; }
  return true;
}

// ── 行とチケットの紐づけ ──────────────────────────────────────

/**
 * そのWBSの紐づけを全部取り、行ごとにまとめる（行の id → チケットの id の配列）。
 * 行の id を in で並べると行数が多いときにURLが長くなりすぎるので、wbs_items を内部結合して絞る。
 */
export async function loadWbsItemTickets(sheetId: string): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!isSupabaseEnabled || !sheetId) return map;
  const { data, error } = await supabase!
    .from("wbs_item_tickets").select("wbs_item_id, ticket_id, created_at, wbs_items!inner(wbs_sheet_id)")
    .eq("wbs_items.wbs_sheet_id", sheetId)
    .order("created_at", { ascending: true })
    .order("ticket_id", { ascending: true });
  if (error) { console.error("[wbs] load item tickets failed:", error.message); return map; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (data ?? []) as any[]) {
    const list = map.get(r.wbs_item_id);
    if (list) list.push(r.ticket_id); else map.set(r.wbs_item_id, [r.ticket_id]);
  }
  return map;
}

/** 紐づけを足す。すでにある組み合わせは無視する（同じ紐づけを2回登録しない） */
export async function addWbsItemTickets(itemId: string, ticketIds: string[]): Promise<boolean> {
  if (!isSupabaseEnabled || ticketIds.length === 0) return true;
  const { error } = await supabase!.from("wbs_item_tickets")
    .upsert(ticketIds.map(id => ({ wbs_item_id: itemId, ticket_id: id })), { onConflict: "wbs_item_id,ticket_id", ignoreDuplicates: true });
  if (error) { console.error("[wbs] add item tickets failed:", error.message); return false; }
  return true;
}

/** 紐づけを外す。行もチケットも残る */
export async function removeWbsItemTickets(itemId: string, ticketIds: string[]): Promise<boolean> {
  if (!isSupabaseEnabled || ticketIds.length === 0) return true;
  const { error } = await supabase!.from("wbs_item_tickets").delete().eq("wbs_item_id", itemId).in("ticket_id", ticketIds);
  if (error) { console.error("[wbs] remove item tickets failed:", error.message); return false; }
  return true;
}
