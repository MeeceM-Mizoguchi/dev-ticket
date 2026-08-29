// ホワイトボードの Supabase 永続化レイヤ（CRUD / doc_state 保存復元 / 画像アップロード）。
// リアルタイム同期そのものは SupabaseYjsProvider が担い、ここは DB との橋渡しのみ。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { findProjectBySlug } from "@/app/lib/projectResolve";
import type { AccessLevel, UserPermissions, Whiteboard, WhiteboardShareMember } from "@/app/types";

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
    // 共有相手と作成者名は別テーブル（whiteboard_shares / profiles）から後から載せる。
    // ここでは空で置き、listBoards / getBoardMeta が attachShareInfo で埋める。
    sharedWith: [],
    createdByName: "",
  };
}

// ── 限定公開（whiteboard_shares）の読み込み ────────────────────
// プライベートボードは「作成者だけ」が既定だが、作成者が選んだPJメンバーにだけ見せることもできる。
// 誰に共有されているかは RLS で守られている（作成者・共有相手・本人だけが行を読める）ので、
// 画面はここで取れたものをそのまま信じてよい。

/** 共有行をボードIDごとにまとめて引く。RLS で見えない行はそもそも返らない */
export async function loadShareMap(boardIds: string[]): Promise<Record<string, WhiteboardShareMember[]>> {
  if (!isSupabaseEnabled || boardIds.length === 0) return {};
  const { data, error } = await supabase!
    .from("whiteboard_shares")
    .select("whiteboard_id, profile_id, profiles(name)")
    .in("whiteboard_id", boardIds)
    .order("created_at", { ascending: true });
  // add_whiteboard_shares.sql 未適用のDB（テーブルが無い）でも一覧が全滅しないようにする
  if (error) return {};
  const out: Record<string, WhiteboardShareMember[]> = {};
  for (const r of (data ?? []) as any[]) {
    const m: WhiteboardShareMember = { id: r.profile_id, name: (r.profiles?.name as string | undefined) ?? "" };
    const list = out[r.whiteboard_id];
    if (list) list.push(m); else out[r.whiteboard_id] = [m];
  }
  return out;
}

/**
 * ボードに「共有相手」と「作成者名」を載せる。
 * 作成者名を引くのは、共有相手がコメントのメンション通知先を判断するのに要るため
 * （プライベート中は「ボードを見られる人」にしか通知を飛ばさない）。
 */
async function attachShareInfo(boards: Whiteboard[]): Promise<Whiteboard[]> {
  const privates = boards.filter((b) => b.visibility === "private");
  if (privates.length === 0) return boards;
  const shareMap = await loadShareMap(privates.map((b) => b.id));
  const creatorIds = Array.from(new Set(privates.map((b) => b.createdBy).filter(Boolean)));
  const nameMap = await loadProfileNames(creatorIds);
  return boards.map((b) => (b.visibility === "private"
    ? { ...b, sharedWith: shareMap[b.id] ?? [], createdByName: nameMap[b.createdBy] ?? "" }
    : b));
}

/** profiles.id → 表示名。共有相手の名前は埋め込みで取れるので、ここは作成者の解決だけに使う */
async function loadProfileNames(ids: string[]): Promise<Record<string, string>> {
  if (!isSupabaseEnabled || ids.length === 0) return {};
  const { data } = await supabase!.from("profiles").select("id, name").in("id", ids);
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as any[]) out[r.id] = (r.name as string | null) ?? "";
  return out;
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
  /** プライベートモードのボードか（バッジ表示用。ここに来る時点で作成者か共有相手と確定している） */
  isPrivate: boolean;
  /** Realtimeチャンネル名に混ぜるトークン。公開ボードは "" */
  privateKey: string;
  /** 自分がこのボードの作成者か（＝共有先を触れる側か） */
  isOwner: boolean;
  /** 限定公開先。空 = 作成者だけが見られる */
  sharedWith: WhiteboardShareMember[];
  /** 作成者の表示名（プライベートボードのみ解決）。コメント通知の宛先判定に使う */
  createdByName: string;
}

