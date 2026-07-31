-- ============================================================
-- Fix: profiles.role の固定値 CHECK 制約を撤廃
--   roles テーブルでカスタムロール（例: SIC様）を追加できるのに、
--   profiles.role が ('admin','project-manager','developer','designer')
--   に固定されていて保存時に profiles_role_check 違反になる問題を解消する。
--   Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 既存の固定値チェック制約を削除
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- 空文字だけは弾く軽い制約に置き換える（ロール名は roles テーブル側で管理）
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check CHECK (role <> '');
