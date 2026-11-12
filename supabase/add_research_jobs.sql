-- ============================================================
-- ENHA2-055-1 高度検索：調査の記録（research_jobs）
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
--
-- 前提（適用済みであること）:
--   fix_project_level_rls_BRU14-001.sql（can_access_project() を使う）
--
-- ★ このSQLは、アプリをマージ・デプロイしたあとに手で流す。
--   流すまでの間は、高度検索の画面と調査のAPI（research-start / research-result / research-fail）だけが
--   エラーになる。既存の画面・APIはこのテーブルを使わないので、これまでどおり動く。
--
-- 設計上の要点:
--   ・調査1件 = 1行。画面で「プロンプトを生成してコピー」を押すと、本人の権限で「待機中」の行を作る。
--   ・AI は APIキーで research-start → research-result（または research-fail）を送り、状態を進める。
--     API は service_role で書くので RLS は通らない（キーの発行者と created_by の一致は API 側で確かめる）。
--   ・画面からできるのは、本人の行を読むこと・作ること・待機中／処理中の行を「キャンセル」にすることだけ。
--     結果の列を書き換えられないよう、更新できる列を status と finished_at に絞る（列の権限）。
--   ・status: queued（待機中）/ running（処理中）/ done（完了）/ failed（失敗）/ cancelled（キャンセル）
--   ・結果の中には、見られる人を絞った議事録の内容が入りうるため、読めるのは本人だけにする。
-- ============================================================

create table if not exists public.research_jobs (
  id              uuid        primary key default gen_random_uuid(),
  project_id      text        not null references public.projects(id) on delete cascade,
  organization_id text,
  -- 質問した人（profiles.id）。RLS の「本人だけ」の判定に使う
  created_by      uuid        not null references public.profiles(id) on delete cascade,
  question        text        not null,
  status          text        not null default 'queued',
  -- レポート型の結果（結論・経緯（時系列）・未決事項・出典）の Markdown
  result          text,
  -- 短い回答型の結果（回答の2〜3文）の Markdown
  result_short    text,
  -- 出典の配列。[{ no, kind, id, title, date, url, quote }]（quote は資料から書き写した根拠の文）
  sources         jsonb       not null default '[]'::jsonb,
  error           text,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'research_jobs_status_check' and conrelid = 'public.research_jobs'::regclass) then
    alter table public.research_jobs
      add constraint research_jobs_status_check check (status in ('queued', 'running', 'done', 'failed', 'cancelled'));
  end if;
end
$$;

create index if not exists idx_research_jobs_project_creator_created
  on public.research_jobs(project_id, created_by, created_at);

alter table public.research_jobs enable row level security;

-- ── RLS ──────────────────────────────────────────────────────
drop policy if exists "research_jobs_select" on public.research_jobs;
drop policy if exists "research_jobs_insert" on public.research_jobs;
drop policy if exists "research_jobs_update" on public.research_jobs;
drop policy if exists "research_jobs_delete" on public.research_jobs;

-- 読めるのは本人の調査だけ
create policy "research_jobs_select" on public.research_jobs
  for select using (created_by = auth.uid());

-- 作れるのは、本人として・見られるプロジェクトに・待機中で・結果が空のものだけ
create policy "research_jobs_insert" on public.research_jobs
  for insert with check (
    created_by = auth.uid()
    and public.can_access_project(project_id)
    and status = 'queued'
    and result is null and result_short is null and error is null
    and started_at is null and finished_at is null
  );

-- 画面からの更新は、本人の待機中／処理中の調査をキャンセルにすることだけ
create policy "research_jobs_update" on public.research_jobs
  for update
  using (created_by = auth.uid() and status in ('queued', 'running'))
  with check (created_by = auth.uid() and status = 'cancelled');

-- 削除のポリシーは作らない（画面からは消せない）

-- 列の権限: 画面（authenticated）が書き換えられるのは status と finished_at だけ。
-- RLS は「どの行か」しか絞れないので、結果の列を書き換えられないよう列で絞る。
revoke update on public.research_jobs from authenticated;
grant update (status, finished_at) on public.research_jobs to authenticated;
revoke delete on public.research_jobs from authenticated;
