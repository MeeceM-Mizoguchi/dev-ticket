-- ============================================================
-- クライアント打ち合わせメモ（client_notes）
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
--
-- 議事録(meeting_minutes)はプロジェクト単位なので、
-- 「プロジェクトに紐づかない、その会社としての打ち合わせ」を書く場所が無かった。
-- クライアント管理から開けるメモをこのテーブルで持つ。
--
-- 構造は meeting_minutes に寄せてあるが、フォルダ階層とアクション項目は持たない
-- （会社メモは件数が限られるため、フラットな一覧＋検索で足りる）。
-- ============================================================

-- ログインユーザーの organization_id（fix_multitenant_rls.sql と同一定義）。
-- この SQL 単体でも流せるように再掲している。
create or replace function get_my_org_id()
returns text
language sql
stable
security definer
as $$
  select organization_id from public.profiles where id = auth.uid()
$$;

create table if not exists client_notes (
  id              uuid primary key default gen_random_uuid(),
  client_id       text not null references clients(id) on delete cascade,
  -- clients と同じ粒度でテナント分離する。clients.organization_id を引き継ぐ。
  organization_id text default null,
  title           text not null default '',
  note_date       date not null default current_date,
  attendees       jsonb not null default '[]',
  content         text not null default '',
  images          jsonb not null default '[]',
  created_by      text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- BUG-01 対策の安定ソート（note_date desc, created_at desc, id）で引くための索引
create index if not exists idx_client_notes_client
  on client_notes (client_id, note_date desc, created_at desc, id);

alter table client_notes enable row level security;

-- clients と同じ判定（owner は全組織／自組織／組織未設定の行）
drop policy if exists "tenant_select_client_notes" on client_notes;
create policy "tenant_select_client_notes" on client_notes
  for select using (
    (select role from public.profiles where id = auth.uid()) = 'owner'
    or organization_id = get_my_org_id()
    or organization_id is null
  );

drop policy if exists "tenant_insert_client_notes" on client_notes;
create policy "tenant_insert_client_notes" on client_notes
  for insert with check (
    (select role from public.profiles where id = auth.uid()) = 'owner'
    or organization_id = get_my_org_id()
    or organization_id is null
  );

drop policy if exists "tenant_update_client_notes" on client_notes;
create policy "tenant_update_client_notes" on client_notes
  for update using (
    (select role from public.profiles where id = auth.uid()) = 'owner'
    or organization_id = get_my_org_id()
    or organization_id is null
  );

drop policy if exists "tenant_delete_client_notes" on client_notes;
create policy "tenant_delete_client_notes" on client_notes
  for delete using (
    (select role from public.profiles where id = auth.uid()) = 'owner'
    or organization_id = get_my_org_id()
    or organization_id is null
  );
