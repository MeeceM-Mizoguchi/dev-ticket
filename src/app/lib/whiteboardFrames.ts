// フレームで囲った図形／フレームを親フレームに「グループ化」する仕組み（BRU4-054 / BRU5-040）。
//
// 所属関係は Excalidraw ネイティブの frameId ではなく、自前の customData.wbParent
// （親フレームの id）で表す。理由:
//  - ネイティブ frameId は Excalidraw の z-order 再整列で剥がれることがあり、
//    「何かの操作で一定確率でグループが解ける」不具合の原因になっていた（BRU5-040）。
//    customData は z-order ロジックの対象外で、要素まるごと Yjs 同期されるため剥がれない。
//  - frameId はフレームの入れ子（frame-in-frame）を表現できない。wbParent なら任意段数の
//    ネストを表現でき、親フレーム移動時の追従も自前のデルタ平行移動（followFrameMoves）で
//    図形・入れ子フレームともに一元化できる。
//
// 所属の確定は次の2契機で行う:
//  - フレームの新規作成/リサイズ時（captureFrameChildren）
//  - 要素のドラッグ確定時（reparentDraggedElements）… 枠へ入れた/出した/入れ子にした を反映
//
// 既存データ（旧 frameId）は読み込み時に ExcalidrawYjsBridge.migrateNativeFrames() が
// wbParent へ移し frameId を外すため、ここでは wbParent のみを所属根拠とする。

const rand = () => Math.floor(Math.random() * 0x7fffffff);
const isFrame = (e: any) => e?.type === "frame" || e?.type === "magicframe";

// 要素の所属親フレーム id（無所属は null）。
export function resolveParent(el: any): string | null {
  const p = el?.customData?.wbParent;
  return typeof p === "string" && p ? p : null;
}

// フレーム矩形を正規化（ドラッグ方向で width/height が負になり得る）。
function normRect(f: any): { x: number; y: number; width: number; height: number } {
  const x = Math.min(f.x, f.x + f.width);
  const y = Math.min(f.y, f.y + f.height);
  return { x, y, width: Math.abs(f.width), height: Math.abs(f.height) };
}

// 要素 el がフレーム f に完全内包されるか（非回転bbox基準）。
function isInsideFrame(el: any, f: any): boolean {
  const r = normRect(f);
  return (
    el.x >= r.x &&
    el.y >= r.y &&
    el.x + el.width <= r.x + r.width &&
    el.y + el.height <= r.y + r.height
  );
}

// id -> 親フレームid のマップ（親が実在する非削除フレームの時だけ張る＝孤児は無所属扱い）。
function buildParentMap(elements: readonly any[]): Map<string, string> {
  const frameIds = new Set(elements.filter((e) => isFrame(e) && !e.isDeleted).map((e) => e.id));
  const m = new Map<string, string>();
  for (const el of elements) {
    if (el.isDeleted) continue;
    const p = resolveParent(el);
    if (p && frameIds.has(p) && p !== el.id) m.set(el.id, p);
  }
  return m;
}

// elId が ancId の子孫か（wbParent 鎖を上へ辿る・循環/深すぎは打ち切り）。
function isDescendantOf(elId: string, ancId: string, parentMap: Map<string, string>): boolean {
  let cur: string | undefined = parentMap.get(elId);
  let guard = 0;
  while (cur && guard++ < 64) {
    if (cur === ancId) return true;
    cur = parentMap.get(cur);
  }
  return false;
}

// el を最小内包するフレームの id（無ければ null）。
// el 自身・el の子孫フレームは除外（フレームを自分の子孫の中へ入れる循環を防ぐ）。
function computeParentFor(el: any, frames: readonly any[], parentMap: Map<string, string>): string | null {
  let bestId: string | null = null;
  let bestArea = Infinity;
  for (const f of frames) {
    if (f.id === el.id) continue;
    if (isDescendantOf(f.id, el.id, parentMap)) continue;
    if (!isInsideFrame(el, f)) continue;
    const r = normRect(f);
    const area = r.width * r.height;
    if (area < bestArea) { bestArea = area; bestId = f.id; }
  }
  return bestId;
}

