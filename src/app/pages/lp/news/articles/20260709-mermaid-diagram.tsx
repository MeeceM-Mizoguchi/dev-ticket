import {
  ScreenFigure,
  MermaidToolbarScreen,
  MermaidModalScreen,
  MermaidInsertedScreen,
  MermaidWhiteboardScreen,
  MermaidExportScreen,
} from './screens';

/**
 * 記事本文。プレーンな HTML を書くだけで共通タイポグラフィが適用されます。
 * 画面イメージは実機能をトレース:
 *  ・RichEditor.tsx のツールバー「Mermaid」ボタン
 *  ・MermaidEditModal.tsx / MermaidToolButton.tsx の入力モーダル（左「定義」右「プレビュー」）
 *  ・MermaidNode.tsx（本文はコードを見せず図だけ・ホバーで編集/削除/拡大）
 *  ・Excalidraw ツールバー末尾に注入される Mermaid ボタン（実SVGアイコン）
 * 「ボタンを押す → 定義を入力 → 図として挿入」の順に、実際の操作手順を説明します。
 */
export default function MermaidDiagram() {
  return (
    <>
      <p>
        フローチャートやシーケンス図などを、専用の作図ツールを使わず
        <strong>テキストで定義するだけで図にできる「Mermaid図」に対応しました</strong>。
        Wiki・議事録・チケット・コメントなどの文書から、ホワイトボードまで対応。
        図の内容はテキストとして残るので、あとから直すのも、履歴で差分を追うのも簡単です。
      </p>

      <h2>1. ツールバーの「Mermaid」ボタンから始める</h2>
      <p>
        Mermaid図は、<strong>書式編集ができる場所ならどこでも</strong>使えます
        （Wiki・議事録・チケットの説明・各種コメント・アクションメモ・バックログ）。
        編集ツールバーの右側にある<strong>「Mermaid」ボタン</strong>を押すと、入力画面が開きます。
      </p>

      <ScreenFigure label="編集ツールバー" caption="太字や見出しと同じツールバーに「Mermaid」ボタンがあります">
        <MermaidToolbarScreen />
      </ScreenFigure>

      <h2>2. 定義を入力すると、その場でプレビュー</h2>
      <p>
        開いた画面の<strong>左側に図の定義（Mermaid記法）を入力</strong>すると、
        <strong>右側にプレビューがリアルタイムで表示</strong>されます。
        最初からサンプルが入っているので、書き換えながら形を確認できます。
        <code>flowchart</code>（フロー図）のほか、<code>sequenceDiagram</code>（シーケンス図）・
        <code>classDiagram</code>（クラス図）・<code>gantt</code>（ガントチャート）など、
        Mermaid記法で書ける図に対応しています。内容を確認して「挿入」を押します。
      </p>

      <ScreenFigure label="Mermaid図の入力画面" caption="左に定義を書くと、右のプレビューにすぐ反映されます">
        <MermaidModalScreen title="Mermaid図を挿入" primaryLabel="挿入" />
      </ScreenFigure>

      <h2>3. 本文にはコードではなく「図」が入る</h2>
      <p>
        挿入すると、本文に表示されるのは<strong>図だけ</strong>です。
        コードが本文に並んで読みにくくなることはありません。
        図にマウスを乗せると<strong>「拡大・編集・削除」ボタン</strong>が現れ、
        図をクリックすれば大きく拡大表示できます。
        あとから直したいときは編集ボタンから、いつでも定義を開いて修正できます。
      </p>

      <ScreenFigure label="挿入された図" caption="本文には図だけを表示。ホバーで拡大・編集・削除ができます">
        <MermaidInsertedScreen />
      </ScreenFigure>

      <h2>4. ホワイトボードでは「編集できる図形」として生成</h2>
      <p>
        ホワイトボードでは、<strong>上部ツールバーの末尾に追加された「Mermaid」ボタン</strong>から
        同じように定義を入力して図を生成できます。生成された図は画像ではなく
        <strong>編集できる図形として配置される</strong>ため、
        位置や色を調整したり、付箋や矢印とつないだりと、そのまま作図の続きが行えます。
        もちろん<strong>共同編集にもそのまま同期</strong>します。
      </p>

      <ScreenFigure label="ホワイトボード" caption="ツールバーの Mermaid ボタンから、編集できる図形としてキャンバスに生成されます">
        <MermaidWhiteboardScreen />
      </ScreenFigure>

      <h2>5. エクスポートでも「図」として出力</h2>
      <p>
        Wiki・議事録の<strong>PDF / Word / Excel 出力</strong>でも、Mermaid図は
        コードのままではなく<strong>きちんと図として埋め込まれます</strong>。
        画面で見たままの資料を、そのまま配布・共有できます。
      </p>

      <ScreenFigure label="エクスポート" caption="PDF・Word・Excel のいずれでも、図として出力されます">
        <MermaidExportScreen />
      </ScreenFigure>

      <h2>主な特長</h2>
      <ul>
        <li>フローチャート・シーケンス図・ガントチャートなどをテキストで作図</li>
        <li>書式編集ができる場所（Wiki・議事録・チケット・コメントなど）すべてで利用可能</li>
        <li>入力画面は左に定義・右にプレビューで、書きながら仕上がりを確認できる</li>
        <li>本文にはコードではなく図だけを表示。ホバーで編集・削除・拡大に対応</li>
        <li>ホワイトボードでは編集できる図形として生成され、そのまま調整・共同編集できる</li>
        <li>PDF / Word / Excel へのエクスポートでも図として出力</li>
      </ul>
    </>
  );
}
