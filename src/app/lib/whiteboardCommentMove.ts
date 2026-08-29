// ホワイトボードのコメントピンを「フレームと一緒に動かす」「その移動を undo/redo する」ための判定。
//
// ピンは Excalidraw の要素ではない DOM オーバーレイなので、
//   ・フレームの中身の追従（whiteboardFrames.followFrameMoves）
//   ・Excalidraw の undo/redo 履歴
// のどちらにも本来は乗らない。乗せる代わりに、ここで同じ結論を自前で出す。
// 描画や DOM に触れない純粋な関数だけを置く（CommentLayer から使い、単体で検証できるように）。

export type XY = { x: number; y: number };
export type FrameBox = { x: number; y: number; w: number; h: number };
/** 純移動したフレーム1つ。rect は「移動前」の矩形（この中に居たピンを運ぶ）。 */
export type FrameMove = { id: string; rect: FrameBox; dx: number; dy: number; area: number };

export const isFrameEl = (e: any): boolean => e?.type === "frame" || e?.type === "magicframe";

/** フレームの矩形。描いている途中は width/height が負になり得るので正規化する。 */
export function frameBoxOf(f: { x: number; y: number; width?: number; height?: number }): FrameBox {
  const w = f.width ?? 0, h = f.height ?? 0;
  return { x: Math.min(f.x, f.x + w), y: Math.min(f.y, f.y + h), w: Math.abs(w), h: Math.abs(h) };
}

const inBox = (p: XY, b: FrameBox) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

/**
 * 前回の位置と今のシーンを見比べて「純移動したフレーム」を拾う。
 * サイズが変わっているものはリサイズなので除く（枠を広げても中身は動かない・BRU5-061 と同じ判断）。
 * 前回の記録が無いもの（新規作成・読み込み直後）も除く。
 * @returns moved 移動したフレーム / cur 次回の比較に使う今の位置
 */
export function detectFrameMoves(
  prev: Map<string, FrameBox>,
  elements: readonly any[],
): { moved: FrameMove[]; cur: Map<string, FrameBox> } {
  const cur = new Map<string, FrameBox>();
  const moved: FrameMove[] = [];
  for (const el of elements) {
    if (!isFrameEl(el) || el.isDeleted) continue;
    const w = el.width ?? 0, h = el.height ?? 0;
    cur.set(el.id, { x: el.x, y: el.y, w, h });
    const p = prev.get(el.id);
    if (!p || p.w !== w || p.h !== h) continue;   // 新規作成／リサイズは追従しない
    if (p.x === el.x && p.y === el.y) continue;
    moved.push({
      id: el.id,
      rect: frameBoxOf({ x: p.x, y: p.y, width: w, height: h }),
      dx: el.x - p.x, dy: el.y - p.y, area: Math.abs(w * h),
    });
  }
  return { moved, cur };
}

/**
 * 移動したフレームの中に居たピンを、同じだけ動かした位置へ進める。
 * 入れ子は内側（面積の小さい方）を優先する＝親と子で二重に足さない。
 * @param pins いまのピン位置（Yjs 上の位置）
 * @param pending 未確定の位置。ここに在るものはその位置を起点にし、結果もここへ積む（破壊的に更新）
 * @param skip 追従させないピン（自分でドラッグ中など）
 * @returns pending（呼び出し側でそのまま使えるよう同じ参照を返す）
 */
export function carryPins(
  moved: readonly FrameMove[],
  pins: readonly { id: string; x: number; y: number; resolved?: boolean }[],
  pending: Map<string, XY>,
  skip?: (id: string) => boolean,
): Map<string, XY> {
  if (!moved.length) return pending;
  const order = [...moved].sort((a, b) => a.area - b.area); // 内側のフレームを先に見る
  for (const c of pins) {
    if (c.resolved) continue;            // 解決済みのピンは盤面に居ない
    if (skip?.(c.id)) continue;
    const p = pending.get(c.id) ?? { x: c.x, y: c.y };
    const m = order.find((v) => inBox(p, v.rect));
    if (m) pending.set(c.id, { x: p.x + m.dx, y: p.y + m.dy });
  }
  return pending;
}

// ── ピン移動の undo/redo ────────────────────────────────────
// コメントは Excalidraw の履歴に載らないので、ピンだけを動かした操作は自前で戻す。
// ただし横取りしていいのは「そのあとシーンが変わっていない＝いちばん新しい操作である」時だけ。
// 間に図形の操作が挟まっていれば標準の undo に譲る（シーンの署名が一致するかで見分ける。
// 図形側の undo が進んで署名が戻れば、その次の undo でこちらの番になる＝順番が自然に揃う）。

export type MoveEntry = { before: Map<string, XY>; after: Map<string, XY>; sig: string };
export interface MoveHistory { undo: MoveEntry[]; redo: MoveEntry[] }

export const newMoveHistory = (): MoveHistory => ({ undo: [], redo: [] });

const EPS = 0.01;

/** 実際に動いたピンだけの履歴を作る（動いていなければ null）。 */
export function buildMoveEntry(before: Map<string, XY>, after: Map<string, XY>, sig: string): MoveEntry | null {
  const b = new Map<string, XY>();
  const a = new Map<string, XY>();
  after.forEach((p, id) => {
    const q = before.get(id);
    if (!q) return;
    if (Math.abs(q.x - p.x) < EPS && Math.abs(q.y - p.y) < EPS) return;
    b.set(id, { x: q.x, y: q.y });
    a.set(id, { x: p.x, y: p.y });
  });
  return a.size ? { before: b, after: a, sig } : null;
}

export function pushMove(h: MoveHistory, entry: MoveEntry | null, limit = 50): void {
  if (!entry) return;
  h.undo.push(entry);
  while (h.undo.length > limit) h.undo.shift();
  h.redo.length = 0; // 新しい操作をしたらやり直しの分岐は捨てる
}

/**
 * undo/redo で戻す（進める）先のピン位置を取り出す。適用しない時は null。
 *  - 履歴が無い / シーンの署名が違う（間に図形の操作が挟まっている）→ null（標準の undo に譲る）
 *  - ピンが想定の位置に無い（他の人が動かした・消した）→ その履歴を捨てて null
 * @param posOf いまのピン位置（消えていれば null）
 */
export function takeMove(
  h: MoveHistory,
  dir: "undo" | "redo",
  sig: string,
  posOf: (id: string) => XY | null,
): Map<string, XY> | null {
  const stack = dir === "undo" ? h.undo : h.redo;
  const entry = stack[stack.length - 1];
  if (!entry) return null;
  if (entry.sig !== sig) return null;
  const from = dir === "undo" ? entry.after : entry.before;
  const to = dir === "undo" ? entry.before : entry.after;
  for (const [id, p] of from) {
    const cur = posOf(id);
    if (!cur || Math.abs(cur.x - p.x) > 0.5 || Math.abs(cur.y - p.y) > 0.5) { stack.pop(); return null; }
  }
  stack.pop();
  (dir === "undo" ? h.redo : h.undo).push(entry);
  return new Map(to);
}
