-- ============================================================
-- BRU12-025 ファイルボックスのコメント機能
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- ホワイトボードのコメント（ENHA2-039）と同じ操作感を、ファイルビューアの上に載せる。
-- ただし保存先は Yjs ではなくこのテーブル。ホワイトボードは Excalidraw の要素と同じ
-- Yjs Doc に相乗りできたが、ファイルビューアには共有ドキュメントが無いため。
--
-- 【なぜ file_id ではなく (project_id, file_name) で引くのか】
-- ファイルボックスは「同名ファイル＝同じファイルの版」という作りで、保存や再アップロードの
-- たびに project_files の行が増える（一覧は最新版だけを見せる）。コメントを file_id に
-- 縛ると、版が上がった瞬間に全コメントが消えたように見える。そのため引き当ては
-- (project_id, file_name) で行い、file_id は「どの版に対して書かれたか」の記録として持つ。
-- FK は張らない（古い版の行が消えてもコメントを失わないため）。ファイル自体を削除した時の
-- 後始末は api/project-files/[action].ts の delete が同じ条件でまとめて行う。

create table if not exists project_file_comments (
  id           uuid primary key default gen_random_uuid(),
  project_id   text not null references projects(id) on delete cascade,
  -- 書かれた時点の版（表示には使わない。調査用）
  file_id      uuid,
  -- 引き当てキー。project_files.file_name と同じ値
  file_name    text not null,
  -- 返信なら親コメントのid。null なら親コメント本体。
  -- 返信を別テーブルにせず1テーブルで持つのは、一覧・削除・後始末が1本で済むため。
  reply_to     uuid references project_file_comments(id) on delete cascade,
  -- ピンの位置。ビューアの内容ボックスに対する 0..1 の割合で持つ。
  -- 画面幅やズームが変わってもだいたい同じ場所を指すようにするため、px ではなく割合。
  -- 返信は位置を持たない（親のピンにぶら下がる）ので 0 のまま。
  x            double precision not null default 0,
  y            double precision not null default 0,
  user_id      text not null default '',
  user_name    text not null default '',
  body         text not null default '',
  -- 解決済み。true のピンはビューアから消え、コメント一覧の「解決済み」タブへ移る
  resolved     boolean not null default false,
  resolved_at  timestamptz,
  resolved_by_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

alter table project_file_comments enable row level security;

-- ポリシーは project_files と同じ粒度。ファイルボックスはページ単位の権限を持たず、
-- 「プロジェクトメンバーなら全員が読み書きできる」ため（add_project_files.sql の方針）。
-- 投稿者本人しか編集・削除できない制限はアプリ側で担保する（ホワイトボードのコメントと同じ）。
drop policy if exists "auth_select_project_file_comments" on project_file_comments;
create policy "auth_select_project_file_comments" on project_file_comments for select using (auth.role()='authenticated');
drop policy if exists "auth_insert_project_file_comments" on project_file_comments;
create policy "auth_insert_project_file_comments" on project_file_comments for insert with check (auth.role()='authenticated');
drop policy if exists "auth_update_project_file_comments" on project_file_comments;
create policy "auth_update_project_file_comments" on project_file_comments for update using (auth.role()='authenticated');
drop policy if exists "auth_delete_project_file_comments" on project_file_comments;
create policy "auth_delete_project_file_comments" on project_file_comments for delete using (auth.role()='authenticated');

-- ビューアを開くたびに (project_id, file_name) で全件引くので、この複合索引が主役。
create index if not exists idx_project_file_comments_file
  on project_file_comments(project_id, file_name, created_at);
create index if not exists idx_project_file_comments_reply_to
  on project_file_comments(reply_to);
