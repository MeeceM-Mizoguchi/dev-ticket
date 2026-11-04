-- ============================================================
-- BRU24-001-1: バックログの親子項目・添付ファイル・番号予約
--
-- Supabase Dashboard → SQL Editor → New query に貼り付けて実行。
-- 冪等: 何度実行しても安全。既存のバックログ項目・フォルダには影響しない（列の追加と新規のみ）。
--
-- 内容:
--   1. backlog_items.parent_item_id … 項目の下にぶら下げる子の項目（1段まで）
--   2. backlog_attachments          … バックログ項目の添付ファイル（ticket_attachments と同じ列構成）
--   3. backlog_id_seq + reserve_backlog_ids() … "B-001" 形式の番号の直列化
--
-- ── backlog_items の主キーについて ────────────────────────────
-- SQL ファイル上は id 単独だが、本番は (project_id, id) の複合キー
-- （add_minutes_backlog_folders.sql の注記。id 単独を参照する FK は 42830 で張れない）。
-- そのため parent_item_id も backlog_attachments.item_id も参照制約なしの text とし、
-- 親を消したときの子・添付の後始末はアプリ側（BacklogPage.handleDelete）で行う。
-- 親が見つからない子は、画面側でルート直下（フォルダ直下）の単独項目として扱う。
-- ============================================================


-- ── 1. 親子の項目 ────────────────────────────────────────────
-- parent_id はフォルダ専用（is_folder=true の行を指す）。項目どうしの親子はこちらで持つ。
-- 子の parent_id（フォルダ）は親と同じ値に揃える（フォルダ移動は親子まとめて行う）。
alter table public.backlog_items add column if not exists parent_item_id text;

create index if not exists idx_backlog_items_parent_item
  on public.backlog_items (project_id, parent_item_id);


-- ── 2. 添付ファイル ──────────────────────────────────────────
-- 実体は ticket_attachments と同じ public バケット `ticket-files`。
-- チケット⇔バックログの移動では、ストレージの実体はコピーせず行だけ付け替える。
create table if not exists public.backlog_attachments (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references public.projects(id) on delete cascade,
  item_id     text not null,                    -- backlog_items.id（"B-001"）
  file_name   text not null,                    -- 表示名（日本語可）
  file_size   bigint not null default 0,
  file_type   text not null default '',         -- MIME タイプ
  file_path   text not null default '',         -- ticket-files バケット内のキー
  file_url    text not null default '',         -- 公開URL
  uploaded_by text not null default '',
  created_at  timestamptz not null default now()
);

-- BUG-01 対策の安定ソート（created_at, id）で引くための索引
create index if not exists idx_backlog_attachments_item
  on public.backlog_attachments (project_id, item_id, created_at, id);

alter table public.backlog_attachments enable row level security;

drop policy if exists "ba_select" on public.backlog_attachments;
create policy "ba_select" on public.backlog_attachments for select using (auth.role() = 'authenticated');
drop policy if exists "ba_insert" on public.backlog_attachments;
create policy "ba_insert" on public.backlog_attachments for insert with check (auth.role() = 'authenticated');
drop policy if exists "ba_update" on public.backlog_attachments;
create policy "ba_update" on public.backlog_attachments for update using (auth.role() = 'authenticated');
drop policy if exists "ba_delete" on public.backlog_attachments;
create policy "ba_delete" on public.backlog_attachments for delete using (auth.role() = 'authenticated');

-- プロジェクト境界（fix_project_level_rls_BRU14-001.sql の 3) と同じ RESTRICTIVE 方式）。
-- my_project_ids() はそちらで作られる。未適用の環境では張れないので notice を出して飛ばす
-- （その場合は BRU14-001 を流したあとに、このファイルをもう一度流すこと）。
do $do$
begin
  if to_regprocedure('public.my_project_ids()') is null then
    raise notice 'skip: public.my_project_ids() がありません。fix_project_level_rls_BRU14-001.sql を適用後に再実行してください';
    return;
  end if;
  drop policy if exists dt_rls_backlog_attachments_project on public.backlog_attachments;
  create policy dt_rls_backlog_attachments_project on public.backlog_attachments
    as restrictive for all
    using      (project_id in (select mp.project_id from public.my_project_ids() mp))
    with check (project_id in (select mp.project_id from public.my_project_ids() mp));
end
$do$;


-- ── 3. 番号予約 ──────────────────────────────────────────────
-- プロジェクトごとに "B-001" の連番を持つ。ticket_wbs_seq と分けるのは、
-- チケットの WBS プレフィックスに "B" を使っているプロジェクトと混ざらないようにするため。
create table if not exists public.backlog_id_seq (
  project_id text primary key,
  last_no    int  not null default 0
);

alter table public.backlog_id_seq enable row level security;
-- クライアントからは直接触らせない（security definer 関数のみが使う）

/**
 * バックログ項目 p_count 件ぶんの連番を予約し、その先頭番号を返す。
 * 呼び出し側は start .. start + p_count - 1 を "B-%03s" にして使う。
 *
 * reserve_ticket_wbs と同じ作り。UPDATE … RETURNING が backlog_id_seq の行ロックを取るため、
 * 同時に呼ばれても番号は重複しない。実テーブルの最大番号を毎回 greatest() で取り込むので、
 * 画面側の従来の採番（最大番号＋1）と併存しても衝突しない。
 */
create or replace function public.reserve_backlog_ids(
  p_project_id text,
  p_count      int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start    int;
  v_existing int;
  v_ok       boolean;
begin
  if p_count is null or p_count < 1 then
    raise exception 'p_count must be >= 1';
  end if;

  -- 画面（ログインユーザー）から呼ばれたときは、そのプロジェクトのメンバーに限る。
  -- service_role（api/v1）は auth.uid() が null なのでここを通らない。
  if auth.uid() is not null and to_regprocedure('public.can_access_project(text)') is not null then
    execute 'select public.can_access_project($1)' into v_ok using p_project_id;
    if not coalesce(v_ok, false) then
      raise exception 'permission denied for project %', p_project_id using errcode = '42501';
    end if;
  end if;

  insert into public.backlog_id_seq (project_id, last_no)
  values (p_project_id, 0)
  on conflict (project_id) do nothing;

  -- 既存項目の最大番号。フォルダ（BF-001）は "B-" で始まらないので含まれない。
  select coalesce(max(substring(b.id from 3)::int), 0)
    into v_existing
  from public.backlog_items b
  where b.project_id = p_project_id
    and b.id ~ '^B-[0-9]+$';

  update public.backlog_id_seq
     set last_no = greatest(last_no, v_existing) + p_count
   where project_id = p_project_id
  returning last_no - p_count + 1 into v_start;

  return v_start;
end;
$$;

revoke all on function public.reserve_backlog_ids(text, int) from public, anon;
grant execute on function public.reserve_backlog_ids(text, int) to authenticated, service_role;


-- ============================================================
-- 確認用（任意）
-- ============================================================
-- select public.reserve_backlog_ids('<project_id>', 1);  -- 2回続けて呼ぶと別の番号が返る
-- select * from pg_policies where tablename = 'backlog_attachments';
