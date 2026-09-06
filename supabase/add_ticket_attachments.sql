-- ============================================================
-- チケットの添付ファイル（画像以外も添付できるようにする）
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- sprint_tickets.images（画像URLの配列）と対になる仕組み。
-- ファイルは表示名・サイズ・種別を持たせたいので配列列ではなく別テーブルにする。
-- 実体は既存の public バケット `ticket-files` に置く（ソースファイルと同居）。
-- ストレージのキーには日本語を使わず、表示名は file_name 列で持つ
-- （api/project-files/[action].ts の upload-url と同じ方針）。
-- ============================================================

create table if not exists ticket_attachments (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   text not null references sprint_tickets(id) on delete cascade,
  file_name   text not null,                    -- 表示名（日本語可）
  file_size   bigint not null default 0,
  file_type   text not null default '',         -- MIME タイプ
  file_path   text not null default '',         -- ticket-files バケット内のキー
  file_url    text not null default '',         -- 公開URL
  uploaded_by text not null default '',
  created_at  timestamptz not null default now()
);

-- BUG-01 対策の安定ソート（created_at, id）で引くための索引
create index if not exists idx_ticket_attachments_ticket
  on ticket_attachments (ticket_id, created_at, id);

alter table ticket_attachments enable row level security;

drop policy if exists "ta_select" on ticket_attachments;
create policy "ta_select" on ticket_attachments for select using (auth.role() = 'authenticated');
drop policy if exists "ta_insert" on ticket_attachments;
create policy "ta_insert" on ticket_attachments for insert with check (auth.role() = 'authenticated');
drop policy if exists "ta_update" on ticket_attachments;
create policy "ta_update" on ticket_attachments for update using (auth.role() = 'authenticated');
drop policy if exists "ta_delete" on ticket_attachments;
create policy "ta_delete" on ticket_attachments for delete using (auth.role() = 'authenticated');

-- ticket-files バケットが未作成の環境向け（既にあれば public を維持するだけ）
insert into storage.buckets (id, name, public, file_size_limit)
values ('ticket-files', 'ticket-files', true, 52428800)
on conflict (id) do update set public = true;
