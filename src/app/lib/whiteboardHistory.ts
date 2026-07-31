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

/** ユーザー操作を 1 undo ステップとして履歴へ記録する。`api.updateScene({ elements, ...COMMIT })` */
export const COMMIT = { captureUpdate: CaptureUpdateAction.IMMEDIATELY } as const;

/** 選択状態など「履歴に残す意味が無い」更新を明示する。`api.updateScene({ appState, ...NO_HISTORY })` */
export const NO_HISTORY = { captureUpdate: CaptureUpdateAction.NEVER } as const;

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
// 使い方: つまみの pointerdown で beginHistoryGesture()、離したフレームで COMMIT 付きの
// updateScene（または commitSceneToHistory）を1回。解除は下の保険リスナーが必ず行う。
let gestureActive = false;

/** 自前オーバーレイのドラッグ開始。以後 captureUpdate 未指定の更新は EVENTUALLY になる。 */
export const beginHistoryGesture = () => { gestureActive = true; };
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
 */
export function commitSceneToHistory(api: any): void {
  const els = (api?.getSceneElementsIncludingDeleted?.() ?? api?.getSceneElements?.()) as readonly any[] | undefined;
  if (!els?.length) return;
  api.updateScene({ elements: els, ...COMMIT });
}
