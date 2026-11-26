-- ============================================================
-- KAIZEN2611-013 WBS：APIキーを使って、AI や別のシステムが WBS を更新できるようにする
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
--
-- 前提（適用済みであること）: add_wbs.sql / add_wbs_snapshots.sql
-- add_wbs_lock.sql は未適用でもよい（is_locked の列が無ければ「ロックなし」として扱う）。
--
-- ★ アプリ（POST /api/v1/wbs-update）より後に流しても、既存の機能は壊れない。
--   このSQLを流すまでの間、wbs-update だけが「SQL が未適用」の 503 を返す（読み取りの API・画面は今のまま動く）。
--
-- 設計上の要点:
--   ・API（api/_lib/wbsApi.ts）が、送られた操作を確かめて「行の追加・項目の変更・チケットの紐づけ・外す」の
--     形に直してから、wbs_api_apply に渡す。担当者・ステータスの名前の確かめ、warnings の組み立ては API が行う。
--   ・wbs_api_apply は、権限・アーカイブ・ロック・版の番号の確認、反映前のバックアップ、行の反映を1回の処理で行う。
--     WBSの行を for update で押さえるので、比べてから反映するまでの間の編集は、この処理が終わるまで待たされる。
--   ・操作が1つでも反映できなければ（行が別のWBSのもの・段が合わない など）、バックアップも含めて何も残さない
--     （begin … exception の中で行い、失敗したら中の変更をすべて取り消す）。
--   ・行の削除は受けない（削除は画面でだけ行う）。
--   ・呼んだ人は wbs.actor に入れて、wbs_touch_sheets が「最後に編集した人」をキーの発行者として残す。
-- ============================================================

-- ── 1. バックアップの種類に「API で更新する前に保存したもの」を足す ──
-- daily = 毎日 / before_restore = 反映（その時点に戻す）の直前 / before_api = API での更新の直前
alter table public.wbs_snapshots drop constraint if exists wbs_snapshots_kind_check;
alter table public.wbs_snapshots add constraint wbs_snapshots_kind_check
  check (kind in ('daily', 'before_restore', 'before_api'));

-- ── 2. API からの更新 ────────────────────────────────────────
-- p_ops は API が直した形の配列。1件ずつ順に反映する。
--   {"t":"insert","id":uuid,"parent_id":uuid|null,"level":n,"name","assignee","start_date","end_date","progress","status_id","note","sort_order"}
--   {"t":"update","id":uuid,"set":{ name / assignee / start_date / end_date / progress / status_id / note / parent_id / sort_order のうち変えるものだけ }}
--   {"t":"link","item_id":uuid,"ticket_id":text} / {"t":"unlink","item_id":uuid,"ticket_id":text}
-- 返り値: { ok: true, version } / { ok: false, reason: not_found|forbidden|archived|locked|conflict|invalid, ... }
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

-- ── 3. アーカイブから戻すときに、before_api のバックアップを daily に変えない ──
-- add_wbs_snapshots.sql の wbs_unarchive と同じ中身で、種類の写し方だけを変える
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
     set archived_at = null, archived_by_name = '', archive_path = null, last_snapshot_version = null
   where id = p_sheet_id;
  return jsonb_build_object('ok', true, 'archivePath', s.archive_path);
end
$$;

-- ── 4. 関数を呼べる人 ───────────────────────────────────────
-- 呼んだ人の id を受け取るので、service_role（api/v1 の wbs-update）だけが呼べるようにする
revoke all on function public.wbs_api_apply(uuid, uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.wbs_unarchive(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.wbs_api_apply(uuid, uuid, bigint, jsonb) to service_role;
grant execute on function public.wbs_unarchive(uuid, uuid, jsonb) to service_role;

-- PostgREST に新しい関数を知らせる
notify pgrst, 'reload schema';
