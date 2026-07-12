import { ScreenFigure, WhiteboardTablePickerScreen, WhiteboardTableScreen } from './screens';

/**
 * 記事本文。プレーンな HTML を書くだけで共通タイポグラフィが適用されます。
 * 画面イメージは実機能をトレース:
 *  ・TableToolButton.tsx（ツールバー末尾の「表」ボタン＋グリッドピッカー）
 *  ・whiteboardTable.ts / TableResizeOverlay.tsx（自動レイアウト＋手動リサイズ）
 * BRU5-042 / PR #201。
 */
export default function WhiteboardTable() {
  return (
    <>
      <p>
        ホワイトボードに<strong>「表」を追加できるようになりました</strong>。
        タスクの一覧や比較表、役割分担などを、図形を並べる手間なく
        きれいな表としてそのままキャンバスに置けます。
      </p>

      <h2>1. ツールバーの「表」ボタンから、大きさを選んで作成</h2>
      <p>
        上部ツールバーの末尾にある<strong>「表」ボタン</strong>を押すと、
        <strong>マス目のグリッドが開きます</strong>。
        マウスを乗せて<strong>「列 × 行」の大きさを選んでクリック</strong>すると、
        その大きさの表がキャンバスの中央に作られます。先頭の行は見出しとして色が付きます。
      </p>

      <ScreenFigure label="ホワイトボード" caption="「表」ボタンを押し、グリッドで列×行を選ぶだけで表を作成できます">
        <WhiteboardTablePickerScreen />
      </ScreenFigure>

      <h2>2. セルに入力すると、大きさが自動で整う</h2>
      <p>
        各セルは<strong>ダブルクリックで文字を入力</strong>できます。
        入力した文字の量に合わせて<strong>列の幅や行の高さが自動で調整</strong>され、
        すき間やはみ出しのない、きれいに揃った表になります。
        表全体はひとまとまりとして扱われるので、<strong>そのまま移動</strong>できます。
      </p>

      <h2>3. 幅や高さは手動でも調整できる</h2>
      <p>
        表を選ぶと、<strong>列や行の境界にドラッグ用のつまみ</strong>が表示されます。
        ここをドラッグすれば好みの幅・高さに変えられ、<strong>四隅のハンドル</strong>からは表全体を拡大・縮小できます。
        つまみをダブルクリックすると、内容に合わせた自動サイズへ戻せます。
      </p>

      <ScreenFigure label="表の編集" caption="境界のつまみで手動リサイズ、四隅で全体を拡大縮小。セルはダブルクリックで入力できます">
        <WhiteboardTableScreen />
      </ScreenFigure>

      <h2>主な特長</h2>
      <ul>
        <li>ツールバーの「表」ボタンから、列×行を選ぶだけで表を作成</li>
        <li>先頭行は見出しとして色付き。セルはダブルクリックで入力</li>
        <li>入力量に合わせて列幅・行高が自動で整い、常にきれいに揃う</li>
        <li>境界のつまみで手動リサイズ、四隅で全体の拡大・縮小に対応</li>
        <li>表はひとまとまりで移動でき、共同編集にもそのまま同期</li>
      </ul>

      <h2>ご利用方法</h2>
      <p>
        各プロジェクトの「ホワイトボード」の上部ツールバーからご利用いただけます。
        付箋や図形、Mermaid図と組み合わせて、情報を整理しながら議論を進められます。
      </p>
    </>
  );
}
