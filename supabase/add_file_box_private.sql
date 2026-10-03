-- ============================================================
-- ファイルボックスの限定公開・所有者・削除権限
--   ＋ ホワイトボードのプライベートボードをオーナーが見られるようにする
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
--
-- 前提（適用済みであること）:
--   add_project_files.sql / add_project_files_folders.sql / add_google_drive_integration.sql
--   add_file_comments.sql / add_whiteboard_private.sql / add_whiteboard_shares.sql
--   fix_project_level_rls_BRU14-001.sql（is_platform_owner() を使う）
--
-- ★ このSQLは、対応するアプリ（api/project-files ほか）を本番へ出す「前」に流すこと。
--   新しいAPIは owner_id / acl_id を読むので、列が無いとファイルを開けなくなる。
--   逆に、SQLだけ先に当たっている状態は旧アプリのままで問題なく動く。
--
-- 設計上の要点:
--   ・所有者 = 最初にアップロードした人。project_files.owner_id（profiles.id）に持つ。
--     これまでは uploaded_by（名前）しか無く、「誰の持ち物か」を判定できなかった。
--   ・限定公開 = project_files.acl_id が入っている状態。null なら従来どおりプロジェクト全員に公開。
--     見られるのは 所有者 / 共有先（project_file_acl_members）/ オーナー（role='owner'）。
--   ・ファイルは保存のたびに行が増える（同じフォルダの同名＝同じファイルの版）。
--     所有者と公開範囲を行ごとに設定し直さなくて済むよう、INSERT のトリガーで既存の版から引き継ぐ。
--   ・所有者と公開範囲を書き換えられるのはサーバーAPI（service_role）だけ。
--     画面から直接 update されても通らないよう、トリガーで止める。
--   ・削除はサーバーAPI経由のみ（所有者 / オーナー / 「ファイルの削除」権限を持つ人）。
--     画面から直接 delete する経路は元から無いので、RLS で閉じる。
-- ============================================================


-- ============================================================
-- 1) 列とテーブル
-- ============================================================

-- 限定公開の単位（1ファイル = 1行）。版が増えても改名・移動しても変わらない識別子として使う。
create table if not exists project_file_acls (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null references projects(id) on delete cascade,
  -- 誰が限定公開にしたか（＝ファイルの所有者）。監査用で、判定には project_files.owner_id を使う
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- 共有先。project_id は一覧を1回で引くための写し（acl 側と必ず同じ値）
-- ★ created_by に profiles への FK を張らないこと。profiles への FK が2本になると、
--   画面の埋め込み取得 profiles(name) が「どちらの関係か決められない」と失敗する。
create table if not exists project_file_acl_members (
  acl_id      uuid not null references project_file_acls(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  project_id  text not null references projects(id) on delete cascade,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  primary key (acl_id, profile_id)
);

create index if not exists idx_project_file_acl_members_profile on project_file_acl_members(profile_id);
create index if not exists idx_project_file_acl_members_project on project_file_acl_members(project_id);

-- 所有者が退職などで消えても、ファイルは限定公開のまま残す（set null）。
-- 所有者なしのファイルは、オーナーと「ファイルの削除」権限を持つ人だけが削除できる。
alter table project_files
  add column if not exists owner_id uuid references profiles(id) on delete set null;

-- ★ on delete の指定を付けない（＝参照されている acl は消せない）。
--   set null にすると、acl を消しただけで限定公開のファイルが全員に公開されてしまう。
--   解除は必ず「先に acl_id を null に戻す → acl を消す」の順で、サーバーAPIが行う。
alter table project_files
  add column if not exists acl_id uuid references project_file_acls(id);

create index if not exists idx_project_files_acl on project_files(acl_id) where acl_id is not null;
create index if not exists idx_project_files_owner on project_files(owner_id);


-- ============================================================
-- 2) 関数
-- ============================================================

-- 自分がその限定公開の共有先か。
-- project_files ⇄ project_file_acl_members の RLS が互いを参照して循環しないよう、
-- security definer で共有先テーブルの RLS を経由せずに見る（whiteboard_shares と同じ形）。
create or replace function is_file_acl_member(p_acl_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.project_file_acl_members m
    where m.acl_id = p_acl_id and m.profile_id = auth.uid()
  )
$$;

grant execute on function is_file_acl_member(uuid) to authenticated;


-- ============================================================
-- 3) トリガー
-- ============================================================

