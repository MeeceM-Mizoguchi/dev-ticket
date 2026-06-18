-- ============================================================
-- Wiki フォルダ機能追加
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

alter table wiki_pages add column if not exists is_folder boolean not null default false;
