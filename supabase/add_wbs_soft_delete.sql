-- ============================================================
-- KAIZEN2611-022 WBS：間違えて削除したWBSを元に戻せるようにする（削除は論理削除にし、中身はアーカイブと同じく保管する）
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全（列は if not exists、関数は create or replace。すでに実行済みでも同じ状態になるだけ）
--
-- 前提（適用済みであること・この順で）: add_wbs.sql / add_wbs_snapshots.sql / add_wbs_api_KAIZEN2611-013.sql
-- add_wbs_lock.sql は未適用でもよい（is_locked の列が無ければ「ロックなし」として扱う）。
--
-- ★ アプリより後に流しても、既存の機能は壊れない。
--   このSQLを流すまでの間（deleted_at の列が無い間）、アプリは今までどおりの物理削除で動く。
--
-- 設計上の要点:
--   ・削除はアーカイブと同じ2段階（API が間で Storage へファイルを置く。api/wbs/[action].ts の delete）。
--       1) wbs_delete_payload … 権限（作成者かオーナー）・ロック中でないことを確かめ、中身とバックアップをまとめて返す
--       2) wbs_delete_finish  … 1) のあとに編集・バックアップが増えていなければ、中身とバックアップを消して削除済みの印を付ける
--   ・元に戻す（wbs_undelete）は、Storage のファイルから中身とバックアップを元の id のまま戻し、削除済みの印を外す。
--   ・wbs_sheets の行は残すので、行の id・名前・段数・公開範囲・ロックは変わらない。
--   ・毎日のバックアップ（wbs_take_daily_snapshots）・API の更新（wbs_api_apply）・反映（wbs_restore_snapshot）・
--     アーカイブ（wbs_archive_payload）は、削除済みの WBS を対象にしない（中身は同じで、確かめを1つ足しただけ）。
--   ・「完全に削除」は、今までどおり wbs_sheets の delete（RLS の wbs_sheets_delete）と、Storage のファイルの削除で行う。
--   ・新しい関数は service_role だけが呼べる（呼んだ人の id を受け取るため）。
-- ============================================================

-- ── 1. wbs_sheets の列 ───────────────────────────────────────
-- 削除した日時・削除した人。deleted_at が null でなければ削除済み（中身は delete_path のファイルにある）
alter table public.wbs_sheets add column if not exists deleted_at timestamptz;
alter table public.wbs_sheets add column if not exists deleted_by_name text not null default '';
alter table public.wbs_sheets add column if not exists delete_path text;

-- ── 2. 削除できる人か（作成者かオーナー。RLS の wbs_sheets_delete と同じ条件） ──
create or replace function public.wbs_user_can_manage(p_user_id uuid, p_sheet_id uuid)
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
         and (s.created_by = p_user_id or me.role = 'owner')
     )
$$;

-- ── 3. 削除（論理削除）1) 中身とバックアップをまとめる ────────────
create or replace function public.wbs_delete_payload(p_user_id uuid, p_sheet_id uuid)
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
  if not public.wbs_user_can_manage(p_user_id, p_sheet_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if s.deleted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'deleted');
  end if;
  if s.archived_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'archived');
  end if;
  if public.wbs_sheet_is_locked(p_sheet_id) then
    return jsonb_build_object('ok', false, 'reason', 'locked');
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
      'kind', 'deleted',
      'sheetId', s.id,
      'deletedAt', now(),
      'content', public.wbs_snapshot_payload(p_sheet_id),
      'lastSnapshotVersion', s.last_snapshot_version,
      'snapshots', v_snaps
    )
  );
end
$$;

-- ── 4. 削除（論理削除）2) 中身とバックアップを消して、削除済みの印を付ける ──
create or replace function public.wbs_delete_finish(
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
  if not public.wbs_user_can_manage(p_user_id, p_sheet_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if s.deleted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'deleted');
  end if;
  if s.archived_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'archived');
  end if;
  -- wbs_sheets_guard_locked_delete（add_wbs_lock.sql）は物理削除のときのトリガーなので、ここで確かめる
  if public.wbs_sheet_is_locked(p_sheet_id) then
    return jsonb_build_object('ok', false, 'reason', 'locked');
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
     set deleted_at = now(), deleted_by_name = coalesce(v_name, ''), delete_path = p_path
   where id = p_sheet_id;
  return jsonb_build_object('ok', true);
