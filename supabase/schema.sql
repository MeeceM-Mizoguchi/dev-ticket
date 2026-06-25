-- ============================================================
-- Dev Ticket — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── Profiles (extends auth.users) ────────────────────────────
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text        not null,
  email       text        not null,
  role        text        not null default 'developer'
                check (role in ('admin','project-manager','developer','designer')),
  group_name  text        not null default '',
  status      text        not null default 'active'
                check (status in ('active','inactive','invited')),
  project_count int       not null default 0,
  ticket_count  int       not null default 0,
  created_at  timestamptz not null default now()
);

-- Auto-create profile row when a new user signs up
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, name, email, role, group_name, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'developer'),
    coalesce(new.raw_user_meta_data->>'group_name', ''),
    'active'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ── Clients ──────────────────────────────────────────────────
create table if not exists clients (
  id         text primary key,
  name       text not null,
  industry   text not null default '',
  email      text not null default '',
  phone      text not null default '',
  status     text not null default 'active'
               check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);

-- ── Projects ─────────────────────────────────────────────────
create table if not exists projects (
  id          text primary key,
  slug        text not null default '',
  name        text not null,
  client      text not null default '',
  wbs_prefix  text not null default 'T',
  status      text not null default 'planning'
                check (status in ('planning','in-progress','completed','on-hold')),
  start_date  date,
  end_date    date,
  members     text[] not null default '{}',
  tags        text[] not null default '{}',
  done        int   not null default 0,
  in_progress int   not null default 0,
  todo        int   not null default 0,
  description text  not null default '',
  created_at  timestamptz not null default now()
);

-- ── Sprints ──────────────────────────────────────────────────
create table if not exists sprints (
  id         text primary key,
  project_id text not null references projects(id) on delete cascade,
  name       text not null,
  goal       text not null default '',
  identifier text not null default '',
  status     text not null default 'planning'
               check (status in ('planning','active','completed','cancelled')),
  start_date date,
  end_date   date,
  created_at timestamptz not null default now()
);

-- ── Sprint Tickets ────────────────────────────────────────────
create table if not exists sprint_tickets (
  id               text primary key,
  sprint_id        text not null references sprints(id) on delete cascade,
  wbs              text not null default '',
  title            text not null,
  status           text not null default 'todo'
                     check (status in ('todo','in-progress','done')),
  priority         text not null default 'medium'
                     check (priority in ('low','medium','high')),
  assignee         text not null default '',
  start_date       date,
  due_date         date,
  estimated_hours  int  not null default 0,
  progress         int  not null default 0,
  images           jsonb not null default '[]',
  created_at       timestamptz not null default now()
);

-- ── Row Level Security ────────────────────────────────────────
alter table profiles       enable row level security;
alter table clients        enable row level security;
alter table projects       enable row level security;
alter table sprints        enable row level security;
alter table sprint_tickets enable row level security;

-- Authenticated users can read all data
create policy "auth_select_profiles"       on profiles       for select using (auth.role()='authenticated');
create policy "auth_select_clients"        on clients        for select using (auth.role()='authenticated');
create policy "auth_select_projects"       on projects       for select using (auth.role()='authenticated');
create policy "auth_select_sprints"        on sprints        for select using (auth.role()='authenticated');
create policy "auth_select_sprint_tickets" on sprint_tickets for select using (auth.role()='authenticated');

-- Authenticated users can insert / update
create policy "auth_insert_clients"        on clients        for insert with check (auth.role()='authenticated');
create policy "auth_update_clients"        on clients        for update using     (auth.role()='authenticated');
create policy "auth_insert_projects"       on projects       for insert with check (auth.role()='authenticated');
create policy "auth_update_projects"       on projects       for update using     (auth.role()='authenticated');
create policy "auth_insert_sprints"        on sprints        for insert with check (auth.role()='authenticated');
create policy "auth_update_sprints"        on sprints        for update using     (auth.role()='authenticated');
create policy "auth_insert_sprint_tickets" on sprint_tickets for insert with check (auth.role()='authenticated');
create policy "auth_update_sprint_tickets" on sprint_tickets for update using     (auth.role()='authenticated');
create policy "auth_delete_sprint_tickets" on sprint_tickets for delete using     (auth.role()='authenticated');
create policy "auth_delete_sprints"        on sprints        for delete using     (auth.role()='authenticated');
create policy "auth_delete_projects"       on projects        for delete using     (auth.role()='authenticated');
create policy "auth_delete_clients"        on clients         for delete using     (auth.role()='authenticated');
create policy "auth_update_profiles"       on profiles        for update using     (auth.uid()=id);

