import { ScreenFigure, ConceptFigure, DrawioCopyDiagram, DrawioPasteScreen, WhiteboardDrawioExportScreen } from './screens';

/**
 * 記事本文。プレーンな HTML を書くだけで共通タイポグラフィが適用されます。
 * 画面イメージは実機能をトレース:
 *  ・whiteboardDrawioExport.ts（Excalidraw 要素 → draw.io の mxGraphModel へ変換）
 *  ・whiteboardFrameCopy.ts（text/plain と text/html を同時にクリップボードへ載せる）
 *  ・WhiteboardExportMenu.tsx（PNG / SVG / draw.io / 画像コピー の4項目）
 * BRU15-002 の告知。
 */
export default function WhiteboardDrawio() {
  return (
    <>
      <p>
        ホワイトボードでコピーした図形を、<strong>draw.io（app.diagrams.net）へそのまま貼り付けられる</strong>ようになりました。
        画像として貼るのではなく、<strong>draw.io の図形として置き直されます</strong>。
        貼ったあとは draw.io の中で、色を変えることもサイズを変えることも、線をつなぎ替えることもできます。
      </p>
      <p>
        操作は変わりません。ホワイトボードで図形を選んで<strong>コピー</strong>し、draw.io で<strong>貼り付ける</strong>だけです。
      </p>

      <ConceptFigure caption="1回のコピーが、ホワイトボードにも draw.io にも通じます">
        <DrawioCopyDiagram />
      </ConceptFigure>

      <h2>1. これまでは、文字の塊として貼られていました</h2>
      <p>
        これまでホワイトボードの内容を draw.io に貼ると、
        <strong>図形ではなく、長い文字列がひとつのテキストとして</strong>貼り付いていました。
        ホワイトボードがクリップボードに置いていた形式を draw.io が読めなかったためです。
      </p>
      <p>
        そのため、ホワイトボードで描いた下書きを draw.io で清書したいというときは、
        <strong>draw.io 側で最初から引き直す</strong>しかありませんでした。
        画像として貼る方法もありましたが、画像は後から直せません。
      </p>

      <ScreenFigure label="draw.io に貼り付けたところ" caption="同じ操作で、貼り付いた結果だけが変わります">
        <DrawioPasteScreen />
      </ScreenFigure>

      <h2>2. 見た目とつながりを、そのまま持っていきます</h2>
      <p>
        四角・丸・ひし形・テキスト・矢印・線に加えて、
        <strong>三角形・大括弧・画像・フレーム・表・手描き</strong>まで変換します。
        塗りと枠線の色、線の太さ、破線や点線、透明度、回転、角丸、文字の大きさや色、文字揃え、リンクも引き継ぎます。
      </p>
      <p>
        とくに<strong>矢印のつながりはそのまま残ります</strong>。
        「どの図形からどの図形へ」だけでなく<strong>図形のどの位置につないでいたか</strong>まで持っていくので、
        draw.io 側で図形を動かすと矢印がきちんと追いかけてきます。
        つなぎ直しの手間がかかりません。
      </p>
      <p>
        <strong>まとまりも保たれます。</strong>
        フレームで囲っていたものは draw.io のグループになり、中の図形は子として入ります。
        グループにしていた図形も、グループのまま貼り付きます。
        フレームごと動かせば中身もついてくる、という感覚は変わりません。
      </p>

      <h2>3. ホワイトボードへの貼り戻しは、これまでどおりです</h2>
      <p>
        draw.io へ貼れるようにしたことで、<strong>自分のボードに貼り戻せなくなるということはありません</strong>。
        クリップボードには<strong>2つの形式を同時に載せています</strong>。
        貼り付ける側が読めるほうを選び取るので、
        <strong>「draw.io 用にコピーする」と「ボード用にコピーする」を使い分ける必要はありません</strong>。
      </p>
      <p>
        コピーだけでなく<strong>切り取り</strong>も同じです。
        キーボード操作でも、右クリックメニューからでも、結果は変わりません。
      </p>

      <h2>4. ファイルとして書き出すこともできます</h2>
      <p>
        エクスポートに<strong>「draw.io形式で保存」</strong>を追加しました。
        保存したファイルは draw.io の<strong>「ファイル」→「開く」</strong>から読み込めます。
      </p>
      <p>
        社内の設定でクリップボードの受け渡しが制限されている場合や、
        ボード全体をまとめて渡したい場合はこちらをお使いください。
      </p>

      <ScreenFigure label="ホワイトボード － エクスポート" caption="PNG・SVG に加えて、draw.io 形式で保存できるようになりました">
        <WhiteboardDrawioExportScreen />
      </ScreenFigure>

      <h2>5. ご利用にあたって</h2>
      <p>
        ホワイトボードと draw.io では図形の種類がそろっていないため、
        <strong>いくつかは近い形に置き換わります</strong>。あらかじめお知らせします。
      </p>
      <ul>
        <li><strong>手描き風の斜線の塗り</strong> … draw.io に同じ塗り方が無いため、ベタ塗りになります</li>
        <li><strong>大括弧のトゲの位置</strong> … draw.io 側に位置の設定が無いため、中央に寄ります</li>
        <li><strong>表</strong> … 見た目は同じですが、draw.io の「表」としてではなくマス目の集まりとして貼り付きます</li>
      </ul>
      <blockquote>
        ※ この機能はブラウザ版でご利用いただけます。iOS アプリからのコピーはこれまでどおりの動作となります。
        また、draw.io からホワイトボードへ貼り付ける逆方向には、現時点では対応していません。
      </blockquote>

      <h2>主な特長</h2>
      <ul>
        <li>ホワイトボードでコピーした図形を、draw.io に図形として貼り付け</li>
        <li>画像ではないので、貼ったあとに draw.io 側で色・サイズ・接続を編集できる</li>
        <li>操作は従来どおり。コピーのしかたを使い分ける必要はなし</li>
        <li>矢印のつながりを、接続先だけでなく接続位置まで維持</li>
        <li>フレームはグループとして、中の図形ごと持ち込み</li>
        <li>色・線の太さ・線種・透明度・回転・角丸・文字書式・リンクを引き継ぎ</li>
        <li>自分のボードや他のホワイトボードへの貼り戻しは、これまでどおり</li>
        <li>エクスポートから .drawio ファイルとしての保存も可能</li>
      </ul>

      <h2>ご利用方法</h2>
      <p>
        ホワイトボードで図形を選び、<strong>Ctrl＋C</strong>（Mac は <strong>⌘＋C</strong>）または右クリックの「コピー」でコピーします。
        そのまま draw.io を開いて貼り付けると、図形として取り込まれます。
        ファイルで渡す場合は、画面右上の<strong>「エクスポート」→「draw.io形式で保存」</strong>をご利用ください。
      </p>
    </>
  );
}
