// ホワイトボードの Supabase 永続化レイヤ（CRUD / doc_state 保存復元 / 画像アップロード）。
// リアルタイム同期そのものは SupabaseYjsProvider が担い、ここは DB との橋渡しのみ。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { findProjectBySlug } from "@/app/lib/projectResolve";
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
  // プライベートモード（add_whiteboard_private.sql）。未適用のDBでも落ちないよう省略可にしておく。
  visibility?: string | null;
  private_by?: string | null;
  private_key?: string | null;
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
    visibility: r.visibility === "private" ? "private" : "project",
    privateBy: r.private_by ?? "",
    privateKey: r.private_key ?? "",
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
// members / organization_id も返す。ホワイトボード画面が「見られない理由」を
// 出し分ける（未アサインなのか、権限が無いだけなのか）のに使う。
export interface ResolvedProject {
  id: string; name: string; slug: string;
  members: string[]; organizationId: string | null;
  /** 旧識別子(project_slug_aliases)で引き当てたか。呼び出し側がURLを正へ寄せるのに使う */
  viaAlias: boolean;
}

export async function resolveProject(projectSlug: string): Promise<ResolvedProject | null> {
  if (!isSupabaseEnabled) return null;
  const cols = "id, name, slug, members, organization_id";
  const found = await findProjectBySlug(projectSlug, cols);
  if (!found) return null;
  const row: any = found.row;
  return {
    id: row.id, name: row.name, slug: row.slug,
    members: (row.members ?? []) as string[],
    organizationId: (row.organization_id ?? null) as string | null,
    viaAlias: found.viaAlias,
  };
}

// ── ボード単体のメタ情報（リンクから開く時に、所属プロジェクトを逆引きする） ──
export interface BoardMeta {
  id: string; title: string; projectId: string; projectSlug: string; projectName: string;
  /** プライベートモードのボードか（バッジ表示用。ここに来る時点で所有者本人と確定している） */
  isPrivate: boolean;
  /** Realtimeチャンネル名に混ぜるトークン。公開ボードは "" */
  privateKey: string;
}

