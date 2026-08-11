-- ============================================================
-- API連携: 外部のAI／システムからチケットを登録するためのAPIキー
--   Supabase Dashboard → SQL Editor → New query に貼り付けて実行
--   冪等: 何度実行しても安全
--
-- 内容:
--   1. api_keys テーブル（キーは平文を保存せず SHA-256 ハッシュのみ）
--   2. RLS（自組織の管理者のみ）
--   3. ticket_wbs_seq + reserve_ticket_wbs()  … WBS採番の直列化
--   4. consume_api_key_rate()                 … レート制限（Postgres内で完結）
--
-- ⚠️ 3 は「AIやCIから並列でAPIを叩かれたときに同じWBSが振られる」のを防ぐためのもの。
--    ブラウザからの一括作成（src/app/lib/bulkTicketInsert.ts）は従来どおり
--    「max を select して +1」のままだが、reserve_ticket_wbs() は毎回 sprint_tickets の
--    実際の最大番号を取り込むので、両者が混在しても番号は重複しない。
-- ============================================================

-- ── 0. 前提の関数（無ければ作る） ─────────────────────────────
-- 通常は supabase/fix_multitenant_rls.sql で作成済み。まだ流していない環境でも
-- このファイル単体で完結するよう、同じ定義をここにも置いてある（冪等）。
CREATE OR REPLACE FUNCTION public.get_my_org_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

-- ── 1. api_keys ──────────────────────────────────────────────
create table if not exists public.api_keys (
  id                uuid        primary key default gen_random_uuid(),
  -- 「どこで使うキーか」を見分けるためのラベル。例: "Claude Code用"
  name              text        not null,
  -- 平文は保存しない。提示されたキーの SHA-256(hex) と突き合わせる
  key_hash          text        not null unique,
  -- 一覧表示用の先頭部分。例: "dvt_live_a1b2c3d4"
  key_prefix        text        not null,
  -- 平文を AES-256-GCM で暗号化したもの。復号鍵は Vercel の環境変数側にあり
  -- DBには入っていないため、この列だけが漏れてもキーは復元できない。
  -- 画面で「使用するキー」を選んだときに、サーバー経由で復号してプロンプトへ埋め込む。
  key_cipher        text,
  organization_id   text,
  project_id        text        not null references public.projects(id) on delete cascade,
  created_by        text,                     -- profiles.name（sprint_tickets.created_by と揃える）
  created_at        timestamptz not null default now(),
  expires_at        timestamptz,
  revoked_at        timestamptz,
  last_used_at      timestamptz,
  -- レート制限のカウンタ。Redis 等の外部サービスを足さずに済ませるためここに持つ
  rate_window_start timestamptz,
  rate_count        int         not null default 0
);

-- 既に api_keys を作成済みの環境向け（このファイルを再実行すれば追加される）
alter table public.api_keys add column if not exists key_cipher text;

create index if not exists api_keys_project_idx on public.api_keys(project_id);
create index if not exists api_keys_hash_idx    on public.api_keys(key_hash);

alter table public.api_keys enable row level security;

-- ── 2. RLS ───────────────────────────────────────────────────
-- 管理者(admin)/オーナー(owner)のみ。owner は全組織を参照できる。
-- organization_id が NULL のプロジェクト（マルチテナント導入前のデータ）でも
-- 管理できるよう IS NOT DISTINCT FROM で NULL 同士を一致とみなす。
create or replace function public.is_org_admin()
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'owner')
  )
$$;

drop policy if exists "api_keys_select" on public.api_keys;
drop policy if exists "api_keys_insert" on public.api_keys;
drop policy if exists "api_keys_update" on public.api_keys;
drop policy if exists "api_keys_delete" on public.api_keys;

create policy "api_keys_select" on public.api_keys
  FOR SELECT USING (
    (select role from public.profiles where id = auth.uid()) = 'owner'
    OR (public.is_org_admin() AND organization_id IS NOT DISTINCT FROM public.get_my_org_id())
  );
create policy "api_keys_insert" on public.api_keys
  FOR INSERT WITH CHECK (
    (select role from public.profiles where id = auth.uid()) = 'owner'
    OR (public.is_org_admin() AND organization_id IS NOT DISTINCT FROM public.get_my_org_id())
  );
