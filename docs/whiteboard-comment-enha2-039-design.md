# ENHA2-039 ホワイトボード コメント機能 設計書

作成日: 2026-08-07

## 1. 要件

Figma / FigJam のコメントと同じ操作感で、ホワイトボード上の任意の位置にコメントを残せるようにする。

- コメントモード（ピンアイコンのボタン、または「c」キー）に入るとカーソルがピンになる
- クリックするとその位置に入力欄が出る（Enter は改行）
- 保存するとピンが立つ。データは 投稿者名 / 日時 / 本文
- ピンにマウスオーバーするとツールチップで内容が出る
- ツールチップの返信アイコン → テキストエリア → 「返信」ボタンで保存され、入力欄は閉じる
- 返信があるコメントは「返信を表示（N）」を出し、クリックで返信一覧を下に展開する
- 展開中はマウスを外しても消えない（固定表示）。別の場所のクリック / Esc で閉じる
- 返信一覧は2件ぶんくらいの高さで頭打ちにし、以降はスクロール
- コメント・返信それぞれに三点リーダー（⋯）メニュー
  - 「リンクをコピー」は全員、「編集」「削除」は投稿者本人にのみ表示

追加要望（初回レビュー時）:

- 閲覧のみの権限のメンバーもコメントできること
- 保存したら投稿内容がそのまま出て、別の場所のクリック / Esc で閉じること（＝置いたら一旦モードを抜ける）
- 本文の「@メンバー名」でメンション通知＋Slack通知
- コメントを「解決済み」にできること。解決済みは一覧ポップアップから見返せること

## 2. 方式（結論：DBは増やさない。Yjs Doc に相乗りする）

### 2.1 保存先

コメントは Excalidraw 要素と同じ **Yjs Doc の中** に置く。

| 共有型 | キー | 内容 |
|---|---|---|
| `Y.Map` | `wbComments` | ピン1本 = 1エントリ（id / scene座標 / 投稿者 / 本文 / 日時 / 解決済みフラグ） |
| `Y.Map` | `wbCommentReplies` | 返信1件 = 1エントリ（`commentId` で親を指す） |

こうすると新設が要らない：

- **リアルタイム共有** … `SupabaseYjsProvider` が Doc の差分をそのまま配信する（`wb:{boardId}` チャンネル）
- **永続化** … `useWhiteboardSync` の `doc.on("update")` → `saveDocState`（`whiteboards.doc_state`）にそのまま乗る
- **後入り参加者への復元** … `y-sync-req` の差分同期にそのまま乗る

→ **マイグレーション（SQLの追加）・RLS の変更・新しい API は無し。**

### 2.2 返信を親コメントの配列にしない理由

`Y.Map` の値は「まるごと last-write-wins」。返信を親コメントの配列に持たせると、
2人が同時に返信した時に後勝ちで片方が消える。返信を独立エントリにすれば同時返信でも両方残る。

### 2.3 ピンは Excalidraw 要素にしない

ピンを図形として置くと、選択・移動・削除・undo・エクスポート・自動接続（`autoConnectLines`）など
既存の膨大な図形ロジック全部に巻き込まれる。ピンは **DOM オーバーレイ**（`CommentLayer`）で描き、
scene 座標だけを持たせる。

座標追従は他のオーバーレイと同じ方針：

- React は「どのピンが在るか」だけを描く（scene座標は `data-x` / `data-y` に持たせる）
- rAF ループが `transform` だけを書き換える（パン/ズーム中に再レンダーを起こさない）

## 3. 変更ファイル

| ファイル | 変更 |
|---|---|
| `src/app/lib/whiteboardComments.ts` | **新規**。Yjs 上のコメント/返信の型・CRUD・購読・解決・メンション解析 |
| `src/app/lib/whiteboardCommentNotify.ts` | **新規**。メンション/返信の通知（notifications insert ＋ Slack） |
| `src/app/components/whiteboard/CommentLayer.tsx` | **新規**。ピン・吹き出し・入力欄・⋯メニュー・コメントモード（カーソル/キー/クリック） |
| `src/app/components/whiteboard/CommentListPanel.tsx` | **新規**。コメント一覧ポップアップ（未解決／解決済み） |
| `src/app/components/whiteboard/WhiteboardToolbar.tsx` | 「コメント」「一覧」を追加。図形系ボタンだけ `canEdit` で隠す |
| `src/app/components/whiteboard/WhiteboardCanvas.tsx` | `commentMode` / 一覧の開閉を持ち、ツールバーと `CommentLayer` へ配線。`?comment=` の着地を仲介 |
| `src/app/lib/whiteboardLink.ts` | `?comment=` / `?reply=` と、通知の飛び先 `mention_context` の生成・解析 |
| `src/app/lib/whiteboardService.ts` | `loadProjectMemberNames()`（メンション候補） |
| `src/app/lib/whiteboardFocusBus.ts` | フォーカス要求を `{elementId, commentId, replyId}` に拡張 |
| `src/app/pages/WhiteboardPage.tsx` | `?comment=&reply=` を読んで渡し、着地後に URL から消す。`projectId` を渡す |
| `src/app/components/layout/Topbar.tsx` | お知らせがホワイトボード宛てなら該当ピンへ飛ばす |
| `src/app/components/shared/RichEditor.tsx` | 本文に貼られたコメントリンクのクリックを、コメント指定つきで開く |
| `src/app/contexts/PreviewPanelContext.tsx` / `LinkPreviewPanel.tsx` / `WhiteboardLinkPreview.tsx` | プレビューパネル経由でもコメントIDを引き回す |

