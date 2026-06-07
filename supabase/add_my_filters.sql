-- Myフィルタ: ユーザーが保存したフィルタ条件をスプリントごとにDBへ永続化
create table if not exists my_filters (
  id          text        primary key,
  sprint_id   text        not null references sprints(id) on delete cascade,
  member_id   uuid        not null references profiles(id) on delete cascade,
  title       text        not null,
  filters     jsonb       not null default '{}',
  sort_col    text        not null default '',
  sort_dir    text        not null default 'asc' check (sort_dir in ('asc', 'desc')),
  created_at  timestamptz not null default now()
);

alter table my_filters enable row level security;

-- 自分のフィルタのみ参照・変更可能
create policy "Users can manage their own filters"
  on my_filters for all
  using (auth.uid() = member_id)
  with check (auth.uid() = member_id);
