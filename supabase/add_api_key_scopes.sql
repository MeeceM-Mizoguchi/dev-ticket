-- ============================================================
-- API連携: APIキーごとの権限（scope）
--   Supabase Dashboard → SQL Editor → New query に貼り付けて実行
--   冪等: 何度実行しても安全
--
-- これまでのAPIキーは「チケットの登録」しかできなかった。
-- AI がチケットを読み取って実装する機能（GET /api/v1/ticket・POST /api/v1/ticket-status）を
-- 足すにあたり、キーごとにできることを分ける。発行時にプルダウンで選ぶ。
--
--   write … 登録のみ（これまでのキーと同じ。一覧・候補値の取得は従来どおり可）
--   read  … 読み取りのみ（チケットの本文・画像・コメント・子チケット）
--   full  … すべて（登録・読み取り・ステータス更新）
--
-- 既定値を write にしてあるので、発行済みのキーは今より権限が広がらない。
--
-- ⚠️ このファイルを流す前でも既存の連携は止まらない。
--    api/v1/[resource].ts は scope 列が無ければ write として扱い、
--    api/api-keys/[action].ts は write のキーを発行するときこの列に触らない。
--    read / full のキーを発行するには、このファイルの実行が必要。
-- ============================================================

alter table public.api_keys add column if not exists scope text not null default 'write';

do $do$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'api_keys_scope_check' and conrelid = 'public.api_keys'::regclass
  ) then
    alter table public.api_keys
      add constraint api_keys_scope_check check (scope in ('write', 'read', 'full'));
  end if;
end
$do$;
