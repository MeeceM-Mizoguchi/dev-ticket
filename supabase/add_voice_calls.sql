-- ENHA2-029 オンライン音声会話 — 通話履歴テーブル。
-- 通話の成立自体は WebRTC + Supabase Broadcast で完結しDB不要だが、
-- 「誰といつ話したか」の履歴・不在着信の記録用に最小限のテーブルを用意する。

create table if not exists call_sessions (
  id           uuid primary key default gen_random_uuid(),
  project_id   text not null references projects(id) on delete cascade,
  initiator_id text not null,                     -- 発信者 profiles.id
  status       text not null default 'ringing',   -- ringing | active | ended | missed
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);

create table if not exists call_participants (
  session_id uuid not null references call_sessions(id) on delete cascade,
  user_id    text not null,                       -- profiles.id
  joined_at  timestamptz,
  left_at    timestamptz,
  outcome    text not null default 'invited',     -- invited | joined | declined | missed
  primary key (session_id, user_id)
);

create index if not exists idx_call_sessions_project on call_sessions(project_id);
create index if not exists idx_call_sessions_initiator on call_sessions(initiator_id);
create index if not exists idx_call_participants_user on call_participants(user_id);

-- RLS: 発信者 or 招待された参加者だけが自分の関わる通話を読める。
alter table call_sessions enable row level security;
alter table call_participants enable row level security;

drop policy if exists call_sessions_select on call_sessions;
create policy call_sessions_select on call_sessions for select
  using (
    initiator_id = auth.uid()::text
    or exists (
      select 1 from call_participants p
      where p.session_id = call_sessions.id and p.user_id = auth.uid()::text
    )
  );

drop policy if exists call_sessions_insert on call_sessions;
create policy call_sessions_insert on call_sessions for insert
  with check (initiator_id = auth.uid()::text);

drop policy if exists call_sessions_update on call_sessions;
create policy call_sessions_update on call_sessions for update
  using (
    initiator_id = auth.uid()::text
    or exists (
      select 1 from call_participants p
      where p.session_id = call_sessions.id and p.user_id = auth.uid()::text
    )
  );

drop policy if exists call_participants_all on call_participants;
create policy call_participants_all on call_participants for all
  using (
    user_id = auth.uid()::text
    or exists (
      select 1 from call_sessions s
      where s.id = call_participants.session_id and s.initiator_id = auth.uid()::text
    )
  )
  with check (true);
