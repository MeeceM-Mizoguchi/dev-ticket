// ファイルボックスのコメント（BRU12-025）のデータ層。
//
// ホワイトボードのコメント（ENHA2-039 = whiteboardComments.ts）と同じ操作感にするが、
// 保存先だけは違う。ホワイトボードは Excalidraw と同じ Yjs Doc に相乗りできたので
// 「同期も永続化も既存経路のまま」で済んだが、ファイルビューアには共有ドキュメントが
// 無いため、専用テーブル project_file_comments に置く（supabase/add_file_comments.sql）。
//
// 【引き当てキー】(projectId, fileName)。fileId ではない。
// ファイルボックスは「同名ファイル＝同じファイルの版」で、保存や再アップロードのたびに
// project_files の行が増える（一覧は最新版だけを見せる）。fileId で縛るとエディタ保存の
// 直後にコメントが全部消えたように見えるため、版をまたいで引ける名前をキーにする。
//
// 【リアルタイム共有】Postgres の変更通知は使わず、書いた側が broadcast を1発投げて
// 相手に読み直させる（whiteboardService の退去通知と同じ作り）。コメントは秒単位の即時性を
// 要求されない一方、テーブルの realtime 有効化という追加のDB設定を増やしたくないため。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";

/**
 * ピン1本 = 1コメント。
 * ホワイトボードの WbComment と同じ形にしてあるので、コメント一覧（CommentListPanel）を
 * そのまま使い回せる。違いは x/y の意味だけ（下記）。
 */
export interface FileComment {
  id: string;
  /**
   * ピンの位置。ビューアの内容ボックスに対する 0..1 の割合。
   * ホワイトボードは無限キャンバスの scene 座標だったが、ファイルは表示幅が
   * 画面サイズで変わる（画像の縮小・docx の折り返し）ので px では持てない。
   */
  x: number;
  y: number;
  userId: string;
  userName: string;
  text: string;
  createdAt: number;
  updatedAt?: number;
  /** 解決済み。true のピンはビューアから消え、コメント一覧の「解決済み」タブに移る */
  resolved?: boolean;
  resolvedAt?: number;
  resolvedByName?: string;
}

export interface FileCommentReply {
  id: string;
  commentId: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: number;
  updatedAt?: number;
}

export interface FileCommentAuthor { id: string; name: string }

/** ビューアを開いているファイルの識別（コメントの引き当てキー）。 */
export interface FileCommentTarget {
  projectId: string;
  /** 版をまたいで引くためのキー */
  fileName: string;
  /** 書き込み時に「どの版に対して書かれたか」を残すだけ。引き当てには使わない */
  fileId: string;
}

const TABLE = "project_file_comments";

function newId(): string {
  // 楽観更新のために id はクライアントで決める（挿入の戻りを待たずに描ける）。
  // 列は uuid なので crypto.randomUUID() に合わせる。
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  // randomUUID が無い環境（古い WebView 等）向けの保険。形だけ v4 に合わせる。
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const toMs = (v: unknown): number => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : Date.now();
};

// ── 読み出し ───────────────────────────────────────────────
/**
 * そのファイルのコメントと返信をまとめて読む（どちらも作成が古い順）。
 * 親と返信は同じテーブルに入っているので、1クエリで取って reply_to で振り分ける。
 */
export async function listFileComments(target: FileCommentTarget): Promise<{
  comments: FileComment[];
  replies: Record<string, FileCommentReply[]>;
}> {
  const empty = { comments: [], replies: {} };
  if (!isSupabaseEnabled || !target.projectId || !target.fileName) return empty;

  const { data, error } = await supabase!.from(TABLE)
    .select("*")
    .eq("project_id", target.projectId)
    .eq("file_name", target.fileName)
    // 同時刻の行で順番が入れ替わらないよう id も重ねる（BUG-01 と同じ理由）
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    console.error("[fileComments] list failed:", error.message);
    return empty;
  }

  const comments: FileComment[] = [];
  const replies: Record<string, FileCommentReply[]> = {};
  for (const r of data ?? []) {
    const row = r as Record<string, any>;
    const common = {
      id: String(row.id),
      userId: row.user_id || "",
      userName: row.user_name || "",
      text: row.body || "",
      createdAt: toMs(row.created_at),
      updatedAt: row.updated_at ? toMs(row.updated_at) : undefined,
    };
    if (row.reply_to) {
      (replies[String(row.reply_to)] ??= []).push({ ...common, commentId: String(row.reply_to) });
      continue;
    }
    comments.push({
      ...common,
      x: Number(row.x) || 0,
      y: Number(row.y) || 0,
      resolved: !!row.resolved,
      resolvedAt: row.resolved_at ? toMs(row.resolved_at) : undefined,
      resolvedByName: row.resolved_by_name || undefined,
    });
  }
  return { comments, replies };
}

/** プロジェクトの slug（共有リンク用）とメンバー名（メンション候補）をまとめて取る。 */
export async function loadFileCommentContext(projectId: string): Promise<{ slug: string; members: string[] }> {
  if (!isSupabaseEnabled || !projectId) return { slug: "", members: [] };
  const { data } = await supabase!.from("projects").select("slug, members").eq("id", projectId).maybeSingle();
  const members = (data as any)?.members as string[] | null | undefined;
  return {
    slug: (data as any)?.slug || "",
    members: (members ?? []).filter((n): n is string => typeof n === "string" && n.length > 0),
  };
}