// wbParent を書き換えた要素だけを更新して updateScene（version を上げ Yjs 同期に乗せる）。
// あわせてネイティブ frameId を外し、所属根拠を wbParent 一本に統一する。
function applyParents(api: any, elements: readonly any[], nextParent: Map<string, string | null>): boolean {
  let changed = false;
  const updated = elements.map((el) => {
    if (!nextParent.has(el.id)) return el;
    const np = nextParent.get(el.id) ?? null;
    if (resolveParent(el) === np) return el;
    changed = true;
    return {
      ...el,
      frameId: null,
      customData: { ...(el.customData ?? {}), wbParent: np },
      version: (el.version ?? 1) + 1,
      versionNonce: rand(),
    };
  });
  if (!changed) return false;
  api.updateScene({ elements: updated });
  return true;
}

/**
 * フレームの新規作成/リサイズを検知し、内包する要素（図形・入れ子フレーム）へ wbParent を付与する。
 * 各要素は「最小内包フレーム」に所属させるため、内側フレームの子を外側フレームが奪わない。
 *
 * @param frameSig 前回見たフレーム矩形の署名(id -> "x,y,w,h")。新規/リサイズ判定に使う。
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

  // 「新規作成 or リサイズ」されたフレームだけを対象に選ぶ（移動は追従に委ねる）
  const targets: any[] = [];
  const nextSig = new Map<string, string>();
  for (const f of frames) {
    if (f.id === draftId) continue;
    const r = normRect(f);
    const sig = `${r.x},${r.y},${r.width},${r.height}`;
    const prev = frameSig.get(f.id);
    nextSig.set(f.id, sig);
    if (prev === undefined) { targets.push(f); continue; }
    const parts = prev.split(",").map(Number);
    if (parts[2] !== r.width || parts[3] !== r.height) targets.push(f); // リサイズ
  }
  frameSig.clear();
  nextSig.forEach((v, k) => frameSig.set(k, v));
  if (targets.length === 0) return false;

  const parentMap = buildParentMap(elements);
  // 候補 = 変更フレームの矩形に内包される要素 ＋ 変更フレーム自身（入れ子確定用）
  const isCandidate = (el: any) =>
    targets.some((t) => t.id === el.id || isInsideFrame(el, t));

  const nextParent = new Map<string, string | null>();
  for (const el of elements) {
    if (el.isDeleted || el.id === draftId || !isCandidate(el)) continue;
    const np = computeParentFor(el, frames, parentMap);
    if (np !== resolveParent(el)) nextParent.set(el.id, np);
  }
  return applyParents(api, elements, nextParent);
}

/**
 * ドラッグ確定時に、ユーザーが動かした（選択中の）要素の所属を幾何的内包で再判定する。
 * 図形をフレームへ入れた/出した、フレームを別フレームへ入れ子にした/出した、を反映する。
 * 動かした要素“自身”のみ再判定し、その子（フレームごと運ばれた中身）は再判定しない。
 * 最新シーンから要素を取り直すため、同tickで followFrameMoves が先に updateScene しても
 * その結果を踏まえて上書きせずに適用できる。
 *
 * @returns updateScene で反映したら true
 */
export function reparentDraggedElements(api: any, appState: any): boolean {
  const sel = appState?.selectedElementIds || {};
  const ids = Object.keys(sel).filter((id) => sel[id]);
  if (ids.length === 0) return false;
  const elements = api.getSceneElements();
  const frames = elements.filter((e: any) => isFrame(e) && !e.isDeleted);
  const parentMap = buildParentMap(elements);
  const byId = new Map<string, any>(elements.map((e: any) => [e.id, e]));

  const nextParent = new Map<string, string | null>();
  for (const id of ids) {
    const el = byId.get(id);
    if (!el || el.isDeleted) continue;
    const np = computeParentFor(el, frames, parentMap);
    if (np !== resolveParent(el)) nextParent.set(id, np);
  }
  return applyParents(api, elements, nextParent);
}

