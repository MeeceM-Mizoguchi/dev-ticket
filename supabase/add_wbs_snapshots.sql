-- ============================================================
-- KAIZEN2611-004 WBSのバックアップ・反映（その時点に戻す）・アーカイブ
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
--
-- 前提（適用済みであること）: add_wbs.sql / fix_project_level_rls_BRU14-001.sql（can_user_access_project）
-- add_wbs_lock.sql は未適用でもよい（is_locked の列が無ければ「ロックなし」として扱う）。
--
-- ★ このSQLは、対応するアプリを本番へ出す「前」に流すこと。
--   アプリは列が無い環境ではバックアップ・アーカイブの操作を出さずに今のまま動く。
--
-- 設計上の要点:
--   ・WBSごとに「版の番号」(edit_version) と「最後に編集した人・時刻」を持つ。
--     行・ステータス・チケットの紐づけ・そのWBSだけの休日を追加・変更・削除するたびに、トリガーが上げる。
--     トリガーは文単位（for each statement）。親の行を消して下の行が連鎖で消えても、1文につき1回だけ走る。
--   ・バックアップは wbs_snapshots に jsonb で持つ。毎日 3:00（日本時間）の定期実行で、
--     前回のバックアップのあとに版の番号が変わったWBSだけ取る（api/wbs/[action].ts の cron-backup）。
--   ・1年たったバックアップは、定期実行で圧縮して Storage（wbs-archives）へ移し、data を空にして storage_path を持つ。
--   ・反映（その時点に戻す）は wbs_restore_snapshot で、版の番号の比較・反映前の保存・戻す処理を1回の処理で行う。
--   ・WBSのアーカイブは、wbs_sheets の行（名前・段数・公開範囲・ロック）だけを残し、中身とバックアップを
--     圧縮して Storage へ移す。アーカイブから戻すと、中身とバックアップの履歴が戻る。
--   ・書き込みの関数はすべて service_role だけが呼べる（api/wbs/[action].ts から、呼んだ人の id を渡して呼ぶ）。
--     権限（編集可であること・ロック中でないこと）は関数の中で確かめる。
-- ============================================================

-- ── 1. wbs_sheets の列 ───────────────────────────────────────
-- 版の番号。中身を変えるたびにトリガーが 1 ずつ上げる
alter table public.wbs_sheets add column if not exists edit_version bigint not null default 0;
-- 最後に編集した人・時刻（反映を止めたときに「誰が・いつ」を出すため）。
-- 退職などで profiles が消えても編集を止めないよう、外部キーは張らない
alter table public.wbs_sheets add column if not exists last_edited_by uuid;
alter table public.wbs_sheets add column if not exists last_edited_by_name text not null default '';
alter table public.wbs_sheets add column if not exists last_edited_at timestamptz;
-- 最後に毎日のバックアップを取ったときの版の番号。null = まだ1回も取っていない
alter table public.wbs_sheets add column if not exists last_snapshot_version bigint;
-- アーカイブの状態。archived_at が null でなければアーカイブ済み（中身は archive_path のファイルにある）
alter table public.wbs_sheets add column if not exists archived_at timestamptz;
alter table public.wbs_sheets add column if not exists archived_by_name text not null default '';
alter table public.wbs_sheets add column if not exists archive_path text;

-- ── 2. バックアップ ─────────────────────────────────────────
create table if not exists public.wbs_snapshots (
  id              uuid        primary key default gen_random_uuid(),
  -- WBSを削除したらバックアップも消える（Storage のファイルはアプリが消す）
  wbs_sheet_id    uuid        not null references public.wbs_sheets(id) on delete cascade,
  taken_at        timestamptz not null default now(),
  -- daily = 毎日のバックアップ / before_restore = 反映の直前に自動で保存したもの
  kind            text        not null default 'daily' check (kind in ('daily','before_restore')),
  -- 取ったときの版の番号
  sheet_version   bigint      not null default 0,
  -- 中身（wbs_snapshot_payload の形）。Storage へ移したあとは null
  data            jsonb,
  -- Storage（wbs-archives）へ移したときのファイルの場所。1つのファイルに複数のバックアップをまとめて入れる
  storage_path    text,
  -- 反映前に保存したときの、反映した人
  created_by      uuid,
  created_by_name text        not null default '',
  check (data is not null or storage_path is not null)
);

create index if not exists idx_wbs_snapshots_sheet on public.wbs_snapshots(wbs_sheet_id, taken_at desc);
-- 1年たったものを Storage へ移すときの検索用
create index if not exists idx_wbs_snapshots_in_db on public.wbs_snapshots(taken_at) where data is not null;

