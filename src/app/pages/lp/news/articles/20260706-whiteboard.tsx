import { ScreenFigure, WhiteboardScreen } from './screens';

/**
 * 記事本文。プレーンな HTML を書くだけで共通タイポグラフィが適用されます。
 * 画面イメージは実機能（WhiteboardPage.tsx ほか）をトレースした <WhiteboardScreen /> を使用。
 */
export default function Whiteboard() {
  return (
    <>
      <p>
        チームで自由に描いて考えをまとめられる「ホワイトボード機能」を実装しました。
        アイデア出しや設計の共有を、リアルタイムの共同編集で行えます。
      </p>

      <ScreenFigure label="ホワイトボード" caption="付箋・図形・フロー図を、複数メンバーが同時に編集できるキャンバス">
        <WhiteboardScreen />
      </ScreenFigure>

      <h2>主な内容</h2>
      <ul>
        <li>付箋・図形・矢印・手描きで自由にレイアウトできるキャンバス</li>
        <li>複数メンバーが同時に編集できるリアルタイム共同編集</li>
        <li>プロジェクトごとに複数のボードを作成して整理</li>
        <li>ブレインストーミングや画面設計、フロー図の作成に最適</li>
      </ul>

      <h2>ご利用方法</h2>
      <p>
        各プロジェクトの「ホワイトボード」よりご利用いただけます。
        新しいボードを作成し、メンバーを招待してすぐに共同編集を始められます。
      </p>
    </>
  );
}
