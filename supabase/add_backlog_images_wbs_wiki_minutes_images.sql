-- ============================================================
-- バックログ画像・WBS / Wiki画像 / 議事録画像 追加
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- backlog_items: チケット化時のWBSと画像配列を追加
ALTER TABLE backlog_items ADD COLUMN IF NOT EXISTS converted_ticket_wbs text;
ALTER TABLE backlog_items ADD COLUMN IF NOT EXISTS images text[] NOT NULL DEFAULT '{}';

-- wiki_pages: 画像配列を追加
ALTER TABLE wiki_pages ADD COLUMN IF NOT EXISTS images text[] NOT NULL DEFAULT '{}';

-- meeting_minutes: 画像配列を追加
ALTER TABLE meeting_minutes ADD COLUMN IF NOT EXISTS images text[] NOT NULL DEFAULT '{}';
