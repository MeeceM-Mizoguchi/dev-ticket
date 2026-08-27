# 本番反映の確認 設計書（BRU13-041）

> 対象: GitHub 上のマージだけを見て「リリース済み」にしていた判定に、
> **本番に届いたかどうか**を加える。あわせて、失敗したままのマージを入口で止める。
> ステータス: **実装済み**（`npx vite build` 緑）
>
> 関連: [GitHub連携 設計書](./github-integration-design.md)

---

## 1. きっかけになった事故

2026-08-27、NegoNavi の本番環境（negonavi.vercel.app）で、
**8/24 以降にマージされた11コミットが本番に一切反映されていない**ことが判明した。
きっかけは「設定 › メンバー画面のアイコン位置の修正が本番で直っていない」という指摘で、
そこから調査して初めて分かった。**11日間、誰も気づいていなかった。**

| | 事実 |
|---|---|
| 本番 | `https://negonavi.vercel.app/version.json` → `{"buildId":"50237ab794f5"}`（8/24のビルド） |
| main | #38・#40〜#48 の計11コミットが積まれている |
| GitHub | チェック欄に **「Vercel - Deployment was blocked」** |
| 主因 | Vercel のデプロイがブロックされている（ビルド失敗ではなく、**ビルドされる前に止められている**） |
| 副因① | `npm run build` が型エラー22件で停止する状態（#40 以降） |
| 副因② | ブランチ保護（Required status checks）が未設定で、チェックが ✗ でもマージできる |

### 1-1. Dev Ticket は拾えなかっただけでなく、事故を隠す側にいた

同じことが Dev Ticket で管理されているプロジェクトで起きた場合、
[`syncProjectReleases()`](../api/github/%5Bresource%5D.ts) の判定は次の1行だった。

```ts
const merged = states.filter(s => s.merged && s.base === defaultBranch);
```

**マージされた＝リリース済み。** デプロイは一切見ていない。
旧設計書にもそう明記してある（「見ているのは GitHub 上のPRの状態だけなので、
そのプロジェクトのデプロイ先に依存しない」）。

つまり11件は15分ごとの定期実行で全部「リリース済み・進捗100%」に変わり、
リリースノートのカレンダーにも並び、Slack にも流れる。
**本番には1件も届いていないのに、Dev Ticket の画面はリリース完了を主張し続ける。**

マージの入口も素通りだった。[`mergeBlockReasonOf()`](../api/github/%5Bresource%5D.ts) は
`mergeable_state` しか見ておらず、ブランチ保護が無いリポジトリでは GitHub が
CI 真っ赤でも `clean` を返すため、「まとめてマージ」は普通に通る。
CI の状態（`checkState`）は表示用に取っているだけで、マージのゲートには使っていなかった。

さらに `summarizeChecks()` は `check-runs` しか見ていなかった。
Vercel の「Deployment was blocked」は **commit status** 側に出ることがあり、
その場合 Dev Ticket の表示は失敗ですらなく **「チェックなし」** になる。

## 2. 決定事項

| # | 論点 | 決定 |
|---|---|---|
| ① | 何を根拠に「本番に届いた」と判定するか | **本番が公開しているバージョン情報**（`/version.json` 等）と**既定ブランチの先頭**の突き合わせ |
| ② | Vercel API を使うか | **使わない**。プロバイダに依存せず、ブロック・ビルド失敗・キャッシュを区別せず「届いていない」を掴む |
| ③ | 既定の挙動 | **従来どおり**（`deploy_check_mode = off`）。設定したプロジェクトだけが厳しくなる |
| ④ | 失敗チェックのままのマージ | **塞がない。理由を書かせて監査ログに残す**（既定は `warn`、推奨は `reason`） |
| ⑤ | 遅れの知らせ方 | 時間で段階を上げる（30分＝画面／2時間＝Slack／24時間＝赤帯） |
| ⑥ | GitHub App の権限追加 | **必須にはしない**。`statuses` / `deployments` は任意扱いで、無ければ「確認できていない」と出す |
| ⑦ | 確認できないときの扱い | **「問題なし」にしない。** `gate` では前へ進めず、画面には理由を出す |

**非対象**: Vercel / Netlify などのAPIに直接つないで「なぜ止まっているのか」を特定すること（→ 8章）。

## 3. 4つの層

事故には主因と副因が2つあり、1か所を直しても再発する。層を分けて全部に手を当てる。

| 層 | 何をするか | 効く相手 | 追加権限 |
|---|---|---|---|
| **A** | マージの入口で、失敗しているチェックを見て止める | 副因② | 不要 |
| **B** | 本番へ反映されたことを確認してから「リリース済み」にする | 主因 | 不要 |
| **C** | 反映の遅れを定期的に観測して知らせる | 主因 | 不要 |
| **D** | 設定の健全性（未保護・未設定）を診断して見せる | 副因② | 不要 |
| （補） | commit status / Deployments を読んで**理由**まで出す | 主因の説明 | **あり** |

