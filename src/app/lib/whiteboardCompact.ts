// doc_state（Yjs スナップショット）の圧縮。
//
// ── なぜ要るか ──────────────────────────────────────────────
// ExcalidrawYjsBridge は onChange のたびに要素の全JSONを Y.Map へ入れ直す
// （`yElements.set(el.id, clone(el))`）。図形を1回ドラッグすれば毎フレーム＝秒60回これが走り、
// そのたびに Yjs へレコードが1件積まれる。古い版は「削除済み」印が付くだけで消えないため、
// doc_state は実質「そのボードの全操作履歴」になり、描くほど単調に膨らむ。
//
// 実測（2026-09-09 本番）: 最大のボードは 38.6MB（base64）だが、
//   Yjs の内部レコード 2,508,826 件のうち生存はわずか 9,667 件（0.4%）。
//   意味のあるデータは 2.8MB しかなく、残りは全部その履歴だった。
// 全26ボードで 39.4MB → 詰め直すと 9.4MB、消済み要素も落とすと 5.1MB。
//
// ここでやるのは「今そこにある値だけを新しい Doc へ入れ直す」こと。図形は1つも減らない。
// 捨てるのは"どう動かしたか"の履歴だけ。
//
// ── 使ってよいタイミング（重要） ─────────────────────────────
// 詰め直すと Yjs の clientID が変わる。**そのボードを開いている人が他にいる間は絶対にやらない。**
// 相手が持っている元の Doc と、詰め直した Doc は Yjs から見て別系統になり、後から入った人が
// 両方を受け取ると、同じ図形について「古い版」が勝つことがある（＝編集が巻き戻る）。
// 呼び出し側（useWhiteboardSync）は「セッション中ひとりも他のメンバーを見なかった」ことを
// 確認してから、ボードを離れる時にだけ呼ぶ。
import * as Y from "yjs";

/** この大きさ未満は詰め直さない。効果より CPU の方が大きいので触らない */
const MIN_BYTES = 200_000;
/** 元の何割まで縮まなければ採用しないか（誤差レベルの入れ替えを避ける） */
const MIN_GAIN = 0.8;
/** 消済み要素(isDeleted)を落とすまでの猶予。直近の削除は undo される可能性があるので残す */
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * ホワイトボードの Y.Doc が持つ root（すべて Y.Map）。
 *
 * ⚠️ ここに載っていない root を1つでも見つけたら圧縮を中止する。
 * Yjs の update には「root がどの型か」が入っていないため、Y.Array の root を
 * getMap で読むと中身を黙って落としてしまう。root を増やしたらここに必ず足すこと。
 */
const MAP_ROOTS = new Set([
  "elements",           // ExcalidrawYjsBridge: 図形1つ = 1エントリ
  "files",              // WhiteboardCanvas: 画像の Storage URL
  "wbComments",         // whiteboardComments: コメントピン
  "wbCommentReplies",   // whiteboardComments: 返信
]);

/** 詰め直した後も残す値か。elements の古い消済み要素だけを落とす */
function keepEntry(root: string, value: unknown, now: number): boolean {
  if (root !== "elements") return true;
  const el = value as { isDeleted?: boolean; updated?: unknown } | null;
  if (!el || !el.isDeleted) return true;
  const updated = el.updated;
  // updated が無い/壊れている要素は判断材料が無いので残す（消して困るより残して困らない方を取る）
  if (typeof updated !== "number" || !Number.isFinite(updated) || updated <= 0) return true;
  return now - updated < TOMBSTONE_TTL_MS;
}

export interface CompactResult {
  /** 詰め直した update。縮まなかった / 安全に詰め直せなかった場合は null */
  update: Uint8Array | null;
  beforeBytes: number;
  afterBytes: number;
  /** 落とした消済み要素の数（ログ用） */
  droppedTombstones: number;
}

/**
 * Yjs の update を詰め直す。安全に詰め直せない時は必ず `update: null` を返す
 * （呼び出し側はその場合そのまま元の update を保存すればよい）。
 */
export function compactUpdate(raw: Uint8Array, now: number = Date.now()): CompactResult {
  const miss: CompactResult = { update: null, beforeBytes: raw.length, afterBytes: raw.length, droppedTombstones: 0 };
  if (raw.length < MIN_BYTES) return miss;

  let src: Y.Doc | null = null;
  let dst: Y.Doc | null = null;
  try {
    src = new Y.Doc();
    Y.applyUpdate(src, raw);

    // 知らない root があれば、それが Y.Map とは限らないので何もしない
    for (const name of src.share.keys()) if (!MAP_ROOTS.has(name)) return miss;

    let dropped = 0;
    dst = new Y.Doc();
    const source = src;
    const target = dst;
    target.transact(() => {
      for (const name of source.share.keys()) {
        const from = source.getMap(name);
        const to = target.getMap(name);
        from.forEach((value, key) => {
          if (keepEntry(name, value, now)) to.set(key, value);
          else dropped++;
        });
      }
    });

    const out = Y.encodeStateAsUpdate(dst);
    if (out.length >= raw.length * MIN_GAIN) {
      return { update: null, beforeBytes: raw.length, afterBytes: out.length, droppedTombstones: dropped };
    }
    return { update: out, beforeBytes: raw.length, afterBytes: out.length, droppedTombstones: dropped };
  } catch {
    // 想定外の構造だった時は黙って諦める（保存自体は元の update で続く）
    return miss;
  } finally {
    src?.destroy();
    dst?.destroy();
  }
}
