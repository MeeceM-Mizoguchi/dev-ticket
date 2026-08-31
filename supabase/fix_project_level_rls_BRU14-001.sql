-- ============================================================
-- BRU14-001: 画面に表示されないプロジェクトのデータが
--            ログイン済みのAPI呼び出しで取得できる
--
-- Supabase Dashboard → SQL Editor → New query に貼り付けて実行。
-- 冪等: 何度実行しても安全。
--
-- ★手順: まず「0) 適用前の診断」だけを選択実行し、3行とも 0 件であることを
--        確認してから全体を流すこと。0 でない場合の扱いは 0) のコメントを参照。
--
-- ── 何が起きていたか ─────────────────────────────────────────
-- プロジェクト境界の判定が「ブラウザ側の配列フィルタ」にしか無く、
-- DB(RLS)には存在しなかった。
--   ProjectsPage.tsx : projects.filter(p => p.members.includes(userName))
-- そのため PostgREST を直接叩くと、ログインさえしていれば
-- アサインされていないプロジェクトの行がそのまま返っていた。
--
-- ── なぜ RESTRICTIVE ポリシーで塞ぐか ────────────────────────
-- このリポジトリには projects の RLS を書いた SQL が複数あり、内容が矛盾している。
--   fix_all.sql              : auth.role() = 'authenticated'（＝全開）
--   fix_multitenant_rls.sql  : 組織単位に分離
-- PostgreSQL の PERMISSIVE ポリシーは OR で合成されるため、
-- 全開のポリシーが1本でも残っていれば、他を何本足しても素通りしてしまう。
-- 本番にどちらが載っているかを SQL だけからは確定できないので、
-- ここでは AND で合成される RESTRICTIVE ポリシーを重ねる。
-- これなら
--   ・残存している全開ポリシーがあっても必ず絞られる
--   ・ホワイトボードの限定公開など、既存ポリシーの独自ロジックを壊さない
--     （RESTRICTIVE は「さらに狭める」だけで、広げることはできない）
-- という2点を同時に満たせる。
--
-- service_role は BYPASSRLS のため、サーバー側API(api/*)は影響を受けない。
-- 未ログイン(anon)は auth.uid() が null になり、全ヘルパーが空を返すので全拒否。
-- ============================================================


-- ============================================================
-- 0) 適用前の診断  ★ここだけを先に選択実行すること★
--
--    organization_id が NULL の行は、本SQL適用後
--    「その行のメンバー本人にしか見えなく」なる。
--    NULL を素通しにする実装（fix_multitenant_rls.sql の
--    `OR organization_id IS NULL`）こそが今回の穴の一部なので、
--    ここは緩めずに、先にデータ側を埋めて解決する。
--
--    3行とも 0 なら、そのまま最後まで流してよい。
--    0 でなければ、末尾【NULL組織の棚卸し】で中身を見て organization_id を埋めるか、
--    「消えても構わない古いデータ」であることを確認してから進めること。
-- ============================================================
select 'projects' as tbl, count(*) as organization_id_is_null from public.projects where organization_id is null
union all
select 'profiles', count(*) from public.profiles where organization_id is null
union all
select 'clients',  count(*) from public.clients  where organization_id is null;


-- ============================================================
-- 1) ヘルパー関数
--    すべて security definer。RLS が有効なテーブル(profiles/projects)を
--    ポリシーの中から参照するため、そのままだと無限再帰になる。
--    search_path を固定するのは、security definer 関数が呼び出し側の
--    search_path に引きずられて別スキーマの同名テーブルを見に行くのを防ぐため。
-- ============================================================

-- ログインユーザーの表示名。projects.members は「名前の配列」なので突き合わせに使う。
create or replace function my_profile_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select name from public.profiles where id = auth.uid()
$$;

-- ログインユーザーの役割。
create or replace function my_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ログインユーザーの組織ID。organization_id は環境により uuid / text の
-- どちらもあり得るため ::text に寄せて比較する（既存関数の踏襲）。
create or replace function get_my_org_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select organization_id::text from public.profiles where id = auth.uid()
$$;

-- Meece 側の全体管理者。全組織を横断して見られる唯一の役割。
create or replace function is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false)
$$;

-- ── アクセス可能なプロジェクトの定義（唯一の判定ルール） ─────
-- 以降のポリシー・関数はすべてこの1本を経由する。ここだけ直せば全体が揃う。
-- 判定は3通り。
--   1. owner            … 全組織・全プロジェクト
--   2. 同一組織の admin / project-manager … その組織の全プロジェクト
--                          （メンバー管理・権限設定の画面が全PJを走査するため）
--   3. それ以外          … projects.members に自分の名前が入っているものだけ
--                          （＝画面の絞り込みと完全に一致させる）
--
-- organization_id が NULL の旧データは「メンバー本人だけ」に見せる。
-- ここで NULL を素通しにすると、旧データが全社から丸見えになる
-- （fix_multitenant_rls.sql の `OR organization_id IS NULL` が正にその穴だった）。
--
-- 引数に projects の「行の値」を取るのが要点。テーブルを引き直さないので、
-- INSERT の WITH CHECK（まだ SELECT できない行）でもそのまま使える。
create or replace function project_visible_to(
  p_user_id uuid,
  p_org_id  text,
  p_members text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles me
    where me.id = p_user_id
      and (
        me.role = 'owner'
        or (
          p_org_id is not null
          and p_org_id = me.organization_id::text
          and (me.name = any(p_members) or me.role in ('admin', 'project-manager'))
        )
        or (p_org_id is null and me.name = any(p_members))
      )
  )
$$;

-- 指定ユーザーがアクセスできるプロジェクトID（集合版）。
create or replace function user_project_ids(p_user_id uuid)
returns table (project_id text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.projects p
  where public.project_visible_to(p_user_id, p.organization_id::text, p.members)
$$;

-- 単票版。主キー1件引きで済むので、行ごとに呼ばれる箇所はこちらを使う。
create or replace function can_user_access_project(p_user_id uuid, p_project_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select public.project_visible_to(p_user_id, p.organization_id::text, p.members)
      from public.projects p
      where p.id = p_project_id
    ),
    false
  )
$$;

-- ログインユーザー版。RLS ポリシーからはこの2本を使う。
create or replace function my_project_ids()
returns table (project_id text)
language sql
stable
security definer
set search_path = public
as $$
  select up.project_id from public.user_project_ids(auth.uid()) up
$$;

create or replace function can_access_project(p_project_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_user_access_project(auth.uid(), p_project_id)
$$;

-- スプリント単位。sprint_tickets はスプリント経由でしかプロジェクトに辿れない。
create or replace function my_sprint_ids()
returns table (sprint_id text)
language sql
stable
security definer
set search_path = public
as $$
  select s.id
  from public.sprints s
  where s.project_id in (select mp.project_id from public.my_project_ids() mp)
$$;

-- チケット単位。ticket_comments / ticket_source_files 用。
-- 集合ではなく単票なのは、チケット総数がプロジェクト数より桁違いに多く、
-- 全件をハッシュに積むと重くなるため。索引3段引きで済む。
create or replace function can_access_ticket(p_ticket_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sprint_tickets t
    join public.sprints s on s.id = t.sprint_id
    where t.id = p_ticket_id
      and s.project_id in (select mp.project_id from public.my_project_ids() mp)
  )
$$;

-- ホワイトボード単位。whiteboard_shares 用。
create or replace function can_access_whiteboard(p_whiteboard_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.whiteboards w
    where w.id = p_whiteboard_id
      and w.project_id in (select mp.project_id from public.my_project_ids() mp)
  )
$$;

grant execute on function my_profile_name()                        to authenticated;
grant execute on function my_profile_role()                        to authenticated;
grant execute on function get_my_org_id()                          to authenticated;
grant execute on function is_platform_owner()                      to authenticated;
grant execute on function project_visible_to(uuid, text, text[])   to authenticated;
grant execute on function user_project_ids(uuid)                   to authenticated;
grant execute on function my_project_ids()                         to authenticated;
grant execute on function can_access_project(text)                 to authenticated;
grant execute on function my_sprint_ids()                          to authenticated;
grant execute on function can_access_ticket(text)                  to authenticated;
grant execute on function can_access_whiteboard(uuid)              to authenticated;

-- サーバー側API(api/*)は service_role で接続し、呼び出し元ユーザーのIDを
-- 明示して can_user_access_project() を呼ぶ。判定ロジックを TS 側に写経せず、
-- DB の1本に寄せるための入口。
grant execute on function can_user_access_project(uuid, text) to service_role;
grant execute on function can_user_access_project(uuid, text) to authenticated;


-- ============================================================
-- 2) projects 本体
--    子テーブルのように can_access_project(id) は使えない。
--    INSERT の WITH CHECK を評価する時点では、その行をまだ SELECT できず
--    関数が必ず false を返して、プロジェクト作成が全滅するため。
--    行の値を直接受け取る project_visible_to() を使うのはこのため。
-- ============================================================
alter table public.projects enable row level security;

drop policy if exists dt_rls_projects_select on public.projects;
drop policy if exists dt_rls_projects_update on public.projects;
drop policy if exists dt_rls_projects_delete on public.projects;

drop policy if exists dt_rls_projects_scope on public.projects;
create policy dt_rls_projects_scope on public.projects
  as restrictive for all
  using      (project_visible_to(auth.uid(), organization_id::text, members))
  with check (project_visible_to(auth.uid(), organization_id::text, members));

-- 作成・付け替えは自分の組織の中だけ（owner を除く）。
-- 上の FOR ALL と AND で合成されるので、
--   「自分が見られる形の行」かつ「自分の組織」でなければ書き込めない。
-- これが無いと、自分を members に入れた organization_id = NULL の行を作れてしまい、
-- 組織なしデータが増え続ける。NewProjectDialog は非owner なら必ず自組織を入れる。
drop policy if exists dt_rls_projects_insert on public.projects;
create policy dt_rls_projects_insert on public.projects
  as restrictive for insert
  with check (
    is_platform_owner()
    or (organization_id is not null and organization_id::text = get_my_org_id())
  );

-- 更新でも他組織へ付け替えられないようにする。
-- organization_id が NULL の旧データは、埋め終わるまで編集できないと困るので
-- NULL のままを許す（NULL 側は上の FOR ALL 側で「メンバー本人のみ」に絞られる）。
drop policy if exists dt_rls_projects_reassign on public.projects;
create policy dt_rls_projects_reassign on public.projects
  as restrictive for update
  with check (
    is_platform_owner()
    or organization_id is null
    or organization_id::text = get_my_org_id()
  );


-- ============================================================
-- 3) project_id を直接持つテーブル
--    集合 my_project_ids() を IN で使うのは、STABLE 関数の行ごと呼び出しを避け、
--    プランナに InitPlan として1回だけ評価させるため。
-- ============================================================
do $do$
declare
  t text;

  -- project_id が NOT NULL のテーブル
  required text[] := array[
    'backlog_items',
    'call_sessions',
    'github_action_logs',
    'github_action_runs',
    'knowledge_chunks',
    'knowledge_documents',
    'knowledge_folders',
    'meeting_minutes',
    'project_deploy_status',
    'project_file_comments',
    'project_files',
    'project_member_permissions',
    'sprint_orders',
    'sprints',
    'ticket_categories',
    'ticket_github_link_candidates',
    'ticket_github_links',
    'whiteboards',
    'wiki_pages'
  ];

  -- project_id が NULL を取り得るテーブル（個人メモ・個人タスク）。
  -- NULL 側は既存の所有者ポリシーに任せる。
  nullable text[] := array[
    'action_memos',
    'tasks'
  ];
begin
  foreach t in array required loop
    if to_regclass('public.' || t) is null then
      raise notice 'skip: public.% は存在しません', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists dt_rls_%s_project on public.%I', t, t);
    execute format(
      'create policy dt_rls_%s_project on public.%I as restrictive for all'
      || ' using (project_id in (select mp.project_id from public.my_project_ids() mp))'
      || ' with check (project_id in (select mp.project_id from public.my_project_ids() mp))',
      t, t
    );
  end loop;

  foreach t in array nullable loop
    if to_regclass('public.' || t) is null then
      raise notice 'skip: public.% は存在しません', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists dt_rls_%s_project on public.%I', t, t);
    execute format(
      'create policy dt_rls_%s_project on public.%I as restrictive for all'
      || ' using (project_id is null or project_id in (select mp.project_id from public.my_project_ids() mp))'
      || ' with check (project_id is null or project_id in (select mp.project_id from public.my_project_ids() mp))',
      t, t
    );
  end loop;
end
$do$;


-- ============================================================
-- 4) スプリント経由・チケット経由・ボード経由のテーブル
-- ============================================================

-- sprint_tickets（チケット本体）
alter table public.sprint_tickets enable row level security;
drop policy if exists dt_rls_sprint_tickets_scope on public.sprint_tickets;
create policy dt_rls_sprint_tickets_scope on public.sprint_tickets
  as restrictive for all
  using      (sprint_id in (select ms.sprint_id from public.my_sprint_ids() ms))
  with check (sprint_id in (select ms.sprint_id from public.my_sprint_ids() ms));

-- my_filters（スプリントごとの保存フィルタ）
do $do$
begin
  if to_regclass('public.my_filters') is not null then
    execute 'alter table public.my_filters enable row level security';
    execute 'drop policy if exists dt_rls_my_filters_scope on public.my_filters';
    execute 'create policy dt_rls_my_filters_scope on public.my_filters'
         || ' as restrictive for all'
         || ' using      (sprint_id in (select ms.sprint_id from public.my_sprint_ids() ms))'
         || ' with check (sprint_id in (select ms.sprint_id from public.my_sprint_ids() ms))';
  end if;
end
$do$;

-- ticket_comments / ticket_source_files / ticket_required_skills
do $do$
declare t text;
begin
  foreach t in array array['ticket_comments', 'ticket_source_files', 'ticket_required_skills'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists dt_rls_%s_scope on public.%I', t, t);
    execute format(
      'create policy dt_rls_%s_scope on public.%I as restrictive for all'
      || ' using (public.can_access_ticket(ticket_id))'
      || ' with check (public.can_access_ticket(ticket_id))',
      t, t
    );
  end loop;
end
$do$;

-- whiteboard_shares（限定公開の宛先）
do $do$
begin
  if to_regclass('public.whiteboard_shares') is not null then
    execute 'alter table public.whiteboard_shares enable row level security';
    execute 'drop policy if exists dt_rls_whiteboard_shares_scope on public.whiteboard_shares';
    execute 'create policy dt_rls_whiteboard_shares_scope on public.whiteboard_shares'
         || ' as restrictive for all'
         || ' using      (public.can_access_whiteboard(whiteboard_id))'
         || ' with check (public.can_access_whiteboard(whiteboard_id))';
  end if;
end
$do$;


-- ============================================================
-- 5) 本人にしか関係しないテーブル
--    notifications / device_tokens は user_name をキーに持つのに
--    「ログインしていれば全件」だった。通知本文とプッシュトークンが
--    全ユーザー分読めるので、ここも閉じる。
-- ============================================================

-- 通知は「他人宛の行を自分が作る」のが正常系（メンション・アサイン通知など、
-- クライアントから相手の user_name で insert している）。
-- そのため INSERT だけは条件が別で、宛先が自分と同じ組織の人であることを見る。
create or replace function is_name_in_my_org(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles target
    join public.profiles me on me.id = auth.uid()
    where target.name = p_name
      and (
        me.role = 'owner'
        or (
          target.organization_id is not null
          and target.organization_id::text = me.organization_id::text
        )
      )
  )
$$;

grant execute on function is_name_in_my_org(text) to authenticated;

alter table public.notifications enable row level security;

drop policy if exists dt_rls_notifications_owner on public.notifications;
create policy dt_rls_notifications_owner on public.notifications
  as restrictive for select
  using (user_name = my_profile_name());

drop policy if exists dt_rls_notifications_insert on public.notifications;
create policy dt_rls_notifications_insert on public.notifications
  as restrictive for insert
  with check (is_name_in_my_org(user_name));

drop policy if exists dt_rls_notifications_update on public.notifications;
create policy dt_rls_notifications_update on public.notifications
  as restrictive for update
  using      (user_name = my_profile_name())
  with check (user_name = my_profile_name());

drop policy if exists dt_rls_notifications_delete on public.notifications;
create policy dt_rls_notifications_delete on public.notifications
  as restrictive for delete
  using (user_name = my_profile_name());

-- プッシュトークンは自分の端末の分だけ。登録も参照も削除も本人のみ。
-- （配信は api/push-send.ts が service_role で行うため影響しない）
do $do$
begin
  if to_regclass('public.device_tokens') is not null then
    execute 'alter table public.device_tokens enable row level security';
    execute 'drop policy if exists dt_rls_device_tokens_owner on public.device_tokens';
    execute 'create policy dt_rls_device_tokens_owner on public.device_tokens'
         || ' as restrictive for all'
         || ' using      (user_name = public.my_profile_name())'
         || ' with check (user_name = public.my_profile_name())';
  end if;
end
$do$;


-- ============================================================
-- 6) 組織単位のテーブル
--    プロジェクトには紐づかないが、他社に見せてはいけないもの。
--    profiles は「自分自身」を必ず逃がす。ログイン直後に自分の行を
--    読めないと、role も organization_id も決まらず全判定が崩れるため。
-- ============================================================

alter table public.profiles enable row level security;
drop policy if exists dt_rls_profiles_org on public.profiles;
create policy dt_rls_profiles_org on public.profiles
  as restrictive for all
  using (
    id = auth.uid()
    or is_platform_owner()
    or (organization_id is not null and organization_id::text = get_my_org_id())
  )
  with check (
    id = auth.uid()
    or is_platform_owner()
    or (organization_id is not null and organization_id::text = get_my_org_id())
  );

do $do$
declare t text;
begin
  foreach t in array array[
    'clients',
    'permission_groups',
    'api_keys',
    'skills',
    'member_skill_changes',
    'ml_batch_runs',
    'ml_batch_member_runs',
    'recommendation_logs',
    'recommendation_models',
    'skill_update_runs',
    'github_installations'
  ] loop
    if to_regclass('public.' || t) is null then
      raise notice 'skip: public.% は存在しません', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists dt_rls_%s_org on public.%I', t, t);
    execute format(
      'create policy dt_rls_%s_org on public.%I as restrictive for all'
      || ' using (public.is_platform_owner() or (organization_id is not null'
      || '        and organization_id::text = public.get_my_org_id()))'
      || ' with check (public.is_platform_owner() or (organization_id is not null'
      || '        and organization_id::text = public.get_my_org_id()))',
      t, t
    );
  end loop;
end
$do$;


-- ============================================================
-- 7) 403画面を保つための判定RPC
--    RLS で行ごと隠すと、同じ組織の未アサインPJも「存在しない(404)」に
--    なってしまい、「アサインを依頼してください」の案内が出せなくなる。
--    データは一切返さず、判定結果と、同組織のときだけプロジェクト名を返す。
--    別組織は必ず not-found を返し、存在も名前も明かさない。
-- ============================================================
-- 旧slug(エイリアス)から project_id を引く。
-- project_slug_aliases は add_project_slug_aliases.sql (BRU13-047) で作られるが、
-- 未適用の環境がある。language sql の関数本体は作成時に解決されるため、
-- 存在しないテーブルを直接書くと CREATE FUNCTION 自体が落ちる。
-- そこで、テーブルの有無で中身を差し替えて必ず作れるようにしておく。
do $do$
begin
  if to_regclass('public.project_slug_aliases') is not null then
    execute $fn$
      create or replace function project_id_by_old_slug(p_slug text)
      returns text
      language sql
      stable
      security definer
      set search_path = public
      as $body$
        select a.project_id
        from public.project_slug_aliases a
        where upper(a.old_slug) = upper(p_slug)
        limit 1
      $body$;
    $fn$;
  else
    raise notice 'public.project_slug_aliases が無いため、旧slugの引き当ては無効化します（supabase/add_project_slug_aliases.sql が未適用）';
    execute $fn$
      create or replace function project_id_by_old_slug(p_slug text)
      returns text
      language sql
      immutable
      as $body$ select null::text $body$;
    $fn$;
  end if;
end
$do$;

grant execute on function project_id_by_old_slug(text) to authenticated;

create or replace function project_access_hint(p_slug_or_id text)
returns table (access text, project_name text)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id, organization_id::text as org
    from public.profiles
    where id = auth.uid()
  ),
  hit as (
    -- 現行slug → ID → 旧slug(エイリアス) の順で引き当てる。
    select p.id, p.name, p.organization_id::text as org, p.members
    from public.projects p
    where upper(p.slug) = upper(p_slug_or_id)
       or p.id = p_slug_or_id
       or p.id = public.project_id_by_old_slug(p_slug_or_id)
    limit 1
  ),
  verdict as (
    select case
      -- 未ログイン／そんなプロジェクトは無い
      when not exists (select 1 from me) or not exists (select 1 from hit)
        then 'not-found'
      -- RLS と完全に同じ判定を使う。ここが ok なら行も見えているはず。
      when public.project_visible_to(
             (select id from me), (select org from hit), (select members from hit))
        then 'ok'
      -- 同じ組織にあるが自分はアサインされていない → 403（アサイン依頼へ誘導）
      when (select org from hit) is not null
       and (select org from hit) = (select org from me)
        then 'no-access'
      -- 別組織のもの → 存在も名前も明かさず 404
      else 'not-found'
    end as v
  )
  select v, case when v = 'no-access' then (select name from hit) else null end
  from verdict
$$;

grant execute on function project_access_hint(text) to authenticated;


-- ============================================================
-- 8) 適用後の確認
-- ============================================================

-- 8-1) 張られた RESTRICTIVE ポリシーの一覧
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and permissive = 'RESTRICTIVE'
  and policyname like 'dt_rls_%'
order by tablename, policyname;

-- 8-2) まだ「ログインしていれば全件」のままの PERMISSIVE ポリシー。
--      RESTRICTIVE を重ねているので実害は無いが、紛らわしいので
--      落ち着いたら別途 fix_all.sql 系を整理すること。
select tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public'
  and permissive = 'PERMISSIVE'
  and (qual ilike '%auth.role()%' or qual = 'true')
order by tablename, policyname;

-- 8-3) RLS が有効になっていないテーブルが無いか
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity = false
order by c.relname;

-- 8-4)【NULL組織の棚卸し】0件が理想。残っていれば組織IDを埋める。
--     埋め方の例（値は必ず確認してから実行すること）:
--       update public.projects set organization_id = 'ORG-XXXX' where id in ('P-...','P-...');
select 'projects' as tbl, id, name, organization_id from public.projects where organization_id is null
union all
select 'clients',  id, name, organization_id from public.clients  where organization_id is null
order by tbl, id;