**A〜D は GitHub App の権限追加なしで動く。**
既存の接続組織に再承認を求めずに出せることを優先した。
補の権限（`statuses` / `deployments`）が無い場合は、
`checkUnavailable` に情報源名を入れて画面に「確認できていません」と出す。
**黙って「チェックなし」にしない**のがこの機能の要点なので、ここは必ず明示する。

---

## 4. 層B/C の判定ロジック

```
 定期実行（*/15）
   │
   ▼
 probeDeployedRef(url, key)            ← 本番の /version.json を取得
   │   {"buildId":"50237ab794f5"} → "50237ab794f5"
   ▼
 GET /repos/{o}/{r}/commits/{既定ブランチ}   → head sha
   ▼
 GET /repos/{o}/{r}/compare/{deployed}...{head}
   │   status  … identical / ahead / behind / diverged
   │   ahead_by … 本番が何コミット遅れているか
   │   commits  … 未反映のコミット（最大250件）
   ▼
 summarizeSha(head)                    ← 遅れている「理由」
   ├ check-runs      （Checks: read。既存）
   ├ commit statuses （statuses: read。任意。Vercel の blocked はここ）
   └ deployments     （deployments: read。任意）
   ▼
 project_deploy_status に保存 → 画面・Slack・層Bのゲート
```

### 4-1. 状態

| state | 意味 | 画面 |
|---|---|---|
| `not-configured` | 確認先URLが未設定 | 管理者にだけ「確認していません」と出す |
| `in-sync` | 本番に既定ブランチの先頭まで入っている | 緑の1行 |
| `behind` | 本番が遅れている（＝今回の事故） | 猶予内は青、超えたら黄→赤 |
| `unreachable` | 確認先URLに届かなかった | 黄。**「反映済み」とは書かない** |
| `unknown` | 値は取れたがコミットとして突き合わせられなかった | 黄＋直し方 |
| `error` | GitHub 側の取得に失敗 | 黄 |

`compare` の `status` が `behind`（本番の方が新しい）は、
ホットフィックスや別経路のデプロイで起こり得るため **`in-sync` 扱い**にする。
未反映の変更は無いので、警告する理由が無い。

### 4-2. 「いつからずれているか」は状態から導出する

`behind_since` は**未反映コミットのうち最も古いものの日時**にしている。
前回の観測値を引き継ぐ実装にすると、定期実行が止まっていた期間があったときに
「たった今ずれ始めた」と誤って出る。毎回 GitHub の事実から導出すれば、
cron が何日止まっていても正しい経過時間が出る。

### 4-3. 未反映のPRとチケットを名指しする

`compare` が返すコミットのメッセージから

- `(#123)` … スカッシュマージ（Dev Ticket が付ける `commit_title` もこの形）
- `Merge pull request #123 from ...` … マージコミット

でPR番号を拾い、さらに `detectWbs()` で WBS 番号を拾って
`sprint_tickets` を引く。PR一覧を引き直すより桁違いに軽い。

**すでに「リリース済み」にされているチケットが未反映側にいる場合は、その件数を強調する。**
画面の表示と本番が食い違っている、という一番言うべきことなので。

### 4-4. 猶予と段階

| 経過 | level | 出るもの |
|---|---|---|
| 〜30分 | `none` | 「本番へ反映中です」（青。ビルド時間なので異常ではない） |
| 30分〜 | `notice` | GitHubタブに黄色の帯 |
| 2時間〜 | `slack` | 上記＋プロジェクトの Slack チャンネルへ投稿 |
| 24時間〜 | `critical` | 赤帯。リリースノートにも出る |

Slack は `alerted_level` + `alerted_sha` で重複を抑える。
**直ったときも必ず投稿する**（言わないと「まだ止まっているのか」を毎回確かめに行くことになる）。

閾値はサーバー（`DEPLOY_GRACE_MIN` / `DEPLOY_SLACK_MIN` / `DEPLOY_CRITICAL_MIN`）と
画面（`DEPLOY_GRACE_LABEL` / `DEPLOY_SLACK_LABEL`）の両方にある。**変えるときは両方直すこと。**

### 4-5. 層B（gate）が「確認できない」ときは進めない

`deploy_check_mode = gate` のプロジェクトでは、
`in-sync` か「そのPRのマージコミットが未反映側に無い」ことを確認できたときだけ
`released` にする。それ以外（`unreachable` / `unknown` / `error` / 未設定）は
**1件も進めず、理由を `detail.deployHold` に入れて画面に出す**。

