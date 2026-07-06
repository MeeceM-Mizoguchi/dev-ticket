// フレームで囲った図形をフレームに「グループ化」する仕組み（BRU4-054）。
//
// ホワイトボードは Excalidraw 標準の frame 要素(type:"frame")を使っているが、
// この統合ではフレームを描いても内包図形へ frameId が自動付与されず、
// 結果フレームを動かしても中身が付いてこない（＝所属していないため）。
//
// ここでフレームの新規作成/リサイズを検知し、その矩形に完全内包される図形へ
// frameId を付与する。frameId さえ付けば「フレーム移動時に子要素も一緒に動く」のは
// Excalidraw 標準機能が担い、その版数(version)更新が Yjs 同期にも正しく乗る。
//
// 注意: 移動(x/yのみ変化)では再キャプチャしない。移動時に矩形内包で再判定すると、
// 枠外へ出た瞬間に所属解除され、逆に中身が置いていかれてしまうため。所属は
// 「作成/リサイズ時に確定」し、以降の追従は frameId ベースの標準挙動に委ねる。

const rand = () => Math.floor(Math.random() * 0x7fffffff);
const isFrame = (e: any) => e?.type === "frame" || e?.type === "magicframe";

// 要素 el がフレーム矩形 f に完全内包されるか（非回転bbox基準）。
function isInsideFrame(el: any, f: any): boolean {
  return (
    el.x >= f.x &&
    el.y >= f.y &&
    el.x + el.width <= f.x + f.width &&
    el.y + el.height <= f.y + f.height
  );
}

/**
 * フレームの新規作成/リサイズを検知し、内包する図形へ frameId を付与する。
 *
 * @param frameSig 前回見たフレーム矩形の署名(id -> "x,y,w,h")。新規/リサイズ判定に使う。
 *                 本関数が（remote以外で）呼ばれるたびに最新へ更新する。
 * @returns updateScene で反映したら true（呼び出し側で他ヘルパーの二重適用を避けるのに使う）
 */
export function captureFrameChildren(
  api: any,
  elements: readonly any[],
  appState: any,
  frameSig: Map<string, string>,
): boolean {
  const draftId = appState?.newElement?.id; // 描画中(未確定)のフレームは対象外
  const frames = elements.filter((e) => isFrame(e) && !e.isDeleted);
  if (frames.length === 0) {
    frameSig.clear();
    return false;
  }

  // 「新規作成 or リサイズ」されたフレームだけを対象に選ぶ
  const targets: any[] = [];
  const nextSig = new Map<string, string>();
  for (const f of frames) {
    if (f.id === draftId) continue; // 描画確定前は記録も対象化もしない（確定時に新規として拾う）
    const sig = `${f.x},${f.y},${f.width},${f.height}`;
    const prev = frameSig.get(f.id);
    nextSig.set(f.id, sig);
    if (prev === undefined) {
      targets.push(f); // 新規（または確定直後・ロード直後）
      continue;
    }
    const parts = prev.split(",").map(Number);
    const pw = parts[2], ph = parts[3];
    if (pw !== f.width || ph !== f.height) targets.push(f); // リサイズ（移動は標準に委ねる）
  }

  // 次回比較用に署名を最新化（削除されたフレームは nextSig に無いので消える）
  frameSig.clear();
  nextSig.forEach((v, k) => frameSig.set(k, v));

  if (targets.length === 0) return false;

  let changed = false;
  const updated = elements.map((el) => {
    if (isFrame(el) || el.isDeleted || el.id === draftId) return el;
    for (const f of targets) {
      if (isInsideFrame(el, f)) {
        if (el.frameId === f.id) return el; // 既に所属済み
        changed = true;
        return { ...el, frameId: f.id, version: (el.version ?? 1) + 1, versionNonce: rand() };
      }
    }
    return el;
  });

  if (!changed) return false;
  api.updateScene({ elements: updated });
  return true;
}