/**
 * フレーム移動時に、その子孫（入れ子フレーム＋各フレームの中身）を同じデルタで平行移動する。
 * ネイティブ frameId を使わないため追従は標準機能に頼らず、ここで一元的に行う。
 *
 *  - 動いたフレーム自身: ユーザー操作で Excalidraw が既に動かしたので対象外
 *  - 選択中の要素: 一緒にドラッグされ Excalidraw が動かしたので対象外（二重移動防止）
 *  - 所属(wbParent)が「最寄りの動いたフレーム」に繋がる要素: そのデルタで平行移動
 *  - 所属未付与の要素: フレームの“移動前矩形”に内包されるものを幾何判定で救済（この機に所属も補完）
 *  - 図形内テキスト(containerId): 親図形が動くなら必ず追従（バウンドテキストの置き去り防止）
 *
 * 所属付与はフレーム作成/リサイズ時とドラッグ確定時にしか起きないため、あとから追加した図形や
 * 図形に紐づくテキストは所属漏れになりがち。それらを「移動前矩形の内包」で拾って取りこぼしを防ぐ。
 *
 * リサイズ/新規描画/リモート反映中は追従しない（位置スナップショットのみ更新して抜ける）。
 *
 * @param prevPos 前回のフレーム位置(id -> {x,y})。移動検知に使い、毎回最新へ更新する。
 * @returns updateScene で反映したら true
 */
export function followFrameMoves(
  api: any,
  elements: readonly any[],
  appState: any,
  prevPos: Map<string, { x: number; y: number }>,
  remote: boolean,
): boolean {
  const draftId = appState?.newElement?.id;
  const frames = elements.filter((e) => isFrame(e) && !e.isDeleted);

  const nextPos = new Map<string, { x: number; y: number }>();
  for (const f of frames) {
    if (f.id === draftId) continue;
    nextPos.set(f.id, { x: f.x, y: f.y });
  }
  const commitPos = (map: Map<string, { x: number; y: number }>) => {
    prevPos.clear();
    map.forEach((v, k) => prevPos.set(k, v));
  };

  // リサイズ/新規描画/リモート反映では追従しない。位置だけ最新化して抜ける
  // （後続の純移動で誤って大きなデルタを検出しないため）。
  if (remote || appState?.resizingElement || appState?.newElement) {
    commitPos(nextPos);
    return false;
  }

  // 前回位置と比べて動いたフレーム（ユーザー操作による移動）を検出
  const moved = new Map<string, { dx: number; dy: number }>();
  for (const [id, pos] of nextPos) {
    const prev = prevPos.get(id);
    if (prev && (prev.x !== pos.x || prev.y !== pos.y)) {
      moved.set(id, { dx: pos.x - prev.x, dy: pos.y - prev.y });
    }
  }
  if (moved.size === 0) { commitPos(nextPos); return false; }

  const parentMap = buildParentMap(elements);
  const sel = appState?.selectedElementIds || {};
  const byId = new Map<string, any>(elements.map((e) => [e.id, e]));
  const nearestMovedDelta = (id: string): { dx: number; dy: number } | null => {
    let cur: string | undefined = parentMap.get(id);
    let guard = 0;
    while (cur && guard++ < 64) {
      const d = moved.get(cur);
      if (d) return d;
      cur = parentMap.get(cur);
    }
    return null;
  };

  // 動いたフレームの「移動前の矩形」（prevPos の位置 ＋ 移動で変わらない現在の幅高）。
  // 所属(wbParent)が未付与の要素（あとから追加した図形・図形内のバウンドテキスト等）を
  // 取りこぼさないため、この矩形に内包される要素も追従させる。小さいフレーム優先で選ぶ。
  const movedRects: { id: string; rect: any; d: { dx: number; dy: number }; area: number }[] = [];
  for (const [id, d] of moved) {
    const f = byId.get(id);
    const prev = prevPos.get(id);
    if (!f || !prev) continue;
    const rect = normRect({ x: prev.x, y: prev.y, width: f.width, height: f.height });
    movedRects.push({ id, rect, d, area: rect.width * rect.height });
  }
  movedRects.sort((a, b) => a.area - b.area);
  // 所属が実在フレームに繋がっていない要素だけ幾何内包で救済する（別フレーム所属の要素を奪わない）。
  const geoDeltaFor = (el: any): { dx: number; dy: number } | null => {
    if (parentMap.has(el.id)) return null;
    for (const mr of movedRects) {
      if (mr.id === el.id) continue;
      if (isInsideFrame(el, mr.rect)) return mr.d;
    }
    return null;
  };

  // 各要素の移動デルタを決定。優先: 所属チェーン → 幾何内包 → バウンドテキスト（親図形に追従）。
  const deltaById = new Map<string, { dx: number; dy: number }>();
  for (const el of elements) {
    if (el.isDeleted || sel[el.id]) continue;         // 削除／共ドラッグ済みは対象外
    if (isFrame(el) && moved.has(el.id)) continue;    // 動いたフレーム自身は移動済み
    const d = nearestMovedDelta(el.id) ?? geoDeltaFor(el);
    if (d) deltaById.set(el.id, d);
  }
  // 図形内テキスト（containerId）は単独ドラッグされず所属も付きにくいので、親図形が動くなら必ず追従。
  for (const el of elements) {
    if (el.isDeleted || sel[el.id] || deltaById.has(el.id)) continue;
    const cid = el.containerId;
    if (cid && deltaById.has(cid)) deltaById.set(el.id, deltaById.get(cid)!);
  }

  let changed = false;
  const updated = elements.map((el) => {
    const d = deltaById.get(el.id);
    if (!d) return el;
    changed = true;
    const base: any = { ...el, x: el.x + d.dx, y: el.y + d.dy, version: (el.version ?? 1) + 1, versionNonce: rand() };
    // 所属が未付与のまま追従した要素は、この機に正しい所属フレームへ紐付けて以後を安定させる
    // （z-order・所属再判定・次回の追従が「幾何救済頼み」から「所属チェーン」に乗る）。
    if (!parentMap.has(el.id)) {
      const np = computeParentFor(el, frames, parentMap);
      if (np && np !== resolveParent(el)) base.customData = { ...(el.customData ?? {}), wbParent: np };
    }
    return base;
  });

  if (!changed) { commitPos(nextPos); return false; }
  api.updateScene({ elements: updated });

  // 追従後のフレーム位置で prevPos を更新（このupdateScene由来の次tickを移動と誤検知しない）
  const afterPos = new Map<string, { x: number; y: number }>();
  for (const el of updated) {
    if (isFrame(el) && !el.isDeleted && el.id !== draftId) afterPos.set(el.id, { x: el.x, y: el.y });
  }
  commitPos(afterPos);
  return true;
}

