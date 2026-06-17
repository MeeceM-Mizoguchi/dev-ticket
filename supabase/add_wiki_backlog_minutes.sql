-- ============================================================
-- Wiki / バックログ / 議事録 機能追加
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── Backlog Items ────────────────────────────────────────────
-- チケットとは別管理。優先度のついた「種」のリスト。チケット化すると converted_ticket_id が埋まる。
create table if not exists backlog_items (
  id                  text primary key, -- "B-001" 形式（全プロジェクト共通でB固定）
  project_id          text not null references projects(id) on delete cascade,
  title               text not null,
  description         text not null default '',
  status              text not null default 'open'
                        check (status in ('open','in-progress','converted','archived')),
  priority            text not null default 'medium'
                        check (priority in ('low','medium','high')),
  rank                double precision not null default 0,
  assignee            text not null default '',
  estimated_hours     int  not null default 0,
  converted_ticket_id text references sprint_tickets(id) on delete set null,
  created_by          text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table backlog_items enable row level security;
create policy "auth_select_backlog_items" on backlog_items for select using (auth.role()='authenticated');
create policy "auth_insert_backlog_items" on backlog_items for insert with check (auth.role()='authenticated');
create policy "auth_update_backlog_items" on backlog_items for update using (auth.role()='authenticated');
create policy "auth_delete_backlog_items" on backlog_items for delete using (auth.role()='authenticated');

create index if not exists idx_backlog_items_project_id on backlog_items(project_id);

-- ── Wiki Pages ───────────────────────────────────────────────
-- project_id 配下の階層ページ。parent_id で自己参照（NULL = ルート）。
create table if not exists wiki_pages (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  parent_id   uuid references wiki_pages(id) on delete cascade,
  title       text not null default '',
  content     text not null default '',
  sort_order  int  not null default 0,
  created_by  text not null default '',
  updated_by  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table wiki_pages enable row level security;
create policy "auth_select_wiki_pages" on wiki_pages for select using (auth.role()='authenticated');
create policy "auth_insert_wiki_pages" on wiki_pages for insert with check (auth.role()='authenticated');
create policy "auth_update_wiki_pages" on wiki_pages for update using (auth.role()='authenticated');
create policy "auth_delete_wiki_pages" on wiki_pages for delete using (auth.role()='authenticated');

create index if not exists idx_wiki_pages_project_id on wiki_pages(project_id);
create index if not exists idx_wiki_pages_parent_id on wiki_pages(parent_id);

-- ── Meeting Minutes（議事録） ────────────────────────────────
create table if not exists meeting_minutes (
  id           uuid primary key default gen_random_uuid(),
  project_id   text not null references projects(id) on delete cascade,
  title        text not null default '',
  meeting_date date not null default current_date,
  attendees    jsonb not null default '[]',
  content      text not null default '',
  created_by   text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table meeting_minutes enable row level security;
create policy "auth_select_meeting_minutes" on meeting_minutes for select using (auth.role()='authenticated');
create policy "auth_insert_meeting_minutes" on meeting_minutes for insert with check (auth.role()='authenticated');
create policy "auth_update_meeting_minutes" on meeting_minutes for update using (auth.role()='authenticated');
create policy "auth_delete_meeting_minutes" on meeting_minutes for delete using (auth.role()='authenticated');

create index if not exists idx_meeting_minutes_project_id on meeting_minutes(project_id);

-- 議事録本文中の「アクション」項目を action_memos に連携するための参照列
alter table action_memos add column if not exists meeting_minute_id uuid references meeting_minutes(id) on delete set null;

-- ── バックログ項目に分類カラムを追加 ────────────────────────────
alter table backlog_items add column if not exists category_id text references ticket_categories(id) on delete set null;
create index if not exists idx_backlog_items_category_id on backlog_items(category_id);

-- ── 権限フラグ追加（roles.base_permissions に既存JSONBで格納） ──
-- 全ロールにWiki/バックログ/議事録へのアクセスを許可（未設定時はAuthContext側のDEFAULT_PERMISSIONSでfalse扱い）
update roles set base_permissions = base_permissions
  || '{"canAccessWiki":true,"canAccessBacklog":true,"canAccessMinutes":true}'::jsonb
  where name in ('admin','project-manager','developer','designer');
