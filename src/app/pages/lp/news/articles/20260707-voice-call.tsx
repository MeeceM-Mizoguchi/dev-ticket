import { ScreenFigure, CallEntryScreen, StartCallScreen, IncomingCallScreen, VoiceCallScreen } from './screens';

/**
 * 記事本文。プレーンな HTML を書くだけで共通タイポグラフィが適用されます。
 * 画面イメージは実機能（CallButton / StartCallDialog / IncomingCallModal / CallWidget）を
 * トレースした各モックを使用。「発信 → 応答 → 通話中」の流れを順に説明します。
 */
export default function VoiceCall() {
  return (
    <>
      <p>
        プロジェクトのメンバーと、アプリ内でそのまま話せる「オンライン音声通話機能」を実装しました。
        外部の通話ツールを立ち上げることなく、Dev Ticket の画面からワンクリックで発信できます。
      </p>

      <h2>1. 画面右上の「通話ボタン」を押す</h2>
      <p>
        通話の入口は、どの画面でも<strong>常に表示されている画面右上のヘッダー</strong>にあります。
        バグ報告アイコンや通知ベルのとなりにある<strong>電話マークのアイコンが「通話ボタン」</strong>です。
        まずはここを押してください。
      </p>

      <ScreenFigure label="画面右上のヘッダー" caption="通話ボタンは画面右上・通知ベルの左どなりにある電話マークのアイコンです">
        <CallEntryScreen />
      </ScreenFigure>

      <h2>2. プロジェクトと相手を選んで発信する</h2>
      <p>
        通話ボタンを押すと、発信ダイアログが開きます。
        まず通話したい<strong>プロジェクト</strong>を選ぶと、そのプロジェクトのメンバーが一覧表示されます。
        名前の横の丸い印が緑ならオンライン中です。相手を選んで（複数選択も可能）
        <strong>「発信」</strong>ボタンを押すと呼び出しが始まります。
      </p>

      <ScreenFigure label="発信ダイアログ" caption="プロジェクトとメンバーを選んで「発信」。最大5人までのグループ通話にも対応">
        <StartCallScreen />
      </ScreenFigure>

      <h2>3. 相手が着信画面で応答する</h2>
      <p>
        呼び出された相手の画面には、着信モーダルが表示されます。
        <strong>「応答」</strong>を押せば通話開始、<strong>「拒否」</strong>を押せば通話を断れます。
      </p>

      <ScreenFigure label="着信モーダル" caption="呼び出された相手は「応答」か「拒否」を選ぶだけ">
        <IncomingCallScreen />
      </ScreenFigure>

      <h2>4. 通話中もいつも通り作業できる</h2>
      <p>
        通話が始まると、画面の右下に通話ウィンドウが常駐します。
        チケットやボードなど<strong>別の画面へ移動しても通話は途切れません</strong>。
        ウィンドウ内では参加者ごとに「発話中／接続済み」の状態が表示され、
        ミュートの切り替えや退出もここから行えます。
      </p>

      <ScreenFigure label="通話中ウィジェット" caption="通話ウィンドウは画面右下に常駐。ページを移動しても通話は途切れません">
        <VoiceCallScreen />
      </ScreenFigure>

      <h2>主な特長</h2>
      <ul>
        <li>同じプロジェクトのメンバーへ、名前を選ぶだけでワンクリック発信</li>
        <li>1対1はもちろん、最大5人までのグループ通話に対応</li>
        <li>通話ウィンドウは画面右下に常駐し、ページを移動しても通話を継続</li>
        <li>ミュートの切り替えや、誰が話しているか（発話中）がひと目でわかる表示</li>
        <li>アプリ内で完結するため、外部ツールや追加費用は不要</li>
      </ul>
    </>
  );
}
