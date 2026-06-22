-- ============================================================
-- バグ報告（問い合わせ）機能追加
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── bug_reports テーブル ──────────────────────────────────────
create table if not exists bug_reports (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references profiles(id) on delete set null,
  user_name       text not null default '',
  user_email      text not null default '',
  category        text not null default 'other'
                    check (category in ('login','ticket','sprint','member','ui','other')),
  severity        text not null default 'minor'
                    check (severity in ('critical','major','minor')),
  title           text not null,
  steps           text not null default '',
  actual          text not null default '',
  expected        text not null default '',
  url             text not null default '',
  images          jsonb not null default '[]',
  status          text not null default 'open'
                    check (status in ('open','resolved')),
  backlog_item_id text,  -- backlog_items.id (B-XXX) 循環参照回避のためFK制約なし
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table bug_reports enable row level security;
-- 自分の報告のみ読み取り可
create policy "own_select_bug_reports" on bug_reports for select using (auth.uid() = user_id);
-- 認証済みユーザーが投稿可
create policy "auth_insert_bug_reports" on bug_reports for insert with check (auth.role() = 'authenticated');

create index if not exists idx_bug_reports_user_id on bug_reports(user_id);
create index if not exists idx_bug_reports_status  on bug_reports(status);

-- ── backlog_items にユーザー問い合わせフラグ列を追加 ──────────
alter table backlog_items
  add column if not exists is_user_inquiry boolean not null default false,
  add column if not exists bug_report_id   uuid references bug_reports(id) on delete set null;

create index if not exists idx_backlog_items_bug_report_id on backlog_items(bug_report_id);

-- ── DBトリガー：sprint_tickets が released になったら bug_reports を resolved に ─
create or replace function sync_bug_report_status()
returns trigger language plpgsql security definer as $$
begin
  if NEW.status = 'released' and (OLD.status is null or OLD.status <> 'released') then
    update bug_reports
    set    status     = 'resolved',
           updated_at = now()
    where  backlog_item_id in (
      select id from backlog_items
      where  converted_ticket_id = NEW.id
        and  is_user_inquiry = true
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists on_ticket_released on sprint_tickets;
create trigger on_ticket_released
  after update on sprint_tickets
  for each row execute function sync_bug_report_status();
