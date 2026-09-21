-- ============================================================
-- デプロイ検知：最新の公開版を誰でも1件だけ参照できる RPC
-- ============================================================
-- 【必須】Supabase Dashboard → SQL Editor → New query に
--         このファイルの内容を貼り付けて1回だけ実行してください。
--
-- 背景: app_version は本番ビルドの最後(scripts/publish-version.mjs)で記録されるため、
--       「記録された＝デプロイが始まった」だが、本番に切り替わるのは少し後になる。
--       画面側(useVersionCheck)はこの RPC で「公開準備中の版」を早めに知り、
--       本番の build-info.json が切り替わるまで更新中のプログレスを出して待つ。
--
-- app_version の SELECT はシステム管理会社のみ(add_app_version.sql)のまま変えない。
-- ここでは最新1件の version / build_time / 経過秒だけを security definer で返す。
-- 未ログイン(ログイン画面・LP)でも更新できるよう anon にも許可する。
-- 未実行でも画面側は build-info.json だけで検知を続ける（早期検知が効かないだけ）。
-- ============================================================

create or replace function get_latest_app_version()
returns table (version text, build_time text, age_seconds double precision)
language sql
security definer
stable
set search_path = public
as $$
  select v.version,
         v.build_time,
         extract(epoch from (now() - v.released_at))::double precision
  from app_version v
  order by v.released_at desc, v.version desc
  limit 1;
$$;

grant execute on function get_latest_app_version() to anon, authenticated;

-- 確認
select * from get_latest_app_version();
