-- ============================================================
-- 議事録 / バックログ フォルダ機能追加（Wiki と同じ仕様）
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
-- Wiki(wiki_pages) は is_folder + parent_id で階層を持っている。
-- 議事録(meeting_minutes) とバックログ(backlog_items) にも同じ列を足して、
-- 「フォルダ行」を同じテーブルに混ぜる方式に揃える。
-- ・is_folder = true の行がフォルダ。本文/日付/優先度などの列は使わない。
-- ・parent_id は自己参照。NULL = ルート直下。フォルダを消すと中身も消える。
--   （議事録はDBのcascade、バックログはアプリ側で再帰削除。理由は下のコメント参照）

-- ── 議事録 ───────────────────────────────────────────────────
alter table meeting_minutes add column if not exists is_folder  boolean not null default false;
alter table meeting_minutes add column if not exists parent_id  uuid references meeting_minutes(id) on delete cascade;
alter table meeting_minutes add column if not exists sort_order int not null default 0;

create index if not exists idx_meeting_minutes_parent_id on meeting_minutes(parent_id);

-- ── バックログ ───────────────────────────────────────────────
-- backlog_items.id は "B-001" 形式の text。フォルダは "BF-001" 形式で採番するため
-- 既存の採番(like 'B-%')とは衝突しない。
--
-- 注意: backlog_items の主キーは id 単独ではない（project_id を含む複合キー）ため、
-- id を参照する外部キーは張れない（ERROR 42830: no unique constraint matching given keys）。
-- bug_reports.backlog_item_id が「FK制約なし」なのと同じ事情。
-- そのため parent_id は参照制約なしの text にして、フォルダ削除時の配下削除は
-- アプリ側(BacklogPage.handleDelete)で再帰的に行う。
-- 万一 parent_id が迷子になっても、ツリー構築側は親が見つからない行をルート直下として扱う。
alter table backlog_items add column if not exists is_folder boolean not null default false;
alter table backlog_items add column if not exists parent_id text;

create index if not exists idx_backlog_items_parent_id on backlog_items(parent_id);
