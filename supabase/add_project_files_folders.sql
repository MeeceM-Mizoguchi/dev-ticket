-- ============================================================
-- ファイルボックスのフォルダ階層（列の追い付き）
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- project_files のフォルダ機能（parent_id / is_folder）は、
-- 追加された当時に .sql が用意されておらず本番DBだけに存在していた。
-- 新しい環境を立てたときに再現できるよう、ここで追い付かせる。
-- 既に列がある環境で流しても何も起きない（すべて if not exists）。

alter table project_files
  add column if not exists parent_id uuid references project_files(id) on delete cascade;

alter table project_files
  add column if not exists is_folder boolean not null default false;

-- 階層をたどる一覧（同じ親の中身を引く）用
create index if not exists idx_project_files_parent on project_files(project_id, parent_id);

-- フォルダは実体を持たない行なので file_path は '' で入る。
-- add_project_files.sql の file_path は not null（default 無し）なので、
-- 挿入側で必ず '' を渡すこと（src/app/lib/projectFiles.ts）。
