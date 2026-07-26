// 全画面表示中でも消えないポップアップの取り付け先を返す（BRU7-056-9）。
//
// ブラウザの全画面表示は「全画面にした要素の部分木」だけを描画する。そのため
// document.body 直下へポータルした UI（表のグリッドピッカー、Mermaid の入力パネル等）は、
// 全画面にした瞬間に画面から消える。表の行×列が選べず「表を追加できない」ように見えるのは
// これが原因。全画面中はその全画面要素の中へ取り付ければ、通常時と同じように表示される。
//
// position:fixed の座標計算は取り付け先が変わっても影響を受けない（transform / filter /
// backdrop-filter を持つ祖先が無い限り、fixed はビューポート基準のまま）ので、
// 呼び出し側のレイアウト計算は変更不要。
export function overlayMount(): HTMLElement {
  const fs = (document.fullscreenElement
    || (document as any).webkitFullscreenElement) as HTMLElement | null;
  return fs ?? document.body;
}
