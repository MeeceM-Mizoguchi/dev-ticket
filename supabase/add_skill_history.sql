-- ============================================================
-- BRU9-041 スキル更新の履歴・復元
--
-- 目的:
--   ① 誰が/何が いつ member_skills を変えたのかを残す（夜間の自動判定・手動編集・スキル削除）
--   ② その履歴を画面で閲覧する
--   ③ 「この時点の状態に戻す」（メンバー個別のみ）
--
-- 方式: 差分ログ（変更があった行だけを1件1行で記録する）
--   スナップショット方式（毎晩の全状態を保存）は 30人×25スキル×365日 = 年27万行/組織 になり
--   マルチテナントで破綻する。差分ログなら実変更分だけで済み、かつ下の DISTINCT ON クエリで
--   任意時点の状態を完全に再構成できる。
--
--   成立条件は3つ:
--     1. 変更「後」の値を必ず記録する（new_level / new_source）
--     2. 削除も change_type='removed' として1行記録する
--     3. 導入時に現在の全状態を kind='seed' として1回書き込む（再構成の床）
--
-- ※ 冪等（何度実行しても安全）
-- ============================================================

-- ------------------------------------------------------------
-- 1. 履歴の単位（いつ・何が・誰が）
--    kind:
--      seed    … このマイグレーション実行時の初期状態（再構成の床。絶対に消さない）
--      auto    … 夜間バッチ ①スキル分析
--      manual  … 人がスキル編集モーダルで保存した
--      restore … 過去の時点へ戻した
-- ------------------------------------------------------------
create table if not exists skill_update_runs (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      text not null,
  kind                 text not null check (kind in ('seed','auto','manual','restore')),
  actor_profile_id     uuid,          -- manual/restore は操作者。auto/seed は null
  target_profile_id    uuid,          -- 特定メンバーだけを対象にした run（manual/restore）
  restored_from_at     timestamptz,   -- restore のとき、どの時点に戻したか
  summary              jsonb not null default '{}'::jsonb,   -- {added,updated,removed,members}
  created_at           timestamptz not null default now()
);

create index if not exists idx_skill_update_runs_org
  on skill_update_runs(organization_id, created_at desc);

-- ------------------------------------------------------------
-- 2. 変更1件
--
--    ★ profile_id / skill_id に外部キーを張らない（意図的）★
--      メンバーやスキルが削除されても履歴は残さないと「復元」が破綻する。
--      表示時に名前が引けない場合は画面側で「（削除済み）」と出す。
--
--    changed_at は run.created_at の複製。時点再構成をこのテーブル1本で閉じるため。
-- ------------------------------------------------------------
create table if not exists member_skill_changes (
  id              bigint generated always as identity primary key,
  run_id          uuid not null references skill_update_runs(id) on delete cascade,
  organization_id text not null,      -- 非正規化。絞り込みと RLS を速くする
  profile_id      uuid not null,
  skill_id        uuid not null,
  change_type     text not null check (change_type in ('added','level_changed','removed','source_changed')),
  old_level       int,
  new_level       int,
  old_source      text,
  new_source      text,
  evidence        jsonb not null default '{}'::jsonb,   -- 変更後の判定根拠
  changed_at      timestamptz not null
);

create index if not exists idx_member_skill_changes_org
  on member_skill_changes(organization_id, changed_at desc);

-- 時点再構成（restore）と、メンバー個別の履歴表示で使う主役のインデックス
create index if not exists idx_member_skill_changes_profile
  on member_skill_changes(profile_id, skill_id, changed_at desc);

create index if not exists idx_member_skill_changes_run
  on member_skill_changes(run_id);

-- ------------------------------------------------------------
-- 3. 時点再構成
--    「p_at の時点で、そのメンバーがどのスキルをLvいくつで持っていたか」を返す。
--    各(profile,skill)について p_at 以前の最新の変更行を取り、removed は除外する。
-- ------------------------------------------------------------
-- ★ 列参照はすべてテーブル別名で修飾する ★
--   RETURNS TABLE の出力名(skill_id, level, source, evidence)は
--   member_skill_changes の列名と衝突する。修飾しないと
--   「column reference "skill_id" is ambiguous」で実行時に落ちる。
create or replace function skill_state_at(p_profile_id uuid, p_at timestamptz)
returns table (skill_id uuid, level int, source text, evidence jsonb)
language sql
stable
as $$
  select c.skill_id, c.new_level, c.new_source, c.evidence
  from (
    select distinct on (msc.skill_id)
           msc.skill_id, msc.change_type, msc.new_level, msc.new_source, msc.evidence
    from member_skill_changes msc
    where msc.profile_id = p_profile_id and msc.changed_at <= p_at
    order by msc.skill_id, msc.changed_at desc, msc.id desc
  ) c
  where c.change_type <> 'removed' and c.new_level is not null;
