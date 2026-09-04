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
   │  ③ github_installations（組織×GitHubアカウント）
   │      → リポジトリの owner と一致するアカウントの installation_id
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

### 4-1. 接続するGitHubアカウントは複数持てる（BRU14-014）

当初は `github_installations` の主キーが `organization_id` で、1組織につき
GitHubアカウントを**1つ**しか接続できなかった。これが2つの問題を生んでいた。

1. **他のメンバーが「リポジトリを追加・変更」を押すと GitHub が 404 を返す。**
   リンク先の `https://github.com/settings/installations/<id>` は、そのインストールを
   持っている**本人の**設定画面（Organization なら `.../organizations/<login>/settings/...`
   でそのオーナーだけ）で、他のユーザーが開けば当然 404 になる。
2. 別のアカウントや別の Organization にあるリポジトリを紐付ける手段が無かった。

そこで主キーを `(organization_id, installation_id)` に広げ、1組織に
複数のアカウントを接続できるようにした（`supabase/add_github_multi_accounts_BRU14-014.sql`）。

**どのインストールを使うかは、リポジトリの owner で決まる。**
GitHub App のインストールはアカウント単位で、アクセスできるのはそのアカウントが
所有するリポジトリだけなので、`owner/name` の owner と `account_login` を突き合わせれば
一意に決まる（`getInstallationId(sb, orgId, repo)`）。プロジェクト側に
インストールIDを持たせる必要はない。

画面側の導線も変えている。

| 操作 | 遷移先 | 誰が開けるか |
|---|---|---|
| GitHubアカウントを追加 / リポジトリを追加・変更 | `/apps/{slug}/installations/new`（`install-start` 経由） | **誰でも**。その人が管理できるアカウントだけが並ぶ |
| GitHub の設定画面を直接ひらく（副次リンク） | `/settings/installations/<id>` | そのアカウントを管理できる人だけ |

前者を既定の導線にしたことで 404 が起きなくなり、同時に
「自分のアカウントを新しく足す」も同じボタンから行えるようになっている。
後者は残しているが、**開ける人を明記した注意書きを必ず添える**こと。

