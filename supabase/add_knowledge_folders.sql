-- ============================================================
-- ナレッジノート: フォルダ機能
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 前提: supabase/add_knowledge_ai.sql を先に実行しておくこと
-- 冪等: 何度実行しても安全
--
-- 資料を種類ごとに整理し、フォルダ単位で検索対象を切り替えられるようにする。
-- 階層は1段（フォルダの中にフォルダは作らない）。
--   ・設計書 / 議事録 / 参考資料 のような分け方には1段で足りる
--   ・多段にすると「どこに入れたか分からない」が起きやすい
-- ============================================================

create table if not exists knowledge_folders (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_kn_folders_project
  on knowledge_folders(project_id, sort_order, created_at);

-- 資料の所属フォルダ。null = 未分類（フォルダを消しても資料は残す）
alter table knowledge_documents
  add column if not exists folder_id uuid references knowledge_folders(id) on delete set null;

create index if not exists idx_kn_docs_folder
  on knowledge_documents(folder_id);

-- ── RLS ───────────────────────────────────────────────────────
alter table knowledge_folders enable row level security;

drop policy if exists "kn_folders_all" on knowledge_folders;
create policy "kn_folders_all" on knowledge_folders
  for all
  using      (can_access_project(project_id))
  with check (can_access_project(project_id));

-- ============================================================
-- 動作確認クエリ（任意）
-- ============================================================
-- select * from knowledge_folders where project_id = '<project_id>' order by sort_order;
-- select folder_id, count(*) from knowledge_documents group by folder_id;