$$;

-- ------------------------------------------------------------
-- 4. 手動編集（スキル編集モーダルの「保存」）
--
--    従来はクライアントが delete と upsert を別々に発行していたため、
--      ・途中で落ちると中途半端に適用される
--      ・履歴をクライアントが書くことになり信用できない
--    という2点の問題があった。差分計算・適用・履歴記録を1トランザクションに閉じる。
--
--    p_rows: [{"skillId":"...","level":3}, ...]
-- ------------------------------------------------------------
create or replace function save_member_skills(
  p_profile_id uuid,
  p_rows       jsonb,
  p_removed    uuid[],
  p_actor      uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org       text;
  v_run_id    uuid;
  v_now       timestamptz := now();
  v_added     int := 0;
  v_updated   int := 0;
  v_removed   int := 0;
  v_actor     uuid;
  v_actor_org text;
begin
  -- ::text 明示。profiles.organization_id は環境により uuid / text のどちらもあり得る。
  select organization_id::text into v_org from profiles where id = p_profile_id;
  if v_org is null then
    raise exception 'profile not found: %', p_profile_id;
  end if;

  -- ★ security definer は RLS を素通りするので、ここで所属を必ず検証する ★
  --   検証が無いと、認証さえ通れば他組織のメンバーのスキルを書き換えられてしまう。
  v_actor := coalesce(p_actor, auth.uid());
  if coalesce(auth.role(), '') <> 'service_role' then
    select organization_id::text into v_actor_org from profiles where id = v_actor;
    if v_actor_org is null or v_actor_org is distinct from v_org then
      raise exception 'not allowed: different organization';
    end if;
  end if;

  insert into skill_update_runs (organization_id, kind, actor_profile_id, target_profile_id, created_at)
  values (v_org, 'manual', v_actor, p_profile_id, v_now)
  returning id into v_run_id;

  -- ── 削除 ──
  insert into member_skill_changes (
    run_id, organization_id, profile_id, skill_id, change_type,
    old_level, new_level, old_source, new_source, evidence, changed_at)
  select v_run_id, v_org, ms.profile_id, ms.skill_id, 'removed',
         ms.level, null, ms.source, null, ms.evidence, v_now
  from member_skills ms
  where ms.profile_id = p_profile_id and ms.skill_id = any(p_removed);
  get diagnostics v_removed = row_count;

  delete from member_skills
  where profile_id = p_profile_id and skill_id = any(p_removed);

  -- ── 追加・変更（値が実際に変わった行だけ記録する） ──
  with incoming as (
    select (r->>'skillId')::uuid as skill_id, (r->>'level')::int as level
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  ),
  diff as (
    select i.skill_id, i.level, ms.level as old_level, ms.source as old_source, ms.evidence,
           case when ms.skill_id is null then 'added'
                when ms.level is distinct from i.level then 'level_changed'
                else 'source_changed' end as change_type
    from incoming i
    left join member_skills ms
      on ms.profile_id = p_profile_id and ms.skill_id = i.skill_id
    -- 手動保存は source を 'manual' にする。レベルが同じでも auto→manual は意味のある変化。
    where ms.skill_id is null
       or ms.level is distinct from i.level
       or ms.source is distinct from 'manual'
  )
  insert into member_skill_changes (
    run_id, organization_id, profile_id, skill_id, change_type,
    old_level, new_level, old_source, new_source, evidence, changed_at)
  select v_run_id, v_org, p_profile_id, d.skill_id, d.change_type,
         d.old_level, d.level, d.old_source, 'manual', coalesce(d.evidence, '{}'::jsonb), v_now
  from diff d;

  select count(*) filter (where change_type = 'added'),
         count(*) filter (where change_type <> 'added')
    into v_added, v_updated
  from member_skill_changes where run_id = v_run_id and change_type <> 'removed';

  -- ★ 人が保存した行は source='manual' → 以降 ①スキル分析は上書きしない
  insert into member_skills (profile_id, skill_id, level, source, evidence, updated_at)
  select p_profile_id, (r->>'skillId')::uuid, (r->>'level')::int, 'manual', '{}'::jsonb, v_now
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  on conflict (profile_id, skill_id) do update
    set level = excluded.level, source = 'manual', updated_at = v_now;

  update skill_update_runs
     set summary = jsonb_build_object('added', v_added, 'updated', v_updated, 'removed', v_removed, 'members', 1)
   where id = v_run_id;

  -- 変更が1件も無かった run は履歴を汚すだけなので消す
  if v_added = 0 and v_updated = 0 and v_removed = 0 then
    delete from skill_update_runs where id = v_run_id;
    return jsonb_build_object('changed', 0);
  end if;

  return jsonb_build_object('changed', v_added + v_updated + v_removed, 'runId', v_run_id);
end;
$$;

-- ------------------------------------------------------------
-- 5. 復元（メンバー個別のみ）
--
--    ★ 復元は「巻き戻し」ではなく「前に進む操作」として記録する ★
--      履歴は絶対に消さない。だから「復元したけどやっぱり戻したい」も、
--      復元直前の時点へもう一度復元するだけで済む。
--
--    p_disable_auto_update:
--      復元後の行は source='auto' のまま残す（設計判断）。そのままだと今夜の自動判定で
--      再び上書きされうるので、既定でこのメンバーの skill_auto_update を OFF にする。
--
--    p_dry_run: true なら「何が変わるか」だけ返して一切書き込まない（プレビュー用）。
-- ------------------------------------------------------------
create or replace function restore_member_skills(
  p_profile_id          uuid,
  p_at                  timestamptz,
  p_disable_auto_update boolean default true,
  p_actor               uuid default null,
  p_dry_run             boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org        text;
  v_run_id     uuid;
  v_now        timestamptz := now();
  v_actor      uuid;
  v_actor_role text;
  v_actor_org  text;
  v_changes    jsonb;
  v_count      int;
begin
  -- ::text 明示。profiles.organization_id は環境により uuid / text のどちらもあり得る。
  select organization_id::text into v_org from profiles where id = p_profile_id;
  if v_org is null then
    raise exception 'profile not found: %', p_profile_id;
  end if;

  -- ★ 権限はサーバー側でも必ず検証する ★
  --   画面でボタンを隠すだけだと、RPC を直接叩かれれば復元できてしまう。
  --   p_actor はクライアントが自由に詰められるので、null なら auth.uid() を使い、
  --   検証を「p_actor があるときだけ」にはしない（それでは null を渡せば素通りする）。
  v_actor := coalesce(p_actor, auth.uid());
  if coalesce(auth.role(), '') <> 'service_role' then
    select role, organization_id::text into v_actor_role, v_actor_org
      from profiles where id = v_actor;
    if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
      raise exception 'restore requires owner or admin role';
    end if;
    if v_actor_org is distinct from v_org then
      raise exception 'not allowed: different organization';
    end if;
  end if;

  -- 復元先の状態と現在の状態を突き合わせて、実際に変わる行だけを拾う
  with target as (
    select * from skill_state_at(p_profile_id, p_at)
  ),
  current_state as (
    select skill_id, level, source, evidence
    from member_skills where profile_id = p_profile_id
  ),
  diff as (
    -- 追加し直す / レベルを戻す / source を戻す
    --   ★ source も差分に含める ★
    --     レベルが同じでも source が違えば戻す必要がある。例えば「手動編集する前の
    --     自動判定の状態に戻す」場合、source='manual' のままだと行が凍結されたままになり、
    --     自動更新をONに戻しても夜間バッチが二度と触らなくなってしまう。
    select t.skill_id,
           c.level as old_level, t.level as new_level,
           c.source as old_source, t.source as new_source,
           t.evidence,
           case when c.skill_id is null then 'added'
                when c.level is distinct from t.level then 'level_changed'
                else 'source_changed' end as change_type
    from target t
    left join current_state c on c.skill_id = t.skill_id
    where c.skill_id is null
       or c.level is distinct from t.level
       or c.source is distinct from t.source
    union all
    -- その時点では持っていなかったスキルを消す
    select c.skill_id, c.level, null, c.source, null, c.evidence, 'removed'
    from current_state c
    left join target t on t.skill_id = c.skill_id
    where t.skill_id is null
  )
  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb), count(*) into v_changes, v_count from diff d;

  if p_dry_run then
    return jsonb_build_object('changed', v_count, 'changes', v_changes, 'dryRun', true);
  end if;

  if v_count = 0 then
    -- 変化が無いなら run も作らない（履歴に空の復元が並ぶのを防ぐ）
    if p_disable_auto_update then
      update profiles set skill_auto_update = false where id = p_profile_id;
    end if;
    return jsonb_build_object('changed', 0);
  end if;

  insert into skill_update_runs (
    organization_id, kind, actor_profile_id, target_profile_id, restored_from_at, summary, created_at)
  values (v_org, 'restore', v_actor, p_profile_id, p_at,
          jsonb_build_object('changed', v_count, 'members', 1), v_now)
  returning id into v_run_id;

  insert into member_skill_changes (
    run_id, organization_id, profile_id, skill_id, change_type,
    old_level, new_level, old_source, new_source, evidence, changed_at)
  select v_run_id, v_org, p_profile_id,
         (c->>'skill_id')::uuid, c->>'change_type',
         (c->>'old_level')::int, (c->>'new_level')::int,
         c->>'old_source', c->>'new_source',
         -- evidence が SQL NULL だと to_jsonb で JSON の null になる。
         -- そのまま入れると値が 'null' として残るので '{}' に潰す。
         coalesce(nullif(c->'evidence', 'null'::jsonb), '{}'::jsonb), v_now
  from jsonb_array_elements(v_changes) c;

  -- 適用: 消えるものを消して、戻すものを書く
  delete from member_skills
  where profile_id = p_profile_id
    and skill_id in (
      select (c->>'skill_id')::uuid from jsonb_array_elements(v_changes) c
      where c->>'change_type' = 'removed');

  insert into member_skills (profile_id, skill_id, level, source, evidence, updated_at)
  select p_profile_id, (c->>'skill_id')::uuid, (c->>'new_level')::int,
         coalesce(c->>'new_source', 'auto'), coalesce(c->'evidence', '{}'::jsonb), v_now
  from jsonb_array_elements(v_changes) c
  where c->>'change_type' <> 'removed'
  on conflict (profile_id, skill_id) do update
    set level = excluded.level, source = excluded.source,
        evidence = excluded.evidence, updated_at = v_now;

  -- 復元しただけでは今夜の自動判定にまた上書きされうるので、既定で自動更新を止める
  if p_disable_auto_update then
    update profiles set skill_auto_update = false where id = p_profile_id;
  end if;

  return jsonb_build_object('changed', v_count, 'runId', v_run_id);
end;
$$;

-- ------------------------------------------------------------
-- 6. スキルマスタ削除のカスケードを履歴に残す
--    skills を消すと member_skills が on delete cascade で静かに消えるため、
--    トリガで消える直前の状態を 'removed' として記録しておく。
-- ------------------------------------------------------------
create or replace function log_skill_delete_cascade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_now    timestamptz := now();
  v_count  int;
begin
  select count(*) into v_count from member_skills where skill_id = old.id;
  if v_count = 0 then return old; end if;

  insert into skill_update_runs (organization_id, kind, summary, created_at)
  values (old.organization_id, 'manual',
          jsonb_build_object('removed', v_count, 'skillDeleted', old.name), v_now)
  returning id into v_run_id;

  insert into member_skill_changes (
    run_id, organization_id, profile_id, skill_id, change_type,
    old_level, new_level, old_source, new_source, evidence, changed_at)
  select v_run_id, old.organization_id, ms.profile_id, ms.skill_id, 'removed',
         ms.level, null, ms.source, null, ms.evidence, v_now
  from member_skills ms
  where ms.skill_id = old.id;

  return old;
end;
$$;

drop trigger if exists trg_log_skill_delete_cascade on skills;
create trigger trg_log_skill_delete_cascade
  before delete on skills
  for each row execute function log_skill_delete_cascade();

-- ------------------------------------------------------------
-- 7. 初期状態の書き込み（再構成の床）
--
--    ★ これが無いと「導入前から持っていたスキル」が復元時に消える ★
--      時点再構成は member_skill_changes しか見ないので、既存の member_skills を
--      1回 seed として流し込んでおかないと「その時点では存在しなかった」と誤判定される。
--    冪等: seed run が既にある組織はスキップする。
-- ------------------------------------------------------------
do $$
declare
  r record;
  v_run_id uuid;
  v_now    timestamptz := now();
begin
  -- ★ profiles.organization_id は ::text で比較する ★
  --   環境によって profiles.organization_id が uuid だったり text だったりする
  --   （add_app_version.sql に同じ注意書きあり）。この新テーブル群は text で持つので、
  --   直接比較すると uuid 環境で "operator does not exist: text = uuid" で落ちる。
  --   ::text に寄せれば uuid 環境・text 環境のどちらでも動く。
  for r in
    select distinct p.organization_id::text as org_id
    from member_skills ms
    join profiles p on p.id = ms.profile_id
    where p.organization_id is not null
      and not exists (
        select 1 from skill_update_runs sur
        where sur.organization_id = p.organization_id::text and sur.kind = 'seed')
  loop
    insert into skill_update_runs (organization_id, kind, summary, created_at)
    values (r.org_id, 'seed',
            jsonb_build_object('note', '履歴機能の導入時点の状態'), v_now)
    returning id into v_run_id;

    insert into member_skill_changes (
      run_id, organization_id, profile_id, skill_id, change_type,
      old_level, new_level, old_source, new_source, evidence, changed_at)
    select v_run_id, r.org_id, ms.profile_id, ms.skill_id, 'added',
           null, ms.level, null, ms.source, ms.evidence,
           -- 実際に最後に更新された時刻が分かるならそれを使う（seed 実行時刻より正確）
           least(coalesce(ms.updated_at, v_now), v_now)
    from member_skills ms
    join profiles p on p.id = ms.profile_id
    where p.organization_id::text = r.org_id;

    update skill_update_runs
       set summary = summary || jsonb_build_object(
             'added', (select count(*) from member_skill_changes where run_id = v_run_id))
     where id = v_run_id;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 8. RLS
--    履歴は読み取り専用。書き込みは service_role（夜間バッチ）と
--    security definer の RPC 経由のみに限る。
-- ------------------------------------------------------------
alter table skill_update_runs    enable row level security;
alter table member_skill_changes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'skill_update_runs' and policyname = 'skill_update_runs_read') then
    create policy skill_update_runs_read on skill_update_runs for select
      using (auth.role() = 'authenticated');
  end if;

  if not exists (select 1 from pg_policies where tablename = 'member_skill_changes' and policyname = 'member_skill_changes_read') then
    create policy member_skill_changes_read on member_skill_changes for select
      using (auth.role() = 'authenticated');
  end if;
