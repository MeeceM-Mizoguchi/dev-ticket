-- ============================================================
-- BRU3-070 システムのバージョン表示
-- ============================================================
-- 【必須】Supabase Dashboard → SQL Editor → New query に
--         このファイルの内容を貼り付けて1回だけ実行してください。
--
-- 目的: ユーザー問い合わせ時に「そのユーザーの画面/アプリが古いバージョンか」を
--       Meece（システム管理会社）が判断できるようにする。
--         - app_version          : デプロイ履歴（1デプロイ=1行）。最新版の真実の源。
--         - organizations.is_system_admin : Meece組織だけがバージョン履歴を閲覧できる判定フラグ。
--         - bug_reports.app_version       : 問い合わせ送信時に自動添付される利用バージョン。
-- ============================================================

-- ── 1) デプロイ履歴テーブル ───────────────────────────────
-- 書込みは postbuild スクリプト（scripts/publish-version.mjs）が service_role で行う。
create table if not exists app_version (
  version     text        primary key,            -- 例: 'v2026.06.28.1322'
  build_time  text        not null default '',     -- ビルド時刻(epoch ms 文字列)
  released_at timestamptz not null default now(),
  note        text
);

create index if not exists idx_app_version_released_at on app_version (released_at desc);

alter table app_version enable row level security;

-- ── 2) Meece（システム管理会社）判定フラグ ────────────────
-- 組織管理画面（オーナー専用）からトグルで設定する。Meece の組織だけ true にする。
alter table organizations add column if not exists is_system_admin boolean not null default false;

-- 現在のユーザーの所属組織が「システム管理会社」か判定する関数。
-- profiles.organization_id と organizations.id の型(uuid/text)が環境により異なり得るため、
-- 両辺を ::text にキャストして比較し、型不一致(operator does not exist)を確実に回避する。
-- security definer で RLS をバイパスし、一般メンバーでも自組織のフラグを判定できるようにする。
create or replace function is_system_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from profiles p
    join organizations o on o.id::text = p.organization_id::text
    where p.id = auth.uid()
      and o.is_system_admin = true
  );
$$;

grant execute on function is_system_admin() to authenticated;

-- ── 3) バージョン履歴の閲覧は「システム管理会社」組織のメンバーのみ ──
-- 一般ユーザーは履歴を見ない（自分の稼働バージョンはバンドル焼込み値を表示するだけ）。
drop policy if exists "system_admin_read_app_version" on app_version;
create policy "system_admin_read_app_version" on app_version for select using (is_system_admin());

-- ── 4) 問い合わせ（bug_reports）に利用バージョンを自動添付 ──
alter table bug_reports add column if not exists app_version text;

-- 確認
select column_name, data_type
from information_schema.columns
where table_name = 'app_version'
order by ordinal_position;
