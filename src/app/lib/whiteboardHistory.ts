// ホワイトボードの「元に戻す（undo）」を正しく効かせるための履歴記録ポリシー（BRU7-058）。
//
// 【前提】Excalidraw の updateScene は captureUpdate を省略すると CaptureUpdateAction.EVENTUALLY
// になる。EVENTUALLY は履歴スナップショットを進めないため、その更新は
// **次にユーザーが行った操作の履歴エントリへ丸ごと混入する**。
//
//   capture(操作A1) → 自動処理の書き込みH1 → capture(操作A2) → …
//   履歴エントリ(A2) = H1 + A2
//
// この盤面は接続・追従・再レイアウトを onChange 内の自前ヘルパーで実現しているため、
// captureUpdate を指定しないと Ctrl+Z 一回が「直前の操作」と「その1つ前の操作で走った
// 自動コネクト処理」の両方を巻き戻していた。矢印の接続確定（triStart/triEnd の記録・端点の
// 吸着・折れ線の点列）は必ず描画の capture 後に走るので、次の操作を undo した瞬間に
// コネクト情報ごと消え、記録どおりに復元する forceAnchor にも材料が無くなる＝接続が失われる。
//
// 【方針】
//  ・自動導出（追従・自動接続・再レイアウト・リモート反映）… captureUpdate を指定しない。
//    WhiteboardCanvas の guardApi が NEVER を与え、履歴には一切載せずスナップショットだけ進める。
//    undo 後は図形が動いたことを追従処理が検知して経路を引き直すので、結果は自然に復元される。
//  ・ユーザー操作そのもの（書式パネル・図形追加・折れ点の確定など）… COMMIT を展開して
//    IMMEDIATELY を渡し、1操作＝1 undo ステップにする。
//    ドラッグ中の中間状態には付けないこと（1ドラッグが何十もの undo ステップに割れる）。
import { CaptureUpdateAction } from "@excalidraw/excalidraw";

const rand = () => Math.floor(Math.random() * 0x7fffffff);

/** ユーザー操作を 1 undo ステップとして履歴へ記録する。`api.updateScene({ elements, ...COMMIT })` */
export const COMMIT = { captureUpdate: CaptureUpdateAction.IMMEDIATELY } as const;

/** 選択状態など「履歴に残す意味が無い」更新を明示する。`api.updateScene({ appState, ...NO_HISTORY })` */
export const NO_HISTORY = { captureUpdate: CaptureUpdateAction.NEVER } as const;

/** 履歴のスナップショットを一切動かさない更新（＝次の COMMIT でまとめて記録される） */
const PENDING = { captureUpdate: CaptureUpdateAction.EVENTUALLY } as const;

// ── 【大前提】Excalidraw の変更検知は versionNonce だけ（BRU10-073）───────────
//
// Snapshot.detectChangedElements は要素の中身を一切見ず、`prev.versionNonce !== next.versionNonce`
// だけで「変わったか」を判定する。captureIncrement は差分の無いスナップショットに対しては
// increment を emit しないので、
//
//   **versionNonce を上げずに要素を書き換えると、その変更は履歴から丸ごと消える**
//
// （IMMEDIATELY を投げても履歴エントリが1つも作られない）。表の列幅/行高を書く経路が
// 版を据え置きにしていたため「行幅を変えて Ctrl+Z しても戻らない」＝BRU10-073 の症状になった。
// 個々の呼び出し元の上げ忘れに頼らないよう、下の commitSceneToHistory は
// 「ドラッグ開始時のベースラインとのコンテンツ差分」で変更要素を割り出し、確定時に必ず版を振り直す。
// 単発の IMMEDIATELY（書式パネル等）は WhiteboardCanvas の guardApi が同じ関数で保険をかける。

/** 差分判定から除く（Excalidraw の ElementsChange.stripIrrelevantProps と同じ顔ぶれ＋index） */
const META_KEYS = new Set(["version", "versionNonce", "updated", "seed", "index"]);

/**
 * 2つの要素が「中身として」違うか。参照が同じなら即 false（走査コストは実質ゼロ）。
 * 版・更新時刻など履歴の差分に含まれないメタ項目は無視する。
 */
