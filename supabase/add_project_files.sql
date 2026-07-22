-- ============================================================
-- ENHA2-035 ファイルボックス機能
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── Storage バケット ─────────────────────────────────────────
-- 社外秘ファイルを想定するため public = false。
-- 既存の ticket-files / ticket-images (public) と異なり、公開URLは発行しない。
-- 読み取りは api/project-files/signed-url.ts が service_role で発行する
-- 短命(60秒)の署名付きURL経由のみ。
insert into storage.buckets (id, name, public, file_size_limit)
values ('project-files', 'project-files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

-- ★ storage.objects へのポリシーは「1本も作らないこと」。Dashboard での手作業も不要。
--   クライアントは storage を直接触らず、アップロード/閲覧/削除をすべて
--   api/project-files/[action].ts (service_role = RLSバイパス) 経由で行う。
--   そこで毎回「プロジェクトメンバーか」を検証しているため、
--   ポリシーを足すとかえってその検証を迂回できてしまう。
--   （アップロードは署名付きアップロードURLでブラウザ→ストレージへ直接送るので、
--     サーバーレス関数のリクエストサイズ上限には縛られない）

-- ── project_files テーブル ───────────────────────────────────
-- ticket_source_files と同じ構成だが、file_url は保持しない。
-- 公開URLが存在しないため storage 上のパス(file_path)のみを持ち、都度署名する。
create table if not exists project_files (
  id           uuid primary key default gen_random_uuid(),
  project_id   text not null references projects(id) on delete cascade,
  folder_path  text not null default '',  -- 将来のフォルダ階層用。Phase1 は '' 固定
  file_name    text not null,
  file_size    bigint not null default 0,
  file_type    text not null default '',
  file_path    text not null,
  version      int  not null default 1,   -- 同名ファイルの再アップロードで加算
  uploaded_by  text not null default '',
  created_at   timestamptz not null default now()
);

alter table project_files enable row level security;

drop policy if exists "auth_select_project_files" on project_files;
create policy "auth_select_project_files" on project_files for select using (auth.role()='authenticated');
drop policy if exists "auth_insert_project_files" on project_files;
create policy "auth_insert_project_files" on project_files for insert with check (auth.role()='authenticated');
drop policy if exists "auth_update_project_files" on project_files;
create policy "auth_update_project_files" on project_files for update using (auth.role()='authenticated');
drop policy if exists "auth_delete_project_files" on project_files;
create policy "auth_delete_project_files" on project_files for delete using (auth.role()='authenticated');

create index if not exists idx_project_files_project_id on project_files(project_id);
create index if not exists idx_project_files_listing on project_files(project_id, created_at desc);

-- ── 権限について ─────────────────────────────────────────────
-- ファイルボックスは Wiki/バックログ等と違い、ページ単位のアクセス権限を持たない。
-- プロジェクトのメンバーであれば全員が閲覧・追加・削除できる。
-- そのため roles / project_member_permissions に専用フラグは追加しない。
--
-- 実アクセスの制御:
--   画面 … プロジェクトメンバー判定（FileBoxPage のガード）
--   実体 … api/project-files, api/dav がリクエストごとにメンバー判定
--
-- 【既にこのSQLの旧版を実行済みの場合】
-- roles.base_permissions に不要な "canAccessFiles" が残るが、参照している箇所は無いので
-- 実害はない。消したい場合のみ以下を実行する:
--   update roles set base_permissions = base_permissions - 'canAccessFiles';
