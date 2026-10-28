-- ============================================================
-- BRU22-006 議事録・クライアントメモの公開範囲（全員 / 指定したメンバーのみ）
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
--
-- 前提（適用済みであること）:
--   add_wiki_backlog_minutes.sql / add_minutes_backlog_folders.sql
--   add_client_notes.sql / add_client_notes_folders.sql
--   fix_project_level_rls_BRU14-001.sql（is_platform_owner() を使う）
--
-- ★ このSQLは、対応するアプリを本番へ出す「前」に流すこと。
--   アプリは列が無い環境では公開範囲のメニューを出さずに今のまま動くが、
--   列があるときだけ公開範囲を設定できるようになる。
--
-- 設計上の要点:
--   ・公開範囲 = visibility。'project'（全員。今と同じ）/ 'members'（指定したメンバーのみ）。
--     既存の行と、新しく作る行は 'project'。適用した直後に見え方は変わらない。
--   ・所有者 = 作成した人。owner_id（profiles.id）に持つ。
--     これまでは created_by（名前）しか無く、「誰の持ち物か」を判定できなかった。
--     登録時はトリガーで必ず登録した本人の ID を入れる（アプリは送らない）。
--   ・'members' の行を見られるのは、作成者・公開先（*_members）・オーナー（role='owner'）だけ。
--     admin・PM でも、指定されていなければ見られない。
--   ・フォルダの公開範囲は中身すべてに効く。行が見えるのは、その行と上のフォルダすべてが
--     見られるときだけ（中の1件を、さらに狭めることもできる）。
--   ・visibility と owner_id を書き換えられるのは、作成者とオーナーだけ（トリガーで止める）。
--   ・削除: 'members' の行は作成者とオーナーだけが消せる。
--     中に自分から見えない行・自分が消せない行があるフォルダは消せない（DBの cascade で巻き込むため）。
--   ・判定は既存のポリシーを残したまま、restrictive（AND で効く）ポリシーを重ねて行う。
--     一覧・横断検索・リンクのプレビュー・内部リンク・記事の出力・メモ件数・アクションに、まとめて効く。
-- ============================================================


-- ============================================================
-- 1) 列とテーブル
-- ============================================================

alter table public.meeting_minutes add column if not exists visibility text not null default 'project';
alter table public.meeting_minutes add column if not exists owner_id uuid references public.profiles(id) on delete set null;
alter table public.client_notes    add column if not exists visibility text not null default 'project';
alter table public.client_notes    add column if not exists owner_id uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'meeting_minutes_visibility_check' and conrelid = 'public.meeting_minutes'::regclass) then
    alter table public.meeting_minutes
      add constraint meeting_minutes_visibility_check check (visibility in ('project', 'members'));
  end if;
  if not exists (select 1 from pg_constraint
                 where conname = 'client_notes_visibility_check' and conrelid = 'public.client_notes'::regclass) then
    alter table public.client_notes
      add constraint client_notes_visibility_check check (visibility in ('project', 'members'));
  end if;
end
$$;

-- 公開先（公開範囲が「指定したメンバーのみ」のときに見られる人）。wbs_sheet_members と同じ形
create table if not exists public.meeting_minute_members (
  meeting_minute_id uuid not null references public.meeting_minutes(id) on delete cascade,
  profile_id        uuid not null references public.profiles(id)        on delete cascade,
  created_at        timestamptz not null default now(),
  primary key (meeting_minute_id, profile_id)
);

create table if not exists public.client_note_members (
  client_note_id uuid not null references public.client_notes(id) on delete cascade,
  profile_id     uuid not null references public.profiles(id)     on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (client_note_id, profile_id)
);

create index if not exists idx_meeting_minute_members_profile on public.meeting_minute_members(profile_id);
create index if not exists idx_client_note_members_profile    on public.client_note_members(profile_id);
create index if not exists idx_meeting_minutes_owner          on public.meeting_minutes(owner_id);
create index if not exists idx_client_notes_owner             on public.client_notes(owner_id);


