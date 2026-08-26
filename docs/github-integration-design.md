# GitHub連携 設計書

> 対象: Dev Ticket から GitHub のPR・Issue・コミット／ブランチを**アプリ内で閲覧**し、
> 権限を持つ人だけが**PRのマージ・レビュー承認**を行えるようにする。
> ステータス: **実装済み**（`npx vite build` 緑。ただし GitHub App の作成と環境変数の登録が
> 完了するまでは、画面は 8-1-A「まだ有効化されていません」を出す）
>
> **実装時の設計との差分**
> - サーバーは `api/github-install-start.ts` 等に分けず、**`api/github/[resource].ts` の1ファイル**に集約した
>   （`api/v1/[resource].ts` と同じ理由。認証と権限判定を複製しないため）。
>   そのためコールバックURLは `/api/github/install-callback`。
> - インストール開始は 302 ではなく **JSON でURLを返してブラウザ側で遷移**する。
>   サーバーが302する形だと、アクセストークンをクエリに載せる必要が出てURLとログに残るため。
> - GitHubタブの表示可否は呼び出し側から配線せず、`useGithubAccess`（ProjectSubNav 内）で解決する。
>   8つある ProjectSubNav 呼び出し側すべてに配線すると漏れが出て、タブが画面ごとに出たり消えたりするため。

---

## 1. 背景・課題

