// ホワイトボードの Supabase 永続化レイヤ（CRUD / doc_state 保存復元 / 画像アップロード）。
// リアルタイム同期そのものは SupabaseYjsProvider が担い、ここは DB との橋渡しのみ。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { AccessLevel, UserPermissions, Whiteboard } from "@/app/types";

interface WhiteboardRow {
  id: string;
  project_id: string;
  title: string;
  doc_state: string;
  preview: unknown;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export function mapWhiteboard(r: WhiteboardRow): Whiteboard {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    createdBy: r.created_by,
    updatedBy: r.updated_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── Uint8Array <-> base64（Yjs stateの永続化・Broadcast運搬用） ──
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── プロジェクト解決（slug または id） ──
export async function resolveProject(projectSlug: string): Promise<{ id: string; name: string; slug: string } | null> {
  if (!isSupabaseEnabled) return null;
  const { data: bySlug } = await supabase!.from("projects").select("id, name, slug").eq("slug", projectSlug).limit(1);
  if (bySlug?.[0]) return bySlug[0] as any;
  const { data: byId } = await supabase!.from("projects").select("id, name, slug").eq("id", projectSlug).maybeSingle();
  return (byId as any) ?? null;
}

// ── ボード単体のメタ情報（リンクから開く時に、所属プロジェクトを逆引きする） ──
export interface BoardMeta { id: string; title: string; projectId: string; projectSlug: string; projectName: string }

export async function getBoardMeta(boardId: string): Promise<BoardMeta | null> {
  if (!isSupabaseEnabled) return null;
  const { data: b } = await supabase!.from("whiteboards").select("id, title, project_id").eq("id", boardId).maybeSingle();
  if (!b) return null;
  const { data: p } = await supabase!.from("projects").select("id, name, slug").eq("id", (b as any).project_id).maybeSingle();
  if (!p) return null;
  return {
    id: (b as any).id,
    title: (b as any).title ?? "",
    projectId: (p as any).id,
    projectSlug: (p as any).slug,
    projectName: (p as any).name,
  };
}

// ── ホワイトボードの権限解決 ──
// whiteboards の RLS は authenticated 全許可（supabase/add_whiteboard.sql）なので、
// 「見せる/編集させる」の判断はアプリ側のこの関数が唯一の防壁。
// ホワイトボード画面とリンクプレビューの両方から必ずここを通す。
export interface WhiteboardPerms { whiteboard: AccessLevel; wiki: AccessLevel; backlog: AccessLevel; minutes: AccessLevel }

export async function loadWhiteboardPerms(projectId: string, userId: string, isAdminRole: boolean): Promise<WhiteboardPerms> {
  if (isAdminRole) return { whiteboard: "edit", wiki: "edit", backlog: "edit", minutes: "edit" };
  if (!isSupabaseEnabled) return { whiteboard: "none", wiki: "none", backlog: "none", minutes: "none" };
  const { data } = await supabase!
    .from("project_member_permissions").select("permissions")
    .eq("project_id", projectId).eq("member_id", userId).maybeSingle();
  const up = (data as any)?.permissions as Partial<UserPermissions> | undefined;
  return {
    whiteboard: (up?.whiteboardPermission as AccessLevel) ?? "none",
    wiki: (up?.wikiPermission as AccessLevel) ?? "none",
    backlog: (up?.backlogPermission as AccessLevel) ?? "none",
    minutes: (up?.minutesPermission as AccessLevel) ?? "none",
  };
}

// userId から安定した色を生成（カーソル/アバターの色。画面とプレビューで同じ色にする）
export function wbUserColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h}, 70%, 45%)`;
}

// ── CRUD ──
export async function listBoards(projectId: string): Promise<Whiteboard[]> {
  if (!isSupabaseEnabled) return [];
  const { data } = await supabase!
    .from("whiteboards")
    .select("*")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });
  return (data ?? []).map((r) => mapWhiteboard(r as WhiteboardRow));
}

export async function createBoard(projectId: string, title: string, userId: string): Promise<Whiteboard | null> {
  if (!isSupabaseEnabled) return null;
  const { data, error } = await supabase!
    .from("whiteboards")
    .insert({ project_id: projectId, title, created_by: userId, updated_by: userId })
    .select("*")
    .single();
  if (error || !data) return null;
  return mapWhiteboard(data as WhiteboardRow);
}

export async function renameBoard(id: string, title: string, userId: string): Promise<void> {
  if (!isSupabaseEnabled) return;
  await supabase!.from("whiteboards").update({ title, updated_by: userId, updated_at: new Date().toISOString() }).eq("id", id);
}

export async function deleteBoard(id: string): Promise<void> {
  if (!isSupabaseEnabled) return;
  await supabase!.from("whiteboards").delete().eq("id", id);
}

export async function loadDocState(id: string): Promise<string> {
  if (!isSupabaseEnabled) return "";
  const { data } = await supabase!.from("whiteboards").select("doc_state").eq("id", id).maybeSingle();
  return (data?.doc_state as string | undefined) ?? "";
}

export async function saveDocState(id: string, docStateBase64: string, userId: string): Promise<void> {
  if (!isSupabaseEnabled) return;
  await supabase!
    .from("whiteboards")
    .update({ doc_state: docStateBase64, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", id);
}

// ── 画像アップロード（議事録と同じ ticket-images バケットを流用） ──
export async function uploadWhiteboardImage(boardId: string, dataURL: string): Promise<string | null> {
  if (!isSupabaseEnabled) return null;
  const res = await fetch(dataURL);
  const blob = await res.blob();
  const ext = (blob.type.split("/")[1] || "png").replace("+xml", "");
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `whiteboard/${boardId}/${Date.now()}_${rand}.${ext}`;
  const { error } = await supabase!.storage.from("ticket-images").upload(path, blob, { contentType: blob.type, upsert: true });
  if (error) return null;
  return supabase!.storage.from("ticket-images").getPublicUrl(path).data.publicUrl;
}
