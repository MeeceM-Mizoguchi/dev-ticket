-- ============================================================
-- Googleドライブ連携（ファイルボックス）
-- 設計: docs/google-drive-integration-design.md
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
-- ============================================================

-- ── 1. 組織ごとの設定 ────────────────────────────────────────
-- google_drive_mode:
--   'off'          … 使わない（既定）。ファイルボックスにボタン自体を出さない
--   'shared_drive' … その組織の Google Workspace 共有ドライブに保存する
--   'my_drive'     … 各メンバーの個人ドライブ（マイドライブ）に保存する
--
-- 既定を 'off' にしているのは、ファイルボックスが元々
-- 「外部ビューアにファイルを一切渡さない」方針（src/app/lib/projectFiles.ts 冒頭）で
-- 作られているため。Googleへデータを出すことは組織ごとの明示的なオプトインとする。
alter table organizations add column if not exists google_drive_mode text not null default 'off';
alter table organizations add column if not exists google_shared_drive_id text default null;
alter table organizations add column if not exists google_shared_drive_name text default null; -- 表示用

-- 想定外の値が入ると API 側の分岐が素通りするので、DB でも縛る
do $$
begin
  alter table organizations drop constraint if exists organizations_google_drive_mode_check;
  alter table organizations add constraint organizations_google_drive_mode_check
    check (google_drive_mode in ('off', 'shared_drive', 'my_drive'));
exception when others then
  raise notice 'google_drive_mode の制約を追加できませんでした: %', sqlerrm;
end $$;

-- ── 2. OAuth リフレッシュトークン ────────────────────────────
-- ★ projects.slack_access_token のパターンを踏襲しないこと。
--   projects は tenant_select_projects ポリシー（fix_multitenant_rls.sql）で
--   組織メンバーなら行ごと読めるため、そこに置いたトークンは
--   一般メンバーがクライアントから読み出せてしまう。
--   Google のリフレッシュトークンは Drive の読み書き権限そのものなので、
--   service_role だけが触れる専用テーブルに隔離する。
create table if not exists google_drive_tokens (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  organization_id text not null default '',
  google_email    text not null default '',
  refresh_token   text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table google_drive_tokens enable row level security;

-- ★ ポリシーを1本も作らない = anon / authenticated からは一切読めない。
--   読み書きは api/google/[action].ts (service_role = RLSバイパス) からのみ行う。
--   過去に誤って作られたものがあれば落としておく。
drop policy if exists "auth_select_google_drive_tokens" on google_drive_tokens;
drop policy if exists "auth_insert_google_drive_tokens" on google_drive_tokens;
drop policy if exists "auth_update_google_drive_tokens" on google_drive_tokens;
drop policy if exists "auth_delete_google_drive_tokens" on google_drive_tokens;

create index if not exists idx_google_drive_tokens_org on google_drive_tokens(organization_id);

-- 「〇〇@example.com で連携中」と画面に出すためのミラー。
-- こちらは読めてよい情報なので profiles 側に持つ（トークンは持たせない）。
alter table profiles add column if not exists google_email text default null;

-- ── 3. project_files を外部ファイルに対応させる ──────────────
-- Googleファイルは storage に実体を持たない。
--   file_path = ''、file_size = 0、version = 1 固定で、
--   実体の在り処は external_url / external_id が持つ。
-- フォルダ階層 (parent_id) は通常ファイルと全く同じように使える。
alter table project_files add column if not exists external_provider text default null; -- 'google'
alter table project_files add column if not exists external_id       text default null; -- Drive の fileId
alter table project_files add column if not exists external_url      text default null; -- webViewLink
-- リンク共有（type:"anyone"）が有効なファイル。一覧にバッジを出して隠れないようにする
alter table project_files add column if not exists link_shared       boolean not null default false;
alter table project_files add column if not exists link_shared_by    text default null;
alter table project_files add column if not exists link_shared_at    timestamptz default null;

-- 同じ Drive ファイルが二重登録されるのを防ぐ（再試行や二重送信の保険）
create unique index if not exists idx_project_files_external
  on project_files(project_id, external_id) where external_id is not null;

-- ── 権限について ─────────────────────────────────────────────
-- ファイルボックスと同じく、プロジェクトのメンバーであれば全員が作成・閲覧・削除できる。
-- roles / project_member_permissions に専用フラグは追加しない。
--
-- Google 側の権限は別系統で、DevTicket のメンバーシップとは自動同期しない。
-- 詳細は docs/google-drive-integration-design.md の 8.3 を参照。