export async function getBoardMeta(boardId: string, userId?: string): Promise<BoardMeta | null> {
  if (!isSupabaseEnabled) return null;
  // プライベートボードは RLS で行ごと消えるため、権限のない人が開くと下の !b で「見つからない」に落ちる。
  // 「存在するが見えない」と「存在しない」を区別しない（区別すると存在自体が漏れる）。
  const res = await supabase!
    .from("whiteboards").select("id, title, project_id, visibility, private_key, created_by").eq("id", boardId).maybeSingle();
  // add_whiteboard_private.sql 未適用のDB（列が無い）でもプレビューが全滅しないようにする
  const b: any = res.error
    ? (await supabase!.from("whiteboards").select("id, title, project_id").eq("id", boardId).maybeSingle()).data
    : res.data;
  if (!b) return null;
  const { data: p } = await supabase!.from("projects").select("id, name, slug").eq("id", (b as any).project_id).maybeSingle();
  if (!p) return null;
  const isPrivate = (b as any).visibility === "private";
  const createdBy = ((b as any).created_by as string | null) ?? "";
  const [shareMap, nameMap] = isPrivate
    ? await Promise.all([loadShareMap([boardId]), loadProfileNames(createdBy ? [createdBy] : [])])
    : [{} as Record<string, WhiteboardShareMember[]>, {} as Record<string, string>];
  return {
    id: (b as any).id,
    title: (b as any).title ?? "",
    projectId: (p as any).id,
    projectSlug: (p as any).slug,
    projectName: (p as any).name,
    isPrivate,
    privateKey: ((b as any).private_key as string | null) ?? "",
    isOwner: !!userId && createdBy === userId,
    sharedWith: shareMap[boardId] ?? [],
    createdByName: nameMap[createdBy] ?? "",
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
  return attachShareInfo((data ?? []).map((r) => mapWhiteboard(r as WhiteboardRow)));
}

/** ボード1件を引き直す（共有を張り替えた直後など、行だけ最新化したい時） */
export async function reloadBoard(boardId: string): Promise<Whiteboard | null> {
  if (!isSupabaseEnabled) return null;
  const { data } = await supabase!.from("whiteboards").select("*").eq("id", boardId).maybeSingle();
  if (!data) return null;
  const [board] = await attachShareInfo([mapWhiteboard(data as WhiteboardRow)]);
  return board ?? null;
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
// 切り替えの唯一の入口。実際に「作成者かどうか」を判定しているのは DB 側
// （whiteboards_guard_ownership トリガー）なので、作成者でない人がここを叩くと
// update がエラーになり null が返る（＝UIでメニューを隠すのは補助）。
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
  // 公開に戻したら限定公開の設定も畳む。残しておくと、次にプライベート化した時に
  // 前の共有先が黙って復活してしまい「自分だけのつもり」が崩れる。
  if (!makePrivate) await clearBoardShares(board.id);
  const next = mapWhiteboard(data as WhiteboardRow);
  return makePrivate ? { ...next, createdByName: board.createdByName } : next;
}

// ── 限定公開（共有先の付け外し） ─────────────────────────────
// 付け外しできるのはボードの作成者だけ。判定は RLS（wb_shares_write）が持っている。

/** 選んだメンバーへまとめて共有を張る。既に張ってある相手は upsert で素通しする */
export async function addBoardShares(boardId: string, memberIds: string[], byUserId: string): Promise<boolean> {
  if (!isSupabaseEnabled || memberIds.length === 0) return true;
  const rows = memberIds.map((id) => ({ whiteboard_id: boardId, profile_id: id, created_by: byUserId }));
  const { error } = await supabase!
    .from("whiteboard_shares").upsert(rows, { onConflict: "whiteboard_id,profile_id" });
  if (error) { console.error("[whiteboard_shares] add failed:", error.message); return false; }
  return true;
}

/** 共有を外す。呼び出し側は必ず rotatePrivateKey も走らせること（下のコメント参照） */
export async function removeBoardShare(boardId: string, memberId: string): Promise<boolean> {
  if (!isSupabaseEnabled) return false;
  const { error } = await supabase!
    .from("whiteboard_shares").delete().eq("whiteboard_id", boardId).eq("profile_id", memberId);
  if (error) { console.error("[whiteboard_shares] remove failed:", error.message); return false; }
  return true;
}

/** 共有をすべて畳む（プライベート解除時） */
export async function clearBoardShares(boardId: string): Promise<void> {
  if (!isSupabaseEnabled) return;
  const { error } = await supabase!.from("whiteboard_shares").delete().eq("whiteboard_id", boardId);
  if (error) console.error("[whiteboard_shares] clear failed:", error.message);
}

/**
 * Realtime チャンネルの秘密トークンを作り直す。共有を外した直後に必ず呼ぶ。
 *
 * RLS はテーブルしか守らない。外された人は `wb:{boardId}:{private_key}` というチャンネル名を
 * 覚えているので、鍵を替えないと Broadcast に居座って同期内容を覗き続けられる
 * （SupabaseYjsProvider は後入りに対してドキュメント全体を配る）。
 * 鍵が変わると、残っているメンバーのキャンバスも張り直しが要る（＝ボード行の再読込）。
 */
export async function rotatePrivateKey(boardId: string, userId: string): Promise<Whiteboard | null> {
  if (!isSupabaseEnabled) return null;
  const { data, error } = await supabase!
    .from("whiteboards")
    .update({ private_key: newPrivateKey(), updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", boardId)
    .select("*")
    .single();
  if (error || !data) return null;
  const [board] = await attachShareInfo([mapWhiteboard(data as WhiteboardRow)]);
  return board ?? null;
}

/** 共有先に選べるメンバー（＝そのプロジェクトにアサインされている人） */
export interface ShareCandidate extends WhiteboardShareMember {
  /** ホワイトボードを開ける権限があるか。無い人に共有しても画面に辿り着けないので注意書きを出す */
  canOpenWhiteboard: boolean;
}

/**
 * 共有先の候補。projects.members は「名前」の配列なので、組織の profiles と名前で突き合わせて id を得る
 * （whiteboard_shares.profile_id は profiles.id = auth.uid()）。
 * 併せて project_member_permissions を引き、ホワイトボード権限が none の人に印を付ける。
 */
export async function loadShareCandidates(
  projectId: string, orgId: string | null, excludeUserId: string,
): Promise<ShareCandidate[]> {
  if (!isSupabaseEnabled || !projectId) return [];
  const [{ data: proj }, permsRes] = await Promise.all([
    supabase!.from("projects").select("members").eq("id", projectId).maybeSingle(),
    supabase!.from("project_member_permissions").select("member_id, permissions").eq("project_id", projectId),
  ]);
  const memberNames = new Set(((proj as any)?.members ?? []) as string[]);
  if (memberNames.size === 0) return [];

  let q = supabase!.from("profiles").select("id, name, role").neq("status", "inactive");
  if (orgId) q = q.eq("organization_id", orgId);
  const { data: profiles } = await q.order("name");

  const permByMember = new Map<string, string>();
  for (const r of (permsRes.data ?? []) as any[]) {
    permByMember.set(r.member_id, ((r.permissions ?? {}).whiteboardPermission as string) ?? "none");
  }

  return ((profiles ?? []) as any[])
    .filter((p) => p.id !== excludeUserId && p.name && memberNames.has(p.name))
    .map((p) => ({
      id: p.id as string,
      name: p.name as string,
      // owner/admin は project_member_permissions を経由せず edit 固定（loadWhiteboardPerms と同じ判定）
      canOpenWhiteboard: p.role === "owner" || p.role === "admin"
        ? true
        : (permByMember.get(p.id) ?? "none") !== "none",
    }));
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

// ── アクセス変更の通知（開いている人の画面をその場で追随させる） ──
// これを送らないと、締め出された人の画面は編集できるのに保存だけ RLS に弾かれ、書いた内容が黙って消える。
// 図形同期チャンネル（wb:{id}）に相乗りさせないのは、プライベート化や鍵の作り直しでチャンネル名が
// 変わってしまい「変更後に旧チャンネルへ送る」ができなくなるため、ボードIDだけで決まる別トピックにする。
const EVICT_EVENT = "wb-evict";
const evictTopic = (boardId: string) => `wb:${boardId}:evict`;

/** private=プライベート化 / unshare=共有を外した / rekey=鍵を作り直した */
export type WbAccessReason = "private" | "unshare" | "rekey";

export interface WbAccessPayload {
  /** 送信者。自分発は無視する */
  by: string;
  /**
   * 締め出す相手の userId。
   * null = 「送信者以外の全員」（プライベート化の瞬間はまだ共有先が無いのでこれで足りる）。
   * 配列 = そこに載っている人だけが締め出され、残りは「鍵が変わったので張り直し」になる。
   */
  targets: string[] | null;
  reason: WbAccessReason;
}

/** 受け取り側が取るべき行動。evicted=ボードから出る / refresh=ボード行を読み直して張り直す */
export interface WbAccessEvent { kind: "evicted" | "refresh"; reason: WbAccessReason }

function classifyAccessEvent(payload: unknown, selfUserId: string): WbAccessEvent | null {
  const p = payload as Partial<WbAccessPayload> | undefined;
  if (!p || p.by === selfUserId) return null;   // 自分が切り替えた側なら無視
  const reason: WbAccessReason = p.reason ?? "private";
  const targets = Array.isArray(p.targets) ? p.targets : null;
  return { kind: targets === null || targets.includes(selfUserId) ? "evicted" : "refresh", reason };
}

/**
 * アクセス変更の購読（ボードを開いている間だけ）。
 * 戻り値の broadcast は「今このボードを開いている自分」が送る用。
 * 既に張ってあるチャンネルから送るので、同じトピックへ二重 join せずに済む。
 */
export function subscribeBoardAccess(
  boardId: string, selfUserId: string, onEvent: (ev: WbAccessEvent) => void,
): { broadcast: (p: Omit<WbAccessPayload, "by">) => Promise<void>; dispose: () => void } {
  if (!isSupabaseEnabled) return { broadcast: async () => {}, dispose: () => {} };
  const ch = supabase!.channel(evictTopic(boardId), { config: { broadcast: { self: false, ack: false } } });
  ch.on("broadcast", { event: EVICT_EVENT }, ({ payload }) => {
    const ev = classifyAccessEvent(payload, selfUserId);
    if (ev) onEvent(ev);
  }).subscribe();
  return {
    // 送信直後にチャンネルごと張り直る（鍵の作り直し）ことがあるので、送り切るまで待てるようにする
    broadcast: async (p) => {
      await Promise.resolve(ch.send({ type: "broadcast", event: EVICT_EVENT, payload: { ...p, by: selfUserId } }))
        .catch(() => {});
    },
    dispose: () => { void ch.unsubscribe(); },
  };
}

/**
 * そのボードを開いていない状態から通知だけ送る（一覧から切り替えた時のフォールバック）。
 * 開いている場合は subscribeBoardAccess の broadcast を使う。
 */
export async function broadcastBoardAccess(
  boardId: string, byUserId: string, p: Omit<WbAccessPayload, "by">,
): Promise<void> {
  if (!isSupabaseEnabled) return;
  const ch = supabase!.channel(evictTopic(boardId), { config: { broadcast: { self: false, ack: false } } });
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(); };
    const timer = setTimeout(finish, 2000); // 接続できない時に待ち続けない
    ch.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      Promise.resolve(ch.send({ type: "broadcast", event: EVICT_EVENT, payload: { ...p, by: byUserId } }))
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
