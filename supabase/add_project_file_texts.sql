-- ============================================================
-- ENHA2-056 高度検索：ファイルボックスのファイルから取り出した文字（project_file_texts）
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
--
-- 前提（適用済みであること）:
--   add_project_files.sql
--
-- ★ このSQLは、アプリをマージ・デプロイしたあとに手で流す。
--   流すまでの間は、文字の取り出し（裏で動く）が保存に失敗するだけで、アップロード・ファイルを開く処理は
--   これまでどおり成功する。高度検索の search では、ファイルが検索の対象にならないだけ。
--
-- 設計上の要点:
--   ・1行 = project_files の1行（＝ファイルの1つの版）。新しい版を上げると、その版の行に取り出し直す。
--     検索は各ファイルの最新の版の行だけを見るので、古い版の文字では当たらない。
--   ・取り出しに失敗した・対象外の形式のときは、text を空にして error に理由を残す（アップロードは失敗にしない）。
--   ・読み書きするのはサーバー（service_role）だけ。画面からは読まないので、authenticated のポリシーは作らない
--     （限定公開のファイルの中身を、見てよくない人に読ませないため。判定は API 側の fileAccess.ts）。
-- ============================================================

create table if not exists public.project_file_texts (
  file_id           uuid        primary key references public.project_files(id) on delete cascade,
  project_id        text        not null references public.projects(id) on delete cascade,
  -- 取り出した文字（1ファイル 20万文字まで。超えた分は捨てる）
  text              text        not null default '',
  -- 取り出したときの版（project_files.version）
  extracted_version int,
  -- 取り出し方: storage（アップロードしたファイル）/ google（Googleドライブから書き出し）
  source            text        not null default 'storage',
  -- 取り出せなかった理由（対象外の形式・文字のデータが無いPDF など）。取り出せたときは null
  error             text,
  extracted_at      timestamptz not null default now()
);

create index if not exists idx_project_file_texts_project on public.project_file_texts(project_id);

alter table public.project_file_texts enable row level security;
-- ポリシーは作らない（service_role だけが読み書きする）
