-- ============================================================
-- BRU10-068 スプリント並び替え
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
--
-- スプリント一覧の表示順をドラッグ&ドロップで自由に決められるようにする。
-- 並び順は「プロジェクト全体（全員に適用）」と「個人のみに適用」の2種類を持つ。
--   ・member_id が null … そのプロジェクトのメンバー全員に適用される並び順
--   ・member_id が uuid … そのメンバーにだけ適用される並び順（他メンバーには影響しない）
-- 画面側は「個人設定があれば個人設定、無ければ全体設定」の優先度で解決する。
-- ============================================================

create table if not exists sprint_orders (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  -- null = 全員に適用（プロジェクト共通の並び順）
  member_id   uuid references profiles(id) on delete cascade,
  -- sprints.id の配列。ここに無いスプリント（保存後に作られたもの）は末尾に回す
  sprint_ids  text[] not null default '{}',
  updated_by  text not null default '',
  updated_at  timestamptz not null default now()
);

-- プロジェクト共通の並び順は1プロジェクトにつき1件
create unique index if not exists idx_sprint_orders_project_shared
  on sprint_orders(project_id) where member_id is null;

-- 個人の並び順は1プロジェクト×1メンバーにつき1件
create unique index if not exists idx_sprint_orders_project_member
  on sprint_orders(project_id, member_id) where member_id is not null;

-- ── RLS ───────────────────────────────────────────────────────
-- 参照・更新ともプロジェクトにアクセスできるメンバーのみ。
-- 「全員に適用」で保存したときに他メンバーの個人設定も消す必要があるため、
-- 自分以外の行に対する delete も許可している（can_access_project 内に限定）。
alter table sprint_orders enable row level security;

drop policy if exists "sprint_orders_all" on sprint_orders;
create policy "sprint_orders_all" on sprint_orders
  for all
  using      (can_access_project(project_id))
  with check (can_access_project(project_id));

-- ============================================================
-- 動作確認クエリ（任意）
-- ============================================================
-- select project_id, member_id, sprint_ids, updated_by, updated_at from sprint_orders;
