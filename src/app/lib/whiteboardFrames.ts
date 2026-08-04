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

/**
 * 選択中の要素に加え、「一緒に運ばないと壊れる連れ子」も集める（推移的に辿る）。
 * 画像コピー（whiteboardCopySelection）と、フレームのコピー/切り取り（whiteboardFrameCopy）で共用する。
 *  - コンテナに束縛されたテキスト（containerId が取込済み）… これが無いと文字が消える
 *  - フレームの内包要素（wbParent / frameId が取込済み）… フレーム→入れ子フレーム→その中の図形まで
 *  - テキストボックスの影の背景板（BRU5-062: customData.wbBgFor が取込済みテキスト）
 *  - フレーム装飾の影矩形（BRU5-063: customData.wbFrameBg が取込済みフレーム）… 枠色/背景が消えないように
 * ※wbParent は「直接の親」しか指さないため、入れ子フレームの孫要素を取りこぼさないよう
 *   「取込済み集合が増えなくなるまで」繰り返し拡張する（不動点）。
 * 返り値はシーンの並び順（fractional index 昇順）を保つ。
 */
export function collectSelectionClosure(api: any): any[] {
  const all = api.getSceneElements() as any[];
  const sel: Record<string, boolean> = api.getAppState().selectedElementIds || {};
  const selectedIds = new Set(Object.keys(sel).filter((id) => sel[id]));
  if (selectedIds.size === 0) return [];

  const included = new Set<string>(selectedIds);
  const has = (id?: string | null) => !!id && included.has(id);
  let grew = true;
  while (grew) {
    grew = false;
    for (const el of all) {
      if (el.isDeleted || included.has(el.id)) continue;
      const cd = el.customData || {};
      if (has(el.containerId) || has(el.frameId) || has(cd.wbParent) || has(cd.wbBgFor) || has(cd.wbFrameBg)) {
        included.add(el.id);
        grew = true;
      }
    }
  }
  return all.filter((el) => !el.isDeleted && included.has(el.id));
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
    // テキスト背景の影矩形(BRU5-062)の所属は syncTextBoxBgRects がテキストへミラーする唯一の書き手。
    // ここで幾何判定に基づき別々に書くと、文字は枠内・影矩形(PAD分大きい)は枠外で所属が食い違い、
    // 毎tick互いに上書きし合うチラつき(churn)になるため対象外にする。
    if (el?.customData?.wbBgFor) return el;
    // フレーム装飾の影矩形(BRU5-063)も同様に、所属(wbParent=frame)は syncFrameDecorRects が
    // 唯一の書き手。幾何判定で別途書くとフレーム自身を親にしようとして食い違うため対象外。
    if (el?.customData?.wbFrameBg) return el;
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
 * @param bornIds このドラッグ操作中に生まれた要素id（Alt複製した複製など）。元フレームの移動へ
 *   巻き込んで動かさない（複製は元位置に残すのが正しい）。二重移動＆収束不能の防止（BRU7-043）。
 * @returns updateScene で反映したら true
 */
export function followFrameMoves(
  api: any,
  elements: readonly any[],
  appState: any,
  prevPos: Map<string, { x: number; y: number; w: number; h: number }>,
  remote: boolean,
  bornIds?: Set<string>,
): boolean {
  const draftId = appState?.newElement?.id;
  const frames = elements.filter((e) => isFrame(e) && !e.isDeleted);

  // 全非削除要素の現在位置スナップショット。フレーム移動検知に加え、子が「この tick で
  // 既にフレームと同じデルタだけ動いたか」（undo/redo でフレームごと戻った/進んだ）の判定にも使う。
  // 追従は子を updateScene(既定=EVENTUALLY) で動かすため、フレーム移動と同一の履歴増分にまとまる。
  // よって undo/redo では Excalidraw がフレームと子を一緒に戻す。ここでその戻りを「新たな移動」と
  // 誤検知して子へ逆デルタを再適用すると二重移動で位置がズレる（BRU5-060）。それを防ぐため、
  // フレームのみでなく全要素の前回位置を保持し、既に一緒に動いた子は追従対象から除外する。
  // 幅・高さ(w,h)も保持し、フレームの「純移動(位置変化かつサイズ不変)」と「リサイズ(サイズ変化)」を
  // 幾何で判別する（左辺・上辺リサイズは x,y も動くため、位置差だけでは移動と誤検知する・BRU5-061）。
  const curPos = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const el of elements) {
    if (el.isDeleted || el.id === draftId) continue;
    curPos.set(el.id, { x: el.x, y: el.y, w: el.width ?? 0, h: el.height ?? 0 });
  }
  const commitPos = (map: Map<string, { x: number; y: number; w: number; h: number }>) => {
    prevPos.clear();
    map.forEach((v, k) => prevPos.set(k, v));
  };

  // リサイズ/新規描画/リモート反映では追従しない。位置だけ最新化して抜ける
  // （後続の純移動で誤って大きなデルタを検出しないため）。
  if (remote || appState?.resizingElement || appState?.newElement) {
    commitPos(curPos);
    return false;
  }

  // 前回位置と比べて「純移動した」フレーム（ユーザー操作による平行移動）を検出。
  // サイズ(w,h)が変わっていれば移動ではなくリサイズとみなし、子を動かさない（BRU5-061）。
  const moved = new Map<string, { dx: number; dy: number }>();
  for (const f of frames) {
    if (f.id === draftId) continue;
    const prev = prevPos.get(f.id);
    const sameSize = prev && prev.w === (f.width ?? 0) && prev.h === (f.height ?? 0);
    if (prev && sameSize && (prev.x !== f.x || prev.y !== f.y)) {
      moved.set(f.id, { dx: f.x - prev.x, dy: f.y - prev.y });
    }
  }
  if (moved.size === 0) { commitPos(curPos); return false; }

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

  // 要素 el がこの tick で既にデルタ d ぶん動いているか。undo/redo ではフレームと子が同一の
  // 履歴増分で一緒に戻る/進むため、子は既に d ぶん移動済み。これを再度動かすと二重移動になるので除外する（BRU5-060）。
  // ドラッグ/矢印キー移動では子はまだ動いていない（selfDelta≈0）ため、この判定に引っかからず従来どおり追従する。
  const MOVE_EPS = 0.01;
  const alreadyMoved = (el: any, d: { dx: number; dy: number }): boolean => {
    const prev = prevPos.get(el.id);
    if (!prev) return false;
    return Math.abs((el.x - prev.x) - d.dx) < MOVE_EPS && Math.abs((el.y - prev.y) - d.dy) < MOVE_EPS;
  };

  // 各要素の移動デルタを決定。優先: 所属チェーン → 幾何内包 → バウンドテキスト（親図形に追従）。
  const deltaById = new Map<string, { dx: number; dy: number }>();
  for (const el of elements) {
    if (el.isDeleted || sel[el.id]) continue;         // 削除／共ドラッグ済みは対象外
    if (bornIds?.has(el.id)) continue;                // このドラッグで生まれた複製は追従させない（BRU7-043）
    if (isFrame(el) && moved.has(el.id)) continue;    // 動いたフレーム自身は移動済み
    const d = nearestMovedDelta(el.id) ?? geoDeltaFor(el);
    if (d && !alreadyMoved(el, d)) deltaById.set(el.id, d); // undo/redo で一緒に動いた子は除外
  }
  // 図形内テキスト（containerId）は単独ドラッグされず所属も付きにくいので、親図形が動くなら必ず追従。
  for (const el of elements) {
    if (el.isDeleted || sel[el.id] || deltaById.has(el.id)) continue;
    if (bornIds?.has(el.id)) continue;                // 複製された図形内テキストも追従対象外（BRU7-043）
    const cid = el.containerId;
    if (cid && deltaById.has(cid)) {
      const d = deltaById.get(cid)!;
      if (!alreadyMoved(el, d)) deltaById.set(el.id, d);
    }
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

  if (!changed) { commitPos(curPos); return false; }
  api.updateScene({ elements: updated });

  // 追従後の全要素位置で prevPos を更新（このupdateScene由来の次tickを移動と誤検知しない／
  // 子の「既に動いたか」判定が次tickで正しく効くよう、フレーム以外も含めて最新化する）。
  const afterPos = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const el of updated) {
    if (el.isDeleted || el.id === draftId) continue;
    afterPos.set(el.id, { x: el.x, y: el.y, w: el.width ?? 0, h: el.height ?? 0 });
  }
  commitPos(afterPos);
  return true;
}