-- ============================================================
-- 2) 関数
--    すべて security definer。meeting_minutes ⇄ meeting_minute_members の RLS が
--    互いを参照して循環し 500 になるのを避けるため、RLS を経由せずに見る（add_wbs.sql と同じ形）。
--    上のフォルダまでたどる判定は、壊れたデータで無限ループしないよう深さに上限を付ける。
-- ============================================================

-- ── 議事録 ───────────────────────────────────────────────────

-- 自分がその行の公開先か
create or replace function is_meeting_minute_member(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.meeting_minute_members mm
    where mm.meeting_minute_id = p_id and mm.profile_id = auth.uid()
  )
$$;

-- 公開範囲を変えられるか（＝作成者かオーナー）。owner_id が空の行はオーナーだけ
create or replace function is_meeting_minute_manager(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.meeting_minutes m
    where m.id = p_id and (m.owner_id = auth.uid() or public.is_platform_owner())
  )
$$;

-- その行を見られるか。その行と上のフォルダすべてが「全員」か、作成者・公開先・オーナーのとき
create or replace function can_view_meeting_minute(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive chain as (
    select m.id, m.parent_id, m.visibility, m.owner_id, 1 as depth
    from public.meeting_minutes m
    where m.id = p_id
    union all
    select p.id, p.parent_id, p.visibility, p.owner_id, c.depth + 1
    from chain c
    join public.meeting_minutes p on p.id = c.parent_id
    where c.depth < 50
  )
  select exists (select 1 from chain)
     and (
       public.is_platform_owner()
       or not exists (
         select 1 from chain c
         where c.visibility = 'members'
           and c.owner_id is distinct from auth.uid()
           and not exists (
             select 1 from public.meeting_minute_members mm
             where mm.meeting_minute_id = c.id and mm.profile_id = auth.uid()
           )
       )
     )
$$;

-- ── クライアントメモ ─────────────────────────────────────────

create or replace function is_client_note_member(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.client_note_members cm
    where cm.client_note_id = p_id and cm.profile_id = auth.uid()
  )
$$;

create or replace function is_client_note_manager(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.client_notes n
    where n.id = p_id and (n.owner_id = auth.uid() or public.is_platform_owner())
  )
$$;

create or replace function can_view_client_note(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive chain as (
    select n.id, n.parent_id, n.visibility, n.owner_id, 1 as depth
    from public.client_notes n
    where n.id = p_id
    union all
    select p.id, p.parent_id, p.visibility, p.owner_id, c.depth + 1
    from chain c
    join public.client_notes p on p.id = c.parent_id
    where c.depth < 50
  )
  select exists (select 1 from chain)
     and (
       public.is_platform_owner()
       or not exists (
         select 1 from chain c
         where c.visibility = 'members'
           and c.owner_id is distinct from auth.uid()
           and not exists (
             select 1 from public.client_note_members cm
             where cm.client_note_id = c.id and cm.profile_id = auth.uid()
           )
       )
     )
$$;

grant execute on function is_meeting_minute_member(uuid)  to authenticated;
grant execute on function is_meeting_minute_manager(uuid) to authenticated;
grant execute on function can_view_meeting_minute(uuid)   to authenticated;
grant execute on function is_client_note_member(uuid)     to authenticated;
grant execute on function is_client_note_manager(uuid)    to authenticated;
grant execute on function can_view_client_note(uuid)      to authenticated;


-- ============================================================
-- 3) トリガー
--    auth.uid() が null（SQL Editor・service_role）の運用操作は、どれも素通しする。
-- ============================================================

-- ── 登録時: 所有者は必ず登録した本人 ──────────────────────────
create or replace function doc_visibility_set_owner()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new.owner_id := auth.uid();
  end if;
  return new;
end
$$;

drop trigger if exists trg_meeting_minutes_set_owner on public.meeting_minutes;
create trigger trg_meeting_minutes_set_owner
  before insert on public.meeting_minutes
  for each row execute function doc_visibility_set_owner();

drop trigger if exists trg_client_notes_set_owner on public.client_notes;
create trigger trg_client_notes_set_owner
  before insert on public.client_notes
  for each row execute function doc_visibility_set_owner();

-- ── 更新時: 公開範囲と所有者の書き換えを作成者とオーナーに限る ──
-- 更新のポリシーは「見えている人」に通す（本文の編集は公開先の人も行うため）。
-- RLS の with check は OLD 行を見られないので、所有権に関わる列だけをトリガーで守る
-- （add_wbs.sql の wbs_sheets_guard_ownership と同型）。
create or replace function doc_visibility_guard_update()
returns trigger
language plpgsql
as $$
begin
  if new.visibility is not distinct from old.visibility
 and new.owner_id   is not distinct from old.owner_id then
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if old.owner_id is distinct from auth.uid() and not public.is_platform_owner() then
    raise exception '%: only the creator or the owner can change visibility', tg_table_name;
  end if;
  return new;
end
$$;

drop trigger if exists trg_meeting_minutes_guard_visibility on public.meeting_minutes;
create trigger trg_meeting_minutes_guard_visibility
  before update on public.meeting_minutes
  for each row execute function doc_visibility_guard_update();

drop trigger if exists trg_client_notes_guard_visibility on public.client_notes;
create trigger trg_client_notes_guard_visibility
  before update on public.client_notes
  for each row execute function doc_visibility_guard_update();

-- ── 削除時: 消せない行を巻き込む削除を止める ────────────────────
-- フォルダを消すと、中身は DB の cascade で消える（cascade は RLS を通らない）。
-- そのため、中に「自分から見えない行」や「自分が消せない行（他の人の『指定したメンバーのみ』の行）」が
-- あるフォルダは、ここで止めて何も消さない。
-- 画面はエラー文の DT_DOC_DELETE_HIDDEN / DT_DOC_DELETE_PROTECTED を見て案内を出し分ける。
--
-- 親（プロジェクト・クライアント・上のフォルダ）ごと消えるときの連鎖の削除は、
-- 最初に消した行で確かめ済みなので通す（親の行が既に無いことで見分ける）。
-- security definer なのは、自分から見えない行・プロジェクトも数えるため。
create or replace function meeting_minutes_guard_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_platform_owner() then
    return old;
  end if;
  if not exists (select 1 from public.projects p where p.id = old.project_id) then
    return old;
  end if;
  if old.parent_id is not null
     and not exists (select 1 from public.meeting_minutes m where m.id = old.parent_id) then
    return old;
  end if;

  if old.visibility = 'members' and old.owner_id is distinct from auth.uid() then
    raise exception 'meeting_minutes: only the creator or the owner can delete this row (DT_DOC_DELETE_PROTECTED)';
  end if;

  if coalesce(old.is_folder, false) then
    if exists (
      with recursive d as (
        select m.id, 1 as depth from public.meeting_minutes m where m.parent_id = old.id
        union all
        select m.id, d.depth + 1 from d join public.meeting_minutes m on m.parent_id = d.id where d.depth < 50
      )
      select 1 from d where not public.can_view_meeting_minute(d.id)
    ) then
      raise exception 'meeting_minutes: the folder contains rows you cannot see (DT_DOC_DELETE_HIDDEN)';
    end if;
    if exists (
      with recursive d as (
        select m.id, m.visibility, m.owner_id, 1 as depth from public.meeting_minutes m where m.parent_id = old.id
        union all
        select m.id, m.visibility, m.owner_id, d.depth + 1 from d join public.meeting_minutes m on m.parent_id = d.id where d.depth < 50
      )
      select 1 from d where d.visibility = 'members' and d.owner_id is distinct from auth.uid()
    ) then
      raise exception 'meeting_minutes: the folder contains rows you cannot delete (DT_DOC_DELETE_PROTECTED)';
    end if;
  end if;
  return old;
end
$$;

drop trigger if exists trg_meeting_minutes_guard_delete on public.meeting_minutes;
create trigger trg_meeting_minutes_guard_delete
  before delete on public.meeting_minutes
  for each row execute function meeting_minutes_guard_delete();

create or replace function client_notes_guard_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_platform_owner() then
    return old;
  end if;
  if not exists (select 1 from public.clients c where c.id = old.client_id) then
    return old;
  end if;
  if old.parent_id is not null
     and not exists (select 1 from public.client_notes n where n.id = old.parent_id) then
    return old;
  end if;

  if old.visibility = 'members' and old.owner_id is distinct from auth.uid() then
    raise exception 'client_notes: only the creator or the owner can delete this row (DT_DOC_DELETE_PROTECTED)';
  end if;

  if coalesce(old.is_folder, false) then
    if exists (
      with recursive d as (
        select n.id, 1 as depth from public.client_notes n where n.parent_id = old.id
        union all
        select n.id, d.depth + 1 from d join public.client_notes n on n.parent_id = d.id where d.depth < 50
      )
      select 1 from d where not public.can_view_client_note(d.id)
    ) then
      raise exception 'client_notes: the folder contains rows you cannot see (DT_DOC_DELETE_HIDDEN)';
    end if;
    if exists (
      with recursive d as (
        select n.id, n.visibility, n.owner_id, 1 as depth from public.client_notes n where n.parent_id = old.id
        union all
        select n.id, n.visibility, n.owner_id, d.depth + 1 from d join public.client_notes n on n.parent_id = d.id where d.depth < 50
      )
      select 1 from d where d.visibility = 'members' and d.owner_id is distinct from auth.uid()
    ) then
      raise exception 'client_notes: the folder contains rows you cannot delete (DT_DOC_DELETE_PROTECTED)';
    end if;
  end if;
  return old;
end
$$;

drop trigger if exists trg_client_notes_guard_delete on public.client_notes;
create trigger trg_client_notes_guard_delete
  before delete on public.client_notes
  for each row execute function client_notes_guard_delete();


-- ============================================================
-- 4) 既存の行の所有者を埋める
--    created_by（名前）を、組織のメンバーと突き合わせる（add_file_box_private.sql と同じ考え方）。
--    オーナー（role='owner'）は組織をまたいで操作するので、組織が違っても候補に入れる。
--    同じ名前の人が複数いて決められない行・退職済みで見つからない行は、owner_id を空のまま残す
--    （その行の公開範囲は、オーナーだけが変えられる）。
-- ============================================================
with resolved as (
  select m.id, (array_agg(pr.id))[1] as owner_id
  from public.meeting_minutes m
  join public.projects p on p.id = m.project_id
  join public.profiles pr
    on pr.name = m.created_by
   and (pr.role = 'owner' or pr.organization_id::text is not distinct from p.organization_id::text)
  where m.owner_id is null
    and coalesce(m.created_by, '') <> ''
  group by m.id
  having count(*) = 1
)
update public.meeting_minutes t
set owner_id = r.owner_id
from resolved r
where t.id = r.id
  and t.owner_id is null;

