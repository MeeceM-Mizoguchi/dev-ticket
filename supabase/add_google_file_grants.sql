-- ============================================================
-- Googleファイルを開く前の権限付与の記録
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
-- ============================================================
--
-- ファイルボックスから Googleファイルを開くとき、api/google/[action].ts の ensure-access が
-- 本人の紐づけたGoogleアカウントへ編集権限を付けてから開く。
-- 毎回 Drive へ付与を頼むと開くまで1秒ほど待たされるので、付けたことをここに記録し、
-- 期限（API 側の GRANT_RECORD_TTL_MS = 30日）内は付与を省く。
--
-- google_email は小文字で保存する（Google のアドレスは大文字小文字を区別しない）。
-- 紐づけを別のアカウントに変えた場合はアドレスが変わるので、記録は自然に使われなくなる。
create table if not exists google_file_grants (
  file_id      uuid not null references project_files(id) on delete cascade,
  google_email text not null,
  granted_at   timestamptz not null default now(),
  primary key (file_id, google_email)
);

alter table google_file_grants enable row level security;

-- ★ ポリシーを1本も作らない = anon / authenticated からは一切読めない。
--   読み書きは api/google/[action].ts (service_role = RLSバイパス) からのみ行う
--   （google_drive_tokens と同じ扱い。誰がどのファイルを開けるかの情報なので画面には出さない）。
drop policy if exists "auth_select_google_file_grants" on google_file_grants;
drop policy if exists "auth_insert_google_file_grants" on google_file_grants;
drop policy if exists "auth_update_google_file_grants" on google_file_grants;
drop policy if exists "auth_delete_google_file_grants" on google_file_grants;