/**
 * フレームが自分の子孫より背面に来るよう並べ替える。
 * ネイティブ frameId を使わないため「フレームは中身の背面」だけをこちらで保証する。
 *
 * 【重要・BRU7-057】ここで保証するのは “それだけ” にする。
 * 以前はフレームの子孫を「フレームの直後へまとめて emit」していたため、子の重なり順が
 * フレームの位置に固定され、fractional index を無視していた。その結果
 *   ・フレーム内の図形を「最前面へ」しても、フレーム外の要素（あとから引いた矢印・貼った画像など）
 *     より前に出られない ＝ ボタンを押しても何も起きない
 *   ・逆にフレーム外の要素は常にフレームの中身より前面
 * となっていた。Excalidraw の「最前面へ」は index を全体の最大値に振り直す（frameId を使って
 * いないので盤面全体が対象）ので、こちらが位置を握り潰していたのが原因。
 *
 * 新方式: index 昇順（＝ユーザーが決めた重なり順）をそのまま維持し、フレーム要素だけを
 * 「自分の最も背面の子孫の直前」へ引き下げる。子は動かさないので最前面/最背面がそのまま効く。
 * 位置は元配列の添字から決定的に導くため、全クライアントで同じ並びに揃う。
 *
 * 例外は「フレーム自身が全子孫より前面にある」状態だけ。Excalidraw の最前面/前面へは
 * frameId を見ないためフレーム要素しか動かさず、放置すると引き下げで元に戻って“ボタンが効かない”
 * ことになる。この並びは通常の収束状態では起こり得ない（＝ユーザーがフレームを前へ出した合図）
 * ので、その時だけ子孫をフレームの直後へ連れて行き、グループごと前面へ出す。
 *
 * @param sorted fractional index 昇順で整列済みの要素配列
 */