with resolved as (
  select n.id, (array_agg(pr.id))[1] as owner_id
  from public.client_notes n
  left join public.clients c on c.id = n.client_id
  join public.profiles pr
    on pr.name = n.created_by
   and (pr.role = 'owner'
        or pr.organization_id::text is not distinct from coalesce(n.organization_id::text, c.organization_id::text))
  where n.owner_id is null
    and coalesce(n.created_by, '') <> ''
  group by n.id
  having count(*) = 1
)
update public.client_notes t
set owner_id = r.owner_id
from resolved r
where t.id = r.id
  and t.owner_id is null;

-- 確認用（任意）: 所有者を決められなかった行
--   select id, title, created_by from public.meeting_minutes where owner_id is null order by created_at;
--   select id, title, created_by from public.client_notes    where owner_id is null order by created_at;


-- ============================================================
-- 5) RLS
--    既存のポリシー（authenticated 全許可・組織／プロジェクト単位の絞り込み）はそのまま残し、
--    restrictive（＝AND で効く）ポリシーを足す。
--    自分の行の判定は行の値で行い（登録の with check でも使えるように）、上のフォルダは関数でたどる。
-- ============================================================

drop policy if exists dt_rls_meeting_minutes_visibility on public.meeting_minutes;
create policy dt_rls_meeting_minutes_visibility on public.meeting_minutes
  as restrictive for all
  using (
    (visibility = 'project' or owner_id = auth.uid() or is_platform_owner() or is_meeting_minute_member(id))
    and (parent_id is null or can_view_meeting_minute(parent_id))
  )
  with check (
    (visibility = 'project' or owner_id = auth.uid() or is_platform_owner() or is_meeting_minute_member(id))
    and (parent_id is null or can_view_meeting_minute(parent_id))
  );

