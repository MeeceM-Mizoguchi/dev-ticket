-- ============================================================
-- BRU25-012 プロジェクトのアーカイブ
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- ・archived_at が空（null）なら「アーカイブされていない」。既存のプロジェクトはすべて null のまま（データの書き換えは無い）
-- ・アーカイブはステータス（status）の値として持たない。手動設定OFFのプロジェクトは
--   ステータスがチケットから再計算されて書き戻されるため、元に戻ってしまう
-- ・アプリ側は、この列が無い環境でも「アーカイブされていない」として動く（列を名指しせず * で読む）
-- ============================================================

alter table projects add column if not exists archived_at timestamptz null;
alter table projects add column if not exists archived_by text null;
