// ホワイトボードのコメント（ENHA2-039）のデータ層。
//
// 保存先は Excalidraw 要素と同じ Yjs Doc の中に置く（別テーブルは作らない）。
//   doc.getMap("wbComments")        … ピン1本 = 1エントリ
//   doc.getMap("wbCommentReplies")  … 返信1件 = 1エントリ（commentId で親を指す）
// こうすると
//   ・リアルタイム共有は SupabaseYjsProvider の差分配信にそのまま乗る
//   ・永続化も useWhiteboardSync の doc_state 保存（デバウンス）にそのまま乗る
// ので、同期・保存の経路を新設せずに済む。
//
// 返信を親コメントの配列に持たせず別マップに分けているのは、Y.Map の値は
// 「まるごと last-write-wins」だから。配列で持つと、2人が同時に返信した時に
// 後勝ちで片方の返信が消える。エントリを分ければ同時返信でも両方残る。
import * as Y from "yjs";

export interface WbComment {
  id: string;
  /** ピンを落とした位置（scene座標。図形には紐付かない） */
  x: number;
  y: number;
  userId: string;
  userName: string;
  text: string;
  createdAt: number;
  updatedAt?: number;
  /** 解決済み。true のピンはキャンバスから消え、コメント一覧の「解決済み」タブに移る */
  resolved?: boolean;
  resolvedAt?: number;
  resolvedByName?: string;
}

export interface WbCommentReply {
  id: string;
  commentId: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: number;
  updatedAt?: number;
}

export interface WbCommentAuthor { id: string; name: string }

/**
 * ピンの一辺(px・画面)。位置(x,y)はピンの左下＝コメント座標。
 * 描画する CommentLayer と、フレームで囲う対象を強調する FrameHighlightLayer で同じ寸法を使う。
 */
export const COMMENT_PIN_SIZE = 26;

const COMMENTS_KEY = "wbComments";
const REPLIES_KEY = "wbCommentReplies";

const commentsMap = (doc: Y.Doc) => doc.getMap<WbComment>(COMMENTS_KEY);
const repliesMap = (doc: Y.Doc) => doc.getMap<WbCommentReply>(REPLIES_KEY);

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── 読み出し ───────────────────────────────────────────────
/** 全コメント（作成が古い順）。壊れたエントリは黙って除外する。 */
export function readComments(doc: Y.Doc): WbComment[] {
  const out: WbComment[] = [];
  commentsMap(doc).forEach((c) => {
    if (c && typeof c.id === "string" && Number.isFinite(c.x) && Number.isFinite(c.y)) out.push(c);
  });
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

/** commentId → 返信（作成が古い順）。 */
export function readReplies(doc: Y.Doc): Record<string, WbCommentReply[]> {
  const out: Record<string, WbCommentReply[]> = {};
  repliesMap(doc).forEach((r) => {
    if (!r || typeof r.id !== "string" || typeof r.commentId !== "string") return;
    (out[r.commentId] ??= []).push(r);
  });
  for (const list of Object.values(out)) list.sort((a, b) => a.createdAt - b.createdAt);
  return out;
}

/** コメント/返信の変更を購読する。戻り値で解除。 */
export function observeComments(doc: Y.Doc, onChange: () => void): () => void {
  const cm = commentsMap(doc);
  const rm = repliesMap(doc);
  cm.observe(onChange);
  rm.observe(onChange);
  return () => { cm.unobserve(onChange); rm.unobserve(onChange); };
}

// ── 書き込み ───────────────────────────────────────────────
export function addComment(doc: Y.Doc, x: number, y: number, text: string, author: WbCommentAuthor): WbComment {
  const c: WbComment = {
    id: newId("wbc"), x, y,
    userId: author.id, userName: author.name,
    text, createdAt: Date.now(),
  };
  commentsMap(doc).set(c.id, c);
  return c;
}

export function updateComment(doc: Y.Doc, id: string, text: string): void {
  const cur = commentsMap(doc).get(id);
  if (!cur) return;
  commentsMap(doc).set(id, { ...cur, text, updatedAt: Date.now() });
}

/**
 * ピンの位置を動かす（複数まとめて）。ドラッグ確定時に1回だけ呼ぶ想定。
 * 1トランザクションにまとめるのは、途中経過を差分として配らないため
 * （他の参加者の画面でピンがバラバラに飛ぶのを防ぐ）。
 * 本文は触らないので updatedAt は進めない（「編集済み」表示にしない）。
 */
export function moveComments(doc: Y.Doc, moves: Array<{ id: string; x: number; y: number }>): void {
  if (!moves.length) return;
  doc.transact(() => {
    const cm = commentsMap(doc);
    for (const m of moves) {
      if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
      const cur = cm.get(m.id);
      if (!cur || (cur.x === m.x && cur.y === m.y)) continue;
      cm.set(m.id, { ...cur, x: m.x, y: m.y });
    }
  });
}

/** コメントを削除する。ぶら下がっている返信も一緒に消す（孤児を残さない）。 */
export function deleteComment(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    commentsMap(doc).delete(id);
    const rm = repliesMap(doc);
    const orphans: string[] = [];
    rm.forEach((r, key) => { if (r?.commentId === id) orphans.push(key); });
    for (const key of orphans) rm.delete(key);
  });
}