create policy "api_keys_update" on public.api_keys
  FOR UPDATE USING (
    (select role from public.profiles where id = auth.uid()) = 'owner'
    OR (public.is_org_admin() AND organization_id IS NOT DISTINCT FROM public.get_my_org_id())
  );
create policy "api_keys_delete" on public.api_keys
  FOR DELETE USING (
    (select role from public.profiles where id = auth.uid()) = 'owner'
    OR (public.is_org_admin() AND organization_id IS NOT DISTINCT FROM public.get_my_org_id())
  );

-- ── 3. WBS採番の直列化 ───────────────────────────────────────
-- プロジェクト＋プレフィックスごとに連番を持つ。
create table if not exists public.ticket_wbs_seq (
  project_id text not null,
  prefix     text not null,
  last_no    int  not null default 0,
  primary key (project_id, prefix)
);

alter table public.ticket_wbs_seq enable row level security;
-- クライアントからは触らせない（service_role と security definer 関数のみが使う）

/**
 * 親チケット p_count 件ぶんの連番を予約し、その先頭番号を返す。
 *
 * UPDATE … RETURNING が ticket_wbs_seq の行ロックを取るため、同時に呼ばれても
 * 番号は重複しない。既存チケットの最大番号を毎回 greatest() で取り込むので、
 * ブラウザ側の従来の採番と併存しても衝突しない。
 */
create or replace function public.reserve_ticket_wbs(
  p_project_id text,
  p_prefix     text,
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
begin
  if p_count is null or p_count < 1 then
    raise exception 'p_count must be >= 1';
  end if;

  insert into public.ticket_wbs_seq (project_id, prefix, last_no)
  values (p_project_id, p_prefix, 0)
  on conflict (project_id, prefix) do nothing;

  -- 既存チケットの最大番号。子チケット（T-001-1）は末尾が数字だけにならないので除外される。
  select coalesce(max(substring(t.wbs from length(p_prefix) + 2)::int), 0)
    into v_existing
  from public.sprint_tickets t
  join public.sprints s on s.id = t.sprint_id
  where s.project_id = p_project_id
    and t.wbs like p_prefix || '-%'
    and substring(t.wbs from length(p_prefix) + 2) ~ '^[0-9]+$';

  update public.ticket_wbs_seq
     set last_no = greatest(last_no, v_existing) + p_count
   where project_id = p_project_id
     and prefix = p_prefix
  returning last_no - p_count + 1 into v_start;

  return v_start;
end;
$$;

-- ── 4. レート制限 ────────────────────────────────────────────
/**
 * APIキー1本あたりのリクエスト数を数える。上限内なら true、超過なら false。
 * ついでに last_used_at も更新する（画面の「最終利用」表示に使う）。
 *
 * UPDATE の SET 式はすべて更新前の行を読むため、CASE の中の rate_window_start は
 * 「今回の更新より前の値」を指す。1文で完結するので同時実行でも数え漏れしない。
 */
create or replace function public.consume_api_key_rate(
  p_key_id         uuid,
  p_limit          int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  update public.api_keys
     set rate_window_start = case
           when rate_window_start is null
             or rate_window_start < now() - make_interval(secs => p_window_seconds)
           then now()
           else rate_window_start
         end,
         rate_count = case
           when rate_window_start is null
             or rate_window_start < now() - make_interval(secs => p_window_seconds)
           then 1
           else rate_count + 1
         end,
         last_used_at = now()
   where id = p_key_id
  returning rate_count <= p_limit into v_ok;

  return coalesce(v_ok, false);
end;
$$;

-- ── 5. 権限の締め ────────────────────────────────────────────
-- 3 と 4 の関数は SECURITY DEFINER（＝定義者権限で動く）なので、
-- ブラウザから呼べる必要はない。API側は service_role で接続しており、
-- service_role は RLS も EXECUTE 権限もバイパスするため影響しない。
REVOKE ALL ON FUNCTION public.reserve_ticket_wbs(text, text, int)   FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_api_key_rate(uuid, int, int)  FROM public, anon, authenticated;
