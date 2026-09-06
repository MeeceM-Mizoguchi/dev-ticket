import { ScreenFigure, ConceptFigure, GithubPrScreen, TicketPrScreen, GithubFlowDiagram } from './screens';

/**
 * 記事本文。プレーンな HTML を書くだけで共通タイポグラフィが適用されます。
 * 画面イメージは実機能をトレース:
 *  ・GithubPage.tsx / PullRequestList.tsx（PR / Issue / コミット / ブランチ の4タブ）
 *  ・TicketPrSection.tsx（関連PR。ブランチ作成・PR作成・マージ・PR未紐付けアラート）
 *  ・CreateBranchDialog.tsx / CreatePullDialog.tsx / MergeConfirmDialog.tsx
 *  ・PermissionsPage.tsx（GitHub権限の3分割）
 * ENHA2-044（PR #358）／BRU13-005（#364）／BRU13-013（#372）／BRU14-003（#419・#421）
 * をまとめた告知。
 */
export default function GithubIntegration() {
  return (
    <>
      <p>
        <strong>GitHub連携</strong>を追加しました。
        プルリクエストや Issue を Dev Ticket の画面の中で確認でき、
        <strong>ブランチを切る・PRを作る・マージする</strong>までを、GitHub の画面へ移動せずに行えます。
        しかも<strong>閲覧するメンバーに GitHub のアカウントは要りません</strong>。
      </p>

      <ConceptFigure caption="チケットからブランチを切り、PRを作り、マージして、本番に届いたかまで。Dev Ticket の中だけで一周します">
        <GithubFlowDiagram />
      </ConceptFigure>

      <h2>1. GitHub の情報が、Dev Ticket の中に表示されます</h2>
      <p>
        プロジェクトに<strong>GitHubタブ</strong>が加わり、
        <strong>プルリクエスト・Issue・コミット・ブランチ</strong>の4つを画面内で確認できます。
        PRの行にはCIの結果とレビューの状況が並ぶので、
        <strong>今マージできる状態かどうかが一覧のまま分かります</strong>。
      </p>
      <p>
        これまで GitHub のURLをメモに貼って共有していたときは、
        受け取った人の GitHub のログイン状態や権限によって<strong>見える人と見えない人が分かれて</strong>いました。
        Dev Ticket がサーバー側で認証を持つ形にしたことで、
        <strong>GitHub のアカウントを持たないメンバーにも同じ内容が表示されます</strong>。
      </p>

      <ScreenFigure label="GitHub" caption="PR・Issue・コミット・ブランチを画面内で確認。CI とレビューの状況もその場で分かります">
        <GithubPrScreen />
      </ScreenFigure>

      <h2>2. チケットの中で、ブランチ作成からマージまで完結します</h2>
      <p>
        チケット詳細の<strong>「関連PR」</strong>から、次の操作がそのまま行えます。
      </p>
      <ul>
        <li><strong>ブランチを作成</strong> … 分岐元を選んでブランチを作成。名前は自由に決められます</li>
        <li><strong>PRを作成</strong> … マージ先・比較するブランチ・タイトル・本文・Draft の有無を指定して作成</li>
        <li><strong>マージする</strong> … CI・レビュー・マージ方式を確認したうえで実行</li>
      </ul>
      <p>
        タイトルと本文は<strong>チケット番号から先に埋まります</strong>。
        本文にはチケットへのリンクも自動で入るので、
        「どのチケットの対応か」を後から探し直す必要がありません。
      </p>

      <ScreenFigure label="チケット詳細 － 関連PR" caption="チケットを開いたまま、ブランチを切り、PRを作り、マージまで進められます">
        <TicketPrScreen />
      </ScreenFigure>

      <h2>3. ブランチ名を自由に決めても、チケットに紐付きます</h2>
      <p>
        以前は<strong>ブランチ名やPRのタイトルに含まれるチケット番号</strong>だけが紐付けの手がかりでした。
        そのため命名を外したブランチから出たPRは、紐付けの候補にすら出てきませんでした。
      </p>
      <p>
        チケットから作成したブランチは、<strong>名前ではなく Dev Ticket 側の記録で紐付きます</strong>。
        ですから<strong>番号を含まない名前を付けても、そこから出たPRは自動的にそのチケットへ紐付きます</strong>。
        画面から作っても GitHub 側で作っても結果は同じです。
        ブランチの一覧には、紐付いたチケットの番号とタイトルが並びます。
      </p>

      <h2>4. PRの付け忘れを、画面が知らせます</h2>
      <p>
        「対応完了してリリースノートに追加」を押したときに<strong>PRが1件も紐付いていない</strong>と、
        関連PRの欄が強調され、その位置まで画面がスクロールします。
        そのまま閉じようとすると<strong>確認をはさみ</strong>、
        「紐付ける」「PR不要にして閉じる」「紐付けずに閉じる」から選べます。
      </p>
      <p>
        リリース待ち以降なのにPRが無いチケットは、<strong>一覧でも赤く表示され「PR未紐付け」のバッジ</strong>が付きます。
        後から見ても取り残しに気づける状態になります。
      </p>

      <h2>5. 「誰に何を許すか」は Dev Ticket 側で決められます</h2>
      <p>
        GitHub の権限は<strong>操作ごとに3つ</strong>に分かれており、それぞれ
        <strong>権限なし / 閲覧のみ / 作成可</strong>から選べます。
      </p>
      <ul>
        <li><strong>ブランチ作成</strong> … ブランチを切れるか</li>
        <li><strong>プルリクエスト作成</strong> … PRを作れるか</li>
        <li><strong>マージ</strong> … main へ反映できるか</li>
      </ul>
      <p>
        分けている理由は<strong>取り返しのつきやすさが違う</strong>からです。
        ブランチは消せば済みますが、main へのマージはそうはいきません。
        <strong>「ブランチは切らせたいが、マージはさせない」</strong>という配り方ができます。
      </p>
      <p>
        設定はアサイン計画の画面から、グループ単位でも個人単位でも行えます。
        <strong>3つとも「権限なし」のメンバーには GitHubタブ自体が表示されません</strong>。
        なお、GitHub 側で設定しているブランチ保護（必須レビュー・必須CI）はこれまで通り有効のままです。
      </p>
      <blockquote>
        ※ GitHub 上の操作は連携アプリの名義で行われるため、
        マージコミットのメッセージと Dev Ticket 側の記録に実行者が残ります。
        誰がいつ何をしたかは、あとから追跡できます。
      </blockquote>

      <h2>主な特長</h2>
      <ul>
        <li>プルリクエスト・Issue・コミット・ブランチを Dev Ticket の画面内で閲覧</li>
        <li>閲覧するメンバーに GitHub アカウントは不要</li>
        <li>チケット詳細から、ブランチ作成 → PR作成 → マージまで完結</li>
        <li>タイトルと本文はチケット番号から自動入力。本文にチケットURLも挿入</li>
        <li>チケットから作ったブランチは、名前に番号が無くてもPRが自動で紐付く</li>
        <li>リリース待ち以降でPRが無いチケットは、離脱時の確認と一覧の赤表示で取り残しを防止</li>
        <li>権限は「ブランチ作成」「PR作成」「マージ」の3つに分割。それぞれ3段階で設定可能</li>
      </ul>

      <h2>ご利用方法</h2>
      <p>
        サイドバーの「外部連携」から GitHub に接続し、プロジェクト設定でリポジトリを紐付けると、
        そのプロジェクトに GitHubタブが表示されます。
        権限の既定は「権限なし」ですので、アサイン計画の画面から必要なメンバーへ付与してご利用ください。
      </p>
    </>
  );
}