/** 解決済み ⇔ 未解決 を切り替える。誰でも切り替えられる（Figma と同じ）。 */
export function setCommentResolved(doc: Y.Doc, id: string, resolved: boolean, byName: string): void {
  const cur = commentsMap(doc).get(id);
  if (!cur) return;
  commentsMap(doc).set(id, resolved
    ? { ...cur, resolved: true, resolvedAt: Date.now(), resolvedByName: byName }
    : { ...cur, resolved: false, resolvedAt: undefined, resolvedByName: undefined });
}

export function addReply(doc: Y.Doc, commentId: string, text: string, author: WbCommentAuthor): WbCommentReply {
  const r: WbCommentReply = {
    id: newId("wbr"), commentId,
    userId: author.id, userName: author.name,
    text, createdAt: Date.now(),
  };
  repliesMap(doc).set(r.id, r);
  return r;
}

export function updateReply(doc: Y.Doc, id: string, text: string): void {
  const cur = repliesMap(doc).get(id);
  if (!cur) return;
  repliesMap(doc).set(id, { ...cur, text, updatedAt: Date.now() });
}

export function deleteReply(doc: Y.Doc, id: string): void {
  repliesMap(doc).delete(id);
}

// ── 表示用ヘルパー ─────────────────────────────────────────
/** 「2026/08/07 14:32」形式。当日なら「14:32」だけにする。 */
export function formatCommentTime(ts: number): string {
  const d = new Date(ts);
  const hh = `${d.getHours()}`.padStart(2, "0");
  const mm = `${d.getMinutes()}`.padStart(2, "0");
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `${hh}:${mm}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

/** アバターに出す頭文字（日本語名でも1文字取れる）。 */
export function initialOf(name: string): string {
  return (name || "?").trim().slice(0, 1).toUpperCase();
}

// ── メンション ─────────────────────────────────────────────
// チケットのコメントと同じ「@メンバー名」形式。リッチエディタではなく素の textarea なので、
// 判定は「本文にメンバー名が @付きで含まれているか」の素直な突き合わせで行う
// （TicketDetailPanel.notifyMentions と同じ考え方）。
/** 本文の中で実際に言及されているメンバー名を返す（自分宛ては除く）。 */
export function mentionedMembers(text: string, members: string[], selfName: string): string[] {
  if (!text) return [];
  return members.filter((n) => n && n !== selfName && text.includes(`@${n}`));
}

export interface WbTextPart {
  text: string;
  /** メンションとして当たったメンバー名（素の文字列なら undefined） */
  mention?: string;
}

/**
 * 本文を「素の文字列」と「メンション」に切り分ける（表示で色を付けるため）。
 *
 * ・メンバー名は長いものから当てる。「山田」と「山田太郎」のように前方一致する名前があると、
 *   短いほうで切って「@山田 太郎」のような見た目になってしまうため。
 * ・members に無い「@なにか」は素の文字として返す。色が付かない＝通知も飛ばない、と
 *   見た目が一致するので、打ち間違いにその場で気づける（mentionedMembers と同じ突き合わせ）。
 */
export function splitMentions(text: string, members: string[]): WbTextPart[] {
  if (!text) return [];
  const names = members.filter((n) => !!n).sort((a, b) => b.length - a.length);
  if (names.length === 0) return [{ text }];

  const parts: WbTextPart[] = [];
  let buf = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "@") {
      const rest = text.slice(i + 1);
      const hit = names.find((n) => rest.startsWith(n));
      if (hit) {
        if (buf) { parts.push({ text: buf }); buf = ""; }
        parts.push({ text: `@${hit}`, mention: hit });
        i += hit.length + 1;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  if (buf) parts.push({ text: buf });
  return parts;
}

/**
 * 入力中のキャレット直前が「@…」ならその検索語を返す（メンション候補の絞り込み用）。
 * 「@」の直前が文字の場合（メールアドレス等）は候補を出さない。
 */
export function mentionQueryAt(text: string, caret: number): { query: string; start: number } | null {
  const head = text.slice(0, caret);
  const at = head.lastIndexOf("@");
  if (at < 0) return null;
  const query = head.slice(at + 1);
  if (/[\n\t]/.test(query)) return null;          // 改行をまたいだら別の話
  if (at > 0 && !/[\s(（[【]/.test(head[at - 1])) return null;
  return { query, start: at };
}
