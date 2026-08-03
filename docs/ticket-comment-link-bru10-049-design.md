# BRU10-049 チケットのコメントのリンク発行 設計書

作成日: 2026-08-03

## 1. 要件

チケットの各コメントに、そのコメントを直接指すリンクを発行できるようにする。

- コメントに三点リーダー（⋯）メニューを追加する
- メニューの「リンクをコピー」をクリックするとリンクがクリップボードにコピーされる
- コピーしたリンクを開くと、当該チケットが開き、そのコメント位置まで自動でスクロールする

## 2. 現状調査（結論：URL規約もアンカー機構も既にある／着地側が未配線）

### 2.1 すでにある資産

| 資産 | 場所 | 内容 |
|---|---|---|
| コメントアンカーURL規約 | `GlobalSearch.tsx:338` / `Topbar.tsx:296` | `/{projectSlug}/{wbs}?anchor=comment:{commentId}` を既に発行している（全文検索のコメントヒット、メンション通知） |
| アンカー受け取り | `TicketDetailPanel.tsx:832-842` | `anchor` prop が `comment:` で始まれば `panel-comment-{id}` へ `scrollIntoView` |
| コメントのDOMアンカー | `TicketDetailPanel.tsx:3169, 3267, 3485, 3591` | 親コメント・返信の両方に `id="panel-comment-{c.id}"` が既に付いている |
| 着地ハイライト | `TicketDetailPanel.tsx:129 pointToComment()` | スクロール＋枠線パルス。返信元ジャンプで使用中 |
| 共有オリジン解決 | `src/app/lib/appOrigin.ts` | Capacitor/タブモードでも壊れない公開オリジン（`VITE_PUBLIC_APP_ORIGIN`） |
| リンク生成モジュールの前例 | `src/app/lib/whiteboardLink.ts` | build/parse を1モジュールに閉じる構成 |
| コピー処理 | `src/lib/clipboard.ts copyText()` | Capacitor 対応済み |
| コピー完了トースト | `TicketDetailPanel.tsx:2288-2295` | 「コピーしました！」の吹き出し |

### 2.2 既存の欠落（本チケットで同時に直す）

`?anchor=comment:xxx` の着地先である `/:projectSlug/:segment` = **`SprintDetailPage` が `anchor` を一切読んでいない**。

- `SprintPage.tsx:60` は `searchParams.get("anchor")` を読んでパネルに渡している
- `SprintDetailPage.tsx:821` の `<TicketDetailPanel>` には `anchor` prop が無い

つまり現状、全文検索のコメントヒットもメンション通知も「チケットは開くがコメントまで飛ばない」状態。ここを直さないと本機能のリンクも機能しないため、本チケットのスコープに含める。

## 3. 方式

**新しいURL体系・DBカラム・ルートは作らない。既存の `?anchor=comment:{id}` 規約に相乗りする。**

理由：

- 同じ「コメントを指す」意味のURLが2系統に分かれると、着地処理も2重になり必ず片方が腐る
- コメントIDは `ticket_comments.id`（UUID）が既にあり、短縮IDやトークン発行は不要
- 権限はチケット詳細を開く時点のRLSでそのまま担保される（リンク自体は権限を与えない＝既存のチケットリンクと同じ性質）

### 3.1 URL形式

```
{公開オリジン}/{PROJECT_SLUG}/{WBS}?anchor=comment:{commentId}
例) https://dv-ticket.com/DEVTICKET/BRU10-049?anchor=comment:3f2a...-...
```

- オリジンは `appOrigin()` を通す。既存のチケットリンクボタン（`TicketDetailPanel.tsx:2318`）は `window.location.origin` を直に使っているが、Mac/iPadアプリでは `capacitor://localhost` になり他人に渡せない。新規実装は `appOrigin()` に統一する（既存箇所は本チケットでは触らない＝差分を最小に保つ）
- `appOrigin()` が空（ネイティブ＋env未設定）の場合は、`CopyObjectLinkButton` と同じ方針でコピーせずエラー表示

### 3.2 新規モジュール `src/app/lib/commentLink.ts`

リンク文字列の組み立てとアンカー解析を1箇所に閉じる。`TicketDetailPanel` に散らばっている `"comment:"` 直書き（832行の判定、1360/1380行の通知アンカー生成）もこの関数に寄せる。

```ts
export const COMMENT_ANCHOR_PREFIX = "comment:";
export function buildCommentAnchor(commentId: string): string;         // "comment:xxx"
export function parseCommentAnchor(anchor?: string | null): string | null; // "comment:xxx" -> "xxx"
export function buildCommentPath(projectSlug, wbs, commentId): string; // アプリ内遷移用の相対パス
export function buildCommentLink(projectSlug, wbs, commentId): string | null; // 共有用の絶対URL（オリジン不明なら null）
```

## 4. UI設計

### 4.1 三点リーダーメニュー

コメントヘッダー行（名前・ステータスバッジ・日時・右寄せアクション群）の**アクション群の末尾**に ⋯ を追加する。既存の編集(`Pencil`)／削除(`Trash2`)／返信(`CornerDownRight`)はそのまま残す。