-- ── Notifications ────────────────────────────────────────────
create table if not exists notifications (
  id           uuid        primary key default gen_random_uuid(),
  user_name    text        not null,
  type         text        not null default 'mention'
                 check (type in ('mention','assign','review_request','revision_request','review_approved','status','comment')),
  title        text        not null,
  body         text        not null default '',
  ticket_id    text,
  ticket_wbs   text        not null default '',
  ticket_title text        not null default '',
  project_slug text        not null default '',
  is_read      boolean     not null default false,
  created_at   timestamptz not null default now()
);
alter table notifications enable row level security;
create policy "auth_select_notifications" on notifications for select using (auth.role()='authenticated');
create policy "auth_insert_notifications" on notifications for insert with check (auth.role()='authenticated');
create policy "auth_update_notifications" on notifications for update using (auth.role()='authenticated');
create policy "auth_delete_notifications" on notifications for delete using (auth.role()='authenticated');

-- ── Plans ────────────────────────────────────────────────────
create table if not exists plans (
  id                      text primary key,
  name                    text not null,
  is_system               boolean not null default false,
  account_expires_at      timestamptz,
  max_members             int,
  max_projects            int,
  max_sprints_per_project int,
  max_tickets_per_sprint  int,
  max_images_per_item     int,
  max_comments_per_ticket int,
  max_filters_per_sprint  int,
  feature_notifications   boolean not null default true,
  feature_csv_export      boolean not null default true,
  feature_actual_monitor  boolean not null default true,
  feature_child_tickets   boolean not null default true,
  created_at              timestamptz not null default now()
);

alter table plans enable row level security;
create policy "auth_select_plans" on plans for select using (auth.role()='authenticated');
create policy "auth_insert_plans" on plans for insert with check (auth.role()='authenticated');
create policy "auth_update_plans" on plans for update using (auth.role()='authenticated');
create policy "auth_delete_plans" on plans for delete using (auth.role()='authenticated');

-- system "無制限" plan (always exists, cannot be deleted)
insert into plans (id, name, is_system) values ('system-unlimited', '無制限', true)
on conflict (id) do nothing;

-- ── Migrations (run manually in Supabase SQL Editor) ─────────
-- ENHA-034: plansテーブルと organizations.plan_id 追加（初回のみ実行）
-- 上記 plans テーブルの create table 文をそのまま実行する
-- alter table organizations add column if not exists plan_id text references plans(id) on delete set null;

-- generated_prompt カラム追加（初回のみ実行）
-- alter table sprint_tickets add column if not exists generated_prompt text;
-- notifications テーブル追加（初回のみ実行）
-- 上記 notifications テーブルの create table 文をそのまま実行する

-- 実績モニタ マイルストーンカラム追加（チケット単位 / 初回のみ実行）
-- alter table sprint_tickets add column if not exists started_at timestamptz;
-- alter table sprint_tickets add column if not exists review_requested_at timestamptz;
-- alter table sprint_tickets add column if not exists review_approved_at timestamptz;
-- alter table sprint_tickets add column if not exists stg_completed_at timestamptz;
-- alter table sprint_tickets add column if not exists uat_completed_at timestamptz;
-- alter table sprint_tickets add column if not exists released_at timestamptz;

-- リリースノート機能追加（初回のみ実行）
-- ステータス CHECK 制約を新ステータスに対応させる
-- alter table sprint_tickets drop constraint if exists sprint_tickets_status_check;
-- alter table sprint_tickets add constraint sprint_tickets_status_check
--   check (status in ('todo','in-progress','in-review','review-done','stg-test','uat','done','closed','waiting-release','released'));
-- リリース日カラム追加
-- alter table sprint_tickets add column if not exists release_date date;
-- alter table sprint_tickets add column if not exists is_release_date_undecided boolean not null default false;