-- 登録時に所有者と公開範囲を決める。
--   ・画面（ログインユーザーのJWT）からの登録は、必ず本人名義・公開で入る。
--     画面から登録するのはフォルダだけ（下の insert ポリシー）。
--   ・既存ファイルの新しい版は、最初の版の所有者と公開範囲を引き継ぐ。
--     保存・WebDAV保存・版の復元のどの経路でも、限定公開が外れない。
--   ・フォルダと Googleドライブ上のファイルは版を持たないので、渡された値のまま入れる。
-- security definer なのは、登録する人から見えない限定公開ファイルの版も引き当てるため
-- （見えないまま別ファイル扱いにすると、同じ名前の行が2系統できて版が混ざる）。
create or replace function project_files_set_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base record;
begin
  if auth.uid() is not null then
    new.owner_id := auth.uid();
    new.acl_id := null;
  end if;

  if coalesce(new.is_folder, false) or new.external_provider is not null then
    return new;
  end if;

  select f.owner_id, f.acl_id into base
  from public.project_files f
  where f.project_id = new.project_id
    and f.parent_id is not distinct from new.parent_id
    and f.file_name = new.file_name
    and coalesce(f.is_folder, false) = false
    and f.external_provider is null
  order by f.version asc, f.created_at asc, f.id asc
  limit 1;

  if found then
    new.owner_id := base.owner_id;
    new.acl_id := base.acl_id;
  end if;
  return new;
end
$$;

drop trigger if exists trg_project_files_set_owner on project_files;
create trigger trg_project_files_set_owner
  before insert on project_files
  for each row execute function project_files_set_owner();

-- 所有者と公開範囲の書き換えは、サーバーAPI（service_role）と SQL Editor だけに許す。
-- 画面のログインユーザーが直接 update しても通さない（改名・移動など、ほかの列の更新は素通し）。
create or replace function project_files_guard_owner()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is not distinct from old.owner_id
 and new.acl_id   is not distinct from old.acl_id then
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  raise exception 'project_files: owner and visibility can only be changed through the API';
end
$$;

drop trigger if exists trg_project_files_guard_owner on project_files;
create trigger trg_project_files_guard_owner
  before update on project_files
  for each row execute function project_files_guard_owner();


-- ============================================================
-- 4) 既存ファイルの所有者を埋める
--    最初の版の uploaded_by（名前）を、そのプロジェクトの組織のメンバーと突き合わせる。
--    オーナー（role='owner'）は組織をまたいで操作するので、組織が違っても候補に入れる。
--    同じ名前の人が複数いて決められないもの・退職済みで見つからないものは、所有者なしのまま残す。
-- ============================================================
with first_ver as (
  select distinct on (project_id, parent_id, file_name, coalesce(is_folder, false), external_id)
    project_id, parent_id, file_name, coalesce(is_folder, false) as is_folder, external_id, uploaded_by
  from project_files
  where owner_id is null
  order by project_id, parent_id, file_name, coalesce(is_folder, false), external_id,
           version asc, created_at asc, id asc
),
resolved as (
  select f.project_id, f.parent_id, f.file_name, f.is_folder, f.external_id,
         (array_agg(pr.id))[1] as owner_id
  from first_ver f
  join projects p on p.id = f.project_id
  join profiles pr
    on pr.name = f.uploaded_by
   and (pr.role = 'owner' or pr.organization_id::text is not distinct from p.organization_id::text)
  where coalesce(f.uploaded_by, '') <> ''
  group by f.project_id, f.parent_id, f.file_name, f.is_folder, f.external_id
  having count(*) = 1
)
update project_files t
set owner_id = r.owner_id
from resolved r
where t.owner_id is null
  and t.project_id = r.project_id
  and t.parent_id is not distinct from r.parent_id
  and t.file_name = r.file_name
  and coalesce(t.is_folder, false) = r.is_folder
  and t.external_id is not distinct from r.external_id;

-- 確認用（任意）: 所有者を決められなかったファイル
--   select project_id, file_name, uploaded_by from project_files where owner_id is null order by project_id, file_name;


-- ============================================================
-- 5) RLS
--    既存のポリシー（authenticated 全許可＋BRU14-001 のプロジェクト単位の絞り込み）はそのまま残し、
--    restrictive（＝AND で効く）ポリシーを足す。
-- ============================================================

