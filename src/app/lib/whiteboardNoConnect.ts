// Ctrl / Cmd を押している間は「コネクトさせない」ためのモディファイア監視（BRU7-056-4）。
//
// 線・矢印を図形のすぐ横に置きたいだけなのに端点が辺の中点へ吸われてしまう、という場面があるため
// 「押している間だけ自動接続を止める」逃げ道を用意する。キーは Excalidraw のネイティブ結合の
// 無効化キー（Ctrl/Cmd = appState.isBindingEnabled=false）と揃えた。押している間は
// 接続ハイライト（グレー枠・緑の接続予定点）も出さない＝“繋がる気配”を一切見せない。
//
// 状態はモジュール内に1つだけ持ち、WhiteboardCanvas（接続処理）と TriangleBindHint（ハイライト）の
// 両方が同じ値を見るようにする（片方だけ効いて表示と挙動がズレるのを防ぐ）。
// キー入力とポインタ入力の両方から拾うのは、キーを押したままキャンバスへ入ってきた場合
// （keydown がこのウィンドウに届いていない）も正しく判定するため。

let held = false;

const update = (v: boolean) => { held = v; };
const fromEvent = (e: KeyboardEvent | PointerEvent | MouseEvent) => update(!!(e.ctrlKey || e.metaKey));

if (typeof window !== "undefined") {
  window.addEventListener("keydown", fromEvent as EventListener, true);
  window.addEventListener("keyup", fromEvent as EventListener, true);
  window.addEventListener("pointerdown", fromEvent as EventListener, true);
  window.addEventListener("pointermove", fromEvent as EventListener, true);
  window.addEventListener("pointerup", fromEvent as EventListener, true);
  // フォーカスが外れるとキーの離しを取りこぼす（押しっぱなし扱いで固まる）ので必ず解除する
  window.addEventListener("blur", () => update(false));
}

/** Ctrl/Cmd を押している最中か（＝コネクトもハイライトも止める） */
export const isConnectSuppressed = () => held;