end $$;

-- security definer の関数は public への既定 grant を外してから authenticated にだけ渡す
revoke execute on function skill_state_at(uuid, timestamptz)                                from public;
revoke execute on function save_member_skills(uuid, jsonb, uuid[], uuid)                    from public;
revoke execute on function restore_member_skills(uuid, timestamptz, boolean, uuid, boolean) from public;

grant execute on function skill_state_at(uuid, timestamptz)                                to authenticated;
grant execute on function save_member_skills(uuid, jsonb, uuid[], uuid)                    to authenticated;
grant execute on function restore_member_skills(uuid, timestamptz, boolean, uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- 9. profiles.skill_auto_update を本人以外も更新できるようにする
--
--    ★ トグルが「効かない」原因になっていた箇所 ★
--      メンバー管理者が他人のトグルを操作する必要がある。既存ポリシーが
--      本人の行しか更新できない場合、UPDATE は 0 行で静かに終わり、
--      10秒ポーリングが古い値を再取得してトグルが勝手にONへ戻る。
--    ここでは「同じ組織のメンバーの行なら更新してよい」ポリシーを足す。
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'profiles' and policyname = 'profiles_same_org_update') then
    create policy profiles_same_org_update on profiles for update
      using (
        auth.role() = 'authenticated'
        and organization_id = (select organization_id from profiles where id = auth.uid())
      )
      with check (
        auth.role() = 'authenticated'
        and organization_id = (select organization_id from profiles where id = auth.uid())
      );
  end if;
end $$;