// ── 書き込み ───────────────────────────────────────────────
// どれも「呼び出し側が先に画面を更新し、こちらは DB に流すだけ」という前提。
// isSupabaseEnabled が false（デモモード）なら何もせず成功扱いにして、画面側の
// ローカル状態だけでコメントが機能するようにしてある。

async function insertRow(row: Record<string, unknown>): Promise<void> {
  if (!isSupabaseEnabled) return;
  const { error } = await supabase!.from(TABLE).insert(row);
  if (error) console.error("[fileComments] insert failed:", error.message);
}

async function updateRow(id: string, patch: Record<string, unknown>): Promise<void> {
  if (!isSupabaseEnabled) return;
  const { error } = await supabase!.from(TABLE).update(patch).eq("id", id);
  if (error) console.error("[fileComments] update failed:", error.message);
}

/** 新しいコメント（ピン）。x/y は内容ボックスに対する 0..1 の割合。 */
export function buildFileComment(x: number, y: number, text: string, author: FileCommentAuthor): FileComment {
  return {
    id: newId(), x, y,
    userId: author.id, userName: author.name,
    text, createdAt: Date.now(),
  };
}

export async function saveFileComment(target: FileCommentTarget, c: FileComment): Promise<void> {
  await insertRow({
    id: c.id,
    project_id: target.projectId,
    file_id: target.fileId,
    file_name: target.fileName,
    reply_to: null,
    x: c.x, y: c.y,
    user_id: c.userId, user_name: c.userName,
    body: c.text,
    resolved: false,
  });
}

export function buildFileCommentReply(commentId: string, text: string, author: FileCommentAuthor): FileCommentReply {
  return {
    id: newId(), commentId,
    userId: author.id, userName: author.name,
    text, createdAt: Date.now(),
  };
}

export async function saveFileCommentReply(target: FileCommentTarget, r: FileCommentReply): Promise<void> {
  await insertRow({
    id: r.id,
    project_id: target.projectId,
    file_id: target.fileId,
    file_name: target.fileName,
    reply_to: r.commentId,
    x: 0, y: 0,
    user_id: r.userId, user_name: r.userName,
    body: r.text,
    resolved: false,
  });
}

/** 本文の書き換え（コメント・返信で共通）。 */
export async function updateFileCommentText(id: string, text: string): Promise<void> {
  await updateRow(id, { body: text, updated_at: new Date().toISOString() });
}

/**
 * ピンの位置を動かす。ドラッグ確定時に1回だけ呼ぶ想定。
 * 本文は触らないので updated_at は進めない（「編集済み」表示にしない）。
 */
export async function moveFileComment(id: string, x: number, y: number): Promise<void> {
  await updateRow(id, { x, y });
}

/** 解決済み ⇔ 未解決 を切り替える。誰でも切り替えられる（ホワイトボードと同じ）。 */
export async function setFileCommentResolved(id: string, resolved: boolean, byName: string): Promise<void> {
  await updateRow(id, resolved
    ? { resolved: true, resolved_at: new Date().toISOString(), resolved_by_name: byName }
    : { resolved: false, resolved_at: null, resolved_by_name: null });
}

/**
 * コメント（または返信）を削除する。
 * 親を消すと、ぶら下がっている返信は reply_to の ON DELETE CASCADE で一緒に消える。
 */
export async function deleteFileComment(id: string): Promise<void> {
  if (!isSupabaseEnabled) return;
  const { error } = await supabase!.from(TABLE).delete().eq("id", id);
  if (error) console.error("[fileComments] delete failed:", error.message);
}

// ── リアルタイム共有 ───────────────────────────────────────
const CHANGED_EVENT = "file-comments-changed";

function changedTopic(target: FileCommentTarget): string {
  // ファイル名はそのままだとチャンネル名に使えない文字が混じるので通す
  return `fc:${target.projectId}:${encodeURIComponent(target.fileName)}`;
}

/**
 * 同じファイルを開いている他の人の変更を受け取る。
 * 戻り値の broadcast は「自分が書いた」ことを知らせる用（既に張ったチャンネルから送る）。
 */
export function subscribeFileComments(target: FileCommentTarget, selfUserId: string, onChanged: () => void): {
  broadcast: () => void; dispose: () => void;
} {
  if (!isSupabaseEnabled || !target.projectId || !target.fileName) {
    return { broadcast: () => {}, dispose: () => {} };
  }
  const ch = supabase!.channel(changedTopic(target), { config: { broadcast: { self: false, ack: false } } });
  ch.on("broadcast", { event: CHANGED_EVENT }, ({ payload }) => {
    if ((payload as any)?.by === selfUserId) return; // 自分の書き込みは画面に反映済み
    onChanged();
  }).subscribe();
  return {
    broadcast: () => { void ch.send({ type: "broadcast", event: CHANGED_EVENT, payload: { by: selfUserId } }); },
    dispose: () => { void ch.unsubscribe(); },
  };
}
