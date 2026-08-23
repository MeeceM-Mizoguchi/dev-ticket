-- GitHub連携（docs/github-integration-design.md）
-- Supabase Dashboard → SQL Editor で実行してください。
--
-- 権限（githubPermission）は project_member_permissions / permission_groups の
-- jsonb にキーが増えるだけなので、ここでの追加は不要。

-- ── Ⅱ. インストール（GitHub組織ごとに1つ） ──────────────────────────────────
-- App のインストールは GitHub の組織単位で行うため、プロジェクトではなく
-- Dev Ticket の組織に対して1行持つ。
create table if not exists github_installations (
  organization_id   text primary key,
  installation_id   text not null,
  account_login     text not null,          -- 接続先の GitHub 組織名（表示用）
  account_type      text,                   -- Organization / User
  repo_selection    text,                   -- all / selected
  connected_by      uuid,
  connected_at      timestamptz not null default now(),
  revoked_at        timestamptz default null
);

alter table github_installations enable row level security;

-- 読み取りは同一組織のメンバーのみ。書き込みはサーバー(service_role)だけが行う。
drop policy if exists github_installations_select on github_installations;
-- profiles.organization_id は環境により uuid / text のどちらもあり得るため ::text で明示比較する
-- （add_knowledge_ai.sql の can_access_project() と同じ理由）。
create policy github_installations_select on github_installations
  for select using (
    organization_id::text = (select organization_id::text from profiles where id = auth.uid())
  );

-- ── Ⅲ. プロジェクト×リポジトリ ─────────────────────────────────────────────
alter table projects add column if not exists github_repo_full_name text default null;
alter table projects add column if not exists github_default_branch text default null;
alter table projects add column if not exists github_enabled boolean not null default false;

-- ── チケットとPR/Issueの紐付け ─────────────────────────────────────────────
create table if not exists ticket_github_links (
  id           bigserial primary key,
  project_id   text not null references projects(id) on delete cascade,
  ticket_id    text not null,
  kind         text not null check (kind in ('pull','issue')),
  number       integer not null,
  title        text,
  state        text,
  url          text,
  linked_by    uuid,
  auto_linked  boolean not null default false,
  auto_reason  text,
  created_at   timestamptz not null default now(),
  unique (project_id, ticket_id, kind, number)
);

create index if not exists idx_ticket_github_links_ticket
  on ticket_github_links (project_id, ticket_id);

alter table ticket_github_links enable row level security;

-- 紐付けの参照はプロジェクトにアクセスできる人。追加・削除はサーバー側で
-- githubPermission = merge を確認したうえで service_role が行う。
drop policy if exists ticket_github_links_select on ticket_github_links;
create policy ticket_github_links_select on ticket_github_links
  for select using (can_access_project(project_id));

-- ── 書き込み操作の監査ログ ──────────────────────────────────────────────────
-- GitHub 上は App(bot) 名義になるため、「誰が実行したか」はこちらに必ず残す。
create table if not exists github_action_logs (
  id          bigserial primary key,
  project_id  text not null references projects(id) on delete cascade,
  actor_id    uuid not null,
  actor_name  text,
  action      text not null,        -- merge / approve / request_changes / comment
  repo        text not null,
  pr_number   integer,
  result      text not null,        -- ok / error
  detail      text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_github_action_logs_project
  on github_action_logs (project_id, created_at desc);

alter table github_action_logs enable row level security;

-- 参照は同一組織の管理者のみ。insert はサーバー(service_role)だけ。
drop policy if exists github_action_logs_select on github_action_logs;
create policy github_action_logs_select on github_action_logs
  for select using (
    exists (
      select 1 from projects p
      where p.id = github_action_logs.project_id
        and p.organization_id::text = (select organization_id::text from profiles where id = auth.uid())
    )
  );

-- ── プラン ────────────────────────────────────────────────────────────────
-- 未適用の環境では PlanContext 側が true 扱いにするため、既定は true。
alter table plans add column if not exists feature_github boolean not null default true;
