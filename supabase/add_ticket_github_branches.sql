-- BRU13-054: Dev Ticket から作ったブランチとチケットの紐付け
--
-- これまでチケットとPRの紐付けは、ブランチ名／PRタイトルに書かれた WBS 番号を
-- 正規表現で拾うことだけで成り立っていた（api/github/[resource].ts の detectWbs）。
-- そのため、命名を外したブランチは紐付き候補にすら出てこず、後から直す手段も無かった。
--
-- ブランチを Dev Ticket から作るときに「このブランチはこのチケットのもの」を
-- ここに残しておけば、名前が何であれ、そのブランチから出たPRをチケットへ辿れる。
-- ブランチ名を自由に決められるようにするための土台。
--
-- 紐付けは ticket_github_links とは別テーブルにする。あちらは kind in ('pull','issue')
-- と number（整数）が前提で、番号を持たないブランチは構造的に入らない。

create table if not exists ticket_github_branches (
  id           bigserial primary key,
  project_id   text not null references projects(id) on delete cascade,
  ticket_id    text not null,
  -- 作成時点のリポジトリ。プロジェクトのリポジトリ紐付けを後から張り替えても、
  -- 別リポジトリの同名ブランチを誤って同一視しないように持っておく
  repo         text not null,
  branch_name  text not null,
  base_branch  text not null default '',
  created_by   uuid,
  created_by_name text,
  created_at   timestamptz not null default now(),
  -- 同じリポジトリの同じブランチ名は1本しか存在しないので、チケットは1つに定まる。
  -- 作り直し（削除→再作成）で衝突したときは upsert で上書きする
  unique (project_id, repo, branch_name)
);

create index if not exists idx_ticket_github_branches_ticket
  on ticket_github_branches (project_id, ticket_id);

-- head ブランチ名からチケットを引く経路（PR紐付け）が最も多いので索引を張る
create index if not exists idx_ticket_github_branches_name
  on ticket_github_branches (project_id, branch_name);

alter table ticket_github_branches enable row level security;

-- 参照はプロジェクトにアクセスできる人。作成は、サーバー側で
-- githubBranchPermission = write を確認したうえで service_role が行う。
drop policy if exists ticket_github_branches_select on ticket_github_branches;
create policy ticket_github_branches_select on ticket_github_branches
  for select using (can_access_project(project_id));

-- プロジェクト境界の RESTRICTIVE ポリシー（fix_project_level_rls_BRU14-001.sql と同じ形）。
-- あちらの一覧にもこのテーブルを足してあるが、本ファイルだけを当てた環境でも
-- 他プロジェクトの行が見えないように、ここでも張っておく。
do $do$
begin
  if to_regprocedure('public.my_project_ids()') is null then
    raise notice 'skip: my_project_ids() が未作成のため RESTRICTIVE ポリシーは張りません';
    return;
  end if;
  drop policy if exists dt_rls_ticket_github_branches_project on public.ticket_github_branches;
  create policy dt_rls_ticket_github_branches_project on public.ticket_github_branches
    as restrictive for all
    using (project_id in (select mp.project_id from public.my_project_ids() mp))
    with check (project_id in (select mp.project_id from public.my_project_ids() mp));
end
$do$;