export function elementContentChanged(prev: any, next: any): boolean {
  if (prev === next) return false;
  if (!prev || !next) return true;
  for (const k of Object.keys(next)) {
    if (META_KEYS.has(k)) continue;
    if (prev[k] !== next[k]) return true;
  }
  for (const k of Object.keys(prev)) {
    if (META_KEYS.has(k)) continue;
    if (!(k in next)) return true;
  }
  return false;
}

// ── 自前オーバーレイのドラッグ操作（BRU7-058）─────────────────────────────
//
// 折れ点つまみ・表の列幅つまみのように「自前の DOM オーバーレイで掴んで動かす」操作は
// Excalidraw から見えないため、本体の capture 機構が働かない。ここを素朴に作ると壊れる:
//
//   ・中間フレームを IMMEDIATELY にする → 1ドラッグが何十もの undo ステップに割れる
//   ・中間フレームを NEVER にする       → スナップショットが最終状態まで進んでしまい、
//                                        離した時の IMMEDIATELY が「差分ゼロ」になって
//                                        **そのドラッグが丸ごと undo できなくなる**
//
// 正しいのは EVENTUALLY（「非同期の多段操作の途中。次の IMMEDIATELY でまとめて記録する」）。
// ただし同じドラッグ中には追従・再レイアウトなどの自動処理も走り、そちらが既定の NEVER で
// 同じ要素を書くとやはりスナップショットが進んでしまう。captureUpdate は呼び出し単位なので、
// 「ドラッグ中は updateScene の既定を NEVER ではなく EVENTUALLY にする」のが確実。
//
// 使い方: つまみの pointerdown で beginHistoryGesture(api)、離したフレームで COMMIT 付きの
// updateScene（または commitSceneToHistory）を1回。解除は下の保険リスナーが必ず行う。
//
// ── ここまでだと「そのドラッグが1ステップも記録されない」（BRU10-044）─────────────
//
// Excalidraw の **公開 API の updateScene だけ** は、履歴へ記録する直前に
// filterUncomittedElements を通す:
//
//   for (const [id, prevElement] of 現在のシーン) {
//     const snap = store.snapshot.elements.get(id);
//     if (snap.version < prevElement.version) next.set(id, snap); // ← 記録対象から差し戻す
//   }
//
// 「シーンの version がスナップショットより先＝ローカルで編集中（未コミット）だから、
// リモート反映のついでに確定してはいけない」という共同編集向けの安全弁で、比較しているのは
// **渡した配列ではなく“現在のシーン”の version**。
//
// ドラッグ中の中間フレームは version を上げながら EVENTUALLY で書いている（＝スナップショットは
// 進めない）ので、離した時点で必ず「シーンの version > スナップショットの version」になる。
// つまり確定の IMMEDIATELY を投げても、回した図形が丸ごと差し戻されて差分ゼロ＝
// **履歴エントリが作られない**。ユーザーから見ると「ドラッグしたあと Ctrl+Z しても戻らない。
// 別の操作を1回はさんでから Ctrl+Z すると、その操作もろとも戻る」という挙動になる。
// （Excalidraw 本体のドラッグはこの関門を通らない store.commit 経由で記録しているため無傷。）
//
// → 確定は2段階にする。①ドラッグで触った要素の version をシーン上でいったん 1 まで下げて
//   「未コミット」判定を外し、②改めて version を上げた配列を IMMEDIATELY で渡す。
//   ①は EVENTUALLY なのでスナップショットに触らず、②で初めて差分が記録される。
//
// ── どの要素を触ったかの数え方（BRU10-073・訂正）─────────────────────────
//
// 旧実装は guardApi で「updateScene に渡された versionNonce がシーンと違う要素」を数えていたが、
// これは**呼び出し元が版を上げている場合しか成立しない**。表のリサイズのように版を据え置きで書く
// 経路では1件も集まらず、上のフォールバック（素の IMMEDIATELY）へ落ちて履歴エントリが0になっていた。
// → ドラッグ開始時のシーンをベースラインとして控え、確定時に**中身を突き合わせて**変更要素を割り出す。
//   これなら呼び出し元が版を上げているかどうかに依存しない。
//   ベースラインは浅いコピーで持つ（Excalidraw 本体は mutateElement で要素を in-place 更新することが
//   あり、参照だけ持つとベースラインまで一緒に書き換わって差分が消えるため）。
let gestureActive = false;
let gestureBase: Map<string, any> | null = null; // ドラッグ開始時のシーン（id -> 要素の浅いコピー）

