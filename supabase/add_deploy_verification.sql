-- 本番反映の確認（docs/deploy-verification-design.md）
-- Supabase Dashboard → SQL Editor で実行してください。
--
-- 背景: これまで「PRが既定ブランチへマージされた＝リリース済み」として扱っていた。
-- マージは成功しているのにデプロイが止まっている（Vercel の blocked 等）と、
-- 本番に何も届いていないのに Dev Ticket 上は全件「リリース済み」になる。
-- 実際に11コミットが11日間気づかれずに滞留した事故が発生している。
--
-- そこで「マージ済み」と「本番反映済み」を別の事実として持てるようにする。

-- ── プロジェクトごとの設定 ──────────────────────────────────────────────────
-- deploy_check_url … 本番が公開しているバージョン情報のURL（例 https://example.com/version.json）
-- deploy_check_key … その JSON の中で「今動いているコミット」を示すキー名（例 buildId）
-- deploy_check_mode … off  … 何もしない（既定。従来どおりマージで「リリース済み」）
--                     warn … 反映を確認して警告は出すが、ステータスは従来どおり進める
--                     gate … 本番へ反映されたことを確認できるまで「リリース済み」にしない
alter table projects add column if not exists deploy_check_url text default null;
alter table projects add column if not exists deploy_check_key text default null;
alter table projects add column if not exists deploy_check_mode text not null default 'off';

-- require_checks_mode … マージ前に「失敗しているチェック」をどう扱うか
--   off    … 何もしない
--   warn   … 警告を出すだけ（既定）
--   reason … 理由を書かないとマージできない（書けば通す。理由は監査ログに残る）
--   block  … マージさせない
-- GitHub のブランチ保護が未設定でも、Dev Ticket 側で同じ関門を作るためのもの。
alter table projects add column if not exists require_checks_mode text not null default 'warn';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_deploy_check_mode_chk') then
    alter table projects add constraint projects_deploy_check_mode_chk
      check (deploy_check_mode in ('off', 'warn', 'gate'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_require_checks_mode_chk') then
    alter table projects add constraint projects_require_checks_mode_chk
      check (require_checks_mode in ('off', 'warn', 'reason', 'block'));
  end if;
end $$;

-- ── 観測結果（プロジェクトごとに1行） ────────────────────────────────────────
-- 「いま本番に何が乗っているか」を定期実行で観測して残す。
-- 画面はこの行を読むだけにして、開くたびに本番へ HTTP を投げないようにする。
create table if not exists project_deploy_status (
  project_id     text primary key references projects(id) on delete cascade,
  checked_at     timestamptz,
  -- not-configured / in-sync / behind / unreachable / unknown / error
  state          text not null default 'not-configured',
  ok             boolean not null default false,
  deployed_ref   text,          -- 本番から取れた値そのもの（buildId / SHA など）
  deployed_sha   text,          -- コミットSHAとして解決できた場合だけ入る
  head_sha       text,          -- 既定ブランチの先頭
  head_message   text,
  head_committed_at timestamptz,
  behind_by      integer not null default 0,
  -- ずれ始めた時刻。未反映コミットのうち最も古いものの日時で、状態から毎回導出する
  -- （前回値の引き継ぎに頼らないので、cron が止まっていた間があっても正しく出る）
  behind_since   timestamptz,
  pending_pulls  jsonb not null default '[]'::jsonb,
  pending_tickets jsonb not null default '[]'::jsonb,
  -- 既定ブランチ先頭のチェック結果（Vercel の blocked はここに出る）
  check_state    text,
  check_summary  text,
  check_detail   jsonb not null default '[]'::jsonb,
  -- 権限不足などで見られなかった情報源。「問題なし」と「確認できていない」を混同しないために持つ
  check_unavailable jsonb not null default '[]'::jsonb,
  message        text,
  error          text,
  -- 通知の重複防止。同じ状態で何度も Slack に流さない
  alerted_level  text not null default 'none',   -- none / slack / critical
  alerted_sha    text,
  alerted_at     timestamptz,
  updated_at     timestamptz not null default now()
);

alter table project_deploy_status enable row level security;

-- 参照はプロジェクトにアクセスできる人。書き込みはサーバー(service_role)だけ。
drop policy if exists project_deploy_status_select on project_deploy_status;
create policy project_deploy_status_select on project_deploy_status
  for select using (can_access_project(project_id));

create index if not exists idx_project_deploy_status_state
  on project_deploy_status (state);
