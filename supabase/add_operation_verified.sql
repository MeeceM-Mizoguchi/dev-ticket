-- ============================================================
-- 動作確認チェック機能追加
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- sprint_tickets に動作確認済みフラグを追加
alter table sprint_tickets
  add column if not exists is_operation_verified boolean not null default false;

-- 既存のリリース済みチケットは動作確認完了とみなす
update sprint_tickets
set is_operation_verified = true
where status = 'released';
