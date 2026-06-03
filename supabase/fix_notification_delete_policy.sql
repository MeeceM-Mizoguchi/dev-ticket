-- ============================================================
-- notifications テーブル: hidden_at カラム追加
-- ============================================================
-- 【必須】Supabase Dashboard → SQL Editor → New query に
--         このファイルの内容を貼り付けて実行してください。
--
-- 背景: DELETE RLS ポリシーが機能しないため、
--       UPDATE を使ったソフトデリート方式に変更します。
--       UPDATE ポリシーは既に動作しています（既読機能が証拠）。
-- ============================================================

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

-- 確認
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'notifications' AND column_name = 'hidden_at';
