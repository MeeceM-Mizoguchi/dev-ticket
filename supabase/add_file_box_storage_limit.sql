-- ============================================================
-- ファイルボックスの容量制限（プランごとに「組織全体で何GBまで」を設定する）
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- ★ 画面・API より先にこの SQL を適用すること。
--   未適用のままプラン設定画面で保存すると、列が無いため保存に失敗する。
--   （容量の判定そのものは、未適用の環境では「上限なし」として動く）

-- ── plans.max_file_storage_gb ────────────────────────────────
-- null = 無制限。単位は GB（1GB = 1024^3 バイト）。
-- 既存のプランは一律 10GB にする（システムの「無制限」プランも含む）。
-- 列を足した「その1回だけ」10GB を入れる。再実行しても、あとから画面で
-- 無制限（null）や別の値に変えたプランを 10GB へ戻してしまわない。
insert into plans (id, name, is_system) values ('system-unlimited', '無制限', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'plans' and column_name = 'max_file_storage_gb'
  ) then
    alter table plans add column max_file_storage_gb numeric;
    update plans set max_file_storage_gb = 10;
  end if;
end $$;

-- ── 使用量と上限をまとめて返す関数 ───────────────────────────
-- 使用量は「そのプロジェクトが属する組織の、全プロジェクトのファイルボックスの合計」。
--   ・古い版も数える（実体が storage に残っているため）
--   ・限定公開のファイルも数える（見えない人の画面でも合計は同じになる）
--   ・Googleドライブ上のファイルは数えない（実体が Drive 側にあり storage を使わない）
--   ・フォルダは数えない
-- 上限は組織のプラン（plan_id が null の組織はシステムの「無制限」プラン）の値。
-- limit_bytes が null なら無制限。
--
-- 呼ぶのは api/_lib/fileQuota.ts（service_role）だけ。
-- 画面から直接呼べると、他組織のプロジェクトIDを渡して使用量を覗けてしまうので実行権限を外す。
create or replace function file_storage_quota(p_project_id text)
returns table (used_bytes bigint, limit_bytes bigint)
language sql
stable
security definer
set search_path = public
as $$
  with proj as (
    select id, organization_id from projects where id = p_project_id
  ),
  scope as (
    select p.id
    from projects p, proj
    where p.id = proj.id
       or (proj.organization_id is not null and p.organization_id = proj.organization_id)
  ),
  plan as (
    select pl.max_file_storage_gb
    from plans pl
    where pl.id = coalesce(
      (select o.plan_id from organizations o, proj where o.id::text = proj.organization_id::text),
      'system-unlimited'
    )
  )
  select
    coalesce((
      select sum(f.file_size)
      from project_files f
      where f.project_id in (select id from scope)
        and f.external_provider is null
        and coalesce(f.is_folder, false) = false
    ), 0)::bigint as used_bytes,
    (select (max_file_storage_gb * 1073741824)::bigint from plan) as limit_bytes
$$;

revoke all on function file_storage_quota(text) from public, anon, authenticated;
grant execute on function file_storage_quota(text) to service_role;