-- 読むのは、そのWBSを見られる人。書き込みは service_role（関数・API）だけ
alter table public.wbs_snapshots enable row level security;
drop policy if exists "wbs_snapshots_select" on public.wbs_snapshots;
create policy "wbs_snapshots_select" on public.wbs_snapshots for select using (can_view_wbs_sheet(wbs_sheet_id));

-- ── 3. 版の番号を上げるトリガー ─────────────────────────────
-- 編集した人は、画面からの書き込みなら auth.uid()。service_role の関数（反映・アーカイブから戻す）からは
-- 関数の中で set_config('wbs.actor', 呼んだ人の id, true) を入れておき、それを使う（その処理の間だけ有効）。
create or replace function public.wbs_touch_sheets(p_sheet_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid;
  v_name text;
begin
  if p_sheet_ids is null or cardinality(p_sheet_ids) = 0 then
    return;
  end if;
  -- 関数の中で入れた「呼んだ人」を先に使う（service_role の接続に残っている JWT より優先する）
  v_uid := coalesce(nullif(current_setting('wbs.actor', true), '')::uuid, auth.uid());
  if v_uid is not null then
    select p.name into v_name from public.profiles p where p.id = v_uid;
  end if;
  update public.wbs_sheets
     set edit_version        = edit_version + 1,
         last_edited_by      = v_uid,
         last_edited_by_name = coalesce(v_name, ''),
         last_edited_at      = now()
   where id = any(p_sheet_ids);
end
$$;

-- wbs_items / wbs_statuses / wbs_holidays（wbs_sheet_id を持つ表）用。
-- 遷移表（new_rows / old_rows）は、その操作で使えるものだけを読む（plpgsql は実行した文だけを解釈する）
create or replace function public.wbs_touch_from_sheet_rows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.wbs_touch_sheets(array(select distinct r.wbs_sheet_id from new_rows r where r.wbs_sheet_id is not null));
  elsif tg_op = 'DELETE' then
    perform public.wbs_touch_sheets(array(select distinct r.wbs_sheet_id from old_rows r where r.wbs_sheet_id is not null));
  else
    perform public.wbs_touch_sheets(array(
      select r.wbs_sheet_id from new_rows r where r.wbs_sheet_id is not null
      union
      select r.wbs_sheet_id from old_rows r where r.wbs_sheet_id is not null
    ));
  end if;
  return null;
end
$$;

-- wbs_item_tickets 用（行を通してWBSを引く）。行ごと消えたときは行の削除のほうで版が上がっている
create or replace function public.wbs_touch_from_item_ticket_rows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.wbs_touch_sheets(array(
      select distinct i.wbs_sheet_id from new_rows r join public.wbs_items i on i.id = r.wbs_item_id));
  elsif tg_op = 'DELETE' then
    perform public.wbs_touch_sheets(array(
      select distinct i.wbs_sheet_id from old_rows r join public.wbs_items i on i.id = r.wbs_item_id));
  else
    perform public.wbs_touch_sheets(array(
      select i.wbs_sheet_id from new_rows r join public.wbs_items i on i.id = r.wbs_item_id
      union
      select i.wbs_sheet_id from old_rows r join public.wbs_items i on i.id = r.wbs_item_id));
  end if;
  return null;
end
$$;

-- 遷移表を使うトリガーは1つに1種類の操作しか持てないので、追加・変更・削除で3本ずつ作る
do $$
declare
  t text;
  fn text;
begin
  foreach t in array array['wbs_items', 'wbs_statuses', 'wbs_holidays', 'wbs_item_tickets'] loop
    fn := case when t = 'wbs_item_tickets' then 'wbs_touch_from_item_ticket_rows' else 'wbs_touch_from_sheet_rows' end;
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_touch_ins', t);
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_touch_upd', t);
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_touch_del', t);
    execute format('create trigger %I after insert on public.%I referencing new table as new_rows for each statement execute function public.%I()',
      'trg_' || t || '_touch_ins', t, fn);
    execute format('create trigger %I after update on public.%I referencing old table as old_rows new table as new_rows for each statement execute function public.%I()',
      'trg_' || t || '_touch_upd', t, fn);
    execute format('create trigger %I after delete on public.%I referencing old table as old_rows for each statement execute function public.%I()',
      'trg_' || t || '_touch_del', t, fn);
  end loop;
end
$$;

-- ── 4. 権限の判定（呼んだ人の id を受け取る版） ─────────────
-- 画面側（loadWbsPermission）と同じ: owner・admin は編集可、それ以外はアサイン計画の wbsPermission。
-- 見られる範囲は wbs_sheets_select のポリシーと同じ。

create or replace function public.wbs_user_can_view(p_user_id uuid, p_sheet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.wbs_sheets s
    join public.profiles me on me.id = p_user_id
    where s.id = p_sheet_id
      and public.can_user_access_project(p_user_id, s.project_id)
      and (
        s.visibility = 'project'
        or s.created_by = p_user_id
        or me.role = 'owner'
        or exists (select 1 from public.wbs_sheet_members m where m.wbs_sheet_id = s.id and m.profile_id = p_user_id)
      )
      and (
        me.role in ('owner', 'admin')
        or exists (
          select 1 from public.project_member_permissions pmp
          where pmp.project_id = s.project_id and pmp.member_id = p_user_id
            and coalesce(pmp.permissions->>'wbsPermission', 'none') in ('view', 'edit')
        )
      )
  )
$$;

create or replace function public.wbs_user_can_edit(p_user_id uuid, p_sheet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.wbs_user_can_view(p_user_id, p_sheet_id)
     and exists (
       select 1
       from public.wbs_sheets s
       join public.profiles me on me.id = p_user_id
       where s.id = p_sheet_id
         and (
           me.role in ('owner', 'admin')
           or exists (
             select 1 from public.project_member_permissions pmp
             where pmp.project_id = s.project_id and pmp.member_id = p_user_id
               and pmp.permissions->>'wbsPermission' = 'edit'
           )
         )
     )
$$;

-- ロック中か。is_locked の列が無い環境（add_wbs_lock.sql 未適用）では「ロックなし」
create or replace function public.wbs_sheet_is_locked(p_sheet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (to_jsonb(s) ->> 'is_locked')::boolean from public.wbs_sheets s where s.id = p_sheet_id), false)
$$;

-- ── 5. バックアップの中身 ───────────────────────────────────
-- 入れるもの: 行・ステータスの種類・行とチケットの紐づけ・そのWBSだけの休日。
-- 入れないもの: 全WBSで共通の休日、WBSの名前・段数・公開範囲・ロック。
-- 行は上の段から並べる（戻すときに親を先に入れるため）。
create or replace function public.wbs_snapshot_payload(p_sheet_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'format', 1,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'parent_id', i.parent_id, 'level', i.level, 'name', i.name, 'assignee', i.assignee,
        'start_date', i.start_date, 'end_date', i.end_date, 'progress', i.progress, 'status_id', i.status_id,
        'note', i.note, 'sort_order', i.sort_order
      ) order by i.level, i.sort_order, i.id)
      from public.wbs_items i where i.wbs_sheet_id = p_sheet_id
    ), '[]'::jsonb),
    'statuses', coalesce((
      select jsonb_agg(jsonb_build_object('id', st.id, 'name', st.name, 'color', st.color, 'sort_order', st.sort_order)
        order by st.sort_order, st.id)
      from public.wbs_statuses st where st.wbs_sheet_id = p_sheet_id
    ), '[]'::jsonb),
    'item_tickets', coalesce((
      select jsonb_agg(jsonb_build_object('wbs_item_id', t.wbs_item_id, 'ticket_id', t.ticket_id)
        order by t.wbs_item_id, t.created_at, t.ticket_id)
      from public.wbs_item_tickets t join public.wbs_items i on i.id = t.wbs_item_id
      where i.wbs_sheet_id = p_sheet_id
    ), '[]'::jsonb),
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('holiday_date', h.holiday_date, 'name', h.name) order by h.holiday_date, h.id)
      from public.wbs_holidays h where h.wbs_sheet_id = p_sheet_id
    ), '[]'::jsonb)
  )