## 4. 操作の流れ

### 4.1 コメントモード

- 入る … ツールバーの「コメント」ボタン、または「c」キー（入力中・図形のテキスト編集中は無視）
- カーソル … `.wb-comment-mode .excalidraw canvas { cursor: url(ピンSVG) !important }`
  （Excalidraw は canvas に `style.cursor` を直接書くため `!important` が要る）
- 入ると選択ツールへ戻す。逆に Excalidraw のツールを選んだらコメントモードは自動で抜ける
- 抜ける … もう一度ボタン/「c」、または Esc

保存すると **コメントモードは抜けて**、置いたコメントが固定表示で開く。
続けて置きたい時はもう一度ピンボタン/「c」を押す（クリックのたびにピンが増えて散らかるのを防ぐ）。

### 4.2 クリックでピンを落とす

`containerRef` の **キャプチャ段階**で `pointerdown` を受け、対象が `<canvas>` なら握り潰す
（Excalidraw まで届くと選択解除や図形描画が走ってしまう）。ツールバー・自前パネル・ピン自身は
canvas ではないので巻き込まれない。左ボタンのみ対象にしているので、中ボタンドラッグでのパンは
コメントモード中も使える。

### 4.3 ツールチップの開閉

| 状態 | 意味 |
|---|---|
| `hoverId` | ホバー中（マウスを外すと 220ms 後に閉じる） |
| `stickyId` | 固定表示。ピンのクリック / 返信 / 返信を表示 / リンク着地 で立つ |

`activeId = stickyId ?? hoverId`。固定表示は「`[data-wbc-ui]` の外での pointerdown」または Esc で閉じる。
ピンとツールチップの間にはすき間があるので、閉じるのは 220ms 遅らせて渡れるようにしている。

### 4.4 リンク

- コメント … `/{slug}/whiteboard/{boardId}?comment={commentId}`
- 返信 … `…?comment={commentId}&reply={replyId}`（飛び先はピン。着地時に返信一覧を開く）

着地側は Yjs の差分がまだ届いていないことがあるので、`?element=` と同じく
200ms 間隔で最大30回（≒6秒）再探索する。見つからなければトーストで知らせて URL から消す。

## 5. メンションと通知

本文に `@メンバー名` を書くとメンション扱いになる。入力欄で「@」を打つと候補が出る
（候補は `projects.members`。素の textarea なのでリッチエディタのメンション拡張は使えず、
`mentionQueryAt()` ＋ 自前のドロップダウンで最小限を持つ。↑↓で選択、Enter/Tab で確定）。

通知は **チケットのコメントと同じ経路に相乗り**する（`TicketDetailPanel.notifyMentions` と同型）。

| 経路 | 使うもの | 備考 |
|---|---|---|
| ベルのお知らせ | `notifications` テーブルへ insert | 既存テーブル・既存カラムのみ。プッシュ通知もDBフック経由で従来どおり飛ぶ |
| Slack | `POST /api/slack-notify` | 既存API。プロジェクトのSlack設定がONの時だけ飛ぶ |

飛ばすのは次の2つ。編集時は「今回増えたメンション」だけに絞る（同じ人へ何度も飛ばさない）。

- メンション … `type: "mention"`
- 自分以外のコメントへの返信 … `type: "comment"`（チケットのコメントと同じ挙動）

### 5.1 通知からの復帰先

お知らせの飛び先は元々チケット前提（`/{slug}/{wbs}?anchor=…`）なので、
ホワイトボードのコメントは `mention_context` に `whiteboard:{boardId}:{commentId}` を入れ、
`Topbar.handleNotifClick` がそれを見て `/{slug}/whiteboard/{boardId}?comment={id}` へ飛ばす。
**notifications のスキーマ変更は無し。**

## 6. 解決済み

- 吹き出しのチェックボタンで 解決 ⇔ 未解決 を切り替える（誰でも切り替え可・Figma と同じ）
- 解決済みのピンは**盤面から消える**。ただし一覧やリンクから開いている間だけは表示する
- 見返す入口が「コメント一覧」ポップアップ（ツールバーの「一覧」）。未解決／解決済みのタブで、
  行をクリックするとその位置まで移動して吹き出しが開く

## 7. 権限

`whiteboards` の RLS は authenticated 全許可で、実体は `loadWhiteboardPerms` のアプリ側判定。
**コメントは図形の編集権限とは切り離す**（図形は編集できなくても議論には参加できるべきなので）。

| 権限 | ボードの閲覧 | 図形の編集 | コメント投稿・返信・解決 | 自分の投稿の編集・削除 |
|---|---|---|---|---|
| edit | ○ | ○ | ○ | ○ |
| view | ○ | × | ○ | ○ |
| none | × | × | × | × |

他人のコメントの編集・削除はできない（⋯メニューに項目自体を出さない）。

## 8. 決めごと・非対象

- ピンは図形に紐付かず、scene 座標に固定する（図形を動かしてもピンは動かない）
- 「解決済み一覧」は専用ポップアップではなく、コメント一覧のタブとして持つ
- 画像/PNG エクスポートにピンは含まれない（Excalidraw 要素ではないため）
