-- BRU14-014 GitHub連携：1組織に複数のGitHubアカウントを接続できるようにする
-- Supabase Dashboard → SQL Editor で実行してください。
--
-- これまで github_installations は organization_id が主キーで、1組織につき
-- GitHubアカウントを1つしか接続できなかった。そのため
--   ・接続した本人以外が「リポジトリを追加・変更」を押すと GitHub が 404 を返す
--     （/settings/installations/<id> は、そのインストールを持つ本人しか開けないため）
--   ・別のアカウントや Organization にあるリポジトリを紐付ける手段が無い
-- という状態だった。主キーを (organization_id, installation_id) に広げて、
-- 同じ組織が複数のアカウントを持てるようにする。既存の行はそのまま残る。

alter table github_installations
  drop constraint if exists github_installations_pkey;

alter table github_installations
  add constraint github_installations_pkey primary key (organization_id, installation_id);

-- 接続一覧は必ずこの並びで引く（BUG-01: order が無いと毎回順序が変わり、
-- 「既定の接続」として使うアカウントが読み込みのたびに入れ替わってしまう）。
create index if not exists idx_github_installations_org
  on github_installations (organization_id, connected_at, installation_id);

-- 書き込みは従来どおりサーバー(service_role)だけ。
-- 画面からの「切断する」も /api/github/disconnect 経由に変えている
-- （このテーブルには insert/update/delete の permissive ポリシーが無いため、
--   ブラウザから直接 delete しても1行も消えない）。