$$;

-- 中身を入れる（反映・アーカイブから戻すで共通）。呼ぶ前に、そのWBSの中身を消しておくこと。
-- 行・ステータスは元の id のまま入れる（マスタースケジュールから行へ飛ぶリンクが外れないように）。
-- 今は無いチケットへの紐づけは外す。ステータスが見つからない行は「ステータスなし」（画面では先頭）にする。
create or replace function public.wbs_apply_payload(p_sheet_id uuid, p_project_id text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.wbs_statuses (id, wbs_sheet_id, name, color, sort_order)
  select (x->>'id')::uuid, p_sheet_id, x->>'name', coalesce(nullif(x->>'color', ''), '#EDECF4'), coalesce((x->>'sort_order')::float8, 0)
  from jsonb_array_elements(coalesce(p_data->'statuses', '[]'::jsonb)) x;

  -- 外部キー（parent_id）は文の終わりに確かめられるので、1文で入れれば親子の順は問わない
  insert into public.wbs_items (id, wbs_sheet_id, parent_id, level, name, assignee, start_date, end_date, progress, status_id, note, sort_order)
  select (x->>'id')::uuid, p_sheet_id, nullif(x->>'parent_id', '')::uuid, coalesce((x->>'level')::int, 1),
         coalesce(x->>'name', ''), coalesce(x->>'assignee', ''),
         nullif(x->>'start_date', '')::date, nullif(x->>'end_date', '')::date,
         coalesce((x->>'progress')::int, 0),
         case when exists (select 1 from public.wbs_statuses st where st.id = nullif(x->>'status_id', '')::uuid and st.wbs_sheet_id = p_sheet_id)
              then nullif(x->>'status_id', '')::uuid end,
         coalesce(x->>'note', ''), coalesce((x->>'sort_order')::float8, 0)
  from jsonb_array_elements(coalesce(p_data->'items', '[]'::jsonb)) x;

  insert into public.wbs_item_tickets (wbs_item_id, ticket_id)
  select distinct (x->>'wbs_item_id')::uuid, x->>'ticket_id'
  from jsonb_array_elements(coalesce(p_data->'item_tickets', '[]'::jsonb)) x
  where exists (select 1 from public.sprint_tickets t where t.id = x->>'ticket_id')
    and exists (select 1 from public.wbs_items i where i.id = (x->>'wbs_item_id')::uuid and i.wbs_sheet_id = p_sheet_id)
  on conflict do nothing;

  insert into public.wbs_holidays (project_id, wbs_sheet_id, holiday_date, name)
  select p_project_id, p_sheet_id, (x->>'holiday_date')::date, coalesce(x->>'name', '')
  from jsonb_array_elements(coalesce(p_data->'holidays', '[]'::jsonb)) x
  where nullif(x->>'holiday_date', '') is not null
  on conflict do nothing;
end
$$;

-- ── 6. 毎日のバックアップ ──────────────────────────────────
-- 前回のバックアップのあとに版の番号が変わった（または1回も取っていない）、アーカイブしていないWBSだけ。
-- 1回に p_limit 件まで。返り値は取った件数（API は p_limit 件取れたら、もう一度呼ぶ）。
create or replace function public.wbs_take_daily_snapshots(p_limit int default 100)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select s.id, s.edit_version from public.wbs_sheets s
    where s.archived_at is null and s.last_snapshot_version is distinct from s.edit_version
    order by s.id
    limit greatest(p_limit, 1)
    for update skip locked
  loop
    insert into public.wbs_snapshots (wbs_sheet_id, kind, sheet_version, data)
    values (r.id, 'daily', r.edit_version, public.wbs_snapshot_payload(r.id));
    update public.wbs_sheets set last_snapshot_version = r.edit_version where id = r.id;
    n := n + 1;
  end loop;
  return n;
end
$$;

-- ── 7. 反映（その時点に戻す） ───────────────────────────────
-- 版の番号の比較・反映前の保存・戻す処理を、1回の処理（この関数の中）で行う。
-- WBSの行を for update で押さえるので、比べてから戻すまでの間の編集は、この処理が終わるまで待たされる。
-- 返り値: { ok: true, version } / { ok: false, reason: not_found|archived|forbidden|locked|conflict|invalid, ... }
create or replace function public.wbs_restore_snapshot(p_user_id uuid, p_sheet_id uuid, p_expected_version bigint, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.wbs_sheets%rowtype;
  v_name text;
  v_version bigint;
begin
  select * into s from public.wbs_sheets where id = p_sheet_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.wbs_user_can_view(p_user_id, p_sheet_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.wbs_user_can_edit(p_user_id, p_sheet_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if s.archived_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'archived');
  end if;
  if public.wbs_sheet_is_locked(p_sheet_id) then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  if s.edit_version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'conflict',
      'editedByName', s.last_edited_by_name, 'editedAt', s.last_edited_at);
  end if;
  if p_data is null or jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_typeof(p_data->'statuses') is distinct from 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- このあとの削除・追加で上がる版の番号に、反映した人を残す
  perform set_config('wbs.actor', p_user_id::text, true);
  select p.name into v_name from public.profiles p where p.id = p_user_id;

  -- 反映の直前の状態を保存する（これを反映すれば、反映を取り消せる）
  insert into public.wbs_snapshots (wbs_sheet_id, kind, sheet_version, data, created_by, created_by_name)
  values (p_sheet_id, 'before_restore', s.edit_version, public.wbs_snapshot_payload(p_sheet_id), p_user_id, coalesce(v_name, ''));

  -- 今の中身を消す（行の紐づけは on delete cascade で一緒に消える）。全WBSで共通の休日は触らない
  delete from public.wbs_items where wbs_sheet_id = p_sheet_id;
  delete from public.wbs_statuses where wbs_sheet_id = p_sheet_id;
  delete from public.wbs_holidays where wbs_sheet_id = p_sheet_id;

  perform public.wbs_apply_payload(p_sheet_id, s.project_id, p_data);

  select edit_version into v_version from public.wbs_sheets where id = p_sheet_id;
  return jsonb_build_object('ok', true, 'version', v_version);
end
$$;

-- ── 8. WBSのアーカイブ／アーカイブから戻す ──────────────────
-- アーカイブは2段階で行う（API が間で Storage へファイルを置く）。
--   1) wbs_archive_payload … 権限を確かめ、中身とバックアップをまとめて返す
--   2) wbs_archive_finish  … 1) のあとに編集・バックアップが増えていなければ、中身とバックアップを消してアーカイブ済みにする
-- ロック中のWBSもアーカイブできる。
create or replace function public.wbs_archive_payload(p_user_id uuid, p_sheet_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.wbs_sheets%rowtype;
  v_snaps jsonb;
begin
  select * into s from public.wbs_sheets where id = p_sheet_id;
  if not found or not public.wbs_user_can_view(p_user_id, p_sheet_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.wbs_user_can_edit(p_user_id, p_sheet_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if s.archived_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'archived');
  end if;

  -- Storage へ移し済みのバックアップは、ファイルの場所（storage_path）だけを持つ
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id, 'taken_at', x.taken_at, 'kind', x.kind, 'sheet_version', x.sheet_version,
    'data', x.data, 'storage_path', x.storage_path, 'created_by', x.created_by, 'created_by_name', x.created_by_name
  ) order by x.taken_at, x.id), '[]'::jsonb)
  into v_snaps
  from public.wbs_snapshots x where x.wbs_sheet_id = p_sheet_id;

  return jsonb_build_object(
    'ok', true,
    'projectId', s.project_id,
    'version', s.edit_version,
    'snapshotCount', jsonb_array_length(v_snaps),
    'payload', jsonb_build_object(
      'format', 1,
      'sheetId', s.id,
      'archivedAt', now(),
      'content', public.wbs_snapshot_payload(p_sheet_id),
      'lastSnapshotVersion', s.last_snapshot_version,
      'snapshots', v_snaps
    )
  );
