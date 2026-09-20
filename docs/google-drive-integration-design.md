# Googleドライブ連携（ファイルボックス）設計書

作成日: 2026-09-20
ステータス: **設計のみ**（未実装。Google Cloud 側の準備が完了するまで着手できない）

> 対象: ファイルボックス画面に「Googleアプリ」ボタンを追加し、スプレッドシート／ドキュメント／
> スライドを**その場で新規作成 → 別タブで編集**できるようにする。
> 作成したファイルはファイルボックスの一覧にも並び、プロジェクトメンバーが開ける。

---

## 1. 背景・課題

ファイルボックスは Supabase Storage の非公開バケット（`project-files`）に実体を持ち、
閲覧は 60 秒の署名付きURL、編集は自前ビューア（[`ExcelEditor`](../src/app/components/files/ExcelEditor.tsx) /
[`WordEditor`](../src/app/components/files/WordEditor.tsx)）かデスクトップOfficeのWebDAV保存で行っている。

この構成は**同時編集ができない**。誰かが開いている間に別の人が保存すると、版が increment されるだけで
互いの変更は混ざらない。複数人で1つの表を同時に触りたい、という用途に応えられていない。

Googleドライブ側でファイルを作れば、同時編集・コメント・版履歴はすべてGoogleに任せられる。

### 既存方針との衝突（重要）

