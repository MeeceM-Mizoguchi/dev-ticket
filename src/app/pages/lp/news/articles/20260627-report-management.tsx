import { ScreenFigure, ReportScreen } from './screens';

/**
 * 記事本文。プレーンな HTML を書くだけで共通タイポグラフィが適用されます。
 * 画面イメージは実機能（ReportsPage.tsx）をトレースした <ReportScreen /> を使用。
 */
export default function ReportManagement() {
  return (
    <>
      <p>
        チームの活動状況を可視化する「レポート管理機能」を実装しました。
        日々蓄積されるチケットやスプリントのデータを集計し、生産性をひと目で把握できます。
      </p>

      <ScreenFigure label="レポート管理" caption="週次／月次のKPIと、ステータス内訳・スループット推移を自動集計">
        <ReportScreen />
      </ScreenFigure>

      <h2>主な内容</h2>
      <ul>
        <li>チケットの完了数・消化状況をグラフで可視化</li>
        <li>メンバーごとの担当・稼働状況を集計して負荷を把握</li>
        <li>スプリント単位の進捗をレポートとして振り返り</li>
        <li>期間を指定してチームのパフォーマンスを分析</li>
      </ul>

      <h2>ご利用方法</h2>
      <p>
        サイドメニューの「レポート」よりご利用いただけます。
        追加の設定は不要で、これまでの活動データが自動で集計されます。
      </p>
    </>
  );
}
