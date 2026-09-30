-- ============================================================
-- Googleドライブ上のプロジェクトの保存先フォルダ（ID）の記録
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
-- ============================================================
--
-- ファイルボックスのGoogleファイルは、Drive 上の次のフォルダに作られる（api/google/[action].ts）。
--   shared_drive … <管理者が選んだフォルダ>/<プロジェクト名>/
--   my_drive     … マイドライブ/DevTicket/<プロジェクト名>/
--
-- 以前はこのフォルダを毎回プロジェクト名で探していたため、プロジェクト名を変えると
-- 空のフォルダが新しく作られ、既存のGoogleファイルが全件「Googleドライブ上で削除されています」と
-- 表示されて開けなくなっていた。一度見つけた／作ったフォルダの ID をここに覚え、以後は ID で引く。
--
-- scope_key … フォルダIDを覚える単位
--   'shared:<保存先フォルダのID>' … 共有ドライブ運用。組織で1つ。
--                                  保存先フォルダの設定を変えたら別の置き場所として扱う
--   'user:<ユーザーID>'           … マイドライブ運用。フォルダは作った人それぞれのマイドライブにある
--
-- 未作成でも API の読み書きが失敗するだけで、名前で探す従来の動きになる。
create table if not exists google_project_folders (
  project_id  text not null references projects(id) on delete cascade,
  scope_key   text not null,
  folder_id   text not null,
  updated_at  timestamptz not null default now(),
  primary key (project_id, scope_key)
);

-- 「このフォルダを他のプロジェクトも使っているか」を引く（rename-project-folder）
create index if not exists google_project_folders_folder_id_idx on google_project_folders (folder_id);

alter table google_project_folders enable row level security;

-- ★ ポリシーを1本も作らない = anon / authenticated からは一切読めない。
--   読み書きは api/google/[action].ts (service_role = RLSバイパス) からのみ行う
--   （google_file_grants と同じ扱い）。
drop policy if exists "auth_select_google_project_folders" on google_project_folders;
drop policy if exists "auth_insert_google_project_folders" on google_project_folders;
drop policy if exists "auth_update_google_project_folders" on google_project_folders;
drop policy if exists "auth_delete_google_project_folders" on google_project_folders;