drop policy if exists dt_rls_client_notes_visibility on public.client_notes;
create policy dt_rls_client_notes_visibility on public.client_notes
  as restrictive for all
  using (
    (visibility = 'project' or owner_id = auth.uid() or is_platform_owner() or is_client_note_member(id))
    and (parent_id is null or can_view_client_note(parent_id))
  )
  with check (
    (visibility = 'project' or owner_id = auth.uid() or is_platform_owner() or is_client_note_member(id))
    and (parent_id is null or can_view_client_note(parent_id))
  );

-- 公開先: 自分宛ての行と、作成者・オーナーは読める。付け外しは作成者・オーナーだけ
alter table public.meeting_minute_members enable row level security;
alter table public.client_note_members    enable row level security;

drop policy if exists meeting_minute_members_select on public.meeting_minute_members;
drop policy if exists meeting_minute_members_write  on public.meeting_minute_members;
create policy meeting_minute_members_select on public.meeting_minute_members for select using (
  profile_id = auth.uid() or is_meeting_minute_manager(meeting_minute_id)
);
create policy meeting_minute_members_write on public.meeting_minute_members for all
  using (is_meeting_minute_manager(meeting_minute_id))
  with check (is_meeting_minute_manager(meeting_minute_id));

drop policy if exists client_note_members_select on public.client_note_members;
drop policy if exists client_note_members_write  on public.client_note_members;
create policy client_note_members_select on public.client_note_members for select using (
  profile_id = auth.uid() or is_client_note_manager(client_note_id)
);
create policy client_note_members_write on public.client_note_members for all
  using (is_client_note_manager(client_note_id))
  with check (is_client_note_manager(client_note_id));

-- アクション: 見えない議事録から作られたものは読めない（マイアクション・上部バー・議事録のアクション欄）
drop policy if exists dt_rls_action_memos_minute_visibility on public.action_memos;
create policy dt_rls_action_memos_minute_visibility on public.action_memos
  as restrictive for all
  using (meeting_minute_id is null or can_view_meeting_minute(meeting_minute_id))
  with check (meeting_minute_id is null or can_view_meeting_minute(meeting_minute_id));

-- PostgREST に新しい列・テーブルを知らせる
notify pgrst, 'reload schema';


-- ============================================================
-- 6) 適用後の確認（任意）
-- ============================================================
--   -- 既存の行がすべて「全員」のままか（0 件なら適用前と同じ見え方）
--   select count(*) from public.meeting_minutes where visibility <> 'project';
--   select count(*) from public.client_notes    where visibility <> 'project';
--   -- 張られたポリシー
--   select tablename, policyname, permissive, cmd from pg_policies
--   where schemaname = 'public'
--     and tablename in ('meeting_minutes', 'client_notes', 'meeting_minute_members', 'client_note_members', 'action_memos')
--   order by tablename, policyname;