/**
 * フレームが自分の子孫より背面に来るよう並べ替える。
 * ネイティブ frameId を使わないため「配列順 = z-order（フレームは中身の背面）」を
 * こちらで保証する。同じ親の兄弟内は元の index 順を保持し、全クライアントで決定的に揃える。
 *
 * @param sorted fractional index 昇順で整列済みの要素配列
 */
export function orderFramesBehindChildren(sorted: readonly any[]): any[] {
  const frameIds = new Set(sorted.filter((e) => isFrame(e) && !e.isDeleted).map((e) => e.id));
  const parentOf = (el: any): string | null => {
    const p = resolveParent(el);
    return p && frameIds.has(p) && p !== el.id ? p : null;
  };
  const childrenOf = new Map<string, any[]>();
  for (const el of sorted) {
    const p = parentOf(el);
    if (!p) continue;
    const arr = childrenOf.get(p) ?? [];
    arr.push(el);
    childrenOf.set(p, arr);
  }
  const out: any[] = [];
  const emitted = new Set<string>();
  const emit = (el: any, depth: number) => {
    if (emitted.has(el.id) || depth > 64) return;
    emitted.add(el.id);
    out.push(el);
    const kids = childrenOf.get(el.id);
    if (kids) for (const k of kids) emit(k, depth + 1);
  };
  for (const el of sorted) {
    if (parentOf(el)) continue; // 子は親の下で emit される
    emit(el, 0);
  }
  // 取りこぼし（循環など）は元順で末尾に付ける
  for (const el of sorted) if (!emitted.has(el.id)) { emitted.add(el.id); out.push(el); }
  return out;
}
