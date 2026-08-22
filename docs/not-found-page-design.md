# 404 / アクセス不可 画面 設計

## 背景・課題

アサインされていないプロジェクトのURL（議事録・バックログ・Wiki・チケット等）を開くと、
画面は表示されず **黙って `/projects` へリダイレクト** される。存在しないURLは
**黙って `/dashboard` へリダイレクト** される。

情報が漏れないという意味では正しいが、リンクを受け取った側からは

- リンクの貼り付けに失敗したのか
- URLが古いのか
- そもそも自分に見る権限が無いのか

がまったく区別できない。結果、同じリンクを何度も叩き直したり、URLを手で書き換えて
試したりする混乱が起きている。

## 方針

**「黙ってリダイレクトする」をやめ、理由を必ず画面に出す。**

1. 遷移させずにその場で専用画面を描画する（URLはそのまま残す）
2. 「なぜ見られないか」を日本語で明示する
3. **開こうとしたURLを画面に表示する** → リンクは正しく届いていると分かる（本件の主因）
4. 次にどこへ行けばよいかをボタンで示す

## 状態の分類

| kind | コード | 出る場面 | 見出し |
|---|---|---|---|
| `route` | 404 | URLに対応する画面が無い（打ち間違い・古いURL） | ページが見つかりません |
| `project` | 404 | プロジェクトが存在しない／削除済み | プロジェクトが見つかりません |
| `resource` | 404 | プロジェクトは開けるが中の項目が無い（削除済みリンク） | 〇〇が見つかりません |
| `no-access` | 403 | プロジェクトは在るが自分はアサインされていない | このプロジェクトにアクセスできません |
| `no-permission` | 403 | アサインはされているが、その機能の権限が `none` | 〇〇を表示する権限がありません |

### 情報漏えいについて

`no-access` は「そのプロジェクトが存在すること」を明かす。これは
**同一組織内に限って** 許容する。理由は、社内で「アサインを依頼すればよい」と
分かることの価値が、存在の秘匿より高いため。

**別組織のプロジェクトは従来どおり `project`（404）として扱い、存在を明かさない。**
（既存の `getBoardMeta()` のコメント「存在するが見えない／存在しないを区別しない」と
同じ考え方を、組織をまたぐ場合にだけ適用する）

## 実装

### 追加

`src/app/components/shared/NotFoundView.tsx`

- `NotFoundView` … 上記5種を描く共通ビュー。AppShell の中に描画されるので
  サイドバー・タブは残る。URLのコピーボタン付き。
- `RouteNotFoundPage` … ルーターの `*` 用の薄いラッパー。
- `projectAccessView(project, viewer)` … プロジェクト配下画面の共通ガード。
  表示してよければ `null`、弾くなら出すべき画面を返す。

`src/app/lib/projectAccess.ts`

- `checkProjectAccess(project, viewer)` … `"ok" | "not-found" | "no-access"`。
  画面ごとにバラついていた「別組織か」「アサインされているか」の条件をここに一本化した。
  弾いた後に何を表示するかが判定結果に依存するようになったため、分散させておけない。

### ルーティング

- `PROTECTED_ROUTES` の末尾に `{ path: "*", element: <RouteNotFoundPage /> }` を追加。
  保護シェル配下なので、サイドバー付きの 404 になる。
- `App.tsx` / `AppRoutes.tsx` の `<Route path="*" element={<Navigate to="/dashboard" />} />` を削除。
  （未ログインで不明URLを開いた場合は従来どおり `/login` 経由になる）

### 各ページのガード置き換え

| ファイル | 置き換え前 | 置き換え後 |
|---|---|---|
| `SprintPage` | `notFound / !project` → `/projects` | `projectAccessView` |
| | 非メンバー用の自前画面 | `no-access`（共通ビューへ統合） |
| `SprintDetailPage` | `!project \|\| !sprint` → `/projects` | PJ解決に成功→`resource`（スプリント/チケット）／失敗→`project` |
| | `!sameOrg \|\| !isMember` → `/projects` | `projectAccessView` |
| `BacklogPage` | 3本のリダイレクト | `projectAccessView` / `no-permission` |
| | 項目リンクが解決できない | `resource`（バックログ項目） |
| `MinutesPage` | 同上 | 同上（議事録） |
| `WikiPage` | 同上 | 同上（Wikiページ。`pages/:id`・`folders/:id` のときだけ） |
| `FileBoxPage` | 2本のリダイレクト | `projectAccessView` |
| `KnowledgePage` | 2本のリダイレクト | `projectAccessView` |
| `WhiteboardPage` | `notFound` / `perm none` | `project` / `no-permission`。権限が `none` かつ未アサインなら `no-access` に出し分け |
| `ProjectTasksPage` | `notFound` → `/projects` | `project` ＋**アサイン判定を新設**して `no-access` |
| `MembersPage` / `RolesPage` / `PermissionsPage` / `AdminSettingsPage` / `AnnouncementSettingsPage` / `OrganizationPage` / `OrganizationDetailPage` / `ReportsPage` | 権限なし → `/dashboard` | `no-permission` |

### 誤検知（見えるはずの画面が404になる）の防止

- 判定はすべて **`loading === false` になってから** 行う。
- `notFound` は **`load()` の先頭で必ず false に戻す**。404画面はリダイレクトしない＝
  コンポーネントがアンマウントされないため、これを入れないと一度404を出した後は
  同じ画面（例: `/A/minutes` → `/B/minutes`）が永久に404のままになる。
- 項目リンクの `resource` 判定は、作成直後に URL だけ先に変わるケースで
  誤爆しないよう、各ページの作成処理が `await load()` を挟んでいることを確認済み。
- 同じく `resource` 判定は、PJを跨いだ直後に手元の一覧がまだ前のPJのもので
  誤爆しないよう、`project.slug === projectSlug`（またはid一致）を条件に加える。
- Wiki は `/:projectSlug/wiki/*`（タイトルベースの旧URL）を許容しているため、
  ワイルドカード経路では `resource` 判定を行わない。

### アクセスできる範囲は変えない（1点だけ例外）

判定の追加はすべて「文言を正しくするため」であり、見える範囲は原則そのまま。

- `WhiteboardPage` … 権限が `none` のときに理由を出し分けるだけ。
  権限を持つ管理者は従来どおり未アサインでも開ける。
- `ProjectTasksPage` … ここだけアサイン判定を**新設**した。
  DB側は `tasks_select` の `can_access_project()` で既に弾いているため、
  未アサインの人には「空のタスク一覧」が出ていた。実質の可視範囲は変わらず、
  「なぜ空なのか」が伝わるようになる。

## 触らないもの

- `TicketShortUrlPage`（ルート未登録の死んだコード）
- ナレッジノートの `:docId` 着地（`setupRequired` / プラン制限の画面と絡み、
  取得失敗を「無い」と誤判定する恐れがあるため既存のトースト通知のまま）
- ホワイトボードの `:boardId` 着地（右ペインに「ボードが見つかりませんでした」を
  出す作りが既にあり、ボード一覧を残せるぶんそちらのほうが親切なので据え置き）
- ファイルボックスの `?file=` / `?folder=` 着地（既存のトースト通知で運用中）
- ホワイトボードの `?element=` / `?comment=` 着地（同上）
