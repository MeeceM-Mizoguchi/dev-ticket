-- ============================================================
-- plansテーブルに feature_bulk_create カラムを追加
-- Supabaseダッシュボードの SQL Editor で実行してください
-- https://supabase.com/dashboard → SQL Editor → New query
-- ============================================================

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS feature_bulk_create boolean NOT NULL DEFAULT true;
