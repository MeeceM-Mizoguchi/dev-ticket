import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { mapBacklogAttachment } from "@/app/lib/mappers";
import { getExt } from "@/app/lib/projectFiles";
import { MAX_ATTACHMENT_BYTES } from "@/app/lib/ticketAttachments";
import type { BacklogAttachment } from "@/app/types";

// BRU24-001 バックログ項目の採番と添付ファイル。
// 添付の実体はチケットと同じ public バケット `ticket-files`、メタは backlog_attachments テーブル。
// チケット⇔バックログの移動では実体はコピーせず、行だけを付け替える。
// supabase/add_backlog_parent_attachments_BRU24-001.sql

const BUCKET = "ticket-files";

export function formatBacklogId(no: number): string {
  return `B-${String(no).padStart(3, "0")}`;
}

/**
 * バックログ項目の番号を count 件ぶん予約して返す（"B-001" 形式）。
 * DB の reserve_backlog_ids() で採番するので、外部API・別タブと同時に登録しても重ならない。
 * 関数が未適用の環境では従来どおり「最大番号＋1」から振る。
 */
export async function reserveBacklogIds(projectId: string, count: number): Promise<string[]> {
  if (count < 1) return [];
  const { data, error } = await supabase!.rpc("reserve_backlog_ids", { p_project_id: projectId, p_count: count });
  let start = typeof data === "number" ? data : NaN;
  if (error || !Number.isFinite(start)) {
    if (error) console.warn("[backlogItems] reserve_backlog_ids が使えないため最大番号＋1で採番します:", error.message);
    const { data: maxRow } = await supabase!
      .from("backlog_items").select("id")
      .eq("project_id", projectId)
      .like("id", "B-%")
      .order("id", { ascending: false }).limit(1).maybeSingle();
    start = (parseInt(maxRow?.id?.slice(2) ?? "0", 10) || 0) + 1;
  }
  return Array.from({ length: count }, (_, i) => formatBacklogId(start + i));
}

function storageKey(projectId: string, itemId: string, fileName: string): string {
  const ext = getExt(fileName);
  return `backlog/${projectId}/${itemId}/attachments/${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext ? `.${ext}` : ""}`;
}

/** バックログ項目の添付ファイル一覧。BUG-01 対策で created_at + id の安定ソート。 */
export async function fetchBacklogAttachments(projectId: string, itemId: string): Promise<BacklogAttachment[]> {
  if (!isSupabaseEnabled || !projectId || !itemId) return [];
  const { data, error } = await supabase!
    .from("backlog_attachments")
    .select("*")
    .eq("project_id", projectId)
    .eq("item_id", itemId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    console.error("[backlogItems] 添付の取得に失敗:", error.message);
    return [];
  }
  return (data ?? []).map(mapBacklogAttachment);
}

/** 1件アップロードして DB に登録する。失敗時は理由を Error で投げる。 */
export async function uploadBacklogAttachment(
  projectId: string, itemId: string, file: File, uploadedBy: string,
): Promise<BacklogAttachment> {
  if (!isSupabaseEnabled) throw new Error("ファイル添付にはログインが必要です");
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`「${file.name}」は50MBを超えているため添付できません`);
  }

  const path = storageKey(projectId, itemId, file.name);
  const { error: upErr } = await supabase!.storage.from(BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
  if (upErr) throw new Error(`「${file.name}」のアップロードに失敗しました: ${upErr.message}`);

  const { data: urlData } = supabase!.storage.from(BUCKET).getPublicUrl(path);
  const { data, error } = await supabase!.from("backlog_attachments").insert({
    project_id: projectId,
    item_id: itemId,
    file_name: file.name,
    file_size: file.size,
    file_type: file.type || "",
    file_path: path,
    file_url: urlData.publicUrl,
    uploaded_by: uploadedBy || "",
  }).select().single();

  if (error || !data) {
    try { await supabase!.storage.from(BUCKET).remove([path]); } catch { /* 後始末なので握りつぶす */ }
    throw new Error(`「${file.name}」の登録に失敗しました: ${error?.message ?? "unknown"}`);
  }
  return mapBacklogAttachment(data);
}

/** 添付を削除する（DB行 → ストレージ実体の順）。 */
export async function deleteBacklogAttachment(attachment: BacklogAttachment): Promise<void> {
  if (!isSupabaseEnabled) return;
  const { error } = await supabase!.from("backlog_attachments").delete().eq("id", attachment.id);
  if (error) throw new Error(`削除に失敗しました: ${error.message}`);
  if (attachment.filePath) {
    const { error: rmErr } = await supabase!.storage.from(BUCKET).remove([attachment.filePath]);
    if (rmErr) console.warn("[backlogItems] 実体の削除に失敗:", rmErr.message);
  }
}

/** バックログ項目の削除に伴う後始末（行には FK が無いので、行も実体もここで消す）。 */
export async function purgeBacklogAttachments(projectId: string, itemIds: string[]): Promise<void> {
  if (!isSupabaseEnabled || itemIds.length === 0) return;
  const { data } = await supabase!
    .from("backlog_attachments").select("file_path").eq("project_id", projectId).in("item_id", itemIds);
  const paths = (data ?? []).map(r => r.file_path as string).filter(Boolean);
  if (paths.length > 0) {
    const { error } = await supabase!.storage.from(BUCKET).remove(paths);
    if (error) console.warn("[backlogItems] 実体の一括削除に失敗:", error.message);
  }
  await supabase!.from("backlog_attachments").delete().eq("project_id", projectId).in("item_id", itemIds);
}