end
$$;

create or replace function public.wbs_archive_finish(
  p_user_id uuid, p_sheet_id uuid, p_expected_version bigint, p_snapshot_count int, p_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.wbs_sheets%rowtype;
  v_name text;
begin
  select * into s from public.wbs_sheets where id = p_sheet_id for update;
  if not found or not public.wbs_user_can_view(p_user_id, p_sheet_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.wbs_user_can_edit(p_user_id, p_sheet_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if s.archived_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'archived');
  end if;
  if s.edit_version <> p_expected_version
     or (select count(*) from public.wbs_snapshots x where x.wbs_sheet_id = p_sheet_id) <> p_snapshot_count then
    return jsonb_build_object('ok', false, 'reason', 'conflict',
      'editedByName', s.last_edited_by_name, 'editedAt', s.last_edited_at);
  end if;

  perform set_config('wbs.actor', p_user_id::text, true);
  select p.name into v_name from public.profiles p where p.id = p_user_id;

  delete from public.wbs_snapshots where wbs_sheet_id = p_sheet_id;
  delete from public.wbs_items where wbs_sheet_id = p_sheet_id;
  delete from public.wbs_statuses where wbs_sheet_id = p_sheet_id;
  delete from public.wbs_holidays where wbs_sheet_id = p_sheet_id;

  update public.wbs_sheets
     set archived_at = now(), archived_by_name = coalesce(v_name, ''), archive_path = p_path
   where id = p_sheet_id;
  return jsonb_build_object('ok', true);
end
$$;

-- アーカイブから戻す。p_payload は wbs_archive_payload が返した payload（API が Storage から取り出して渡す）。
-- 返り値の archivePath のファイルは、戻し終えたら API が消す。
create or replace function public.wbs_unarchive(p_user_id uuid, p_sheet_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.wbs_sheets%rowtype;
begin
  select * into s from public.wbs_sheets where id = p_sheet_id for update;
  if not found or not public.wbs_user_can_view(p_user_id, p_sheet_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.wbs_user_can_edit(p_user_id, p_sheet_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if s.archived_at is null then
    return jsonb_build_object('ok', false, 'reason', 'not_archived');
  end if;
  if p_payload is null or (p_payload->>'sheetId') is distinct from p_sheet_id::text
     or jsonb_typeof(p_payload->'content') is distinct from 'object' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  perform set_config('wbs.actor', p_user_id::text, true);

  -- アーカイブしている間に中身が残っていた場合に備えて、先に空にする
  delete from public.wbs_items where wbs_sheet_id = p_sheet_id;
  delete from public.wbs_statuses where wbs_sheet_id = p_sheet_id;
  delete from public.wbs_holidays where wbs_sheet_id = p_sheet_id;

  perform public.wbs_apply_payload(p_sheet_id, s.project_id, p_payload->'content');

  insert into public.wbs_snapshots (id, wbs_sheet_id, taken_at, kind, sheet_version, data, storage_path, created_by, created_by_name)
  select (x->>'id')::uuid, p_sheet_id, (x->>'taken_at')::timestamptz,
         case when x->>'kind' = 'before_restore' then 'before_restore' else 'daily' end,
         coalesce((x->>'sheet_version')::bigint, 0),
         case when jsonb_typeof(x->'data') = 'object' then x->'data' end,
         nullif(x->>'storage_path', ''),
         nullif(x->>'created_by', '')::uuid, coalesce(x->>'created_by_name', '')
  from jsonb_array_elements(coalesce(p_payload->'snapshots', '[]'::jsonb)) x
  where jsonb_typeof(x->'data') = 'object' or nullif(x->>'storage_path', '') is not null
  on conflict (id) do nothing;

  -- 戻した日の定期実行で、戻した状態のバックアップを1つ取る
  update public.wbs_sheets
     set archived_at = null, archived_by_name = '', archive_path = null, last_snapshot_version = null
   where id = p_sheet_id;
  return jsonb_build_object('ok', true, 'archivePath', s.archive_path);
end
$$;

-- ── 9. 関数を呼べる人 ───────────────────────────────────────
-- 書き込み・権限の判定（呼んだ人の id を受け取るもの）は service_role だけ。
-- 画面（anon / authenticated）から id を偽って呼べないようにする。
revoke all on function public.wbs_touch_sheets(uuid[]) from public, anon, authenticated;
revoke all on function public.wbs_user_can_view(uuid, uuid) from public, anon, authenticated;
revoke all on function public.wbs_user_can_edit(uuid, uuid) from public, anon, authenticated;
revoke all on function public.wbs_sheet_is_locked(uuid) from public, anon, authenticated;
revoke all on function public.wbs_snapshot_payload(uuid) from public, anon, authenticated;
revoke all on function public.wbs_apply_payload(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.wbs_take_daily_snapshots(int) from public, anon, authenticated;
revoke all on function public.wbs_restore_snapshot(uuid, uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.wbs_archive_payload(uuid, uuid) from public, anon, authenticated;
revoke all on function public.wbs_archive_finish(uuid, uuid, bigint, int, text) from public, anon, authenticated;
revoke all on function public.wbs_unarchive(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.wbs_user_can_view(uuid, uuid) to service_role;
grant execute on function public.wbs_user_can_edit(uuid, uuid) to service_role;
grant execute on function public.wbs_take_daily_snapshots(int) to service_role;
grant execute on function public.wbs_restore_snapshot(uuid, uuid, bigint, jsonb) to service_role;
grant execute on function public.wbs_archive_payload(uuid, uuid) to service_role;
grant execute on function public.wbs_archive_finish(uuid, uuid, bigint, int, text) to service_role;
grant execute on function public.wbs_unarchive(uuid, uuid, jsonb) to service_role;

-- ── 10. アーカイブ用の置き場（非公開） ───────────────────────
-- 画面から直接は読み書きしない（API が service_role で扱う）ので、storage.objects のポリシーは足さない
insert into storage.buckets (id, name, public)
values ('wbs-archives', 'wbs-archives', false)
on conflict (id) do update set public = false;

-- PostgREST に新しい列・表・関数を知らせる
notify pgrst, 'reload schema';