-- 閲覧・更新: 限定公開の行は 所有者 / 共有先 / オーナー だけ
drop policy if exists dt_rls_project_files_acl on project_files;
create policy dt_rls_project_files_acl on project_files
  as restrictive for all
  using (
    acl_id is null
    or owner_id = auth.uid()
    or is_platform_owner()
    or is_file_acl_member(acl_id)
  )
  with check (
    acl_id is null
    or owner_id = auth.uid()
    or is_platform_owner()
    or is_file_acl_member(acl_id)
  );

-- 登録: 画面から直接入れてよいのはフォルダだけ。
-- ファイルの登録は、保存キーの検査と版の採番を行うサーバーAPI（service_role）が行う。
drop policy if exists dt_rls_project_files_insert_folder on project_files;
create policy dt_rls_project_files_insert_folder on project_files
  as restrictive for insert
  with check (coalesce(is_folder, false));

-- 削除: 画面から直接は消させない。
-- 「所有者 / オーナー / ファイルの削除権限」の判定は api/project-files の delete が行う。
drop policy if exists dt_rls_project_files_no_client_delete on project_files;
create policy dt_rls_project_files_no_client_delete on project_files
  as restrictive for delete
  using (false);

-- 限定公開の単位そのものは画面から読まない（ポリシーを1本も作らない＝service_role だけが読み書きする）
alter table project_file_acls enable row level security;

-- 共有先: そのファイルを見られる人は、誰に共有されているかも見られる。
-- （所有者・共有先どうし・オーナー。コメントのメンション通知先を「見られる人」に絞るのにも使う）
-- 付け外しはサーバーAPIだけが行うので、書き込みのポリシーは作らない。
alter table project_file_acl_members enable row level security;

drop policy if exists pf_acl_members_select on project_file_acl_members;
create policy pf_acl_members_select on project_file_acl_members for select using (
  exists (
    select 1 from public.project_files f
    where f.acl_id = project_file_acl_members.acl_id
  )
);

-- コメント: 見られるファイルのコメントだけ。
-- file_id は「書かれた時点の版」の行。その行が見えなければ、コメントも読み書きできない。
-- （file_id が空の古い行は、これまでどおりプロジェクトの絞り込みだけで扱う）
drop policy if exists dt_rls_project_file_comments_file on project_file_comments;
create policy dt_rls_project_file_comments_file on project_file_comments
  as restrictive for all
  using (
    file_id is null
    or exists (select 1 from public.project_files f where f.id = project_file_comments.file_id)
  )
  with check (
    file_id is null
    or exists (select 1 from public.project_files f where f.id = project_file_comments.file_id)
  );


-- ============================================================
-- 6) ホワイトボード: オーナーはプライベートボードと共有先を見られる
--    add_whiteboard_shares.sql のポリシーに「or is_platform_owner()」を足して張り替える。
--    プライベート化／解除／共有先の変更は、これまでどおり作成者だけ
--    （whiteboards_guard_ownership トリガーと wb_shares_write はそのまま）。
-- ============================================================
drop policy if exists "wb_select" on whiteboards;
create policy "wb_select" on whiteboards for select
  using (
    auth.role() = 'authenticated'
    and (
      visibility <> 'private'
      or private_by = (auth.uid())::text
      or is_whiteboard_shared_with_me(id)
      or is_platform_owner()
    )
  );

drop policy if exists "wb_update" on whiteboards;
create policy "wb_update" on whiteboards for update
  using (
    auth.role() = 'authenticated'
    and (
      visibility <> 'private'
      or private_by = (auth.uid())::text
      or is_whiteboard_shared_with_me(id)
      or is_platform_owner()
    )
  )
  with check (
    visibility <> 'private'
    or private_by = (auth.uid())::text
    or is_whiteboard_shared_with_me(id)
    or is_platform_owner()
  );

drop policy if exists "wb_delete" on whiteboards;
create policy "wb_delete" on whiteboards for delete
  using (
    auth.role() = 'authenticated'
    and (
      visibility <> 'private'
      or private_by = (auth.uid())::text
      or is_platform_owner()
    )
  );

drop policy if exists "wb_shares_select" on whiteboard_shares;
create policy "wb_shares_select" on whiteboard_shares for select using (
  profile_id = auth.uid()
  or is_whiteboard_creator(whiteboard_id)
  or is_whiteboard_shared_with_me(whiteboard_id)
  or is_platform_owner()
);