現状、GitHub の情報は [環境メモ](../src/app/components/projects/ProjectSettingsDialog.tsx#L105-L175) に
URL を貼って共有している。表示側は [`EnvMemoTag`](../src/app/pages/SprintPage.tsx#L32-L62) で、
中身は素の `<a target="_blank">` にすぎない。

このため、リンクを受け取った人の見え方が**その人の GitHub のログイン状態と権限**に完全に依存する。

| 受け取った人の状態 | 見えるもの |
|---|---|
| GitHub 未ログイン | ログアウト状態の画面。Private なら **404** |
| 別アカウントでログイン中 | そのアカウントの権限で判定される。Private なら **404** |
| 権限のあるアカウントでログイン中 | 正しく見える |

**URL 自体は誰がクリックしても同じページを指しており、貼り方を変えても解決しない。**
`github.com/{owner}/{repo}/pulls` の `{owner}` はリポジトリ所有者であって閲覧者ごとに変わる部分ではない。

解決するには、**Dev Ticket 側が GitHub の認証情報を持ち、サーバー経由で取得した内容をアプリ内に描画する**しかない。

## 2. 決定事項

| # | 論点 | 決定 |
|---|---|---|
| ① | 認証方式 | **GitHub App**。個人アカウントに依存せず失効もしない |
| ② | 対象リポジトリ | **Private / Public 両方**。Private 前提で設計する |
| ③ | 表示するもの | **PR一覧・Issue一覧・コミット／ブランチ・チケットとPRの紐付け** |
| ④ | 書き込み操作 | **PRのマージ・レビュー承認・コメント**。ブランチ保護は GitHub 側でそのまま効かせる |
| ⑤ | 誰が見られるか | **Dev Ticket の権限で決める**。GitHub アカウントの有無・GitHub 側の権限は問わない（＝本件の主目的） |
| ⑥ | 誰がマージできるか | **Dev Ticket の権限で決める**。アサイン計画画面でメンバー／グループ単位に設定する |
| ⑦ | GitHub 上の名義 | **App（bot）名義**。ただしマージコミットに実行者名を明記し、Dev Ticket 側に監査ログを残す |
| ⑧ | 権限の既定値 | **`none`（何も見えない）**。既存メンバーに勝手に見えるようにはしない |
| ⑨ | インストールの単位 | **GitHub の組織（アカウント）ごとに1回**。プロジェクトごとではない |
| ⑩ | App の公開設定 | **Private / Public 両対応**。`GITHUB_APP_VISIBILITY` で画面の文言だけ切り替える |
| ⑪ | 実装範囲 | 読み取りと書き込みを**一括で**設計・実装する |

**非対象**: PRの新規作成、ブランチ作成・削除、コードレビューの行コメント、GitHub Actions の再実行、
Webhook によるリアルタイム同期（→ 13章）。

## 3. セットアップの3階層

この機能は**性質の違う3つの作業**が積み重なっている。UI もこの3階層をそのまま見せる。

| 階層 | 作業 | 頻度 | やる人 | 場所 |
|---|---|---|---|---|
| **Ⅰ. App作成** | GitHub App を作り、Vercel に環境変数を登録 | **全体で1回** | システムオーナー | GitHub / Vercel |
| **Ⅱ. インストール** | App を GitHub の組織に入れ、見せるリポジトリを選ぶ | **GitHub組織ごとに1回** | その組織の GitHub 管理者 | GitHub（Dev Ticket から遷移） |
| **Ⅲ. 紐付け・権限** | プロジェクトにリポジトリを割り当て、メンバーに権限を付与 | プロジェクト／メンバーごと | Dev Ticket の管理者 | **Dev Ticket 画面のみ** |

Ⅰは Slack 連携で `SLACK_CLIENT_ID` を設定したのと同じ位置づけで、一度きり。
Ⅱは組織につき1回で、リポジトリが増えても GitHub 側でチェックを足すだけ。
**日常的に発生するのはⅢだけで、これは全て Dev Ticket の画面内で完結する。**

### App の公開設定（Private / Public 両対応）

| 設定 | インストールできる先 | 想定 |
|---|---|---|
| Private | App を作成したアカウント／組織のみ | 自社（Meece）の GitHub だけで使う |
| Public | 任意の組織 | 顧客の GitHub 組織にも使わせる |

**認証・API・データモデルはどちらでも完全に同一**。インストールURL
（`https://github.com/apps/{slug}/installations/new`）も共通で、GitHub 側が
「インストール先として選べる候補」を出し分けるだけである。

したがって Dev Ticket 側で分岐が要るのは**画面の文言だけ**。環境変数
`GITHUB_APP_VISIBILITY`（`private` | `public`、既定 `public`）を `GET /api/github/status`
が返し、UI がそれを見て説明文を切り替える。

| 箇所 | `private` | `public` |
|---|---|---|
| 接続の流れ ② | 「接続先のアカウントを確認します（選択肢は自社の GitHub 組織のみです）」 | 「接続先の Organization（またはアカウント）を選びます」 |
| 管理者権限の注記 | 「自社 GitHub 組織の管理者権限が必要です」 | 「対象 Organization の管理者権限が必要です。無い場合はこのページのURLを管理者に共有してください」 |
| 接続済みバッジ | GitHub 組織名を表示（同上） | GitHub 組織名を表示 |
| 接続失敗時の追加ヒント | 「この App は自社組織にのみインストールできます。別の組織に接続したい場合は設定変更が必要です」 | （出さない） |

後から Private → Public に変更しても、環境変数を切り替えるだけで画面が追従する。
**すでに接続済みのデータは影響を受けない。**

## 4. アーキテクチャ

```
 ブラウザ（Dev Ticket）
   │  Authorization: Bearer <supabase access_token>
   │  ?projectId=xxx
   ▼
 /api/github/[resource]                        ← Vercel serverless
   │  ① Supabase JWT を検証 → userId
   │  ② projects → organization_id / github_repo_full_name
   │  ③ github_installations（組織単位）→ installation_id
   │  ④ そのユーザーが当該プロジェクトのメンバーか確認
   │  ⑤ githubPermission を解決（個別 → グループ → ロール既定）
   │      read 系  … "view" 以上を要求
   │      write 系 … "merge" を要求
   │  ⑥ App JWT(RS256) → installation access token（1時間・キャッシュ）
   ▼
 GitHub REST API v3
```

**トークンはブラウザに一切渡らない。** 権限判定は必ずサーバー側でやり直す
（クライアントの判定は表示の出し分けのためだけのものとして扱う）。

インストールのフロー:

```
 外部連携 → GitHub連携タブ →「GitHubに接続する」
   ▼
 /api/github-install-start?orgId=xxx
   ▼
 https://github.com/apps/{app-slug}/installations/new?state={署名付きstate}
   ▼（GitHub上で Organization と対象リポジトリを選んで Install）
 /api/github-install-callback?installation_id=...&setup_action=install&state=...
   │  github_installations に upsert
   ▼
 /admin-settings?tab=github&github=success
```

## 5. 権限設計

### 5-1. 新しい権限

[`UserPermissions`](../src/app/types.ts#L567-L588) に **1つだけ**追加する。

```ts
export type GithubAccessLevel = "none" | "view" | "merge";

export interface UserPermissions {
  // ...既存
  githubPermission: GithubAccessLevel;
}
```

| 値 | できること |
|---|---|
| `none` | プロジェクトの GitHub タブが**表示されない**。API も全て 403 |
| `view` | PR / Issue / コミット・ブランチの閲覧、チケットとPRの紐付け参照 |
| `merge` | 上記に加えて **PRのマージ・レビュー承認・コメント投稿・紐付けの編集** |

**「閲覧」と「マージ」を boolean 2つに分けない理由**: `マージ=可 / 閲覧=不可` という
矛盾した組み合わせが作れてしまい、その整合を取る分岐が全画面に散る。
3段階の単一値なら `>= view` / `=== merge` の2判定で済み、既存の
[`wikiPermission` 等](../src/app/pages/PermissionsPage.tsx#L41-L46) と同じ形になる。

### 5-2. 反映が必要な箇所

| ファイル | 変更 |
|---|---|
| [types.ts:567](../src/app/types.ts#L567) | `GithubAccessLevel` / `githubPermission` |
| [PermissionsPage.tsx:23](../src/app/pages/PermissionsPage.tsx#L23) | `DEFAULT_GROUP_PERMS` に `githubPermission: "none"` |
| [PermissionsPage.tsx:1292/1378/1519](../src/app/pages/PermissionsPage.tsx#L1292) | グループ編集・グループ一覧・個人モーダルに GitHub ブロックを描画 |
| [AuthContext.tsx:8](../src/app/contexts/AuthContext.tsx#L8) | `DEFAULT_PERMISSIONS` に `githubPermission: "none"` |
| [AuthContext.tsx:53-63](../src/app/contexts/AuthContext.tsx#L53-L63) | owner は `"merge"` |
| [AuthContext.tsx:67-76](../src/app/contexts/AuthContext.tsx#L67-L76) | admin / project-manager の fallback も `"merge"` |
| [ProjectSubNav.tsx:10](../src/app/components/layout/ProjectSubNav.tsx#L10) | `{ id: "github", label: "GitHub", icon: Github, path: "/github", permKey: "github" }` |

**DBマイグレーションは不要**（`permissions` は jsonb でキーが増えるだけ）。
`roles.base_permissions` に無いキーは `DEFAULT_PERMISSIONS` 側の `"none"` が効く。

### 5-3. 既定は「誰にも見えない」

未設定のメンバーは全員 `none`。導入直後は owner / admin / PM 以外に GitHub タブが出ない。
これは意図した挙動（見せたくない人がいる、という要望への安全側の既定）。
そのぶん **「なぜ見えないか」が画面から分かること**が重要になるため、7-1 と 7-3 で明示する。

### 5-4. サーバー側での再判定

`api/github/[resource].ts` は毎リクエストで service role 経由で解決する。
クライアントから渡された権限は一切信用しない。

```
1. project_member_permissions(project_id, member_id).permissions.githubPermission
2. 無ければ、そのメンバーが属する permission_groups の権限
3. 無ければ、roles.base_permissions.githubPermission
4. role === "owner" は常に "merge"
```

読み取り系で `"none"` なら 403、書き込み系で `"merge"` 以外なら 403。

## 6. データモデル

`supabase/add_github_integration.sql`（新規）

```sql
-- Ⅱ. インストール（GitHub組織ごとに1つ）
create table if not exists github_installations (
  organization_id   text primary key,              -- Dev Ticket の組織
  installation_id   text not null,
  account_login     text not null,                 -- 接続先の GitHub 組織名（表示用）
  account_type      text,                          -- Organization / User
  repo_selection    text,                          -- all / selected
  connected_by      uuid,
  connected_at      timestamptz not null default now(),
  revoked_at        timestamptz default null       -- GitHub側で削除された場合に立てる
);

-- Ⅲ. プロジェクト×リポジトリ
alter table projects add column if not exists github_repo_full_name text default null;  -- "owner/repo"
alter table projects add column if not exists github_default_branch text default null;
alter table projects add column if not exists github_enabled boolean not null default false;

-- チケットとPR/Issueの紐付け
create table if not exists ticket_github_links (
  id           bigserial primary key,
  project_id   uuid not null references projects(id) on delete cascade,
  ticket_id    text not null,
  kind         text not null check (kind in ('pull','issue')),
  number       integer not null,
  title        text,                               -- 表示用キャッシュ
  state        text,                               -- open / closed / merged
  linked_by    uuid,
  auto_linked  boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (project_id, ticket_id, kind, number)
);

-- 書き込み操作の監査ログ（GitHub側はbot名義になるため、Dev Ticket側に必ず残す）
create table if not exists github_action_logs (
  id          bigserial primary key,
  project_id  uuid not null references projects(id) on delete cascade,
  actor_id    uuid not null,
  action      text not null,                       -- merge / approve / request_changes / comment
  repo        text not null,
  pr_number   integer,
  result      text not null,                       -- ok / error
  detail      text,
  created_at  timestamptz not null default now()
);
```

RLS は既存テーブルと同じ方針（`can_access_project()` ベース）。
`github_installations` の insert/update は **サーバー(service role)のみ**、select は同一組織のメンバー。
`github_action_logs` の insert もサーバーのみ、select は `canAccessAdminSettings` 相当に絞る。

### 6-1. チケットとPRの紐付け

- **自動**: PRのブランチ名またはタイトルから `([A-Z]+-\d+)` にマッチする WBS 番号を拾い、
  同一プロジェクトのチケットに `auto_linked = true` で紐付ける。PR一覧の取得時にまとめて解決する。
- **手動**: チケット詳細の「関連PR」から PR 番号を選んで追加（`merge` 権限が必要）。

自動紐付けは**表示のみに使い、チケットのステータスは自動変更しない**。
既知の再発バグ（順番が変わる・チカチカする）を踏まないよう、既存のチケット更新経路には触れない。

## 7. サーバーAPI

| ファイル | 役割 |
|---|---|
| `api/github-install-start.ts` | GitHub App のインストール画面へリダイレクト |
| `api/github-install-callback.ts` | `installation_id` を `github_installations` に保存 |
| `api/github/[resource].ts` | 本体。読み書きすべてをここに集約 |
| `api/_lib/githubApp.ts` | App JWT の生成、installation token の取得とキャッシュ、GitHub API の薄いラッパ |

| resource | method | GitHub API | 必要権限 |
|---|---|---|---|
| `status` | GET | （DBのみ） | 誰でも（セットアップ状態の判定に使う） |
| `repos` | GET | `GET /installation/repositories` | view |
| `pulls` | GET | `GET /repos/{o}/{r}/pulls?state=open` | view |
| `pull` | GET | `GET /repos/{o}/{r}/pulls/{n}` ＋ `.../check-runs` | view |
| `issues` | GET | `GET /repos/{o}/{r}/issues`（`pull_request` を持つものは除外） | view |
| `commits` | GET | `GET /repos/{o}/{r}/commits?sha={branch}` | view |
| `branches` | GET | `GET /repos/{o}/{r}/branches` | view |
| `merge` | POST | `PUT /repos/{o}/{r}/pulls/{n}/merge` | **merge** |
| `review` | POST | `POST /repos/{o}/{r}/pulls/{n}/reviews` | **merge** |
| `comment` | POST | `POST /repos/{o}/{r}/issues/{n}/comments` | **merge** |
| `link` | POST/DELETE | `ticket_github_links` の追加・削除 | **merge** |

### 7-1. installation token

App の秘密鍵で RS256 の JWT（`exp` は10分以内）を作り、
`POST /app/installations/{installation_id}/access_tokens` で1時間有効なトークンを得る。
Node の `crypto` だけで作れるため追加ライブラリは不要。
モジュールスコープにキャッシュし、残り5分を切ったら再取得する。

### 7-2. マージの事前判定

| `mergeable_state` | 画面 |
|---|---|
| `clean` | マージボタン有効 |
| `dirty` | 「コンフリクトがあります」→ 無効 |
| `blocked` | 「必須チェックまたはレビュー承認が不足しています」→ 無効 |
| `behind` | 「ベースブランチより古いため更新が必要です」→ 無効 |
| `draft` | 「Draft のためマージできません」→ 無効 |
| `unknown` | GitHub 側で計算中 → 数秒後に自動で再取得 |

ブランチ保護は GitHub 側で従来どおり効く。API が拒否した場合は
**英語のエラーをそのまま出さず、8-7 の対応表で日本語に変換**する。

---

# 8. 画面設計

## 8-0. 操作場所と前後のUI（早見表）

利用者がやることは**3ステップだけ**で、**すべて同じ1画面**
（外部連携 →「GitHub連携」タブ、`/admin-settings?tab=github`）から始まる。

| | 操作 | 操作する画面 | 操作前のUI | 操作後のUI |
|---|---|---|---|---|
| **①** | **App のインストール** | 外部連携 → GitHub連携タブ<br>→ ボタンで **GitHub の画面へ移動**（Dev Ticket の外） | 8-1-B<br>大きな「GitHubに接続する」カード＋接続の流れ4ステップ | 8-1-D の成功バナー → 8-1-C ①<br>「✔ 接続済み meece-inc / 12リポジトリ」<br>ステップ表示が **①✔ ②●** に進む |
| **②** | **リポジトリの紐付け** | **同じ画面の②ブロック**（Dev Ticket 内で完結）<br>＋ プロジェクト設定ダイアログからも可 | 8-1-C ②<br>プロジェクト一覧の表。全行「未設定 ○」 | 該当行が「✔」になり既定ブランチが有効化<br>そのプロジェクトに **GitHubタブが出現**<br>ステップ表示が **②✔ ③●** に進む |
| **③** | **メンバーへの権限付与** | アサイン計画（②ブロックからボタンで遷移） | 8-1-C ③<br>「マージ可 0名 / 閲覧のみ 0名 / 権限なし 19名」 | 付与状況の数字が更新<br>付与された本人の画面に GitHubタブが出る<br>ステップ表示が **①②③ すべて✔ → 完了帯** に |

**Dev Ticket の画面を離れるのは①だけ**で、それも組織につき1回きり。②③は何度でも Dev Ticket 内で変更できる。

補助的な入口（メインの導線は上表のとおりで、こちらは「そこで気づいた人」向け）:

| 気づく場所 | 出るもの |
|---|---|
| プロジェクトの GitHubタブを開いたが未紐付け（管理者） | 8-3-A「外部連携をひらく →」 |
| プロジェクト設定ダイアログ（環境メモの上） | 8-6 のリポジトリ選択欄。未接続なら「先に「外部連携」で GitHub に接続してください →」 |

## 8-0-1. 設計方針

1. **画面から離れる操作の前に、何が起きるかを必ず出す**。GitHub のインストールは Dev Ticket の外へ
   出る操作なので、「移動します」「戻ってきます」「何を選ぶか」を事前に書く。
2. **3階層（App作成／インストール／紐付け・権限）を混ぜない。** 画面上でもステップとして分けて見せる。
3. **今どこまで終わっているかが常に分かる。** ステップインジケータを常設する。
4. **できない理由を必ず書く。** 権限が無い・未接続・CIが通っていない、を黙って隠さない
   （[404設計](./not-found-page-design.md) と同じ方針）。
5. 既存のトーン（白カード／`#059669` のアクセント／12〜13pxの本文／角丸10〜12）に合わせる。
   GitHub 由来の要素だけ `#1F2328` を使う。

## 8-1. 外部連携 → GitHub連携タブ

### 置き場所（既存画面の改称＋タブ追加。新規画面は作らない）

サイドバーの **「通知管理」** を **「外部連携」** に改称し、そこにタブを1つ足す。

```
【サイドバー】                    【外部連携 を開いた画面】
  …                                ┌──────────────────────────────────┐
  アサイン計画                      │ [Slack通知][メンバー設定][GitHub連携]│
  ロール設定                        └──────────────────────────────────┘
  🔌 外部連携   ← 改称                                      ↑ 追加
  お知らせ設定
  組織管理
```

改称する理由: この画面は現在2タブとも Slack の設定（Slack通知 / メンバーのSlack ID）で、
実態は「外部サービス連携の画面」でありながら名前だけが「通知管理」だった。
GitHub の設定が「通知管理」の中にあると探せない。

**URL（`/admin-settings`）と権限（`canAccessAdminSettings`）は変更しない。**
新しい権限フラグは作らない。

| ファイル | 変更 |
|---|---|
| [Sidebar.tsx:21](../src/app/components/layout/Sidebar.tsx#L21) | ラベル「通知管理」→「外部連携」、アイコン `BellRing` → `Plug` |
| [Sidebar.tsx:78](../src/app/components/layout/Sidebar.tsx#L78) | 表示条件を `featureNotifications` **または** `featureGithub` に（下記） |
| [TabContext.tsx:91](../src/app/contexts/TabContext.tsx#L91) | タブ名「通知管理」→「外部連携」 |
| [AdminSettingsPage.tsx:21-24,64-65](../src/app/pages/AdminSettingsPage.tsx#L21-L24) | 見出し・サブタイトル・`NotFoundView` の `label` |
| [RolesPage.tsx:35](../src/app/pages/RolesPage.tsx#L35) | 権限フラグの表示名「通知管理」→「外部連携」、説明文も更新 |
| [OrganizationPage.tsx:307](../src/app/pages/OrganizationPage.tsx#L307) | プラン設定に「GitHub連携」の行を追加 |
| [ENHA2-024-manual-structure.md](./ENHA2-024-manual-structure.md) | マニュアルの画面名・導線の記述を更新 |

`src/app/pages/lp/DemoInteractivePage.tsx` のデモ画面は LP 用のモックのため**触らない**。

### プランによる出し分けの注意

現在サイドバーは `!plan.featureNotifications` のとき「通知管理」ごと非表示にしている
（[Sidebar.tsx:78](../src/app/components/layout/Sidebar.tsx#L78)）。ここを直さないと、
**通知OFF・GitHub ONのプランでGitHub設定に到達できなくなる**。

```ts
// 変更後
if (n.id === "admin-settings" && !plan.featureNotifications && !plan.featureGithub) return false;
```

各タブも個別にプランで出し分ける（通知OFFなら Slack系2タブを、GitHub OFFなら GitHub連携タブを隠す）。
両方OFFのときだけ従来どおり `NotFoundView` を出す。

### 画面の中身

サブタイトルは「Slack通知とGitHub連携の設定を管理します」に変更する。

### セットアップ状態

`GET /api/github/status` の結果で4状態に分岐する。

| 状態 | 条件 | 画面 |
|---|---|---|
| `no-app` | サーバーに `GITHUB_APP_ID` 等が無い | 8-1-A |
| `not-installed` | `github_installations` に行が無い／`revoked_at` あり | 8-1-B |
| `installed` | インストール済み | 8-1-C |
| `error` | installation が GitHub 側で削除された（401/404） | 8-1-E |

### 共通ヘッダ（全状態で常設）

```
┌──────────────────────────────────────────────────────────────────────┐
│  ① GitHubに接続 ──────── ② リポジトリを紐付け ──────── ③ 権限を付与  │
│      ✔ 完了                  ● 実施中                     ○ 未実施    │
└──────────────────────────────────────────────────────────────────────┘
```

- ① … `github_installations` に有効な行があるか
- ② … このDev Ticket組織のプロジェクトに1件でも `github_repo_full_name` があるか
- ③ … このDev Ticket組織に `githubPermission !== "none"` のメンバーが1人でもいるか

各ステップはクリックでその設定ブロックへスクロールする。

### 8-1-A. `no-app`（システム未設定）

```
┌──────────────────────────────────────────────────────────────────────┐
│  ⚠  GitHub連携がまだ有効化されていません                              │
│                                                                       │
│  サーバー側の設定（GitHub App）が未登録のため、この機能は利用できま   │
│  せん。システム管理者にお問い合わせください。                          │
│                                                                       │
│  ▸ 管理者向け: docs/github-integration-design.md の「12. GitHub App   │
│    の作成と環境変数」を参照してください                                │
└──────────────────────────────────────────────────────────────────────┘
```

### 8-1-B. `not-installed`（未接続）

**この画面が本設計でいちばん説明を厚くする箇所。**

```
┌──────────────────────────────────────────────────────────────────────┐
│                            [ GitHubロゴ ]                             │
│                                                                       │
│                          GitHubに接続する                             │
│                                                                       │
│      接続すると、プルリクエスト・Issue・コミットを Dev Ticket の      │
│      画面内で確認できるようになります。                               │
│      閲覧するメンバーに GitHub アカウントは必要ありません。           │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  接続の流れ                                                     │  │
│  │  ────────────────────────────────────────────────────────────  │  │
│  │  ①  下のボタンを押すと GitHub の画面に移動します               │  │
│  │  ②  接続先の Organization（またはアカウント）を選びます        │  │
│  │  ③  Dev Ticket から見せたいリポジトリを選んで Install を押す   │  │
│  │      ・「All repositories」＝ 今後追加される分も自動で対象      │  │
│  │      ・「Only select repositories」＝ 選んだものだけ            │  │
│  │  ④  自動でこの画面に戻ります                                    │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  ⚠  GitHub の管理者権限が必要です                               │  │
│  │  この操作には、対象 Organization で App をインストールできる    │  │
│  │  権限（Owner など）が必要です。権限が無い場合は、この画面の     │  │
│  │  URL を管理者に共有して実施してもらってください。                │  │
│  │                                          [ URLをコピー ]        │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│                    [   GitHubに接続する   ]                           │
│                                                                       │
│      接続は組織につき1回だけです。プロジェクトが増えても、この操作を   │
│      やり直す必要はありません。                                        │
└──────────────────────────────────────────────────────────────────────┘
```

ボタンは GitHub 純正色 `#1F2328`。「接続の流れ」は Slack 設定の3ステップ表示と同じ構造
（[SlackNotificationSetting.tsx:261-272](../src/app/components/settings/SlackNotificationSetting.tsx#L261-L272)）を流用する。

### 8-1-C. `installed`（接続済み）

3つのブロックを縦に並べる。**ブロックの順序＝作業の順序**にする。

```
┌─ ① 接続状態 ─────────────────────────────────────────────────────────┐
│  ✔ 接続済み    meece-inc  （Organization）                            │
│    許可リポジトリ 12件 ・ 2026/08/22 に 溝口 雅登 が接続              │
│                                                                       │
│                       [ リポジトリを追加・変更 ]  [ 切断する ]        │
│  ───────────────────────────────────────────────────────────────────  │
│  「リポジトリを追加・変更」を押すと GitHub の設定画面に移動します。    │
│  新しいリポジトリを Dev Ticket から見えるようにする場合はこちらです。  │
└──────────────────────────────────────────────────────────────────────┘

┌─ ② プロジェクトとリポジトリの紐付け ──────────────────────────────────┐
│  どのプロジェクトでどのリポジトリを表示するかを設定します。            │
│                                                                       │
│  プロジェクト        リポジトリ                     既定ブランチ  状態 │
│  ───────────────────────────────────────────────────────────────────  │
│  Dev Ticket          [MeeceM-Mizoguchi/dev-ticket ▾] [main    ▾]  ✔   │
│  営業アプリ           [ 未設定                    ▾] [ —      ]  ○   │
│  BRUリニューアル      [meece-inc/bru-web          ▾] [develop ▾]  ✔   │
│                                                                       │
│                                                   [ 保存する ]        │
│  ───────────────────────────────────────────────────────────────────  │
│  プルダウンには、GitHub で許可したリポジトリだけが表示されます。       │
│  目的のリポジトリが無い場合は、上の「リポジトリを追加・変更」から      │
│  GitHub 側で許可を追加してください。                                   │
└──────────────────────────────────────────────────────────────────────┘

┌─ ③ メンバーの権限 ───────────────────────────────────────────────────┐
│  ⚠ 初期状態では、すべてのメンバーが「権限なし」です。                 │
│     権限を付けるまで、GitHub タブは本人の画面に表示されません。        │
│                                                                       │
│  現在の付与状況    マージ可 2名 ・ 閲覧のみ 5名 ・ 権限なし 12名       │
│                                                                       │
│  GitHub の閲覧・マージ権限は「アサイン計画」でメンバーまたはグループ   │
│  単位に設定します。                                                    │
│                                       [ アサイン計画をひらく → ]      │
└──────────────────────────────────────────────────────────────────────┘
```

#### ①ブロックの挙動

- 「切断する」は確認ダイアログ付き。文言は
  「接続を解除すると、すべてのプロジェクトで GitHub タブが表示されなくなります。
  GitHub 側のデータは変更されません。」
- 切断は Dev Ticket 側の接続情報を消すだけで、**GitHub 上の App インストール自体は残る**。
  その旨を注記し、「GitHub 側からも完全に削除する」リンク（GitHub の設定画面）を併記する。
- 「リポジトリを追加・変更」は `https://github.com/settings/installations/{installation_id}`
  （Organization の場合は `https://github.com/organizations/{login}/settings/installations/{id}`）を
  別タブで開く。戻ってきたときのために、①ブロックに「GitHub側で変更した場合は
  [一覧を再取得] を押してください」を置く。

#### ②ブロックの挙動（リポジトリの紐付け）

- 行はこの Dev Ticket 組織の**全プロジェクト**。プロジェクトが多い場合は検索欄を付ける。
- リポジトリのプルダウンは `GET /api/github/repos`（= `GET /installation/repositories`）の結果。
  **GitHub で許可したリポジトリだけ**が並ぶ。先頭に「未設定」を置く。
- リポジトリを選ぶと、**既定ブランチを GitHub から自動取得**してブランチ欄に入れる
  （`default_branch`）。手動で別のブランチにも変更できる。
- 保存は行単位ではなく「保存する」で一括。保存後:
  - 状態列が `○` → `✔`
  - トースト「Dev Ticket に MeeceM-Mizoguchi/dev-ticket を紐付けました」＋
    「GitHubタブを開く →」のアクション
  - ステップ表示が **②✔ ③●** に進む
  - `projects.github_enabled = true` を立てる
- 紐付けを「未設定」に戻すと `github_enabled = false` になり、GitHubタブは消える。
  `ticket_github_links` は**消さない**（再設定したら復活する。誤操作の巻き戻しを容易にするため）。
- **1つのリポジトリを複数プロジェクトに紐付けてよい**（同じリポジトリを複数案件で使う運用があるため）。
  重複はエラーにせず、行に小さく「他2プロジェクトでも使用中」と出すだけにする。

### 8-1-D. 接続直後（`?github=success`）

戻ってきた直後は、**成功バナーだけで終わらせず次の作業に誘導する**。

```
┌──────────────────────────────────────────────────────────────────────┐
│  ✅ GitHub に接続しました（meece-inc / 12リポジトリ）                 │
│     次に、プロジェクトとリポジトリを紐付けてください。                 │
└──────────────────────────────────────────────────────────────────────┘
```

同時に ② のブロックへ自動スクロールし、未設定行をハイライトする。

### 8-1-E. `error`（接続が切れている）

GitHub 側で App がアンインストールされた場合、API が 401/404 を返す。

```
┌──────────────────────────────────────────────────────────────────────┐
│  ⚠  GitHub との接続が解除されています                                 │
│     GitHub 側で Dev Ticket App がアンインストールされたか、権限が     │
│     取り消された可能性があります。再接続すると復旧します。            │
│     プロジェクトとリポジトリの紐付けは保持されています。              │
│                                          [ 再接続する ]               │
└──────────────────────────────────────────────────────────────────────┘
```

### 8-1-F. セットアップ完了

①②③ がすべて満たされたら、ステップインジケータを完了帯に差し替える。
「まだ何かやることがあるのでは」と探させないため。

```
┌──────────────────────────────────────────────────────────────────────┐
│  ✔ セットアップ完了   3プロジェクトに紐付け済み ・ 7名に権限を付与済  │
│                                                  [ 設定を変更する ▾ ] │
└──────────────────────────────────────────────────────────────────────┘
```

「設定を変更する」を開くと従来の①②③ブロックが展開される（既定は折りたたみ）。

## 8-2. アサイン計画の権限UI

[PermissionsPage](../src/app/pages/PermissionsPage.tsx) のグループ編集モーダルと
個人モーダルの両方、「ページ別アクセス権限」ブロックの下に独立したブロックを置く。

```
┌─ GitHub連携 ─────────────────────────────────────────────────────────┐
│                                                                       │
│   GitHub                    [ 閲覧のみ（PR・Issue・コミット）    ▾ ]  │
│                                                                       │
│   PR・Issue・コミットを Dev Ticket の画面内で閲覧できます。           │
│   マージやレビュー承認はできません。                                   │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

セレクトの選択肢と、選択中だけ直下に出す説明文:

| 選択肢 | 直下の説明 |
|---|---|
| 権限なし（GitHubタブを表示しない） | このメンバーには GitHub タブが表示されません。 |
| 閲覧のみ（PR・Issue・コミット） | PR・Issue・コミットを Dev Ticket の画面内で閲覧できます。マージやレビュー承認はできません。 |
| マージ可（承認・マージ・コメント） | 上記に加えて、**PRのマージ・レビュー承認・コメント投稿**ができます。 |

「マージ可」を選んだときだけ、下に警告を出す。

```
   ⚠ 「マージ可」は main ブランチへの反映を実行できる権限です。
     GitHub 側のブランチ保護（必須レビュー・必須CI）は引き続き有効ですが、
     Dev Ticket 上の操作で本番ブランチが更新されます。
```

グループ一覧のカードには、他の権限バッジと並べて `GitHub: マージ可` のチップを出す
（[PermissionsPage.tsx:856](../src/app/pages/PermissionsPage.tsx#L856) の `activePerms` に合流させる）。

## 8-3. プロジェクト内 GitHub タブ

`/:projectSlug/github` → `src/app/pages/GithubPage.tsx`

### 表示可否

| 条件 | 表示 |
|---|---|
| `githubPermission === "none"` | タブ自体を出さない。URL直打ちは `NotFoundView kind="no-permission" label="GitHub"` |
| リポジトリ未紐付け＋管理者 | 8-3-A |
| リポジトリ未紐付け＋一般 | 8-3-B |
| 紐付け済み | 8-3-C |

### 8-3-A. 未紐付け（管理者）

```
┌──────────────────────────────────────────────────────────────────────┐
│                          [ GitHubロゴ・グレー ]                       │
│              このプロジェクトにリポジトリが紐付いていません            │
│                                                                       │
│   「外部連携」からリポジトリを選ぶと、PR・Issue・コミットがここに      │
│   表示されます。                                                       │
│                                    [ 外部連携をひらく → ]             │
└──────────────────────────────────────────────────────────────────────┘
```

### 8-3-B. 未紐付け（一般メンバー）

```
   このプロジェクトにはまだ GitHub リポジトリが紐付いていません。
   表示するには管理者による設定が必要です。
```

管理画面へのリンクは出さない（開けないため）。

### 8-3-C. 通常表示

```
┌──────────────────────────────────────────────────────────────────────┐
│  MeeceM-Mizoguchi/dev-ticket          ↗ GitHubで開く   [更新] 3分前   │
│  ─────────────────────────────────────────────────────────────────── │
│  [ プルリクエスト 3 ]  [ Issue 12 ]  [ コミット ]  [ ブランチ ]       │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  #162  Devticket/enha2 024                              ✔ CI 4件成功  │
│  MeeceM-Mizoguchi が 7月5日に作成 ・ main ← devticket/enha2-024       │
│  🔗 ENHA2-024 マニュアル構成の刷新          レビュー ✔ 1件承認        │
│                                        [ 詳細 ]  [ マージする ]       │
├──────────────────────────────────────────────────────────────────────┤
│  #170  タスク管理の分割                              ● CI 実行中(2/4) │
│  yamada が 8月20日に作成 ・ main ← feature/task-split                 │
│  🔗 未紐付け  [+ チケットに紐付ける]        レビュー ○ 未承認         │
│                                        [ 詳細 ]  [ マージ不可 ⓘ ]     │
└──────────────────────────────────────────────────────────────────────┘
```

- `↗ GitHubで開く` は残す（GitHub 権限を持つ人には従来どおり便利なため）。
  ただしツールチップで「GitHub のアカウントと権限が必要です」と添える。
- 「更新」は手動リロード。**自動ポーリングはしない**（レート制限とチカチカ防止）。
  - 例外は「プルリクエストを作成」ダイアログだけ（BRU13-027）。
    開いている間は 10 秒ごとにブランチを取り直し、あとから push されたブランチをその場で選べるようにする。
    非表示のタブでは止め、10 分で自動確認を打ち切る（以後は手動の「更新」で再開）。
- `[ マージする ]` は `githubPermission === "merge"` かつ `mergeable_state === "clean"` のときだけ実体化。
  それ以外は淡色の `[ マージ不可 ⓘ ]` で、ⓘ のツールチップに 7-2 の理由を出す。
- `view` 権限の人にはマージ系ボタンを**そもそも描画しない**（押せないボタンを見せない）。

### 詳細パネル

行の `[ 詳細 ]` で右からパネルを開く。本文（Markdown）、変更ファイル数、
チェック一覧（名前・状態・所要時間）、レビュー一覧、紐付いたチケット。
`merge` 権限があれば下部に「レビュー承認 / 変更を依頼 / コメント」。

## 8-4. マージ確認ダイアログ

`ConfirmDialog` ではなく専用の `MergeConfirmDialog`（表示項目が多く、方式選択があるため）。

```
┌─ マージの確認 ───────────────────────────────────────────┐
│                                                           │
│   以下のプルリクエストをマージします。                     │
│                                                           │
│   リポジトリ    MeeceM-Mizoguchi/dev-ticket               │
│   プルリク      #162  Devticket/enha2 024                 │
│   マージ先      main  ←  devticket/enha2-024              │
│   CI            ✔ すべて成功（4件）                       │
│   レビュー      ✔ 1件承認                                 │
│                                                           │
│   マージ方式                                              │
│     ( ) マージコミットを作成                              │
│     (•) スカッシュしてマージ                              │
│     ( ) リベースしてマージ                                │
│                                                           │
│   ⚠ この操作は取り消せません。                            │
│     GitHub 上は Dev Ticket[bot] 名義で記録され、           │
│     マージコミットに「溝口 雅登」が実行者として残ります。  │
│                                                           │
│                          [ キャンセル ]  [ マージする ]    │
└───────────────────────────────────────────────────────────┘
```

- 既定は「スカッシュしてマージ」。最後に選んだ方式を `localStorage` に保存して次回の既定にする
  （[SlackNotificationSetting.tsx:8](../src/app/components/settings/SlackNotificationSetting.tsx#L8) と同じ手法）。
- 実行中はボタンを「マージ中...」にしてダイアログを閉じさせない。
- 成功: トースト「#162 をマージしました」＋PR一覧を再取得。
- 失敗: ダイアログ内に赤い枠で日本語のエラーを表示し、**ダイアログは閉じない**（原因を読ませるため）。

## 8-5. チケット詳細の「関連PR」

[TicketDetailPanel](../src/app/components/tickets/TicketDetailPanel.tsx) にセクションを追加。

```
┌─ 関連PR ────────────────────────────── [ + PRを紐付ける ] ┐
│  ✔ #162  Devticket/enha2 024                  マージ済み   │
│  ● #170  タスク管理の分割              オープン ・ ✔CI通過 │
│         自動検出（ブランチ名 ENHA2-024）           [解除]  │
└────────────────────────────────────────────────────────────┘
```

- `view` … 一覧の閲覧のみ。`[+ PRを紐付ける]` と `[解除]` は出さない。
- `merge` … 紐付けの追加・解除、行からマージ可能。
- 自動検出の行には根拠（ブランチ名／タイトル）を必ず添える。誤検出を人が判断できるようにするため。
- リポジトリ未紐付けのプロジェクトではセクションごと出さない。

### 8-5-1. チケット側でPRを完結させる（BRU13-013）

GitHub タブへ行かずに、チケット詳細だけで「作る → 紐付ける → マージする」まで終わらせる。

```
┌─ 関連PR ─────────────────── [ ⑃ PRを作成 ] [ + PRを紐付ける ] ┐
│ ┌ このチケットのブランチが見つかりました。PRを作成しますか？ ┐ │
│ │ ⑂ DEVTICKET/BRU13-012                                      │ │
│ │   PR作成モーダルの作成直後… ・ 2時間前 ・ 溝口雅登          │ │
│ │                            [ このブランチでPRを作成 ]      │ │
│ └────────────────────────────────────────────────────────────┘ │
│  ● #163  BRU13-012 …          オープン   [ マージする ] [解除] │
└────────────────────────────────────────────────────────────────┘
```

- **候補ブランチ** … `pending-branches`（PRがまだ無いブランチ）のうち、ブランチ名に
  このチケットの WBS 番号を含むものを出す。ブランチ全件の走査を伴うAPIなので、
  `todo` / `on-hold` / `withdrawn` のチケットでは投げない。
- **PRの作成** … `CreatePullDialog` をそのまま使う。作成できたPRは、一覧の自動検出を待たずに
  その場で `link` する。作成元のチケットが分かっているのに紐付け待ちにしない。
- **マージ** … 紐付いたオープンなPRに `[マージする]` を出す。出すのは
  **ステータスが「リリース待ち」以降のときだけ**。レビュー前に誤って入れられないようにする。
  確認はGitHubタブと同じ `MergeConfirmDialog`。
- ダイアログはチケット詳細パネル（スライドインで transform が乗る）の内側に置くと
  位置が狂うため、`createPortal` で body 直下に出す。

### 8-5-2. PR未紐付けの取り残しを防ぐ

「対応完了してリリースノートに追加」まで進んだのにPRが紐付いていないチケットを残さない。

| 段階 | 出すもの |
|---|---|
| リリースノートに追加した直後 | 関連PRを赤枠で強調し、その位置までスクロール |
| Esc / × / 背景クリックで閉じようとした | `PrLinkLeaveDialog`（専用UI。紐付ける／PR不要にする／このまま閉じる の3択） |
| それでも閉じた | チケット一覧・スプリント一覧で行を赤くし、`PR未紐付け` バッジを出す |

- 一覧の赤は**フラグではなくDBの状態から導出する**（`ticket_github_links` に pull が
  1件も無い かつ ステータスが `waiting-release` / `released`）。詳細画面を通らない
  一括ステータス変更で進んだチケットも同じように拾えるようにするため。
- 例外は `sprint_tickets.pr_link_waived` のみ。仕様確認・ドキュメント作業など
  PRが発生しないチケットを人が確定するための逃げ道で、アラートの抑止だけを担う。
  PRを紐付ければ、この値に関わらず赤は消える。
- 離脱確認を出すのは「リリースノートに追加」を押したその場だけ。過去に溜まっている
  未紐付けチケットを開くたびにモーダルで塞き止めない（そちらは赤い行と案内で気づかせる）。
- 判定は `src/app/lib/prLinkAlert.ts` に集約する。一覧は行ごとにAPIを叩かず、
  `ticket_github_links` をプロジェクト単位で1回だけ引く（select は `can_access_project`）。

### 8-5-3. 開いた時点で候補を出す・PRのリンクをコピーする（BRU13-015）

「PRを紐付ける」を押すまで関連PRの欄が空のままで、そこから何ができるのかが分からない状態を無くす。

- **紐付け候補の自動表示** … `merge` 権限があり、PRが1件も紐付いていないチケットでは、
  詳細を開いた（リロードした）時点でオープンなPRの一覧を出す。押さなくても
  「候補から紐付ける」「[⑃ PRを作成] でその場で作って紐付ける」のどちらも選べる。
  - チケットごとに1回だけ自動で開く。人が × で閉じたら開き直さない。
  - 大文字小文字違いで自動紐付けを見送った候補が出ているときは出さない。先にそちらを決めさせる。
  - 取れてから出す。オープンなPRが0件のときと取得に失敗したときは何も出さない。
    読み込み中の枠が出て消えるチカつきを作らないため、また押していない処理の失敗を
    トーストで知らせても直しようがないため。
- **軽い `pulls`** … 上の自動表示はチケットを開くたびに走るので、`pulls` に `light=1` を足す。
  CI・レビュー・マージ可否（PR1件あたり3リクエスト）とリリース反映を省き、
  番号・タイトル・検出WBSだけを返す。GitHub タブの一覧は従来どおり（`light` なし）。
- **リンクのコピー** … 紐付いた各行に `[リンクをコピー]` を置く。レビュー依頼やチャットへ
  貼るのに、GitHub を開き直させない。コピー後 1.6 秒だけボタンの表示を
  「コピーしました」に変える。コピー自体は `src/lib/clipboard.ts`（ネイティブ対応済み）。

## 8-6. プロジェクト設定ダイアログからの紐付け

[ProjectSettingsDialog](../src/app/components/projects/ProjectSettingsDialog.tsx) の
**環境メモの上**に、リポジトリ選択を1項目だけ置く。GitHub の URL を環境メモに貼っていた
運用の、そのまま置き換え先になる位置。

```
┌─ GITHUBリポジトリ ───────────────────────────────────────────────────┐
│   リポジトリ    [ MeeceM-Mizoguchi/dev-ticket              ▾ ]        │
│   既定ブランチ  [ main                                     ▾ ]        │
│   選択すると、このプロジェクトに GitHub タブが表示されます。          │
└──────────────────────────────────────────────────────────────────────┘
```

- 書き込み先は連携設定②と**同じ `projects.github_repo_full_name`**。
  データが二重化しないので、どちらから編集しても食い違わない。
- **未接続の組織では、セレクトの代わりに案内を出す。**
  ```
     この組織はまだ GitHub に接続されていません。
     [ 外部連携をひらく → ]        ← canAccessAdminSettings のときだけ表示
  ```
  権限が無い人には「管理者に GitHub 連携の設定を依頼してください。」だけを出す。
- 表示は `canAccessAdminSettings` または PM 相当（このダイアログを開ける人）に限る。

## 8-7. 文言一覧（空・読み込み・エラー）

| 場面 | 文言 |
|---|---|
| 読み込み中 | 既存の `PageLoader` を使用 |
| PRが0件 | オープンなプルリクエストはありません。 |
| Issueが0件 | オープンな Issue はありません。 |
| ブランチが1件（既定のみ） | 既定ブランチ以外のブランチはありません。 |
| 権限なしでURL直打ち | `NotFoundView kind="no-permission" label="GitHub"`（＋「GitHubの閲覧権限が付与されていません。管理者にご相談ください。」） |
| 接続が切れた | GitHub との接続が解除されています。管理者に再接続を依頼してください。 |
| レート制限 | GitHub のリクエスト上限に達しました。しばらく待ってから「更新」を押してください。 |
| リポジトリが見つからない | リポジトリにアクセスできません。GitHub 側で Dev Ticket の許可対象から外れた可能性があります。 |
| マージ失敗（保護） | ブランチ保護の条件を満たしていないためマージできません（必須レビューまたは必須チェック）。 |
| マージ失敗（競合） | コンフリクトがあるためマージできません。GitHub 上で解消してください。 |
| マージ失敗（その他） | マージに失敗しました。時間をおいて再度お試しください。 |
| 権限不足（App の宣言／12-1 の①） | マージに必要な Contents（Read & write）が GitHub App 側に設定されていません。インストール画面での承認では直りません。App の所有者が GitHub の App 設定で権限を追加し、そのうえでインストール画面の更新を承認する必要があります。＋「App の権限設定をひらく」 |
| 権限不足（承認待ち／12-1 の②） | マージに必要な Contents（Read & write）の権限更新が、まだ承認されていません。管理者が GitHub のインストール画面で権限の更新を承認すると使えるようになります。＋「インストール設定をひらく」 |
| 権限は足りているのに 403 | GitHub 側でマージが拒否されました。App の権限は足りているため、リポジトリのブランチ保護やルールセットの設定をご確認ください。 |

## 9. GitHub 上の名義と監査

マージは **App（bot）名義**で実行され、GitHub の履歴には `Dev Ticket[bot] merged this` と残る。
これは⑤（GitHubアカウントを持たない人にも使わせる）と⑥（Dev Ticket の権限で制御する）を
両立させるための帰結。「誰がやったか」は次の2箇所で担保する。

1. マージコミットのメッセージ末尾に実行者を明記
   ```
   Merged via Dev Ticket by 溝口 雅登 (mizoguchi_masato@meece.io)
   ```
2. `github_action_logs` に Dev Ticket ユーザーIDで記録

### 将来オプション: 本人名義

GitHub App は user access token も発行できるため、「自分の GitHub を接続済みの人は本人名義で
マージする」という上乗せは後から追加できる。**ゲートは `githubPermission` のまま**で名義だけが変わる。
初期リリースには含めない。

## 10. 追加・変更ファイル一覧

### 新規

| ファイル | 内容 |
|---|---|
| `supabase/add_github_integration.sql` | 3テーブル＋projectsカラム＋RLS |
| `api/_lib/githubApp.ts` | App JWT / installation token / API ラッパ |
| `api/github-install-start.ts` | インストール開始 |
| `api/github-install-callback.ts` | installation_id 保存 |
| `api/github/[resource].ts` | 読み書きAPI本体（権限判定を含む） |
| `src/app/lib/github.ts` | フロント側APIクライアント・型・WBS抽出 |
| `src/app/pages/GithubPage.tsx` | プロジェクト内 GitHub タブ |
| `src/app/components/github/PullRequestList.tsx` | PR一覧・詳細パネル |
| `src/app/components/github/MergeConfirmDialog.tsx` | マージ確認 |
| `src/app/components/github/TicketPrSection.tsx` | チケット詳細の関連PR |
| `src/app/components/github/GithubSetupSteps.tsx` | ①②③ ステップインジケータ |
| `src/app/components/settings/GithubIntegrationSetting.tsx` | 接続設定（8-1 の全状態） |

### 変更

| ファイル | 変更 |
|---|---|
| [types.ts](../src/app/types.ts) | `GithubAccessLevel` / `githubPermission` / `TicketGithubLink` |
| [AuthContext.tsx](../src/app/contexts/AuthContext.tsx) | 既定値と owner / admin / PM の解決 |
| [PermissionsPage.tsx](../src/app/pages/PermissionsPage.tsx) | GitHub 権限ブロック（グループ・個人の両モーダル）＋一覧チップ |
| [ProjectSubNav.tsx](../src/app/components/layout/ProjectSubNav.tsx) | GitHub タブ |
| [AppRoutes.tsx](../src/app/components/layout/AppRoutes.tsx) | `/:projectSlug/github` |
| [AdminSettingsPage.tsx](../src/app/pages/AdminSettingsPage.tsx) | 「GitHub連携」タブ、見出しを「外部連携」に改称 |
| [TicketDetailPanel.tsx](../src/app/components/tickets/TicketDetailPanel.tsx) | 関連PRセクション |
| [ProjectSettingsDialog.tsx](../src/app/components/projects/ProjectSettingsDialog.tsx) | 環境メモの上にリポジトリ選択欄（8-6） |
| [SprintPage.tsx](../src/app/pages/SprintPage.tsx) ほか | `githubPermission` を ProjectSubNav へ渡す |

## 11. リスクと対策

| リスク | 対策 |
|---|---|
| マージは取り消しが難しい | 確認ダイアログ必須／`clean` 以外は無効化／サーバーで権限再判定／監査ログ |
| Private リポジトリの情報が GitHub 権限の無い人に見える | **意図した仕様**。既定を `none` にし、明示的に付与した人だけに限定する |
| API レート制限（installation あたり時間5,000回） | 一覧はページ内キャッシュ＋手動更新。ポーリングしない |
| 秘密鍵の流出 | Vercel 環境変数のみ。`VITE_` 接頭辞を付けない。フロントには一切出さない |
| 権限キー追加で既存メンバーの権限が壊れる | 追加のみ。未設定は `none` にフォールバック |
| 接続作業で詰まる | 8-1 の説明・ステップ表示・管理者権限の注記で吸収する |
| プランによる出し分け | `plan.featureGithub`（新規）で組織単位に無効化できるようにする |

## 12. GitHub App の作成と環境変数（1回だけ）

必要な権限（Repository permissions）:

| 権限 | レベル | 用途 |
|---|---|---|
| Metadata | Read | 必須 |
| Pull requests | **Read & write** | PR閲覧・マージ・レビュー・コメント |
| Contents | **Read & write** | コミット・ブランチ一覧／**マージ** |
| Issues | Read | Issue一覧 |
| Checks | Read | CI状態の表示 |

> **Contents は Read では足りない。**
> マージ（`PUT /repos/{owner}/{repo}/pulls/{n}/merge`）は「マージ先ブランチに commit を積む」書き込み操作なので、
> `Contents: Read & write` が必要。Read のままだと GitHub は `403 Resource not accessible by integration` を返し、
> **PRの閲覧・作成は通るのにマージだけが必ず失敗する**（原因が分かりにくい壊れ方をする）。
>
> App 側の権限を変えても、**インストール側が更新を承認するまで反映されない**。

### 12-1. 権限不足は2段ある（同じ失敗を繰り返さないための切り分け）

`403 Resource not accessible by integration` の原因は2つあり、**直しに行く画面が違う**。

| 段 | 状態 | 直す場所 | 承認で直るか |
|---|---|---|---|
| ① App の宣言 | GitHub App 設定の Repository permissions が足りない | `https://github.com/settings/apps/{slug}/permissions`（Appの所有者のみ） | **直らない** |
| ② インストールの承認 | 宣言は足りているが、インストール側が更新を承認していない | インストール設定画面（組織/個人の管理者） | 直る |

**①を②として案内すると、案内どおりに操作しても直らず、同じ失敗を延々と繰り返す。**
実際 BRU13-018 までの間、①が原因なのに「承認を依頼してください」とだけ出していたため、
まとめてマージが4件全滅する事象が複数回発生した。

そのため実装では次のようにしている。

- `permissionBlock(installationId, operation)` が **App の宣言（`GET /app`）→ インストール（`GET /app/installations/{id}`）の順**に見て、
  どちらが原因か（`scope: "app" | "install"`）と**直し先のURL**まで確定させる。
- **実行前に止める**。`merge` / `merge-bulk` / `create-pull` / `review` は GitHub を叩く前に `assertPermitted()` を通す。
  まとめてマージは1件目を叩く前に止まるので、**全件が同じ理由で失敗する結果画面を出さない**。
- **一覧を開いた時点で知らせる**。`GET /api/github/pulls` が `writeBlock` を返し、
  GitHubタブの先頭に理由と直し先リンクを出したうえで、マージ・PR作成のボタンを押せなくする。
- **承認直後の取り違えを防ぐ**。installation token は最大1時間キャッシュしているため、
  権限を承認した直後は「権限は足りているのにトークンが古い」状態が起こり得る。
  403 のときだけトークンを捨てて取り直し、**一度だけ**やり直す（403 は実行されていないので二重マージにならない）。
- `GET /api/github/status` は `missingPermissions` に加えて `permissionScope` と `appPermissionsUrl` を返し、
  外部連携の画面が①と②で別の文言・別のリンクを出す。

必要権限の定義は `REQUIRED_PERMISSIONS` / `OPERATION_NEEDS`（`api/github/[resource].ts`）が唯一の出どころ。
上の表を変えるときは必ずここも合わせる。

Vercel の環境変数:

| 変数 | 内容 |
|---|---|
| `GITHUB_APP_ID` | App ID |
| `GITHUB_APP_SLUG` | インストールURLに使う App のスラッグ |
| `GITHUB_APP_PRIVATE_KEY` | PEM 秘密鍵。改行そのまま／`\n` エスケープ／base64 のいずれでも可 |
| `GITHUB_APP_PRIVATE_KEY_BASE64` | 上の代わりに使える。PEM 全体を base64 にした1行。**改行が壊れる環境ではこちらが確実**（設定されていればこちらが優先される） |
| `GITHUB_APP_VISIBILITY` | `private` または `public`（既定 `public`）。**画面の文言だけ**を切り替える |
| `PUBLIC_URL` | 既存。コールバックURLの組み立てに使用 |

App 側の設定:
- `Setup URL` = `{PUBLIC_URL}/api/github-install-callback`、"Redirect on update" を有効
- Webhook は使わないので無効
- 公開設定は Private / Public のどちらでもよい。決めたら `GITHUB_APP_VISIBILITY` を合わせる
  （後から変更しても、環境変数を切り替えるだけで画面が追従する）

## 13. 将来拡張（今回は入れない）

- Webhook（`pull_request` / `push`）による紐付けとステータスの即時同期
- 本人名義でのマージ（user access token）
- マージをトリガーにしたチケットステータスの自動遷移
- マージ後のブランチ削除
- コード差分・行コメントの表示