[`projectFiles.ts:3-5`](../src/app/lib/projectFiles.ts#L3-L5) に明示的な方針がある。

> 「ブラウザで閲覧」は全てクライアント内(自前ビューア)で完結させ、
> **Microsoft/Google などの外部ビューアには一切ファイルを渡さない。**

[`add_project_files.sql:7`](../supabase/add_project_files.sql#L7) にも「社外秘ファイルを想定するため
public = false」とある。本機能は**この方針を部分的に緩める**ものであり、無条件に有効化してはならない。
→ 決定事項 ① のとおり、**組織ごとのオプトイン**とする。

---

## 2. 決定事項

| # | 論点 | 決定 |
|---|---|---|
| ① | 有効化の単位 | **組織ごとにオプトイン**。既定はオフ。オフの組織にはボタン自体を出さない |
| ② | 認証方式 | **OAuth 2.0（リフレッシュトークン）**。サービスアカウント＋ドメイン全体の委任は、顧客ごとに顧客のWorkspace管理者の設定作業が必要でSaaSに向かないため採らない |
| ③ | スコープ | **`drive.file` のみ**。非センシティブスコープのため Google のアプリ審査・CASA が不要。`drive` / `drive.readonly` には絶対に手を伸ばさない |
| ④ | 保存先 | Workspace連携あり → **その組織の共有ドライブ**／連携なし → **作成者のマイドライブ** |
| ⑤ | 保存先の指定 | **Google Picker で「共有ドライブの中のフォルダ」を選択**。共有ドライブそのものは Picker で選択できない（⑤補足）。`drive.file` では `drives.list` / `drives.create` も使えないため、顧客側で作成済みのものを選んでもらう |
| ⑥ | フォルダ構成 | 共有ドライブ: `<選んだフォルダ>/<プロジェクト名>/`／個人ドライブ: `マイドライブ/DevTicket/<プロジェクト名>/` を**自動生成**する |
| ⑦ | 権限の配り方 | 既定は**メンバーへの個別付与**（`type:"user", role:"writer"`）。リンク共有は**ファイルごとの明示的オプトイン** |
| ⑧ | DevTicketで削除したとき | **Googleドライブ側のファイルは残す**。DevTicketの一覧から外すだけ |
| ⑨ | 同期の向き | **DevTicket → Google の一方通行**。Drive側の変更は検知しない |
| ⑩ | 個人ドライブ時の警告 | 作成前に**注意モーダル**を表示。「次回以降表示しない」を持つ |

**非対象**: 既存 .xlsx/.docx のGoogle形式への変換、Googleファイルのファイルボックスへの取り込み
（Picker で既存ファイルを選ぶ）、Drive側の変更のDevTicketへの反映、Googleファイルの版履歴表示。

---

## 3. 2つの保存モード

組織設定 `google_drive_mode` で切り替える。

| モード | 保存先 | 所有者 | メンバーへの権限 |
|---|---|---|---|
| `off`（既定） | — | — | — |
| `shared_drive` | 指定された共有ドライブ配下 `DevTicket/<プロジェクト名>/` | **組織** | 共有ドライブのメンバーは自動で見える。非メンバーには個別付与 |
| `my_drive` | 作成者のマイドライブ `DevTicket/<プロジェクト名>/` | **作成した個人** | **全員に個別付与が必須**（付与しないと誰にも見えない） |

### 3.1 `shared_drive` の権限粒度についての注意

共有ドライブは「中の特定ファイルだけ、あるメンバーから隠す」ことが**原理的にできない**。
そのため、DevTicket でそのプロジェクトにアサインされていない同じ組織のメンバーにも、
Google側では見えることがある。

現在のファイルボックスは [`can_user_access_project()`](../api/project-files/[action].ts#L71) で
プロジェクト単位に絞っているので、**Google側だけ粒度が粗くなる**。
これは仕様として受け入れ、設定画面に明記する。

将来プロジェクト単位に絞りたくなった場合は、`DevTicket/<プロジェクト名>/` フォルダを分けてあるので、
フォルダの「限定公開アクセス」または共有ドライブ自体の分割で対応できる。

### 3.2 `my_drive` の注意モーダル

`my_drive` モードの組織で「Googleアプリ」から作成しようとしたとき、**作成処理の前に**表示する。

> このプロジェクトの組織には Google Workspace が登録されていません。
> 作成したファイルは**あなた個人のGoogleドライブ**に保存され、所有者もあなたになります。
> そのGoogleアカウントが削除・無効化されると、**ファイルボックスからも開けなくなります**。ご注意ください。
>
> ☐ 次回以降表示しない
> [キャンセル] [作成する]

「次回以降表示しない」は `localStorage` に `devticket.gdrive.myDriveWarning.dismissed.<userId>` で保存する。
ユーザーIDで区切るのは、共用PCで別の人がログインしたときに引き継がれないようにするため。

---

## 4. スコープと審査

`drive.file` は **非センシティブスコープ**。アプリが作成したファイルと、ユーザーが Google Picker で
明示的に選んだファイルだけにアクセスできる。

- アプリ審査（verification）**不要**
- CASA セキュリティ評価 **不要**
- 「このアプリは確認されていません」警告 **出ない**
- 同意画面にアプリ名・ロゴを出したい場合のみ、軽量な**ブランド確認**を通す

**`drive.file` でできないこと**（＝設計上の制約）:

| できないこと | 影響 | 回避 |
|---|---|---|
| `drives.list`（共有ドライブの一覧） | 設定画面でプルダウン提示できない | **Google Picker** で選ばせる |
| `drives.create`（共有ドライブの作成） | DevTicketから用意できない | 顧客側で事前に作成してもらう |
| アプリが作っていない任意のフォルダを親に指定 | 既存フォルダへの保存ができない | **Picker で選ばせる**。選択した時点でそのフォルダがアプリから触れるようになる |

### 4.1 共有ドライブそのものは Picker で選択できない（実測）

Picker の `ViewId` に `SHARED_DRIVES` は存在せず、`DocsView(FOLDERS).setEnableDrives(true)` で
共有ドライブを一覧に出しても、**ドライブのタイルを選んだだけでは Select ボタンが有効にならない**。
共有ドライブは「中に入るための入れ物」としてしか扱えない。

そのため、選んでもらうのは **共有ドライブの中のフォルダ**とする。設定画面にもその操作を明記する。
フォルダが1つも無い共有ドライブでは選択できないため、顧客側で先にフォルダを1つ作ってもらう。

Picker が返すのは ID と名前だけなので、それが本当にフォルダか・どの共有ドライブに属するかは
サーバー側の `resolve-folder`（`files.get` で `mimeType` と `driveId` を確認）で確かめる。
マイドライブのフォルダが選ばれた場合（`driveId` が無い）は弾く。

---

## 5. 画面設計

### 5.1 ファイルボックス（[`FileBoxPage.tsx`](../src/app/pages/FileBoxPage.tsx)）

「フォルダ作成」ボタンの左隣に追加する（[`FileBoxPage.tsx:593-607`](../src/app/pages/FileBoxPage.tsx#L593-L607) の並び）。

```
[Googleアプリ ▾] [フォルダをアップロード] [フォルダ作成]
      ↓ クリックで展開
   ┌─────────────────┐
   │ 📊 スプレッドシート │
   │ 📄 ドキュメント     │
   │ 📽 スライド         │
   └─────────────────┘
```

展開メニューは `@radix-ui/react-dropdown-menu`（導入済み）を使う。

- 組織の `google_drive_mode` が `off` のときは**ボタンごと出さない**
- Googleアカウント未連携のユーザーが押したら、先にOAuthへ誘導する
- 作成先は**現在開いているフォルダ**（`currentFolderId`）。Drive側の階層には影響しない（9章）

### 5.2 一覧での見え方

Googleファイルは `project_files` の行として、通常のファイルと同じ並びに出す。

- アイコンと色は種別ごとに追加（スプレッドシート=緑／ドキュメント=青／スライド=黄）
- **サイズ・版数は出さない**（Googleファイルには存在しない）。代わりに「Googleスプレッドシート」等の種別を出す
- 行クリックで `window.open(webViewLink, "_blank")`。プレビューモーダルは開かない
- リンク共有がオンのファイルには、`v2` バッジと同じ位置に **「リンク公開中」バッジ**を常時表示する

### 5.3 組織設定画面

[`SlackNotificationSetting.tsx`](../src/app/components/settings/SlackNotificationSetting.tsx) と同じ形で作る。

```
Googleドライブ連携
 ○ 使わない（既定）
 ○ 組織の共有ドライブに保存する
      [保存先フォルダを選択]  ← Google Picker（共有ドライブを開き、中のフォルダを選ぶ）
      選択中: DevTicket共有
 ○ 各メンバーの個人ドライブに保存する
      ⚠ 作成者のGoogleアカウントが削除されると開けなくなります

                                    [保存]
```

**`shared_drive` を選んだ場合、共有ドライブが未選択なら保存ボタンを無効化する。**

さらに保存時に**接続テスト**を実行する。

1. 指定された共有ドライブに `DevTicket 接続テスト` という空ファイルを作成
2. 作成者以外の組織メンバー1名に `permissions.create` を試行
3. 成功したらファイルを削除して保存を確定
4. `403` が返ったら保存せず、以下を表示する
   > Google Workspace の管理者設定で外部共有が制限されているため、メンバーにファイルを共有できません。
   > 管理者に「組織外のユーザーと共有することを許可」の有効化を依頼してください。

これを入れないと、**設定は保存できたのに誰もファイルを開けない**という最悪の状態が本番で起きる。

---

## 6. データモデル

**新規SQL**: `supabase/add_google_drive_integration.sql`（追記式。既存ファイルは書き換えない）

### 6.1 組織設定

```sql
alter table organizations add column if not exists google_drive_mode text not null default 'off';
  -- 'off' | 'shared_drive' | 'my_drive'
alter table organizations add column if not exists google_shared_drive_id text default null;
alter table organizations add column if not exists google_shared_drive_name text default null; -- 表示用
```

### 6.2 OAuth トークン（専用テーブル）

**`projects.slack_access_token` のパターンを踏襲しないこと。**
[`fix_multitenant_rls.sql:72`](../supabase/fix_multitenant_rls.sql#L72) の `tenant_select_projects` は
組織メンバーなら行ごと読めるため、`slack_access_token` は一般メンバーからクライアント経由で読める。
Googleのリフレッシュトークンは権限が強いので、**service_role だけが読めるテーブル**に隔離する。

```sql
create table if not exists google_drive_tokens (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  organization_id text not null,
  google_email    text not null default '',   -- どのGoogleアカウントで繋いだかの表示用
  refresh_token   text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table google_drive_tokens enable row level security;
-- ★ ポリシーを1本も作らない = anon/authenticated からは一切読めない。
--   読み書きは api/google/[action].ts (service_role) からのみ。
```

`google_email` だけは画面に「〇〇@example.com で連携中」と出したいので、
**別途 `profiles.google_email` にも保存する**（こちらは読めてよい）。

```sql
alter table profiles add column if not exists google_email text default null;
```

### 6.3 `project_files` の拡張

```sql
alter table project_files add column if not exists external_provider text default null;  -- 'google'
alter table project_files add column if not exists external_id       text default null;  -- Drive の fileId
alter table project_files add column if not exists external_url      text default null;  -- webViewLink
alter table project_files add column if not exists link_shared       boolean not null default false;
```

Googleファイルの行は `file_path = ''`, `file_size = 0`, `version = 1`,
`file_type = 'application/vnd.google-apps.spreadsheet'` のように入れる。

`is_folder` は `false`。**フォルダ階層（`parent_id`）は通常ファイルと全く同じように使える。**

---

## 7. API 設計

**新規**: `api/google/[action].ts`（1ファイルに集約。GitHub連携・v1 と同じ理由で、
認証と権限判定を複製しないため）

| action | メソッド | 内容 |
|---|---|---|
| `oauth-start` | GET | 同意画面へ 302。`access_type=offline&prompt=consent` でリフレッシュトークンを取る |
| `oauth-callback` | GET | コードを交換し `google_drive_tokens` に保存 |
| `disconnect` | POST | トークンを削除し、Google側のトークンも revoke する |
| `create` | POST | `{ projectId, kind, parentId }` → ファイル生成・権限付与・DB登録 → `{ file, url }` |
| `share-link` | POST | `{ fileId, enabled }` → リンク共有のオン/オフ |
| `sync-permissions` | POST | `{ projectId }` → プロジェクトメンバー全員へ権限を配り直す |
| `test-connection` | POST | 5.3 の接続テスト |

すべて [`project-files/[action].ts`](../api/project-files/[action].ts) と同じく
`getProfile()` → `can_user_access_project()` でメンバー判定を通す。

### 7.1 `create` の処理順

```
1. メンバー判定（can_user_access_project）
2. リフレッシュトークン → アクセストークン
3. 保存先フォルダの解決（無ければ作る）
     shared_drive: <共有ドライブ>/DevTicket/<プロジェクト名>/
     my_drive:     マイドライブ/DevTicket/<プロジェクト名>/
   ※ フォルダIDは projects に memo 化してもよいが、消された場合に作り直せるよう
     毎回 files.list で名前引きし、無ければ作る方が壊れにくい
4. files.create
     mimeType: application/vnd.google-apps.spreadsheet | .document | .presentation
     parents:  [フォルダID]
     supportsAllDrives: true   ← 共有ドライブでは必須。付け忘れると 404
5. permissions.create をメンバー分ループ
     type: "user", role: "writer", sendNotificationEmail: false
     ※ false を付けないとメンバー全員に共有通知メールが飛ぶ
6. project_files へ INSERT（external_* 列に webViewLink / fileId）
7. { url } を返す → クライアントが window.open
```

### 7.2 フォルダ名の自動生成

プロジェクト名に `/` が含まれていてもDriveのフォルダ名としては問題ないが、
空文字になるケースだけ `無題のプロジェクト` に寄せる
（[`ensureFolderPath`](../src/app/lib/projectFiles.ts#L337) の `無題のフォルダ` と同じ考え方）。

---

## 8. 権限の配り方

### 8.1 既定：メンバーへの個別付与

`profiles.email` をそのまま `permissions.create` の宛先に使う。

- Workspace内外を問わず、**Googleアカウントであれば誰でも**付与できる
- Googleアカウントを持たない人には権限行は作られるが開けない
  → 一覧に「Google未連携のため開けません」と出す
- `sendNotificationEmail: false` を必ず付ける

### 8.2 リンク共有（ファイルごとのオプトイン）

```
permissions.create { type: "anyone", role: "writer", allowFileDiscovery: false }
```

- **既定はオフ。** ファイルの ⋯ メニューから明示的にオンにする
- オンにした人と日時を記録する
- 一覧に「リンク公開中」バッジを常時表示する（隠れないようにする）

リンク共有は、URLが実質のパスワードになる。プロジェクトから外れた人・退職した人も
URLを控えていれば開け続けられ、閲覧者の記録も残らない。既定にしてはならない。

### 8.3 権限同期が必要なタイミング

Google側の権限と DevTicket のメンバーシップは**自動では同期しない**。

| いつ | 必要な処理 |
|---|---|
| プロジェクトにメンバーが追加された | 既存のGoogleファイル全件へ権限を配り直す（`sync-permissions`） |
| プロジェクトからメンバーを外した | `permissions.delete` で剥奪 |
| 組織から退場した | 同上 |

`shared_drive` モードでは、共有ドライブのメンバーについてはこの処理が**不要**になる
（ドライブのメンバーシップが唯一の真実になるため）。`my_drive` モードでは必須。

---

## 9. 既存機能との関係

| 既存機能 | Googleファイルでの扱い |
|---|---|
| **フォルダ（`parent_id`）** | **そのまま使える。干渉しない。** DevTicket上の整理とDrive上の階層は別物 |
| コメント（`project_file_comments`） | `(project_id, file_name)` で引くので構造上は動くが、**本機能では無効にする**（ビューアを開かないため付ける場所がない） |
| 版（`version`） | Googleに版の概念を持ち込まない。常に `1` |
| 改名 | DevTicket側の改名時に `files.update` でDrive側も改名する |
| 削除 | **Drive側は残す**（決定事項 ⑧）。確認ダイアログに「Googleドライブ上のファイルは残ります」と明記 |
| `%` サジェスト（`emitLinkItemsChanged`） | 通常ファイルと同じく対象にする |
| 共有リンク（`?file=...`） | DevTicketのURLで着地したら、そのままDriveへ転送する |

### 9.1 同期は一方通行

| 操作 | 挙動 |
|---|---|
| DevTicketでフォルダ間を移動 | Drive側は動かない |
| DevTicketで改名 | Drive側も改名する |
| **Drive側で削除・移動・改名** | **DevTicketは検知しない。** 削除されればリンク切れ |

「Driveは倉庫、DevTicketが索引」という関係になる。リンク切れは `files.get` が 404 を返したときに
一覧で「Googleドライブ上で削除されています」と出して気づけるようにする。

### 9.2 サーバー側の分岐が要る箇所

`project_files` は「storage に実体がある」前提で組まれているため、以下に分岐が要る。

| 箇所 | 対応 |
|---|---|
| [`signed-url`](../api/project-files/[action].ts#L200) | Googleファイルは `external_url` を返す |
| [`dav-url`](../api/project-files/[action].ts#L220) | 対象外（400を返す） |
| [`delete`](../api/project-files/[action].ts#L298) | `storage.remove` をスキップ。行だけ消す |
| [`register`](../api/project-files/[action].ts#L145) の版採番 | Googleファイルは通らない経路 |
| [`getFileKind`](../src/app/lib/projectFiles.ts#L47) | Google3種の判定・アイコン・色を追加 |
| [`canPreviewInBrowser`](../src/app/lib/projectFiles.ts#L51) | 常に `false` |

### 9.3 検証結果と残る要検証

**検証済み（2026-09-20）**: 共有ドライブそのものは Picker で選択できなかった（4.1）。
当初の「共有ドライブのルートを親にする」案は取りやめ、
**顧客側でフォルダを1つ作ってもらい、そのフォルダを Picker で選ばせる**形に変更した。

**残る要検証**

- 1ファイルあたりの権限エントリ数の上限。公式ドキュメントで確認できなかった。
  メンバーが数百人規模の組織で `permissions.create` を回したときの挙動を確認すること。

---

## 10. セットアップ（コード外の作業）

**Google Cloud プロジェクトは DevTicket 側に1つだけ。顧客組織ごとには作らない。**
顧客がやるのは「DevTicket というアプリに自分のGoogleアカウントで許可を出す」ことだけで、
顧客側に Cloud プロジェクトも課金設定も一切不要。

1. Google Cloud プロジェクトを作成（DevTicket 専用に新規作成する。既存の検証用プロジェクトと
   混ぜるとクォータとキーが混ざる）
2. **Google Drive API** と **Google Picker API** を有効化
3. OAuth 同意画面を「外部」で構成。スコープは `drive.file` のみ
4. **同意画面を「本番環境に公開」にする**（下の 10.2 参照。ここを忘れると100ユーザーで止まる）
5. OAuth クライアントID（ウェブアプリケーション）を作成
   - 承認済みリダイレクトURI: `https://dv-ticket.com/api/google/oauth-callback`
   - ステージング用も同様に追加
6. Picker 用の API キーを発行
7. Vercel の環境変数に登録（[`.env.example`](../.env.example) にも追記する）

```
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
VITE_GOOGLE_API_KEY=your-picker-api-key
VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id   # Picker はクライアント側でIDが要る
```

アプリ名・ロゴを同意画面に出したい場合のみ、ブランド確認を申請する（審査ではない）。

### 10.1 料金

**Google Drive API / Google Picker API はどちらも無料。** 従量課金は無い。
Cloud プロジェクトの無料トライアルのクレジットも消費されず、トライアルが切れても動き続ける。
課金が発生するのは BigQuery や Compute などの有料プロダクトを使ったときだけで、本機能では使わない。

**ファイルの保存容量も DevTicket 側の負担にならない。** 作られたファイルは顧客のドライブ
（共有ドライブ＝その組織のWorkspace容量／マイドライブ＝その個人のGoogleアカウント容量）に入る。
DevTicket 側に残るのは `project_files` の1行だけで、Supabase Storage は一切消費しない。
むしろ、これまで .xlsx をアップロードしていた分が Google 側へ移る分、**Supabase の容量は減る**。

### 10.1.1 容量不足（`storageQuotaExceeded`）の扱い

2021年6月以降に作成・編集された Google ネイティブ形式のファイルは、Googleの容量にカウントされる
（かつては無制限だったが、現在は対象）。ただしサイズは小さく、.xlsx をアップロードするのとは桁が違う。

問題になるとすれば顧客側の容量で、特に **`my_drive` モード × 無料Gmailアカウント**（15GB を
Gmail・Googleフォトと共有）は、本人が気づかないうちに満杯になっていることがある。

`files.create` が `403 storageQuotaExceeded` を返したときは、汎用エラーで潰さず、

> Googleドライブの空き容量が不足しているため作成できませんでした。
> 不要なファイルを削除するか、容量を追加してください。

と、原因が本人に分かる文言を出す。

### 10.2 同意画面は必ず「本番環境に公開」にする

OAuth 同意画面が **「テスト」状態のままだと、連携できるのは 100 ユーザーまで**で、
それを超えたユーザーはエラーになる。さらに**リフレッシュトークンが7日で失効する**ため、
全顧客が1週間ごとに再連携を求められることになる。

`drive.file` は非センシティブスコープなので、**審査なしで「本番環境に公開」へ切り替えられる**。
リリース前に必ず切り替えること。

### 10.3 クォータは全顧客で共有される

Cloud プロジェクトが1つということは、**全顧客のAPIリクエストが1つのクォータを食い合う**。

2026年5月1日以降に作成したプロジェクトは加重ユニット制になる。

| 操作 | 消費ユニット |
|---|---|
| 読み取り | 5 |
| 編集（`files.create` / `permissions.create` 等） | 50 |
| 一覧（`files.list`） | 100 |
| ダウンロード | 200 |

上限は **1プロジェクトあたり 1,000,000 ユニット／分**。
ファイルを1つ作る操作は「フォルダ確認(list 100) + 作成(50) + 権限付与(50×メンバー数)」程度なので、
通常利用では問題にならない。

**注意が要るのは 8.3 の権限同期**で、「全Googleファイル × 全メンバー」を一度に回すと
一気にユニットを消費する。以下を必ず実装する。

- `403 rateLimitExceeded` / `429` に対する**指数バックオフ**
- 権限同期はバッチで分割し、1リクエストにまとめて詰め込まない

不足する規模になったら Cloud Console からクォータ引き上げを申請できる。

---

## 11. 実装時の注意

[CLAUDE.md](../CLAUDE.md) の既知バグに該当する箇所。

- **BUG-05（二重登録）**: `create` は `await` を含むので `postingRef` でガードする。
  展開メニューの3ボタンは**先に1つのハンドラへ寄せてから**ガードを付ける
- **BUG-01（順番が変わる）**: 一覧クエリは
  [`FileBoxPage.tsx:152`](../src/app/pages/FileBoxPage.tsx#L152) に `.order()` 済み。
  新しいクエリを足すときは忘れない
- **BUG-02/03（チカチカ）**: 作成後の再読込は `load()` のみ。`loading` を `true` に戻さない
- **IMEガード**: 新規ファイルでの漏れが多い。Enter で確定する1行入力欄を作るなら
  必ず [`submitOnEnter`](../src/app/lib/submitKey.ts) を経由する
- **SQL**: `supabase/add_google_drive_integration.sql` を**新規追加**。既存ファイルは書き換えない
- **検証**: `npm run build`（`npx vite build` 単体では IME 検査が走らない）

---

## 12. 残論点

- 複数のGoogleアカウントにログインしているユーザーは、`webViewLink` を開いたときに
  別アカウントで開いて権限エラーになることがある。テスト項目に入れる
- `my_drive` モードで作成者が退職したときの**ファイルの引き継ぎ**。
  Drive の所有権移転は本人かWorkspace管理者の操作が必要で、DevTicketからは手を出せない。
  一覧で「開けません」と出す以上のことはできない旨を、設定画面にも書いておく
- 既存 .xlsx / .docx を Google 形式に変換して開く機能（Drive APIの変換アップロードで可能だが、
  往復で書式が落ちる）。要望が出てから検討する