end
$$;

-- ── 5. 元に戻す ───────────────────────────────────────────────
-- p_payload は wbs_delete_payload が返した payload（API が Storage から取り出して渡す）。
-- 返り値の deletePath のファイルは、戻し終えたら API が消す。
create or replace function public.wbs_undelete(p_user_id uuid, p_sheet_id uuid, p_payload jsonb)
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
  if not public.wbs_user_can_manage(p_user_id, p_sheet_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if s.deleted_at is null then
    return jsonb_build_object('ok', false, 'reason', 'not_deleted');
  end if;
  if p_payload is null or (p_payload->>'sheetId') is distinct from p_sheet_id::text
     or jsonb_typeof(p_payload->'content') is distinct from 'object' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  perform set_config('wbs.actor', p_user_id::text, true);

  -- 削除している間に中身が残っていた場合に備えて、先に空にする
  delete from public.wbs_items where wbs_sheet_id = p_sheet_id;
  delete from public.wbs_statuses where wbs_sheet_id = p_sheet_id;
  delete from public.wbs_holidays where wbs_sheet_id = p_sheet_id;

  -- 行・ステータスは元の id のまま戻る（マスタースケジュールから行へ飛ぶリンクが外れない）
  perform public.wbs_apply_payload(p_sheet_id, s.project_id, p_payload->'content');

  insert into public.wbs_snapshots (id, wbs_sheet_id, taken_at, kind, sheet_version, data, storage_path, created_by, created_by_name)
  select (x->>'id')::uuid, p_sheet_id, (x->>'taken_at')::timestamptz,
         case when x->>'kind' in ('before_restore', 'before_api') then x->>'kind' else 'daily' end,
         coalesce((x->>'sheet_version')::bigint, 0),
         case when jsonb_typeof(x->'data') = 'object' then x->'data' end,
         nullif(x->>'storage_path', ''),
         nullif(x->>'created_by', '')::uuid, coalesce(x->>'created_by_name', '')
  from jsonb_array_elements(coalesce(p_payload->'snapshots', '[]'::jsonb)) x
  where jsonb_typeof(x->'data') = 'object' or nullif(x->>'storage_path', '') is not null
  on conflict (id) do nothing;

  -- 戻した日の定期実行で、戻した状態のバックアップを1つ取る
  update public.wbs_sheets
     set deleted_at = null, deleted_by_name = '', delete_path = null, last_snapshot_version = null
   where id = p_sheet_id;
  return jsonb_build_object('ok', true, 'deletePath', s.delete_path);
end
$$;

-- ── 6. 削除済みの WBS を対象から外す（今の関数に確かめを1つ足して置き換える） ──
-- 毎日のバックアップ（add_wbs_snapshots.sql と同じ中身。削除済みを外す条件だけ足した）
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
    where s.archived_at is null and s.deleted_at is null and s.last_snapshot_version is distinct from s.edit_version
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

-- 反映（その時点に戻す）。add_wbs_snapshots.sql と同じ中身。削除済みなら not_found
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
  -- KAIZEN2611-022 削除済み（論理削除）の WBS は対象にしない
  if s.deleted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
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

-- アーカイブ。add_wbs_snapshots.sql と同じ中身。削除済みなら not_found
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
  -- KAIZEN2611-022 削除済み（論理削除）の WBS は対象にしない
  if s.deleted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
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

-- API からの更新。add_wbs_api_KAIZEN2611-013.sql と同じ中身。削除済みなら not_found
create or replace function public.wbs_api_apply(p_user_id uuid, p_sheet_id uuid, p_expected_version bigint, p_ops jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.wbs_sheets%rowtype;
  v_name text;
  v_version bigint;
  op jsonb;
  v_set jsonb;
  v_id uuid;
  v_parent uuid;
  v_level int;
  v_parent_level int;
  v_status uuid;
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
  -- KAIZEN2611-022 削除済み（論理削除）の WBS は対象にしない
  if s.deleted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
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
  if p_ops is null or jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid', 'detail', 'operations が空です');
  end if;

  -- このあとの変更で上がる版の番号に、キーの発行者を残す
  perform set_config('wbs.actor', p_user_id::text, true);
  select p.name into v_name from public.profiles p where p.id = p_user_id;

  begin
    -- 反映の直前の状態を保存する（これを「その時点に戻す」で反映すれば、API の更新を取り消せる）
    insert into public.wbs_snapshots (wbs_sheet_id, kind, sheet_version, data, created_by, created_by_name)
    values (p_sheet_id, 'before_api', s.edit_version, public.wbs_snapshot_payload(p_sheet_id), p_user_id, coalesce(v_name, ''));

    for op in select x from jsonb_array_elements(p_ops) x loop
      if op->>'t' = 'insert' then
        v_id := (op->>'id')::uuid;
        v_parent := nullif(op->>'parent_id', '')::uuid;
        v_level := (op->>'level')::int;
        if v_level is null or v_level < 1 or v_level > s.levels then
          raise exception '段が正しくありません（%）', v_level;
        end if;
        if v_parent is null then
          if v_level <> 1 then raise exception '親の行が無い行は大項目にしかできません'; end if;
        else
          select i.level into v_parent_level from public.wbs_items i where i.id = v_parent and i.wbs_sheet_id = p_sheet_id;
          if not found then raise exception '親の行がこのWBSに見つかりません（%）', v_parent; end if;
          if v_level <> v_parent_level + 1 then raise exception '親の行の段と合いません（%）', v_parent; end if;
        end if;
        v_status := nullif(op->>'status_id', '')::uuid;
        if v_status is not null and not exists (select 1 from public.wbs_statuses st where st.id = v_status and st.wbs_sheet_id = p_sheet_id) then
          raise exception 'ステータスがこのWBSに見つかりません（%）', v_status;
        end if;
        insert into public.wbs_items (id, wbs_sheet_id, parent_id, level, name, assignee, start_date, end_date, progress, status_id, note, sort_order)
        values (v_id, p_sheet_id, v_parent, v_level,
                coalesce(op->>'name', ''), coalesce(op->>'assignee', ''),
                nullif(op->>'start_date', '')::date, nullif(op->>'end_date', '')::date,
                coalesce((op->>'progress')::int, 0), v_status,
                coalesce(op->>'note', ''), coalesce((op->>'sort_order')::float8, 0));

      elsif op->>'t' = 'update' then
        v_id := (op->>'id')::uuid;
        v_set := coalesce(op->'set', '{}'::jsonb);
        select i.level into v_level from public.wbs_items i where i.id = v_id and i.wbs_sheet_id = p_sheet_id;
        if not found then raise exception '行がこのWBSに見つかりません（%）', v_id; end if;
        if v_set ? 'parent_id' then
          v_parent := nullif(v_set->>'parent_id', '')::uuid;
          if v_parent is null then
            if v_level <> 1 then raise exception '大項目でない行を、親の無い位置へは移せません（%）', v_id; end if;
          else
            select i.level into v_parent_level from public.wbs_items i where i.id = v_parent and i.wbs_sheet_id = p_sheet_id;
            if not found then raise exception '移す先の親の行がこのWBSに見つかりません（%）', v_parent; end if;
            if v_level <> v_parent_level + 1 then raise exception '移す先の親の行の段と合いません（%）', v_parent; end if;
          end if;
        end if;
        if v_set ? 'status_id' then
          v_status := nullif(v_set->>'status_id', '')::uuid;
          if v_status is not null and not exists (select 1 from public.wbs_statuses st where st.id = v_status and st.wbs_sheet_id = p_sheet_id) then
            raise exception 'ステータスがこのWBSに見つかりません（%）', v_status;
          end if;
        end if;
        update public.wbs_items i set
          name       = case when v_set ? 'name'       then coalesce(v_set->>'name', '')             else i.name end,
          assignee   = case when v_set ? 'assignee'   then coalesce(v_set->>'assignee', '')         else i.assignee end,
          start_date = case when v_set ? 'start_date' then nullif(v_set->>'start_date', '')::date   else i.start_date end,
          end_date   = case when v_set ? 'end_date'   then nullif(v_set->>'end_date', '')::date     else i.end_date end,
          progress   = case when v_set ? 'progress'   then coalesce((v_set->>'progress')::int, 0)   else i.progress end,
          status_id  = case when v_set ? 'status_id'  then nullif(v_set->>'status_id', '')::uuid    else i.status_id end,
          note       = case when v_set ? 'note'       then coalesce(v_set->>'note', '')             else i.note end,
          parent_id  = case when v_set ? 'parent_id'  then nullif(v_set->>'parent_id', '')::uuid    else i.parent_id end,
          sort_order = case when v_set ? 'sort_order' then (v_set->>'sort_order')::float8           else i.sort_order end,
          updated_at = now()
        where i.id = v_id and i.wbs_sheet_id = p_sheet_id;

      elsif op->>'t' = 'link' then
        v_id := (op->>'item_id')::uuid;
        if not exists (select 1 from public.wbs_items i where i.id = v_id and i.wbs_sheet_id = p_sheet_id) then
          raise exception '行がこのWBSに見つかりません（%）', v_id;
        end if;
        if not exists (
          select 1 from public.sprint_tickets t join public.sprints sp on sp.id = t.sprint_id
          where t.id = op->>'ticket_id' and sp.project_id = s.project_id
        ) then
          raise exception 'チケットがこのプロジェクトに見つかりません（%）', op->>'ticket_id';
        end if;
        insert into public.wbs_item_tickets (wbs_item_id, ticket_id) values (v_id, op->>'ticket_id')
        on conflict do nothing;

      elsif op->>'t' = 'unlink' then
        v_id := (op->>'item_id')::uuid;
        if not exists (select 1 from public.wbs_items i where i.id = v_id and i.wbs_sheet_id = p_sheet_id) then
          raise exception '行がこのWBSに見つかりません（%）', v_id;
        end if;
        delete from public.wbs_item_tickets where wbs_item_id = v_id and ticket_id = op->>'ticket_id';

      else
        -- 行の削除（delete）を含め、決めた形以外の操作は受けない
        raise exception '受け付けない操作です（%）', coalesce(op->>'t', '');
      end if;
    end loop;
  exception when others then
    -- 中で行った変更（バックアップを含む）は、すべて取り消される
    return jsonb_build_object('ok', false, 'reason', 'invalid', 'detail', sqlerrm);
  end;

  select edit_version into v_version from public.wbs_sheets where id = p_sheet_id;
  return jsonb_build_object('ok', true, 'version', v_version);
end
$$;


-- ── 7. 関数を呼べる人 ───────────────────────────────────────
-- 呼んだ人の id を受け取るので、service_role（api/wbs の delete / undelete など）だけが呼べるようにする
revoke all on function public.wbs_user_can_manage(uuid, uuid) from public, anon, authenticated;
revoke all on function public.wbs_delete_payload(uuid, uuid) from public, anon, authenticated;
revoke all on function public.wbs_delete_finish(uuid, uuid, bigint, int, text) from public, anon, authenticated;
revoke all on function public.wbs_undelete(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.wbs_take_daily_snapshots(int) from public, anon, authenticated;
revoke all on function public.wbs_restore_snapshot(uuid, uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.wbs_archive_payload(uuid, uuid) from public, anon, authenticated;
revoke all on function public.wbs_api_apply(uuid, uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.wbs_user_can_manage(uuid, uuid) to service_role;
grant execute on function public.wbs_delete_payload(uuid, uuid) to service_role;
grant execute on function public.wbs_delete_finish(uuid, uuid, bigint, int, text) to service_role;
grant execute on function public.wbs_undelete(uuid, uuid, jsonb) to service_role;
grant execute on function public.wbs_take_daily_snapshots(int) to service_role;
grant execute on function public.wbs_restore_snapshot(uuid, uuid, bigint, jsonb) to service_role;
grant execute on function public.wbs_archive_payload(uuid, uuid) to service_role;
grant execute on function public.wbs_api_apply(uuid, uuid, bigint, jsonb) to service_role;

-- PostgREST に新しい列・関数を知らせる
notify pgrst, 'reload schema';
