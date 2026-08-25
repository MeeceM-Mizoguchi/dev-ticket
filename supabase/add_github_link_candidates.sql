-- BRU13-015 大文字小文字だけが違うPRは自動で紐付けず、人に選ばせる
--
-- ブランチ名 SEIBUN/demo-071 と SEIBUN/DEMO-071 のように、WBS番号の綴りが
-- 大文字小文字だけ違うPRが複数ある場合、どちらが正しいかは機械では決められない。
-- そのまま両方を紐付けると、関係の無いPRがチケットに混ざったまま気づけないので、
-- 自動紐付けを止めてここへ退避し、チケット詳細で人が1つ選べるようにする。
--
-- 同じ綴り同士で複数PRがあるのは正常（修正PR＋追従PRなど）。ここへは入らない。

create table if not exists ticket_github_link_candidates (
  id           bigserial primary key,
  project_id   text not null references projects(id) on delete cascade,
  ticket_id    text not null,
  -- 突き合わせに使ったWBS番号。大文字に正規化してある（demo-071 も DEMO-071 も DEMO-071）
  wbs_key      text not null,
  kind         text not null default 'pull' check (kind in ('pull','issue')),
  number       integer not null,
  -- このPRのブランチ名／タイトルに実際に書かれていた綴り。これが割れているから候補になっている
  spelling     text,
  title        text,
  state        text,
  url          text,
  auto_reason  text,
  -- 人が選び終えた印。選ばれなかった候補も含めて全件に入れ、二度と出さない
  resolved_at  timestamptz,
  resolved_by  uuid,
  -- 選ばれた1件だけ true
  chosen       boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (project_id, ticket_id, kind, number)
);

create index if not exists idx_ticket_github_link_candidates_ticket
  on ticket_github_link_candidates (project_id, ticket_id);

alter table ticket_github_link_candidates enable row level security;

-- 参照はプロジェクトにアクセスできる人。書き込みはサーバー側で
-- githubPermission = merge を確認したうえで service_role が行う（紐付け本体と同じ）。
drop policy if exists ticket_github_link_candidates_select on ticket_github_link_candidates;
create policy ticket_github_link_candidates_select on ticket_github_link_candidates
  for select using (can_access_project(project_id));

-- ── 紐付けに使った綴りを残す ────────────────────────────────────────────────
-- 綴りが割れているかどうかは、今回走査したPRだけでは分からない
-- （前回のWebhookで紐付いた demo-071 と、今回来た DEMO-071 の食い違いなど）。
-- 既に紐付いている行の綴りと突き合わせるために、紐付け時の綴りを持っておく。
alter table ticket_github_links
  add column if not exists wbs_spelling text;

comment on column ticket_github_links.wbs_spelling is
  '自動紐付けの根拠になったWBS番号の綴り（原文のまま）。大文字小文字の食い違いの検出に使う';

-- 既存の紐付けは auto_reason（「ブランチ名 demo-071」）に綴りが残っているので、そこから移す。
-- 埋めておかないと、既にマージ済みのPRとの食い違いを検出できない
-- （マージ済みPRは open のPR一覧に出てこないため、綴りを取り直す機会が無い）。
update ticket_github_links
   set wbs_spelling = substring(auto_reason from '([A-Za-z][A-Za-z0-9]*-[0-9]+)')
 where wbs_spelling is null
   and auto_reason is not null;

-- ── 過去PRの穴埋めを1回だけ走らせるための記録 ──────────────────────────────
-- 穴埋めは全PRの走査を伴うので、定期実行で毎回やるものではない。
-- リポジトリを紐付けた直後に1回だけ走らせ、以後はWebhookとPR一覧の表示で追従する。
alter table projects
  add column if not exists github_links_backfilled_repo text,
  add column if not exists github_links_backfilled_at timestamptz;

comment on column projects.github_links_backfilled_repo is
  '過去PRの穴埋めを実行済みのリポジトリ名。現在の github_repo_full_name と違えば未実行とみなして1回だけ走らせる';

-- 現在リポジトリを紐付けてある3プロジェクトは、この対応で過去分を埋め終えている
-- （DevTicket は定期実行が埋め続けていた分、NegoNavi と 成分デジタル表示化 は今回の手動実行分）。
-- 実行済みとして記録し、次にリポジトリ設定を保存したときに再走査しないようにする。
update projects
   set github_links_backfilled_repo = github_repo_full_name,
       github_links_backfilled_at = now()
 where github_enabled = true
   and github_repo_full_name is not null
   and github_links_backfilled_repo is null;