export async function getBoardMeta(boardId: string): Promise<BoardMeta | null> {
  if (!isSupabaseEnabled) return null;
  // プライベートボードは RLS で行ごと消えるため、他人が開くと下の !b で「見つからない」に落ちる。
  // 「存在するが見えない」と「存在しない」を区別しない（区別すると存在自体が漏れる）。
  const res = await supabase!
    .from("whiteboards").select("id, title, project_id, visibility, private_key").eq("id", boardId).maybeSingle();
  // add_whiteboard_private.sql 未適用のDB（列が無い）でもプレビューが全滅しないようにする
  const b: any = res.error
    ? (await supabase!.from("whiteboards").select("id, title, project_id").eq("id", boardId).maybeSingle()).data
    : res.data;
  if (!b) return null;
  const { data: p } = await supabase!.from("projects").select("id, name, slug").eq("id", (b as any).project_id).maybeSingle();
  if (!p) return null;
  return {
    id: (b as any).id,
    title: (b as any).title ?? "",
    projectId: (p as any).id,
    projectSlug: (p as any).slug,
    projectName: (p as any).name,
    isPrivate: (b as any).visibility === "private",
    privateKey: ((b as any).private_key as string | null) ?? "",
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

// ── メンション候補（コメントの @メンバー名・ENHA2-039） ──
// チケット側は useLinkSuggestions が一式まとめて取るが、ホワイトボードで要るのは名前だけなので
// projects.members だけを引く軽いクエリにする。
export async function loadProjectMemberNames(projectId: string): Promise<string[]> {
  if (!isSupabaseEnabled || !projectId) return [];
  const { data } = await supabase!.from("projects").select("members").eq("id", projectId).maybeSingle();
  const members = (data as any)?.members as string[] | null | undefined;
  return (members ?? []).filter((n): n is string => typeof n === "string" && n.length > 0);
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

// ── プライベートモード ──────────────────────────────────────
// 切り替えの唯一の入口。実際に「作成者かどうか」を判定しているのは RLS の with check なので、
// 作成者でない人がここを叩いても update が 0 行になり null が返る（＝UIでメニューを隠すのは補助）。
export async function setBoardVisibility(
  board: Whiteboard, makePrivate: boolean, userId: string,
): Promise<Whiteboard | null> {
  if (!isSupabaseEnabled) return null;
  const patch = makePrivate
    ? { visibility: "private", private_by: userId, private_key: newPrivateKey() }
    : { visibility: "project", private_by: "", private_key: "" };
  const { data, error } = await supabase!
    .from("whiteboards")
    .update({ ...patch, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", board.id)
    .select("*")
    .single();
  if (error || !data) return null;
  return mapWhiteboard(data as WhiteboardRow);
}

function newPrivateKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Yjs の Realtime チャンネル名。
 * プライベート中はトークンを混ぜる。トークンは RLS でボード行ごと隠れるため、
 * 所有者以外はチャンネル名を計算できない＝Broadcast 経由で同期内容を覗けない。
 */
export function wbChannelName(boardId: string, privateKey?: string | null): string {
  return privateKey ? `wb:${boardId}:${privateKey}` : `wb:${boardId}`;
}

// ── 退去通知（プライベート化した瞬間に、開いている他メンバーを閉じさせる） ──
// これを送らないと、他メンバーの画面は編集できるのに保存だけ RLS に弾かれ、書いた内容が黙って消える。
// 図形同期チャンネル（wb:{id}）に相乗りさせないのは、プライベート化するとチャンネル名が
// 変わってしまい「変更後に旧チャンネルへ送る」ができなくなるため、ボードIDだけで決まる別トピックにする。
const EVICT_EVENT = "wb-evict";
const evictTopic = (boardId: string) => `wb:${boardId}:evict`;

/**
 * 退去通知の購読（ボードを開いている間だけ）。
 * 戻り値の broadcast は「今このボードを開いている自分」が送る用。
 * 既に張ってあるチャンネルから送るので、同じトピックへ二重 join せずに済む。
 */
export function subscribeBoardEvicted(boardId: string, selfUserId: string, onEvicted: () => void): {
  broadcast: () => void; dispose: () => void;
} {
  if (!isSupabaseEnabled) return { broadcast: () => {}, dispose: () => {} };
  const ch = supabase!.channel(evictTopic(boardId), { config: { broadcast: { self: false, ack: false } } });
  ch.on("broadcast", { event: EVICT_EVENT }, ({ payload }) => {
    if ((payload as any)?.by === selfUserId) return; // 自分がプライベート化した側なら無視
    onEvicted();
  }).subscribe();
  return {
    broadcast: () => { void ch.send({ type: "broadcast", event: EVICT_EVENT, payload: { by: selfUserId } }); },
    dispose: () => { void ch.unsubscribe(); },
  };
}

/**
 * そのボードを開いていない状態から退去通知だけ送る（一覧から切り替えた時のフォールバック）。
 * 開いている場合は subscribeBoardEvicted の broadcast を使う。
 */
export async function broadcastBoardEvicted(boardId: string, byUserId: string): Promise<void> {
  if (!isSupabaseEnabled) return;
  const ch = supabase!.channel(evictTopic(boardId), { config: { broadcast: { self: false, ack: false } } });
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(); };
    const timer = setTimeout(finish, 2000); // 接続できない時に待ち続けない
    ch.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      Promise.resolve(ch.send({ type: "broadcast", event: EVICT_EVENT, payload: { by: byUserId } }))
        .catch(() => {})
        .finally(() => { clearTimeout(timer); finish(); });
    });
  });
  void ch.unsubscribe();
}

export async function loadDocState(id: string): Promise<string> {
  if (!isSupabaseEnabled) return "";
  const { data } = await supabase!.from("whiteboards").select("doc_state").eq("id", id).maybeSingle();
  return (data?.doc_state as string | undefined) ?? "";
}

/**
 * ボードの内容を保存する。
 * @param userId 更新者。null を渡すと updated_by は書き換えない（BRU12-031）。
 *   他メンバーの編集を受け取った側も保険として保存するようにしたため（編集者がタブを閉じても
 *   内容が失われないように）、その保存で「見ていただけの人」が更新者になるのを防ぐ。
 */
export async function saveDocState(id: string, docStateBase64: string, userId: string | null): Promise<void> {
  if (!isSupabaseEnabled) return;
  await supabase!
    .from("whiteboards")
    .update({
      doc_state: docStateBase64,
      ...(userId ? { updated_by: userId } : {}),
      updated_at: new Date().toISOString(),
    })
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