切断（`/api/github/disconnect`）はアカウント単位で行う。解除したアカウントの
リポジトリを見ていたプロジェクトだけ `github_enabled` を落とし、他のアカウントの
プロジェクトはそのまま使える状態を保つ。
なお `github_installations` には service_role 以外の書き込みポリシーが無いため、
**ブラウザから直接 delete しても1行も消えない**（必ずAPI経由で行うこと）。

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
| [AuthContext.tsx:67-76](../src/app/contexts/AuthContext.tsx#L67-L76) | admin / project-manager の fallback は `"none"`（BRU13-034 で `"merge"` から変更） |
| [ProjectSubNav.tsx:10](../src/app/components/layout/ProjectSubNav.tsx#L10) | `{ id: "github", label: "GitHub", icon: Github, path: "/github", permKey: "github" }` |

**DBマイグレーションは不要**（`permissions` は jsonb でキーが増えるだけ）。
`roles.base_permissions` に無いキーは `DEFAULT_PERMISSIONS` 側の `"none"` が効く。

### 5-3. 既定は「誰にも見えない」

未設定のメンバーは全員 `none`。導入直後は **owner 以外の全員**に GitHub タブが出ない。
これは意図した挙動（見せたくない人がいる、という要望への安全側の既定）。

**admin / project-manager も例外にしない（BRU13-034）。** 当初は他のページ権限に合わせて
admin / PM を暗黙で `merge` にしていたが、GitHub権限の付与はアサイン計画の画面だけで行う
決まりなので、その画面に「権限なし」と表示されている人が PR を閲覧・マージできてしまい、
表示と挙動が食い違っていた（一度「保存する」を押すとキーが入って直る、という症状）。
ロールを根拠にした暗黙の付与はサーバー・クライアントの両方から削除し、
既存レコードは [`supabase/fix_github_permission_defaults.sql`](../supabase/fix_github_permission_defaults.sql) で
`githubPermission: "none"` を明示的に埋めて揃える。
そのぶん **「なぜ見えないか」が画面から分かること**が重要になるため、7-1 と 7-3 で明示する。

### 5-4. サーバー側での再判定

`api/github/[resource].ts` は毎リクエストで service role 経由で解決する。
クライアントから渡された権限は一切信用しない。

```
1. project_member_permissions(project_id, member_id).permissions.githubPermission
2. 無ければ、そのメンバーが属する permission_groups の権限
3. 無ければ、roles.base_permissions.githubPermission
4. どれにも無ければ "none"（role が admin / PM でも例外にしない）
5. role === "owner" は常に "merge"
```

読み取り系で `"none"` なら 403、書き込み系で `"merge"` 以外なら 403。

### 5-5. 操作ごとの権限へ分割（BRU13-054）

ブランチ作成（→ 16章）を足すにあたって、1本の段階では表現できないことが分かった。
**ブランチは消せば済むが、main へのマージは戻せない。** 1つの `merge` にまとめていると
「ブランチは切らせたいがマージはさせたくない」人に渡せる権限が無く、結局マージ可を配ることになる。

そこで **操作ごとに3段階**へ分ける。値はいずれも `none` / `view` / `write`。

```ts
export type GithubActionLevel = "none" | "view" | "write";

export interface GithubPerms {
  branch: GithubActionLevel;  // ブランチの作成
  pull:   GithubActionLevel;  // プルリクエストの作成
  merge:  GithubActionLevel;  // マージ・レビュー承認・コメント投稿・紐付けの編集
}
```

jsonb 上のキーは `githubBranchPermission` / `githubPullPermission` / `githubMergePermission`。

**「閲覧」は軸ごとに分けない。** 軸ごとの閲覧ゲートを作ると「PRは見えるがマージ状況は見えない」
という破綻した組み合わせが設定できてしまう。GitHubタブを開けるかどうかは
**3軸の論理和**（1つでも `none` 以外なら見える＝`canViewGithub`）で判定する。
5-1 で「boolean 2つに分けない」とした理由はここでも生きていて、分けたのは
*できること* だけで、*見えること* は1つのままにしてある。

| 参照/実行 | 必要な権限 |
|---|---|
| GitHubタブ・参照系API全部 | 3軸のどれかが `none` 以外 |
| `create-branch` | `branch === "write"` |
| `create-pull` | `pull === "write"` |
| `merge` / `merge-bulk` / `merge-precheck` / `review` / `comment` / `link` / `unlink` / `resolve-candidate` / `backfill-links` | `merge === "write"` |

解決の順序（① 個別 → ② グループ → ③ ロール既定 → 全部 `none`、owner は常に全権）は
5-4 のまま。**その階層に GitHub 権限が書かれていたら、そこで確定させる**（軸ごとに別々の
階層から拾わない）のも従来どおり。軸ごとに拾うと、個別で明示的に外した権限が
グループ経由で復活してしまう。

**旧 `githubPermission` は消さない。** 移行SQL
[`supabase/add_github_split_permissions.sql`](../supabase/add_github_split_permissions.sql) が
`merge → 3軸とも write` / `view → 3軸とも view` / それ以外 → 全部 `none` で新キーを埋め、
以後も書き込みのたびに旧キーを同じ内容へ揃える（`githubPermsToJson`）。
SQL未適用の環境から読んでも結論が変わらないようにするため。
応答の `level` も従来どおり返し続ける（`toLegacyLevel`：`merge === "write"` なら `"merge"`、
見えるなら `"view"`、それ以外 `"none"`）ので、`level === "merge"` を見ていた既存の画面は
そのまま正しく動く。

**既定値（`DEFAULT_PERMISSIONS` / `DEFAULT_GROUP_PERMS`）に新キーを足してはいけない。**
既定値は保存済みの権限より先に spread される（`{ ...DEFAULT, ...row.permissions }`）ため、
新キーを既定に置くと、**旧キーしか持っていない行に `none` の新キーが被さる**。
`githubPermsFrom` はそれを「新形式で全部 none」と読むので、付与済みの権限が
画面上「権限なし」に見え、そのまま保存すると本当に消える。既定は旧キー1つだけにしておくこと。

この食い違い（3軸とも `none` なのに旧キーが `none` でない）は正規の書き込み経路では
作れないので、読み取り側で検出したら旧キーを正として扱い、自動的に元へ戻す。

判定は3か所に同じものを置く。片方だけ直すとずれるので必ず両方直すこと。

| ファイル | 役割 |
|---|---|
| [src/app/lib/githubPerms.ts](../src/app/lib/githubPerms.ts) | クライアント側の読み取り・合成（AuthContext / useGithubAccess / PermissionsPage / GithubIntegrationSetting が共用） |
| [api/github/\[resource\].ts](../api/github/[resource].ts) の `resolveGithubPerms` | サーバー側。単体で動く決まりなので同じ判定を持つ |

## 6. データモデル

`supabase/add_github_integration.sql`（新規）

```sql
-- Ⅱ. インストール（GitHubアカウントごとに1行。1組織が複数持てる → 4-1）
create table if not exists github_installations (
  organization_id   text not null,                 -- Dev Ticket の組織
  installation_id   text not null,
  primary key (organization_id, installation_id),  -- BRU14-014 で organization_id 単独から拡張
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

> **注意（BRU13-041）**: 「マージ済み＝リリース済み」はデプロイの成否を見ていない。
> デプロイがブロックされていても、この判定はチケットを「リリース済み」に進めてしまう。
> 本番への反映まで確認する設定は [本番反映の確認 設計書](./deploy-verification-design.md) を参照。

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

### 7-3. マージ前のコンフリクトチェック（BRU13-038）

**マージは、1件でも「マージできない状態」があれば1件も実行しない。**

以前は「1件ずつ順番に実行し、途中で失敗しても残りは続行する」だった。
4件まとめてマージして2件がコンフリクトで失敗すると、残り2件は入った状態になり、
コンフリクトを直すときに「入った側の変更」と「残った側の変更」が混ざって取り漏れが出た
（実際に発生した）。

そのため次の手順に変えている。

| 手順 | 内容 |
|---|---|
| ① 単独のマージ可否 | 対象の全件を `POST /api/github/merge-precheck` で確認。1件でも通らなければ**ここで止める** |
| ② 試しマージ | 捨てブランチへ実際の順番どおりに積む（7-4）。1件でも通らなければ**ここで止める** |
| ③ マージ | 全件通った場合だけ実行。1件ずつ順番に |
| ④ 一覧の更新 | 実行後に取り直す |

**ユーザーの操作は「まとめてマージ」を1回押すだけ**で、①〜④はその中で完結する。
①は画面から `merge-precheck` を呼び、②〜③はサーバーの `merge-bulk` の中で走る。

- **1件だけのマージも同じ手順を通る**（`MergeConfirmDialog`）。まとめてマージだけ厳しくすると、
  1件ずつ押した場合に同じ事故が起きる。
- **進捗表示の1段目がコンフリクトチェック**。押してから初めて理由が出る状態にしない。
- 判定は `mergeBlockReasonOf()`（サーバー）と `mergeBlockReason()`（画面）で揃える。
  7-2 の表で無効になるものは、すべてチェックで止める対象。
- `unknown`（GitHub 側で計算中）も**通さない**。分からないまま実行すると、
  途中でコンフリクトに当たって一部だけ入った状態になる。決まるまで数回引き直し
  （`MERGEABLE_POLL_MS`）、それでも決まらなければ「判定中」として止める。
  ただし**まとめてマージの実行ループだけは `unknown` で止めない**（7-4）。
- **チェックを通ったあとに失敗した場合も、そこで打ち切って残りは実行しない**。
  前のマージでベースが動いた影響が濃く、続けるほど混ざるため。
  未実行になった分は結果画面で「未実行」（失敗とは別）として出す。
- 画面で確認してから押すまでの間に状態が変わることがあるため、
  **`merge` / `merge-bulk` はサーバー側で必ず同じチェックをやり直す**。
  止めた場合は 409 とともに `precheck`（どのPRがなぜ止まったか）を返す。

### 7-4. 試しマージ（BRU13-042）

**7-3 の①だけでは足りない。** GitHub の `mergeable` は「**今の**マージ先の先端に対して」
しか計算されない。まとめてマージは1件入れるたびにマージ先が進むため、押した時点で
全件 clean でも、2件目以降がコンフリクトになることがある。実際に「1件マージ成功 →
次がコンフリクト」で止まり、一部だけ入った状態が発生した。

これは何回聞いても分からないので、**実際に同じ順番で積んでみる**。

| | 内容 |
|---|---|
| どこで | `handleMergeBulk` の中（本番のマージへ進む前） |
| どこに積む | `dev-ticket/merge-trial/<ランダム>` という使い捨てブランチ。マージ先の先端から作り、**必ず消す**（`finally`） |
| 何を | 選ばれた順に `POST /repos/{repo}/merges`。409 が返った時点で打ち切る |
| 失敗したら | **1件もマージしない。** 本番のマージ先には一度も触っていないので、戻す作業が発生しない |

- **squash / rebase は形を合わせる。** どちらも「PRのブランチとのつながりを残さず中身だけ
  載せる」方式なので、試しマージの結果（本物のマージコミット）をそのまま積むとつながりが
  残り、後続が実際より通りやすくなる。マージ結果の**ツリーだけを引き継いだ親1つのコミット**
  に置き換えて先端を進める（`flattenTrialTip`）。`merge` 方式のときはそのまま。
- **マージ先ごとに分ける。** マージ先が違うPR同士は互いに影響しないので、1本の捨てブランチに
  まとめて積むと実際と違う結果になる。
- **要らないときは作らない。** 対象が1件のとき、および**変更ファイルが1つも重ならない**とき
  （`needsTrial`）は順番で結果が変わらないので、捨てブランチを作らずに飛ばす。
  ファイル一覧を取り切れなかった場合は「重ならない」と言い切れないので**試す側に倒す**。
- **時間で打ち切る。** 関数の上限は 60 秒（`vercel.json`）。試しマージには `TRIAL_BUDGET_MS`
  までしか使わず、使い切ったら「確認しきれなかった」として1件もマージしない。
  **確認できていないものを通す方向には倒さない。**
- **試している間にマージ先が動いていたら中止する。** 試した結果が当てにならないため、
  先端の SHA を控えておき、実行に移る直前に見比べる。
- **通ったあとの実行ループでは `unknown` で止めない。** 中身が衝突しないことは捨てブランチで
  確かめてあり、`unknown` は GitHub 側の再計算が追いついていないだけ。ここで失敗にすると
  直す必要の無いものを直しに行かせてしまう（実際に「判定中です」で失敗した）。
  本当にマージできなければマージ API 自体が理由を返すので、判断はそちらに任せる。
- 失敗したときは 409 の `precheck` に `trial: true` と `conflictAfter`（**どのPRを入れた
  あとで通らなくなったか**）を載せる。画面はこれを見て「単独では通るが、この順番では
  通らない」と言い分ける（`MergePrecheckNotice`）。
- 捨てブランチは `refs/heads/` に一瞬だけ現れる。`on: push` にブランチの絞り込みが無い
  リポジトリでは短命な CI が起動しうるので、`dev-ticket/merge-trial/**` を除外設定に
  入れてもらう。

#### 途中経過の見せ方

①〜③はサーバー側の1リクエストで通しで走るため、応答が返るまでクライアントには何も届かない。
数十秒「マージ中...」とだけ出ていると、**待つべきなのか壊れているのかが判断できない**。

そこで実行の記録（`github_action_runs`）に `progress` 列を足し、サーバーが段ごとに現在地を書く
（`supabase/add_github_action_run_progress.sql`）。

```json
{ "step": "trial", "done": 3, "total": 7, "current": 51 }
```

- 画面は実行IDを**先に作って**送り（`newRunId()` → `mergePullsBulk(..., runId)`）、
  待っている間 1.5 秒おきに引く（`fetchRunProgress`）。
- 進捗の行は「単独のマージ可否 → 試しマージ → マージ → 一覧の更新」の4段。
  現在地より手前を完了、その先を待機として出す。
- **試しマージを省いたときは「不要でした」と出す**（`trialSkipped`）。黙って完了にすると、
  試したのか試していないのかが後から分からない。
- 閉じたあとに開き直した場合の進捗モーダル（`GithubRunOverlay`）にも同じ現在地を出す。
- 途中経過は補助。`progress` 列が未適用でも引けないだけで、マージ自体は従来どおり動く
  （`GithubRunOverlay` は列込みの select が失敗したら列を外して引き直す）。

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

**BRU13-054 で操作ごとの3行になった**（5-5）。並びは取り返しのつく順。

```
┌─ GitHub連携 ─────────────────────────────────────────────────────────┐
│                                                                       │
│   ブランチ作成                              [ 作成可          ▾ ]     │
│   チケットやGitHub画面からブランチを作成できます。作成したブランチは、  │
│   名前に関係なくチケットへ紐付きます。                                 │
│                                                                       │
│   プルリクエスト作成                        [ 作成可          ▾ ]     │
│   Dev Ticketからプルリクエストを作成できます。マージはできません。      │
│                                                                       │
│   マージ                                    [ 閲覧のみ        ▾ ]     │
│   マージ可否やCIの状況を閲覧できます。マージはできません。             │
│                                                                       │
│   GitHubタブが表示されます（3つのうち1つでも「権限なし」以外なら表示）。│
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

各行の選択肢は `権限なし` / `閲覧のみ` / `作成可`（マージ行だけ `マージ可`）。
選択中の値の説明だけを直下に1行出す（3行×3説明を常時出すと他の権限ブロックより騒がしくなる）。

ブロックの最後に**GitHubタブが出るかどうか**を必ず1行で出す。
閲覧が3軸の論理和で決まる（5-5）ことは設定画面から読み取れないと分からないため。

マージ行に「マージ可」を選んだときだけ、下に警告を出す。

```
   ⚠ 「マージ可」は main ブランチへの反映を実行できる権限です。
     GitHub 側のブランチ保護（必須レビュー・必須CI）は引き続き有効ですが、
     Dev Ticket 上の操作で本番ブランチが更新されます。
```

グループ一覧のカードには、他の権限バッジと並べて `GitHub: ブランチ作成・プルリクエスト作成`
のように**「作成できる操作」を並べたチップ**を出す。1つも無ければ `GitHub: 閲覧のみ`、
3軸とも `none` ならチップ自体を出さない（`githubBadgeLabel`）。

## 8-3. プロジェクト内 GitHub タブ

`/:projectSlug/github` → `src/app/pages/GithubPage.tsx`

### 表示可否

| 条件 | 表示 |
|---|---|
| GitHub権限が3軸とも `none`（＝`level === "none"`） | タブ自体を出さない。URL直打ちは `NotFoundView kind="no-permission" label="GitHub"` |
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
- 実行中はボタンを「マージ中...」にして**閉じる手段を全部塞ぐ**（×・ESC・背景クリック・タブを閉じる／15章）。
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

BRU13-054 で追加したもの（5-5・16章）:

| ファイル | 内容 |
|---|---|
| `supabase/add_github_split_permissions.sql` | GitHub権限を操作ごとの3キーへ展開する移行 |
| `supabase/add_ticket_github_branches.sql` | ブランチ↔チケットの紐付けテーブル＋RLS |
| `src/app/lib/githubPerms.ts` | 操作ごと権限の読み取り・合成（クライアント側の唯一の実装） |
| `src/app/components/github/CreateBranchDialog.tsx` | ブランチ作成ダイアログ・名前の初期値と妥当性判定 |

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

任意（無くても動くが、あるとデプロイの事故を検知できる。
→ [本番反映の確認 設計書](./deploy-verification-design.md)）:

| 権限 | レベル | 用途 |
|---|---|---|
| Commit statuses | Read | **Vercel の「Deployment was blocked」の検知**。これが無いと `check-runs` にしか出ない情報しか見えず、失敗ですらなく「チェックなし」に見える |
| Deployments | Read | 本番デプロイの成否・環境ごとの状態 |

> 任意の権限は `OPTIONAL_PERMISSIONS`（`api/github/[resource].ts`）で管理し、
> 不足していても操作は止めない。代わりに `checkUnavailable` に情報源名を入れ、
> 画面に「確認できていません」と出す。**「チェックなし」を「問題なし」と読ませないため。**

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

- 本人名義でのマージ（user access token）
- マージ後のブランチ削除
- コード差分・行コメントの表示

実装済みになったもの:

- Webhook（`pull_request`）による紐付けとステータスの即時同期（7章）
- マージをトリガーにしたチケットステータスの自動遷移（`sync-released`）
- **本番へ反映されたかの確認 → [本番反映の確認 設計書](./deploy-verification-design.md)（BRU13-041）**

## 14. 「マージ済み」と「本番反映済み」は別（BRU13-041）

本設計では長らく「PRが既定ブランチへマージされた＝リリース済み」としてきた。
**この割り切りが原因で、11コミットが11日間気づかれずに本番へ届かない事故が起きた。**

デプロイがブロックされていても GitHub 上のマージは成功するため、
マージの成否からは区別が付かない。判定は
[本番反映の確認 設計書](./deploy-verification-design.md) に分離し、本書の判定は
「確認しない（`deploy_check_mode = off`）」ときの既定動作として残している。

- マージの入口で失敗チェックを見る（層A）… `require_checks_mode`
- 本番に届くまで「リリース済み」にしない（層B）… `deploy_check_mode = gate`
- 反映の遅れを観測して知らせる（層C）… 既存 cron に相乗り
- 未保護・未設定を診断する（層D）… 外部連携画面の⑤

## 15. 実行中は何もさせない・閉じても引き継ぐ（BRU13-045）

### 15-1. 何が問題だったか

マージ・PR作成の実行中は「作成する」「キャンセル」を非活性にしていたが、
**ダイアログ右上の×ボタンだけは押せる見た目のまま**だった。
実際には `onClose` に空関数を渡してあり押しても何も起きないのだが、
押したら処理が止まるのかどうかが画面から読み取れず、怖くて触れない状態だった。

さらに「タブを閉じたら処理はどうなるのか」も画面のどこにも書かれていなかった。

### 15-2. 閉じても処理は止まらない

マージもPR作成も、GitHubの呼び出し・監査ログ・リリース反映（`syncReleasesNow`）まで
**すべてサーバー側の1リクエストの中で完結している**。クライアントが切断されても
関数の実行は止まらないため、タブやブラウザを閉じても処理は最後まで走り切る。
止まるのは「画面の一覧の取り直し」だけで、データが中途半端に残ることはない。

問題は、そのことを画面から確かめる手段が無かったこと。
`github_action_logs` は**終わったことしか書かない**ので、開き直した画面からは
「まだ実行中」と「もう終わった」を見分けられなかった。

### 15-3. 実行中は閉じる手段を全部塞ぐ

[DialogShell](../src/app/components/shared/DialogShell.tsx) に `busy` を追加し、
マージ確認・まとめてマージ・PR作成の3つが実行中に立てる。

| 閉じ方 | busy のときの扱い |
| --- | --- |
| ×ボタン | `disabled`。押せないことが見た目にも出る（薄い枠・not-allowed・ホバー無効） |
| ESC | `escStack` には**空関数を積む**。積まないと下のダイアログや一覧の閉じる処理に届いてしまう |
| 背景クリック | `onClick` を外す |
| キャンセル | 従来どおり `disabled` |
| タブ・ウィンドウを閉じる | `beforeunload` で引き止める |

`onClose={busy ? () => {} : onClose}` という渡し方はやめ、`onClose` はそのまま渡して
`busy` で判断させる（毎レンダーで別の関数が積まれ直すのも同時に解消する）。

### 15-4. 閉じたあとの引き継ぎ（`github_action_runs`）

開始時に `running` の行を1つ置き、終わったら結果ごと `done` / `error` へ書き換える
（[add_github_action_runs.sql](../supabase/add_github_action_runs.sql)）。

```
画面                        サーバー                     github_action_runs
 │ runId を作って送る ──────▶ insert(state=running) ────▶ running
 │                            GitHub へマージ
 ×（タブを閉じる）            リリース反映
 │                            update(state=done) ───────▶ done
 │
 │ 開き直してログイン
 │ actor_id = 自分 かつ running を1件引く ◀──────────────┘
 │ → 進捗モーダルを強制表示、2秒ごとに引き直して結果まで見届ける
```

- 引くのは**ユーザーID**なので、別のPC・別のブラウザから開き直しても復帰する。
- 探すのは[GithubRunOverlay](../src/app/components/github/GithubRunOverlay.tsx)。
  アプリ最上位に1つだけ置き、**ログインが済んだ時点で1回だけ**探す。
  そのタブがこれから始める実行はまだ記録されていないので、
  ここで拾うのは「前に閉じた（あるいは再読み込みした）ときに走っていたもの」だけになる。
- 復帰したモーダルも実行中は閉じられない（ESCも効かない）。
  終わったら結果を出し、「GitHubの画面をひらく」で最新の一覧へ戻す。
- **90秒**（`vercel.json` の `maxDuration` 60秒＋余裕）を過ぎても `running` のままなら、
  関数が打ち切られたということ。「結果を確認できませんでした」と正直に出し、
  GitHub 側での確認を促す。勝手に成功扱いにも失敗扱いにもしない。
- 記録用の表がまだ適用されていない環境では、`insert` が失敗した時点で
  記録なしのまま実行を続ける。**記録の有無で実行の可否は変えない**。
- 記録は復帰にしか使わないので、実行者本人の24時間より古い行は都度消す。

## 16. ブランチの作成（BRU13-054）

### 16-1. 何が問題だったか

チケットとPRの紐付けは、**ブランチ名／PRタイトルに書かれた WBS 番号を正規表現で拾う**ことだけで
成り立っていた（`detectWbs`）。つまり紐付きの根拠が「人が付けた名前」しかない。

そのため、命名を外したブランチ（`fix-bug`、`tmp2` など）は
**紐付き候補にすら出てこない**。しかも後から直す手段が無く、
PRを手で紐付けるまで「リリース待ちなのにPRが無い」の赤アラートが消えない。

「ブランチ名を厳密に守らせる」で解くこともできるが、それは運用の負担を増やすだけで、
守り忘れた1本は結局そのまま取り残される。

### 16-2. 方針：紐付きの根拠を名前から切り離す

**Dev Ticket からブランチを作った時点で「このブランチはこのチケットのもの」をDBに残す。**
名前は完全に自由でよくなる。名前は人が読むためのもので、機械の紐付けには使わない。

```
supabase/add_ticket_github_branches.sql
  ticket_github_branches(project_id, ticket_id, repo, branch_name, base_branch, created_by, ...)
  unique (project_id, repo, branch_name)
```

`ticket_github_links` とは別テーブルにする。あちらは `kind in ('pull','issue')` と
`number`（整数）が前提で、番号を持たないブランチは構造的に入らない。

`repo` を持つのは、プロジェクトのリポジトリを別のものへ張り替えたときに
旧リポジトリの同名ブランチへ誤って紐付けないため。

### 16-3. PRへの伝わり方

```
ブランチ作成（create-branch）
  └─ ticket_github_branches に1行
        │
        ▼
そのブランチから出たPR（画面から作成 / GitHub側で作成 → webhook / 一覧取得 / 穴埋め）
  └─ autoLink()
       ├─ linkByBranch()  ← head ブランチ名でDBを引き、当たればそのチケットへ紐付ける
       └─ 従来のWBS判定    ← 名前から拾えたときだけ
```

`linkByBranch` は `autoLink` の**先頭**に置く。WBS が1件も拾えないPR
（＝まさに命名を外したブランチ）でもここまでは必ず通す必要があるため、
`wbsList` が空のときの早期 return より前に呼ぶ。

DBに残した事実なので綴り違いの候補出し（`ticket_github_link_candidates`）には回さず、
そのまま紐付ける。手で外した紐付け（`auto_linked = false`）を上書きしないのはWBS側と同じ。

`pending-branches` も同じ経路で恩恵を受ける。
- 一覧の注記は、名前から拾ったWBSより**DBの紐付けを優先**する
- チケット詳細からの呼び出しは `wbs` で名前を絞っていたので、
  そのままだと名前に番号が無いブランチが落ちる。`ticketId` も渡し、
  **名前一致 または DB紐付け**で残すようにした

### 16-4. ブランチ名

**自由。** ただし空欄から書かせると毎回タイプすることになるので、
チケット詳細から開いたときだけ初期値を入れる。

```
{project.slug}/{ticket.wbs}     例: DEVTICKET/BRU13-054
```

これまで運用してきた形そのままで、`slug` は URL の第1セグメント（＝プロジェクト識別子）。
入力欄は開いた時点で全選択状態にしてあり、そのまま打てば置き換わる。

名前の妥当性は `git check-ref-format` 相当の規則で判定する
（空白・`~ ^ : ? * [ \`・制御文字・`..`・`@{`・先頭末尾の `/`・末尾の `.` / `.lock` など）。
GitHub に投げれば 422 は返るが理由が英語1行で分からないので、
**サーバー・画面の両方に同じ判定を置き、日本語の理由まで出す**。画面側は入力中に出す。

### 16-5. サーバー

```
POST /api/github/create-branch  { projectId, name, base?, ticketId? }
  1. projectContext(..., "branch")            … githubBranchPermission = write
  2. assertPermitted(..., "create-branch")    … App権限 Contents: Read & write
  3. GET  /repos/{repo}/git/ref/heads/{base}  … 分岐元の先端 sha
  4. POST /repos/{repo}/git/refs              … refs/heads/{name} を作る
  5. github_action_logs に create_branch を残す
  6. ticketId があれば ticket_github_branches に upsert
```

- `base` 未指定なら GitHub 側の現在の既定ブランチ。プロジェクト設定の値より現在値を優先する。
- 422 は 409 に訳す（`already exists` → 「すでに存在します」）。
- **実行の記録（`github_action_runs`）は付けない。** 15章の対象は「取り消しの効かない操作」で、
  ブランチ作成は数百ミリ秒で終わり、失敗しても作り直せる。
- 紐付けの `upsert` に失敗してもブランチ自体は出来ているので、
  **作成は成功として返す**（応答の `linked` で伝える）。

`GET /api/github/ticket-branches?projectId=&ticketId=` は紐付けを読むだけ（GitHubを叩かない）。
`ticketId` 無しならプロジェクト全体を返し、チケットのWBS・タイトルを添える。

### 16-6. 画面

| 場所 | 出るもの |
|---|---|
| GitHubタブ → ブランチ | ヘッダに「ブランチを作成」（`branch === "write"`）。一覧の各行に、紐付いたチケットのWBSとタイトル |
| チケット詳細 → 関連PR | ヘッダに「ブランチを作成」（同上）。本文の上に「このチケットのブランチ」（名前・分岐元・名前のコピー） |

ブランチ一覧に紐付いたチケットを出すのは、**名前を自由にした以上、名前だけでは
何のブランチか分からなくなるから**。自由にした代償はここで払う。

「PRを作成」ボタンの条件は `merge === "write"` から `pull === "write"` へ変わった（5-5）。