/** 自前オーバーレイのドラッグ開始。以後 captureUpdate 未指定の更新は EVENTUALLY になる。 */
export const beginHistoryGesture = (api?: any) => {
  gestureActive = true;
  gestureBase = null;
  const els = (api?.getSceneElementsIncludingDeleted?.() ?? api?.getSceneElements?.()) as readonly any[] | undefined;
  if (els) gestureBase = new Map(els.map((e) => [e.id, { ...e }]));
};
/** ドラッグ終了（明示解除。pointerup/blur でも自動解除される） */
export const endHistoryGesture = () => { gestureActive = false; };
/** 自前オーバーレイのドラッグ中か（guardApi が既定の captureUpdate を決めるのに使う） */
export const isHistoryGestureActive = () => gestureActive;

if (typeof window !== "undefined") {
  // 取りこぼし保険: ポインタを離した/フォーカスを失ったら必ず解除する。
  // バブル段階で登録するため、オーバーレイ側の確定処理（IMMEDIATELY）より前に解除されるが、
  // 確定は明示的に IMMEDIATELY を渡すので影響しない。
  const clear = () => { gestureActive = false; };
  window.addEventListener("pointerup", clear);
  window.addEventListener("pointercancel", clear);
  window.addEventListener("blur", clear);
}

/**
 * 現在のシーンをそのまま 1 undo ステップとして確定する（自前オーバーレイのドラッグ確定用）。
 * 削除済み要素（tombstone）も渡して、シーンから消し落とさないようにする。
 *
 * 上の説明のとおり、ドラッグで触った要素は version を下げてから確定する（BRU10-044）。
 * ②で version を「現在値＋1」にするのは Yjs への配信条件（version/versionNonce の大小比較・
 * ExcalidrawYjsBridge.syncFromExcalidraw）を満たすため。①の 1 のまま放置すると、他メンバーが
 * 持っている古い版のほうが新しいと判定され、回した結果が巻き戻される。
 *
 * ②で versionNonce も必ず振り直すのが BRU10-073 の肝。Excalidraw は versionNonce の変化でしか
 * 「変わった」と判定しないため、これが無いと（ドラッグ中に版を上げない経路では）
 * IMMEDIATELY を投げても履歴エントリが1つも作られない。
 */
export function commitSceneToHistory(api: any): void {
  const els = (api?.getSceneElementsIncludingDeleted?.() ?? api?.getSceneElements?.()) as readonly any[] | undefined;
  if (!els?.length) return;
  const base = gestureBase;
  gestureBase = null;
  // ドラッグ開始時のベースラインと中身を突き合わせて「このドラッグで変わった要素」を割り出す。
  // ベースラインが無い（beginHistoryGesture に api を渡していない等）ときは全要素を対象にする。
  const touched = new Set<string>();
  for (const e of els) {
    const b = base?.get(e.id);
    if (!base || !b || b.versionNonce !== e.versionNonce || elementContentChanged(b, e)) touched.add(e.id);
  }
  if (!touched.size) return; // 何も変わっていない＝記録するものが無い
  // ① 「未コミット」判定を外す（EVENTUALLY＝スナップショットには触らない）
  api.updateScene({
    elements: els.map((e) => (touched.has(e.id) ? { ...e, version: 1 } : e)),
    ...PENDING,
  });
  // ② 確定。ここで初めて「スナップショット ↔ 現在」の差分が1エントリとして記録される
  api.updateScene({
    elements: els.map((e) => (touched.has(e.id) ? { ...e, version: (e.version ?? 1) + 1, versionNonce: rand() } : e)),
    ...COMMIT,
  });
}
