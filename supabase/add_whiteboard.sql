-- ============================================================
-- ホワイトボード機能 追加（リアルタイム共同編集 / Excalidraw + Yjs）
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── Whiteboards（1プロジェクトに複数） ────────────────────────
-- doc_state: Yjs ドキュメントの状態を base64 エンコードして保持（永続復元用）。
-- 図形・カーソル・チャットのライブ同期は Realtime Broadcast/awareness で行い、
-- DB は「後入り参加者の復元」用スナップショットのみを担う。
create table if not exists whiteboards (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  title       text not null default '無題のボード',
  doc_state   text not null default '',   -- Yjs state (base64)
  preview     jsonb not null default '{}',-- 一覧サムネ用の軽量要約（任意）
  created_by  text not null default '',
  updated_by  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table whiteboards enable row level security;
create policy "auth_select_whiteboards" on whiteboards for select using (auth.role()='authenticated');
create policy "auth_insert_whiteboards" on whiteboards for insert with check (auth.role()='authenticated');
create policy "auth_update_whiteboards" on whiteboards for update using (auth.role()='authenticated');
create policy "auth_delete_whiteboards" on whiteboards for delete using (auth.role()='authenticated');

create index if not exists idx_whiteboards_project_id on whiteboards(project_id);

-- ── 権限フラグ追加（roles.base_permissions / project_member_permissions は JSONB） ──
-- 議事録・バックログと同型。3段階（none / view / edit）。
update roles set base_permissions = base_permissions
  || '{"whiteboardPermission":"edit","canAccessWhiteboard":true}'::jsonb
  where name in ('admin','project-manager');
update roles set base_permissions = base_permissions
  || '{"whiteboardPermission":"none","canAccessWhiteboard":false}'::jsonb
  where name in ('developer','designer');

-- 既存メンバーの未設定行を none で初期化（fix_permissions_data.sql と同型）
update project_member_permissions
  set permissions = permissions || '{"whiteboardPermission":"none"}'::jsonb
  where not (permissions ? 'whiteboardPermission');