export function orderFramesBehindChildren(sorted: readonly any[]): any[] {
  const frameIds = new Set(sorted.filter((e) => isFrame(e) && !e.isDeleted).map((e) => e.id));
  if (frameIds.size === 0) return sorted.slice();
  const parentOf = (el: any): string | null => {
    const p = resolveParent(el);
    return p && frameIds.has(p) && p !== el.id ? p : null;
  };

  sorted = carryFramesMovedToFront(sorted, frameIds, parentOf);

  const pos = new Map<string, number>();
  sorted.forEach((el, i) => pos.set(el.id, i));

  // 各フレームの「引き下げ先」= 自分と全子孫の中で最も背面（＝添字が最小）の位置。
  // 入れ子フレームも祖先チェーンを遡って伝播させる（親は孫より必ず背面になる）。
  const anchor = new Map<string, number>();
  const depth = new Map<string, number>();
  for (const el of sorted) {
    const i = pos.get(el.id)!;
    if (frameIds.has(el.id)) anchor.set(el.id, Math.min(anchor.get(el.id) ?? i, i));
    let cur = parentOf(el);
    let d = 0;
    while (cur && d++ < 64) {
      anchor.set(cur, Math.min(anchor.get(cur) ?? i, i));
      cur = parentOf(sorted[pos.get(cur)!]);
    }
    if (frameIds.has(el.id)) depth.set(el.id, d);
  }

  // フレームは「引き下げ先の直前(-0.5)」へ。整数の隣接要素は跨がないので、
  // フレーム以外の重なり順は一切変わらない。
  const keyOf = (el: any): number => {
    const i = pos.get(el.id)!;
    return frameIds.has(el.id) ? (anchor.get(el.id) ?? i) - 0.5 : i;
  };
  return sorted.slice().sort((a, b) => {
    const d = keyOf(a) - keyOf(b);
    if (d !== 0) return d;
    // 同じ位置を取り合うのは入れ子フレームだけ。浅い（外側の）フレームを背面にする。
    const dd = (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0);
    return dd !== 0 ? dd : pos.get(a.id)! - pos.get(b.id)!;
  });
}

/**
 * 「フレームを最前面へ」を成立させる前処理。
 * フレーム要素が自分の全子孫より後ろ（＝前面）に来ている時だけ、その子孫をフレームの直後へ
 * 集めてグループごと運ぶ。通常はフレームが必ず子孫より前（背面）に整列されるので、この形は
 * ユーザーがフレームを前面へ出した／既存の図形を囲うフレームを新規作成した時にしか現れない。
 * 該当が無ければ元配列をそのまま返す（＝通常時のコストは走査1回のみ）。
 */
function carryFramesMovedToFront(
  sorted: readonly any[],
  frameIds: Set<string>,
  parentOf: (el: any) => string | null,
): readonly any[] {
  // frameId -> 子孫（元の並び順）
  const byId = new Map<string, any>(sorted.map((e) => [e.id, e]));
  const descOf = new Map<string, any[]>();
  const ancestorsOf = (el: any): string[] => {
    const out: string[] = [];
    let cur = parentOf(el);
    let guard = 0;
    while (cur && guard++ < 64) {
      out.push(cur);
      const p = byId.get(cur);
      cur = p ? parentOf(p) : null;
    }
    return out;
  };
  for (const el of sorted) {
    for (const a of ancestorsOf(el)) {
      const arr = descOf.get(a) ?? [];
      arr.push(el);
      descOf.set(a, arr);
    }
  }

  const pos = new Map<string, number>();
  sorted.forEach((el, i) => pos.set(el.id, i));
  // 「自分の全子孫より前面」＝ フレームの添字が子孫の最大添字より大きい
  const moving = new Set<string>();
  for (const id of frameIds) {
    const desc = descOf.get(id);
    if (!desc || !desc.length) continue;
    const maxDesc = desc.reduce((m, d) => Math.max(m, pos.get(d.id)!), -1); // 子孫が多くても安全（spread しない）
    if (pos.get(id)! > maxDesc) moving.add(id);
  }
  if (!moving.size) return sorted;

  // 運ばれる子孫は元の位置から抜き、フレームの直後へ差し込む。
  // 入れ子フレームが両方 moving でも、外側の子孫リストに内側とその中身が含まれるため二重には出ない。
  const carried = new Set<string>();
  for (const id of moving) for (const d of descOf.get(id)!) carried.add(d.id);
  const out: any[] = [];
  const emitted = new Set<string>();
  for (const el of sorted) {
    if (carried.has(el.id)) continue;
    if (emitted.has(el.id)) continue;
    emitted.add(el.id);
    out.push(el);
    if (!moving.has(el.id)) continue;
    for (const d of descOf.get(el.id)!) {
      if (emitted.has(d.id)) continue;
      emitted.add(d.id);
      out.push(d);
    }
  }
  for (const el of sorted) if (!emitted.has(el.id)) { emitted.add(el.id); out.push(el); }
  return out;
}