確認できないまま通してしまうと、この機能を入れた意味が無くなる。
ただし黙って止まると「なぜ動かないのか」が分からなくなるため、
外部連携画面の④に理由をそのまま表示する。

`compare` が返すコミットは最大250件なので、
`behind_by > pendingShas.length` のときも**進めない**（内訳が欠けていて誤判定するため）。

## 5. 層A（マージ前の必須チェック）

`require_checks_mode` はプロジェクトごとに4段階。

| 値 | 挙動 |
|---|---|
| `off` | 何もしない |
| `warn` | 警告を出す（既定） |
| `reason` | **理由を入力しないとマージできない**。理由は `github_action_logs` に `override` として残る |
| `block` | マージさせない |

- **判定するのは `failure` のときだけ。** 実行中（pending）で止めると日常の作業が回らない。
- 既定を `block` にしない理由: 完全に塞ぐと運用が回らなくなり、機能ごと切られる。
  潰したいのは「**気づかずに通る**」であって「通すこと」ではない。
- 押し切った事実を必ず残すことで、「毎回みんな押し切っている」を後から数えられる状態にする。
- **押す前に出す。** サーバーの事前チェックを待たず、一覧・詳細で既に分かっている CI 状態から
  警告を組み立てる（`warningFromPull()`）。押してから初めて理由が出る状態にしない（BRU13-038 と同じ方針）。
- **まとめてマージも「1件でも引っかかれば1件もマージしない」に揃える**（BRU13-038）。
  理由は1回入力すれば全件に適用され、PRごとに監査ログが残る。
- 実行直前にもう一度チェックし直す。前のマージでベースが動き、CIが走り直して落ちていることがあるため。

## 6. データモデル

[`supabase/add_deploy_verification.sql`](../supabase/add_deploy_verification.sql)

```sql
alter table projects add column if not exists deploy_check_url text;
alter table projects add column if not exists deploy_check_key text;
alter table projects add column if not exists deploy_check_mode text not null default 'off';
alter table projects add column if not exists require_checks_mode text not null default 'warn';

create table if not exists project_deploy_status (
  project_id text primary key references projects(id) on delete cascade,
  checked_at timestamptz,
  state text not null default 'not-configured',
  ok boolean not null default false,
  deployed_ref text, deployed_sha text,
  head_sha text, head_message text, head_committed_at timestamptz,
  behind_by integer not null default 0,
  behind_since timestamptz,
  pending_pulls jsonb, pending_tickets jsonb,
  check_state text, check_summary text, check_detail jsonb,
  check_unavailable jsonb,
  message text, error text,
  alerted_level text not null default 'none', alerted_sha text, alerted_at timestamptz,
  updated_at timestamptz not null default now()
);
```

RLS は既存と同じ方針。`select` は `can_access_project(project_id)`、書き込みは service role のみ。

`pending_pulls` / `pending_tickets` は先頭50件だけ保存する（行の肥大を防ぐ）。
**層Bのゲートには保存値を使わず、その場で取り直す**（未反映SHAの全件が要るため）。

## 7. サーバーAPI

| resource | method | 必要権限 | 役割 |
|---|---|---|---|
| `deploy-status` | GET | view | 保存済みの観測結果。10分より古ければ取得のついでに取り直す |
| `deploy-check` | POST | view | 「今すぐ確認する」。必ず取り直す（通知はしない） |
| `deploy-overview` | GET | 組織管理者 | 診断（未保護・未設定・遅延）。リポジトリ40件まで |

- **通知は定期実行だけに集約する。** 画面を開くたびに Slack が鳴ると誰も見なくなる。
- 既存の cron（`/api/github/sync-released`、15分ごと）に相乗りする。cron は増やさない。
  実行時間が伸びるため `vercel.json` に `maxDuration: 60` を追加した。

### 7-1. 確認先URLの安全確認（SSRF）

このURLは組織の管理者が入力し、**サーバーが代わりに取りに行く**。
社内アドレスやクラウドのメタデータ（`169.254.169.254`）を指されると、
サーバーからしか見えないものを覗く踏み台になる。

`assertPublicUrl()` で次を弾く。

- `http` / `https` 以外のスキーム
- `localhost` / `*.local` / `*.internal` / `*.localdomain`
- **名前解決した結果**が private / loopback / link-local / CGNAT / マルチキャストに入るもの
  （ホスト名だけを見る実装では、公開ドメインが内部IPを指すケースを通してしまう）

取得は8秒でタイムアウトし、本文は先頭200KBまでしか読まない。

### 7-2. キー名が外れていても拾いにいく

