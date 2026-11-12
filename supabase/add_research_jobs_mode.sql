-- ============================================================
-- BRU25-015-1 高度検索：どちらの AI で調べたか（research_jobs.mode）
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
--
-- 前提（適用済みであること）:
--   add_research_jobs.sql（research_jobs を作る）
--
-- ★ このSQLは、アプリをマージ・デプロイしたあとに手で流す。
--   流すまでの間は、高度検索の「ブラウザの AI」で調査を作るところだけがエラーになる。
--   「ターミナルの AI」（今までの動き）は調査を作るときに mode を送らないので、これまでどおり動く。
--
-- 設計上の要点:
--   ・mode: 'cli'（ターミナルの AI。APIキーで research-start / research-result を送る）
--           'browser'（ブラウザの AI。資料ファイルを添付し、答えを画面に貼って取り込む）
--   ・既定は 'cli'。既存の行もすべて 'cli' になる。
--   ・画面（authenticated）は、作るとき（insert）にだけ mode を入れる。更新できる列は
--     add_research_jobs.sql のとおり status と finished_at だけのまま（mode は書き換えられない）。
-- ============================================================

alter table public.research_jobs
  add column if not exists mode text not null default 'cli';

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'research_jobs_mode_check' and conrelid = 'public.research_jobs'::regclass) then
    alter table public.research_jobs
      add constraint research_jobs_mode_check check (mode in ('cli', 'browser'));
  end if;
end
$$;

-- PostgREST のスキーマキャッシュを読み直させる（列を足した直後から API で使えるように）
notify pgrst, 'reload schema';
