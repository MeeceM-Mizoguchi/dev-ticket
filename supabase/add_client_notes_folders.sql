-- ============================================================
-- クライアント打ち合わせメモ(client_notes) フォルダ機能追加（議事録と同じ仕様）
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
-- ============================================================
-- add_client_notes.sql 作成時は「件数が限られるのでフラットで足りる」としていたが、
-- 議事録(meeting_minutes)と操作感を揃えるため、同じ is_folder + parent_id 方式を足す。
-- ・is_folder = true の行がフォルダ。日付/参加者/本文の列は使わない。
-- ・parent_id は自己参照。NULL = ルート直下。フォルダを消すと中身も消える(cascade)。

alter table client_notes add column if not exists is_folder  boolean not null default false;
alter table client_notes add column if not exists parent_id  uuid references client_notes(id) on delete cascade;
alter table client_notes add column if not exists sort_order int not null default 0;

create index if not exists idx_client_notes_parent_id on client_notes(parent_id);
