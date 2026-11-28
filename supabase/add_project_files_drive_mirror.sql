-- ============================================================
-- KAIZEN2611-024 ファイルボックスのフォルダとファイルを、Googleドライブ（共有ドライブ）にも同じ形で写す
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
-- ============================================================
--
-- 共有ドライブ運用の組織では、ファイルボックスのフォルダとファイル（PDF・画像・Office文書など）を
-- Drive の「指定したフォルダ/プロジェクト名/」の下にも同じ形で入れる（Dev Ticket → Drive の片方向）。
-- 写しの処理は api/google/[action].ts の mirror-sync / mirror-trash。
--
-- 列（すべて project_files）
--   drive_mirror_id      … Drive の写しの ID。フォルダの行は Drive のフォルダの ID、
--                          ファイルの行は写したファイルの ID（同じファイルの全版の行に同じ値を書く）。
--                          Googleのファイル（external_provider = 'google'）は使わない（external_id が実体）
--   drive_mirror_version … Drive に入れた版（ファイルの行だけ）。最新の版のほうが大きければ入れ直す
--   drive_mirror_parent  … Drive で置いたフォルダの ID。ファイルボックスで移したかを、Drive に問い合わせずに見分ける。
--                          Googleのファイルは、ファイルボックスのフォルダに対応する Drive のフォルダへ移したかに使う
--   drive_mirror_name    … Drive に付けた名前。ファイルボックスで名前を変えたかを見分ける
--   drive_mirror_error   … 反映に失敗した理由（成功したら null に戻す）
--
-- この SQL を当てるまでは、写しの処理は「not_migrated」として何もしない（今までどおりの動き）。
-- 既存の登録・更新はこれらの列に触れないので、当てる前でも壊れない。

alter table project_files add column if not exists drive_mirror_id text;
alter table project_files add column if not exists drive_mirror_version integer;
alter table project_files add column if not exists drive_mirror_parent text;
alter table project_files add column if not exists drive_mirror_name text;
alter table project_files add column if not exists drive_mirror_error text;

-- ── 写しの処理を同じプロジェクトで重ねて走らせないための鍵 ──────────
-- 2つのタブ・2人が同時にファイルボックスを開くと、同じフォルダを2つ作ってしまうため。
-- locked_until を過ぎていれば誰でも取り直せる（処理の途中で関数が落ちても、時間が来れば外れる）。
create table if not exists google_drive_mirror_locks (
  project_id    text not null primary key references projects(id) on delete cascade,
  locked_until  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table google_drive_mirror_locks enable row level security;

-- ★ ポリシーを1本も作らない = anon / authenticated からは一切読めない。
--   読み書きは api/google/[action].ts (service_role = RLSバイパス) からのみ行う
--   （google_project_folders と同じ扱い）。
drop policy if exists "auth_select_google_drive_mirror_locks" on google_drive_mirror_locks;
drop policy if exists "auth_insert_google_drive_mirror_locks" on google_drive_mirror_locks;
drop policy if exists "auth_update_google_drive_mirror_locks" on google_drive_mirror_locks;
drop policy if exists "auth_delete_google_drive_mirror_locks" on google_drive_mirror_locks;
