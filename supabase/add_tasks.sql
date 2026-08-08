-- ============================================================
-- ENHA2-032 タスク管理機能
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
--
-- 設計: docs/ENHA2-032-task-management-design.md
--   ・チケット(sprint_tickets)とは別の軽量タスク。未着手/進行中/完了の3状態のみ
--   ・project_id は nullable。null=個人タスク / 値あり=プロジェクト共有タスク
--   ・タスク単位で特定メンバーへ共有できる(task_shares)
--   ・organization_id は持たない。スコープは owner_id と project_id から決まる
--     (organizations.id は環境により uuid/text が揺れるため、新テーブルでは触らない)
-- ============================================================

-- ── タスク本体 ────────────────────────────────────────────────
create table if not exists tasks (
  id           uuid        primary key default gen_random_uuid(),

  -- 所有者。RLS の基点。profiles.id = auth.users.id
  owner_id     uuid        not null references profiles(id) on delete cascade,
  -- 表示用の作成者名（既存テーブルと同じく profiles.name を非正規化して持つ）
  created_by   text        not null default '',

  -- null = 個人タスク / 値あり = プロジェクトタスク（PJメンバー全員が見える）
  project_id   text        references projects(id) on delete cascade,

  -- サブタスクの親。null = 親タスク。子チケットと同じく現在は1階層のみ（子は子を持てない）。
  -- 親を消したら子も消える（子だけ残っても意味を成さないため）
  parent_id    uuid        references tasks(id) on delete cascade,

  title        text        not null,
  description  text        not null default '',      -- RichEditor の HTML

  -- 分類。チケットの ticket_categories とは切り離した自由入力（個人タスクにも付けたいため）。
  -- 入力欄では既に使われている分類が候補に出る
  category     text        not null default '',

  -- 'in-progress' はハイフン付き。TicketStatus / BacklogStatus と綴りを揃えてある
  status       text        not null default 'todo'
                 check (status in ('todo','in-progress','done')),
  priority     text        not null default 'medium'
                 check (priority in ('high','medium','low')),

  -- 担当者は profiles.name。既存(sprint_tickets.assignee / action_memos.user_name)に合わせる
  assignee     text        not null default '',

  start_date   date,
  due_date     date,

  -- チケット紐付け。チケットが消えてもタスクは残す(表示用に wbs を非正規化)
  ticket_id    text        references sprint_tickets(id) on delete set null,
  ticket_wbs   text        not null default '',

  -- かんばん列内・リストの並び。前後の中点を採る gap 方式なので double precision
  sort_order   double precision not null default 0,

  completed_at timestamptz,                          -- done へ移った時刻
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 既に tasks を作ったあとで適用した場合のための後付け（初回は上の create で入っている）
alter table tasks add column if not exists parent_id uuid references tasks(id) on delete cascade;
alter table tasks add column if not exists category  text not null default '';

create index if not exists idx_tasks_owner   on tasks(owner_id, status);
create index if not exists idx_tasks_parent  on tasks(parent_id) where parent_id is not null;
create index if not exists idx_tasks_project on tasks(project_id) where project_id is not null;
create index if not exists idx_tasks_ticket  on tasks(ticket_id)  where ticket_id  is not null;
create index if not exists idx_tasks_order   on tasks(status, sort_order);

-- ── 共有 ──────────────────────────────────────────────────────
-- 担当者に指名した相手にはアプリ側が自動で1行入れる
-- (個人タスクを他人に振ったのに相手から見えない、という事故を防ぐ)
create table if not exists task_shares (
  task_id    uuid not null references tasks(id)    on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  can_edit   boolean not null default true,   -- false = 閲覧のみ共有
  created_at timestamptz not null default now(),
  primary key (task_id, profile_id)
);

create index if not exists idx_task_shares_profile on task_shares(profile_id);

-- ── RLS の再帰よけ ────────────────────────────────────────────
-- tasks のポリシーが task_shares を見て、task_shares のポリシーが tasks を見ると
-- RLS が循環して 500 になる(ENHA2-029 グループ通話で実際に踏んだ)。
-- 両方向とも security definer 関数を挟んで RLS を迂回する。

-- 自分に共有されているか(task_shares の RLS を経由しない)
create or replace function is_task_shared_with_me(p_task_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.task_shares s
    where s.task_id = p_task_id and s.profile_id = auth.uid()
  )
$$;

-- 自分が所有者か(tasks の RLS を経由しない)
create or replace function is_task_owner(p_task_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id and t.owner_id = auth.uid()
  )
$$;

-- ── ポリシー ──────────────────────────────────────────────────
-- プロジェクトのアクセス判定 can_access_project(text) は
-- supabase/add_knowledge_ai.sql で作成済みのものをそのまま使う。
alter table tasks       enable row level security;
alter table task_shares enable row level security;

drop policy if exists "tasks_select" on tasks;
drop policy if exists "tasks_insert" on tasks;
drop policy if exists "tasks_update" on tasks;
drop policy if exists "tasks_delete" on tasks;
drop policy if exists "task_shares_select" on task_shares;
drop policy if exists "task_shares_write"  on task_shares;

-- 参照: 所有者 / 共有された人 / プロジェクトメンバー
create policy "tasks_select" on tasks for select using (
  owner_id = auth.uid()
  or is_task_shared_with_me(id)
  or (project_id is not null and can_access_project(project_id))
);

-- 作成: 自分名義でのみ。PJタスクはそのPJにアクセスできる人だけ
create policy "tasks_insert" on tasks for insert with check (
  owner_id = auth.uid()
  and (project_id is null or can_access_project(project_id))
);

-- 更新: 所有者 / 編集可で共有された人 / PJメンバー
-- (ここは tasks のポリシー内から task_shares を読む向き。task_shares_select は
--  tasks を関数経由でしか見ないため循環しない)
create policy "tasks_update" on tasks for update using (
  owner_id = auth.uid()
  or exists (select 1 from task_shares s
             where s.task_id = tasks.id and s.profile_id = auth.uid() and s.can_edit)
  or (project_id is not null and can_access_project(project_id))
);

-- 削除: 所有者のみ(共有された人・PJメンバーは消せない)
create policy "tasks_delete" on tasks for delete using (owner_id = auth.uid());

-- 共有行: 自分宛の行は読める。付け外しはタスク所有者のみ
create policy "task_shares_select" on task_shares for select using (
  profile_id = auth.uid() or is_task_owner(task_id)
);
create policy "task_shares_write" on task_shares for all
  using (is_task_owner(task_id)) with check (is_task_owner(task_id));
