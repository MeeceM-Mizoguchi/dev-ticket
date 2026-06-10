-- ============================================================
-- action_memos テーブル追加
-- アクションリスト機能: 手動メモ＋お知らせからの追加
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

create table if not exists action_memos (
  id                    uuid        primary key default gen_random_uuid(),
  user_name             text        not null,
  title                 text        not null default '',
  content               text        not null default '',
  -- category: todo=開発TODO, review=レビュータスク, test=テスト実行, memo=メモ
  category              text        not null default 'memo'
                          check (category in ('todo', 'review', 'test', 'memo')),
  -- お知らせから追加した場合の通知ID（削除しても独立して残る）
  source_notification_id uuid,
  ticket_id             text,
  ticket_wbs            text        not null default '',
  ticket_title          text        not null default '',
  project_slug          text        not null default '',
  project_id            text        not null default '',
  sprint_id             text        not null default '',
  is_done               boolean     not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table action_memos enable row level security;

create policy "auth_select_action_memos" on action_memos
  for select using (auth.role() = 'authenticated');
create policy "auth_insert_action_memos" on action_memos
  for insert with check (auth.role() = 'authenticated');
create policy "auth_update_action_memos" on action_memos
  for update using (auth.role() = 'authenticated');
create policy "auth_delete_action_memos" on action_memos
  for delete using (auth.role() = 'authenticated');
