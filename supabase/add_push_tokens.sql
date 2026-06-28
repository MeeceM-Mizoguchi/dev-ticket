-- ============================================================
-- device_tokens テーブル: プッシュ通知(APNs)用デバイストークン
-- ============================================================
-- 【必須】Supabase Dashboard → SQL Editor → New query に
--         このファイルの内容を貼り付けて実行してください。
--
-- 用途: ENHA2-014 プッシュ通知。Mac/iPad/iPhone のネイティブアプリ起動時に
--       APNs から払い出されたデバイストークンを user_name ごとに保存し、
--       notifications テーブルへの INSERT を契機に該当ユーザーの端末へ
--       OS プッシュ通知を送る（送信処理は api/push-send.ts）。
-- ============================================================

create table if not exists device_tokens (
  id         uuid        primary key default gen_random_uuid(),
  user_name  text        not null,
  token      text        not null unique,        -- APNs デバイストークン（端末ごと一意）
  platform   text        not null default 'ios', -- ios | macos（情報用。iPad/iPhone/Mac はいずれも 'ios'）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_device_tokens_user_name on device_tokens (user_name);

alter table device_tokens enable row level security;

-- notifications と同じ作法（authenticated ロールに許可）。
-- クライアントは自分のトークンを upsert（onConflict: token）するだけ。
drop policy if exists "auth_select_device_tokens" on device_tokens;
drop policy if exists "auth_insert_device_tokens" on device_tokens;
drop policy if exists "auth_update_device_tokens" on device_tokens;
drop policy if exists "auth_delete_device_tokens" on device_tokens;
create policy "auth_select_device_tokens" on device_tokens for select using     (auth.role()='authenticated');
create policy "auth_insert_device_tokens" on device_tokens for insert with check (auth.role()='authenticated');
create policy "auth_update_device_tokens" on device_tokens for update using     (auth.role()='authenticated');
create policy "auth_delete_device_tokens" on device_tokens for delete using     (auth.role()='authenticated');

-- 確認
select column_name, data_type
from information_schema.columns
where table_name = 'device_tokens'
order by ordinal_position;
