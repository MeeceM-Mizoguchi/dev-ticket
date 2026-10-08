-- ============================================================
-- ENHA2-053 WBS機能（作業分解表）
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
--
--   ・1プロジェクトに複数のWBS(wbs_sheets)を持てる
--   ・行(wbs_items)は 大項目→中項目→小項目 の最大3段。親を消すと下の行も消える
--   ・ステータス(wbs_statuses)はWBSごとに自由に増減できる。チケットのステータスとは別物
--   ・行とチケットは多対多(wbs_item_tickets)。紐づけは関連の表示だけに使う
--   ・祝日(wbs_holidays)はプロジェクトごとに持ち、そのプロジェクトの全WBSで共通に使う
--   ・organization_id は持たない。スコープは project_id から決まる
--     (organizations.id は環境により uuid/text が揺れるため、新テーブルでは触らない)
--
-- ここでいう「WBS」は作業分解表のこと。チケット番号(sprint_tickets.wbs)とは別物。
-- ============================================================

-- ── WBS本体 ───────────────────────────────────────────────────
create table if not exists wbs_sheets (
  id              uuid        primary key default gen_random_uuid(),
  project_id      text        not null references projects(id) on delete cascade,
  name            text        not null default '無題のWBS',

  -- 項目の段数。3=大・中・小 / 2=大・中 / 1=大のみ。4段以上は作らない
  levels          int         not null default 3 check (levels between 1 and 3),

  -- 'project' = プロジェクトの全メンバー / 'members' = 指定したメンバーのみ(wbs_sheet_members)
  visibility      text        not null default 'project' check (visibility in ('project','members')),

  -- 作成者。公開設定の変更と削除ができる人の基点。profiles.id = auth.users.id
  -- 作成者が退職しても WBS は残す（その後はオーナーが管理する）
  created_by      uuid        references profiles(id) on delete set null,
  -- 表示用の作成者名（既存テーブルと同じく profiles.name を非正規化して持つ）
  created_by_name text        not null default '',

  -- 切り替えの並び。前後の中点を採る gap 方式なので double precision
  sort_order      double precision not null default 0,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── 公開先（公開設定が「指定したメンバーのみ」のときに見られる人） ──
create table if not exists wbs_sheet_members (
  wbs_sheet_id uuid not null references wbs_sheets(id) on delete cascade,
  profile_id   uuid not null references profiles(id)   on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (wbs_sheet_id, profile_id)
);

-- ── ステータス（WBSごと） ─────────────────────────────────────
create table if not exists wbs_statuses (
  id           uuid        primary key default gen_random_uuid(),
  wbs_sheet_id uuid        not null references wbs_sheets(id) on delete cascade,
  name         text        not null check (btrim(name) <> ''),
  color        text        not null default '#EDECF4',   -- 背景色(#RRGGBB)。文字色は画面で決める
  sort_order   double precision not null default 0,
  created_at   timestamptz not null default now()
);

-- ── 行 ────────────────────────────────────────────────────────
create table if not exists wbs_items (
  id           uuid        primary key default gen_random_uuid(),
  wbs_sheet_id uuid        not null references wbs_sheets(id) on delete cascade,

  -- 属している上の段の行。null = 大項目。親を消したら下の行も消える
  parent_id    uuid        references wbs_items(id) on delete cascade,
  -- 段。1=大項目 / 2=中項目 / 3=小項目
  level        int         not null default 1 check (level between 1 and 3),

  name         text        not null default '',
  -- 担当者は profiles.name。既存(sprint_tickets.assignee / tasks.assignee)に合わせる
  assignee     text        not null default '',
  start_date   date,
  end_date     date,

  -- 手で入力するのは一番右の段の行だけ。それより左の段は画面で平均を計算する（保存しない）
  progress     int         not null default 0 check (progress between 0 and 100),

  -- ステータスを消すときはアプリ側で移し先へ付け替えてから消す。
  -- 付け替え漏れがあっても行は残す（null は画面で先頭のステータスとして扱う）
  status_id    uuid        references wbs_statuses(id) on delete set null,

  note         text        not null default '',

  -- 同じ親の中での並び。前後の中点を採る gap 方式なので double precision
  sort_order   double precision not null default 0,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── 行とチケットの紐づけ（多対多） ────────────────────────────
-- 行またはチケットを消すと紐づけも消える（行やチケットの本体は残る）
create table if not exists wbs_item_tickets (
  wbs_item_id uuid not null references wbs_items(id)      on delete cascade,
  ticket_id   text not null references sprint_tickets(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (wbs_item_id, ticket_id)
);

-- ── 祝日（プロジェクトごと） ──────────────────────────────────
create table if not exists wbs_holidays (
  id           uuid        primary key default gen_random_uuid(),
  project_id   text        not null references projects(id) on delete cascade,
  holiday_date date        not null,
  name         text        not null default '',
  created_at   timestamptz not null default now()
);

-- ── インデックス ──────────────────────────────────────────────
create index if not exists idx_wbs_sheets_project        on wbs_sheets(project_id, sort_order);
create index if not exists idx_wbs_sheet_members_profile on wbs_sheet_members(profile_id);
create index if not exists idx_wbs_statuses_sheet        on wbs_statuses(wbs_sheet_id, sort_order);
create index if not exists idx_wbs_items_sheet           on wbs_items(wbs_sheet_id, sort_order);
create index if not exists idx_wbs_items_parent          on wbs_items(parent_id) where parent_id is not null;
create index if not exists idx_wbs_items_status          on wbs_items(status_id) where status_id is not null;
create index if not exists idx_wbs_item_tickets_ticket   on wbs_item_tickets(ticket_id);
-- 同じWBSの中で同じ名前のステータスは作れない / 同じプロジェクトで同じ日の祝日は1件
create unique index if not exists uq_wbs_statuses_sheet_name on wbs_statuses(wbs_sheet_id, name);
create unique index if not exists uq_wbs_holidays_project_date on wbs_holidays(project_id, holiday_date);

-- ── RLS の再帰よけ ────────────────────────────────────────────
-- wbs_sheets のポリシーが wbs_sheet_members を見て、wbs_sheet_members のポリシーが
-- wbs_sheets を見ると RLS が循環して 500 になる（add_tasks.sql の task_shares と同型）。
-- 両方向とも security definer 関数を挟んで RLS を迂回する。

-- 自分がオーナーか（オーナーは公開設定に関係なく全WBSを見られ、管理できる）
create or replace function is_wbs_org_owner()
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.profiles me
    where me.id = auth.uid() and me.role = 'owner'
  )
$$;

-- 自分が公開先に指定されているか（wbs_sheet_members の RLS を経由しない）
create or replace function is_wbs_sheet_member(p_sheet_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.wbs_sheet_members m
    where m.wbs_sheet_id = p_sheet_id and m.profile_id = auth.uid()
  )
$$;

-- 公開設定の変更と削除ができるか＝作成者かオーナー（wbs_sheets の RLS を経由しない）
create or replace function is_wbs_sheet_manager(p_sheet_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.wbs_sheets s
    where s.id = p_sheet_id
      and (s.created_by = auth.uid() or public.is_wbs_org_owner())
  )
$$;

-- そのWBSを見られるか（行・ステータス・紐づけのポリシーから使う）。
-- プロジェクトにアクセスでき、かつ「全メンバー公開」か「作成者・オーナー・指定されたメンバー」
create or replace function can_view_wbs_sheet(p_sheet_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.wbs_sheets s
    where s.id = p_sheet_id
      and public.can_access_project(s.project_id)
      and (
        s.visibility = 'project'
        or s.created_by = auth.uid()
        or public.is_wbs_org_owner()
        or public.is_wbs_sheet_member(s.id)
      )
  )
$$;

-- その行が属するWBSを見られるか（wbs_item_tickets のポリシーから使う）
create or replace function can_view_wbs_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.wbs_items i
    where i.id = p_item_id and public.can_view_wbs_sheet(i.wbs_sheet_id)
  )
$$;

-- ── 公開設定・作成者の書き換えを作成者とオーナーに限る ────────
-- 更新のポリシーは「見えている人」に通す（名前や段数の変更は編集権限のある人が行うため）。
-- RLS の with check は OLD 行を見られないので、所有権に関わる列だけをトリガーで守る
-- （add_whiteboard_shares.sql の whiteboards_guard_ownership と同型）。
create or replace function wbs_sheets_guard_ownership()
returns trigger
language plpgsql
as $$
begin
  if new.visibility is not distinct from old.visibility
 and new.created_by is not distinct from old.created_by
 and new.project_id is not distinct from old.project_id then
    return new;
  end if;
  -- SQL Editor / service_role（JWT が無い）からの運用操作は素通しする
  if auth.uid() is null then
    return new;
  end if;
  if old.created_by is distinct from auth.uid() and not public.is_wbs_org_owner() then
    raise exception 'wbs_sheets: only the creator or the owner can change visibility';
  end if;
  return new;
end
$$;

drop trigger if exists trg_wbs_sheets_guard_ownership on wbs_sheets;
create trigger trg_wbs_sheets_guard_ownership
  before update on wbs_sheets
  for each row execute function wbs_sheets_guard_ownership();

-- ── ポリシー ──────────────────────────────────────────────────
-- プロジェクトのアクセス判定 can_access_project(text) は
-- supabase/add_knowledge_ai.sql で作成済みのものをそのまま使う。
-- 「閲覧のみ／編集可」(wbsPermission) の出し分けは、他のページ権限と同じく画面側で行う。
alter table wbs_sheets        enable row level security;
alter table wbs_sheet_members enable row level security;
alter table wbs_statuses      enable row level security;
alter table wbs_items         enable row level security;
alter table wbs_item_tickets  enable row level security;
alter table wbs_holidays      enable row level security;

drop policy if exists "wbs_sheets_select" on wbs_sheets;
drop policy if exists "wbs_sheets_insert" on wbs_sheets;
drop policy if exists "wbs_sheets_update" on wbs_sheets;
drop policy if exists "wbs_sheets_delete" on wbs_sheets;
drop policy if exists "wbs_sheet_members_select" on wbs_sheet_members;
drop policy if exists "wbs_sheet_members_write"  on wbs_sheet_members;
drop policy if exists "wbs_statuses_all"     on wbs_statuses;
drop policy if exists "wbs_items_all"        on wbs_items;
drop policy if exists "wbs_item_tickets_all" on wbs_item_tickets;
drop policy if exists "wbs_holidays_all"     on wbs_holidays;

-- 参照: プロジェクトにアクセスできる人。「指定したメンバーのみ」は作成者・オーナー・指定された人だけ
create policy "wbs_sheets_select" on wbs_sheets for select using (
  can_access_project(project_id)
  and (
    visibility = 'project'
    or created_by = auth.uid()
    or is_wbs_org_owner()
    or is_wbs_sheet_member(id)
  )
);

-- 作成: 自分名義でのみ。そのプロジェクトにアクセスできる人だけ
create policy "wbs_sheets_insert" on wbs_sheets for insert with check (
  created_by = auth.uid() and can_access_project(project_id)
);

-- 更新: 見えている行のみ（公開設定の書き換えは上のトリガーで作成者とオーナーに限る）
create policy "wbs_sheets_update" on wbs_sheets for update
  using (
    can_access_project(project_id)
    and (
      visibility = 'project'
      or created_by = auth.uid()
      or is_wbs_org_owner()
      or is_wbs_sheet_member(id)
    )
  )
  with check (can_access_project(project_id));

-- 削除: 作成者とオーナーのみ
create policy "wbs_sheets_delete" on wbs_sheets for delete using (
  created_by = auth.uid() or is_wbs_org_owner()
);

-- 公開先: 自分宛の行は読める。付け外しは作成者とオーナーのみ
create policy "wbs_sheet_members_select" on wbs_sheet_members for select using (
  profile_id = auth.uid() or is_wbs_sheet_manager(wbs_sheet_id)
);
create policy "wbs_sheet_members_write" on wbs_sheet_members for all
  using (is_wbs_sheet_manager(wbs_sheet_id)) with check (is_wbs_sheet_manager(wbs_sheet_id));

-- ステータス・行: そのWBSを見られる人
create policy "wbs_statuses_all" on wbs_statuses for all
  using (can_view_wbs_sheet(wbs_sheet_id)) with check (can_view_wbs_sheet(wbs_sheet_id));
create policy "wbs_items_all" on wbs_items for all
  using (can_view_wbs_sheet(wbs_sheet_id)) with check (can_view_wbs_sheet(wbs_sheet_id));

-- 紐づけ: その行が属するWBSを見られる人
create policy "wbs_item_tickets_all" on wbs_item_tickets for all
  using (can_view_wbs_item(wbs_item_id)) with check (can_view_wbs_item(wbs_item_id));

-- 祝日: プロジェクトにアクセスできる人
create policy "wbs_holidays_all" on wbs_holidays for all
  using (can_access_project(project_id)) with check (can_access_project(project_id));

-- ── 権限キーの追加（roles.base_permissions / project_member_permissions は JSONB） ──
-- ホワイトボードの追加時（add_whiteboard.sql）と同じ既定値。3段階（none / view / edit）。
-- まだキーが無い行にだけ足す（2回目以降の実行で、設定済みの値を上書きしないため）。
update roles set base_permissions = base_permissions || '{"wbsPermission":"edit"}'::jsonb
  where name in ('admin','project-manager') and not (base_permissions ? 'wbsPermission');
update roles set base_permissions = base_permissions || '{"wbsPermission":"none"}'::jsonb
  where name in ('developer','designer') and not (base_permissions ? 'wbsPermission');

-- 既存メンバーの未設定行を none で初期化
update project_member_permissions
  set permissions = permissions || '{"wbsPermission":"none"}'::jsonb
  where not (permissions ? 'wbsPermission');
