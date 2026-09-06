import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { mapTicketAttachment } from "@/app/lib/mappers";
import { getExt, fetchFileWithRetry } from "@/app/lib/projectFiles";
import type { TicketAttachment } from "@/app/types";

// チケット本体の添付ファイル（画像添付のファイル版）。
// 実体は public バケット `ticket-files`、メタは ticket_attachments テーブル。
// supabase/add_ticket_attachments.sql

const BUCKET = "ticket-files";

/** バケット側の上限（fix_all.sql / add_ticket_attachments.sql の file_size_limit と合わせる） */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/**
 * ストレージのキーを組み立てる。
 * 日本語ファイル名をキーに使うと環境によって取り回しが崩れるため、
 * キーは常に ASCII の乱数＋拡張子にして、表示名は DB の file_name で持つ。
 * （api/project-files/[action].ts の upload-url と同じ方針）
 */
function storageKey(ticketId: string, fileName: string): string {
  const ext = getExt(fileName);
  return `tickets/${ticketId}/attachments/${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext ? `.${ext}` : ""}`;
}

/** チケットの添付ファイル一覧。BUG-01 対策で created_at + id の安定ソート。 */
export async function fetchTicketAttachments(ticketId: string): Promise<TicketAttachment[]> {
  if (!isSupabaseEnabled || !ticketId) return [];
  const { data, error } = await supabase!
    .from("ticket_attachments")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    console.error("[ticketAttachments] 一覧の取得に失敗:", error.message);
    return [];
  }
  return (data ?? []).map(mapTicketAttachment);
}

/**
 * 1件アップロードして DB に登録する。
 * 失敗時は理由を Error で投げる（呼び出し側でトーストに出す）。
 */
export async function uploadTicketAttachment(
  ticketId: string, file: File, uploadedBy: string,
): Promise<TicketAttachment> {
  if (!isSupabaseEnabled) throw new Error("ファイル添付にはログインが必要です");
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`「${file.name}」は50MBを超えているため添付できません`);
  }

  const path = storageKey(ticketId, file.name);
  const { error: upErr } = await supabase!.storage.from(BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
  if (upErr) throw new Error(`「${file.name}」のアップロードに失敗しました: ${upErr.message}`);

  const { data: urlData } = supabase!.storage.from(BUCKET).getPublicUrl(path);
  const { data, error } = await supabase!.from("ticket_attachments").insert({
    ticket_id: ticketId,
    file_name: file.name,
    file_size: file.size,
    file_type: file.type || "",
    file_path: path,
    file_url: urlData.publicUrl,
    uploaded_by: uploadedBy || "",
  }).select().single();

  if (error || !data) {
    // DB 登録に失敗したら実体を残さない（孤児ファイルを作らない）
    try { await supabase!.storage.from(BUCKET).remove([path]); } catch { /* 後始末なので握りつぶす */ }
    throw new Error(`「${file.name}」の登録に失敗しました: ${error?.message ?? "unknown"}`);
  }
  return mapTicketAttachment(data);
}

/** 添付を削除する（DB行 → ストレージ実体の順）。 */
export async function deleteTicketAttachment(attachment: TicketAttachment): Promise<void> {
  if (!isSupabaseEnabled) return;
  const { error } = await supabase!.from("ticket_attachments").delete().eq("id", attachment.id);
  if (error) throw new Error(`削除に失敗しました: ${error.message}`);
  if (attachment.filePath) {
    // 実体の削除に失敗しても一覧からは消えているので、ここでは止めない
    const { error: rmErr } = await supabase!.storage.from(BUCKET).remove([attachment.filePath]);
    if (rmErr) console.warn("[ticketAttachments] 実体の削除に失敗:", rmErr.message);
  }
}

/**
 * ダウンロード。
 * 公開URLを直接 <a download> に渡すと保存名がストレージキー（乱数）になってしまうため、
 * 一度 Blob にしてから同一オリジンの blob URL 経由で本来のファイル名を付ける。
 */
export async function downloadTicketAttachment(attachment: TicketAttachment): Promise<void> {
  if (!attachment.fileUrl) return;
  try {
    const res = await fetchFileWithRetry(attachment.fileUrl);
    const blobUrl = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = attachment.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch (e) {
    console.error("[ticketAttachments] ダウンロードに失敗。URLへ直接遷移します:", e);
    window.open(attachment.fileUrl, "_blank", "noopener");
  }
}

/**
 * チケット削除に伴う後始末。
 * DB 行は sprint_tickets への FK（on delete cascade）で消えるが、
 * ストレージの実体は残るのでここで明示的に消す。
 */
export async function purgeTicketAttachments(ticketIds: string[]): Promise<void> {
  if (!isSupabaseEnabled || ticketIds.length === 0) return;
  const { data } = await supabase!
    .from("ticket_attachments").select("file_path").in("ticket_id", ticketIds);
  const paths = (data ?? []).map(r => r.file_path as string).filter(Boolean);
  if (paths.length > 0) {
    const { error } = await supabase!.storage.from(BUCKET).remove(paths);
    if (error) console.warn("[ticketAttachments] 実体の一括削除に失敗:", error.message);
  }
  await supabase!.from("ticket_attachments").delete().in("ticket_id", ticketIds);
}