```
[アバター] ユーザー名  [ステータス]  日時            ✏ 🗑 ↩ ⋯
                                                        └─┬──────────────┐
                                                          │ 🔗 リンクをコピー │
                                                          └────────────────┘
```

- アイコン: `MoreHorizontal`（lucide）／サイズ11px・色 `#D5D0CB`、hoverで `#0284C7`。既存アクションと完全に同じ寸法・配色ルール
- ポップオーバー: ボタン直下・右寄せ、白背景／`1px solid rgba(26,23,20,0.08)`／`borderRadius 8`／`boxShadow 0 8px 24px rgba(0,0,0,0.12)`、`zIndex 60`
- メニュー項目は現時点で「リンクをコピー」1件のみ。将来の項目追加を見越して配列ではなくベタ書き（1件のために抽象化しない）
- コピー成功時：メニューを閉じ、⋯ の上に既存と同じ「コピーしました！」吹き出しを2秒表示
- 失敗時（オリジン未解決・クリップボード拒否）：`showAlert()` でメッセージ表示

### 4.2 配置箇所（4箇所）

`topLevelComments.map` の中でレンダリング分岐が2系統あり、それぞれに親と返信があるため計4箇所に同じコンポーネントを置く。

| # | 対象 | 現在の行 |
|---|---|---|
| 1 | システムコメント（レビュー依頼／差戻し／承認／取下／ステータス変更）の親 | 3174-3195 |
| 2 | 同上の返信 | 3282付近 |
| 3 | 通常コメントの親 | 3491-3516 |
| 4 | 同上の返信 | 3608付近 |

システムコメント（ステータス変更など）にもリンクを出す。「いつ差し戻されたか」を指して共有したい需要があり、除外する理由がない。

### 4.3 コンポーネント

`TicketDetailPanel.tsx` 内のローカル関数コンポーネント `CommentLinkMenu` として実装する（`pointToComment` の直下に置く）。開閉状態はコンポーネント自身が持つ。

- 複数同時オープンは、外側 mousedown で閉じるため自然に防がれる（他の ⋯ を押した時点で前のメニューは外側クリック扱い）
- Esc は `escStack.push/pop` を使う。パネル自体のEscハンドラより後にpushされるためLIFOで**メニューだけが閉じる**（`document.addEventListener` を自前で足すと escStack が capture かつ先に登録済みなので、パネルごと閉じてしまう）

### 4.4 表示条件

`projectSlug` と `ticket.wbs` が揃っている時だけ ⋯ を表示する。既存のチケットリンクボタン（2306行 `{projectSlug && ...}`）と同じガード。`ReportsPage` からパネルを開いた場合は `projectSlug` が渡っていないため非表示になる。

## 5. 着地側

### 5.1 `SprintDetailPage.tsx`

```ts
const [searchParams] = useSearchParams();
const anchor = searchParams.get("anchor") ?? undefined;
...
<TicketDetailPanel ... anchor={anchor} />
```

`selectTicket()`（306行）はユーザー操作時のみ `navigate` するため、着地時にクエリが剥がれることはない。パネルを閉じる／別チケットへ移る際は既存どおりクエリなしのURLへ遷移し、アンカーは自然に消える。

### 5.2 `TicketDetailPanel.tsx` のアンカー効果（832行）

`scrollIntoView` を既存の `pointToComment()` に差し替える。着地時に枠線がパルスするので「どのコメントのリンクだったか」が分かる。説明欄アンカー（`anchor=description`）は従来どおり `scrollIntoView`。

依存配列は現状の `[anchor, comments.length, ticket?.id]` のままでよい。コメントは後から非同期で入るが、`comments.length` の変化で効果が再実行され、その時点でDOMは確定している。`anchorScrolledRef` により同一アンカーでの二重発火は防がれている。

## 6. スコープ外

- 既存のチケットリンクボタンの `window.location.origin` → `appOrigin()` 移行（別途、影響範囲がSlack通知本文まで及ぶため単独で扱う）
- コメントリンクのプレビュー展開（`LinkPreviewPanel` 対応）
- Slack通知へのコメントリンク添付

## 7. 変更ファイル

| ファイル | 変更 |
|---|---|
| `src/app/lib/commentLink.ts` | 新規。リンク生成／アンカー解析 |
| `src/app/components/tickets/TicketDetailPanel.tsx` | `CommentLinkMenu` 追加＋4箇所に配置、アンカー効果を `pointToComment` へ、`"comment:"` 直書きを `commentLink` へ寄せる |
| `src/app/pages/SprintDetailPage.tsx` | `?anchor` を読んでパネルへ渡す |

## 8. 確認項目

1. 通常コメントの ⋯ →「リンクをコピー」→ 別タブでURLを開く → チケットが開きコメントがパルスする
2. 返信コメントでも同様に動く
3. システムコメント（ステータス変更）でも同様に動く
4. コピー直後に「コピーしました！」が出て2秒で消える
5. メニュー表示中にEscを押すとメニューだけ閉じ、パネルは開いたまま
6. メニュー表示中に別の場所をクリックするとメニューが閉じる
7. （回帰）メンション通知クリック → 該当コメントまでスクロールするようになっている
8. （回帰）全文検索のコメントヒットクリック → 同上
9. `ReportsPage` からチケットを開いた場合に ⋯ が出ない（`projectSlug` 無し）