`deploy_check_key` が的外れだった場合、`buildId` / `commit` / `sha` / `revision` などの
定番キーも順に見る。JSON でない応答からはコミットSHAらしき文字列を1つだけ拾う。
「キー名だけ違って永久に未設定扱い」を避けるため。

拾えた値がコミットSHA（7桁以上の16進）でない場合は `unknown` にして、
**「コミットSHAを出すよう変更してください」と直し方まで書く**。

## 8. できないこと

| # | 制約 | 影響 |
|---|---|---|
| 1 | **「なぜ blocked なのか」までは分からない** | 支払い・利用上限・プロジェクト一時停止・Deployment Protection の区別は GitHub 側からは付かない。特定には Vercel API（プロジェクトごとのトークン）が要る。トークンをDBに持つ設計判断が別途必要なため今回は入れていない |
| 2 | version.json を持たないアプリでは使えない | `not-configured` として「確認していない」と出すだけ。仕込みを強制はできない |
| 3 | 認証が要る本番URLは確認できない | `unreachable` になる。ヘッダ付与の設定欄は用意していない |
| 4 | 未反映コミットの内訳は250件まで | 超えたら `gate` は保留する（誤判定より保留を選ぶ） |
| 5 | PR番号はコミットメッセージから拾う | `(#123)` も `Merge pull request #123` も無い運用では未反映PRの一覧が空になる（遅れの検知自体には影響しない） |

## 9. 変更ファイル一覧

### 新規

| ファイル | 内容 |
|---|---|
| `supabase/add_deploy_verification.sql` | projects の4カラム＋`project_deploy_status` |
| `src/app/components/github/DeployStatusBanner.tsx` | 本番反映の帯（層C） |
| `src/app/components/github/CheckGateNotice.tsx` | 失敗チェックの関門と理由入力（層A） |
| `docs/deploy-verification-design.md` | 本書 |

### 変更

| ファイル | 変更 |
|---|---|
| [api/github/[resource].ts](../api/github/%5Bresource%5D.ts) | `summarizeSha`（3系統）／`probeDeployedRef`／`evaluateDeploy`／`runDeployCheck`／`deployGateFor`／`checkGateOf`／`enforceCheckGate`／`deploy-*` の3リソース／`OPTIONAL_PERMISSIONS` |
| [src/app/types.ts](../src/app/types.ts) | `GithubDeployStatus` ほか。`Project` に4項目 |
| [src/app/lib/github.ts](../src/app/lib/github.ts) | `fetchDeployStatus` / `runDeployCheck` / `fetchDeployOverview` / ラベル定義 |
| [src/app/lib/mappers.ts](../src/app/lib/mappers.ts) | `mapProject` に4項目 |
| [src/app/pages/GithubPage.tsx](../src/app/pages/GithubPage.tsx) | 帯の表示・理由の受け渡し |
| [src/app/pages/ReleaseNotesPage.tsx](../src/app/pages/ReleaseNotesPage.tsx) | 遅れているときだけ帯を出す |
| [src/app/components/settings/GithubIntegrationSetting.tsx](../src/app/components/settings/GithubIntegrationSetting.tsx) | ⑤診断ブロック・任意権限の案内 |
| [src/app/components/projects/ProjectSettingsDialog.tsx](../src/app/components/projects/ProjectSettingsDialog.tsx) | 確認先URL・キー・モード・必須チェックの設定 |
| [MergeConfirmDialog](../src/app/components/github/MergeConfirmDialog.tsx) / [BulkMergeDialog](../src/app/components/github/BulkMergeDialog.tsx) | 層Aの警告と理由入力 |
| [MergePrecheckNotice](../src/app/components/github/MergePrecheckNotice.tsx) | 失敗チェック分は CheckGateNotice に任せて重複させない |
| `vercel.json` | `maxDuration: 60` |

## 10. 導入手順

1. `supabase/add_deploy_verification.sql` を SQL Editor で実行する。
2. デプロイする。**この時点では挙動は変わらない**（全プロジェクト `off` / `warn`）。
3. プロジェクト設定で確認先URLを入れる。まず `warn` で様子を見る。
4. 誤検知が無いことを確認してから `gate` に上げる。
5. 必要なら GitHub App に `Commit statuses: Read` と `Deployments: Read` を追加し、
   インストール画面で承認する（**理由の表示が良くなるだけ**で、検知自体は権限なしで動く）。

## 11. 将来拡張（今回は入れない）

- Vercel / Netlify の API に直接つないで、ブロックの理由（利用上限・支払い・一時停止）まで表示する
- ブランチ保護の設定を Dev Ticket から直接変更する（`Administration: write` が要る）
- 本番URLに認証が要る場合のヘッダ設定
- ダッシュボードへの組織横断サマリ
