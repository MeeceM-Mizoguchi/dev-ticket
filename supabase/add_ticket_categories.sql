-- ── Ticket Categories ────────────────────────────────────────
create table if not exists ticket_categories (
  id         text primary key,
  project_id text not null references projects(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

alter table ticket_categories enable row level security;

create policy "auth users can select ticket_categories"
  on ticket_categories for select to authenticated using (true);
create policy "auth users can insert ticket_categories"
  on ticket_categories for insert to authenticated with check (true);
create policy "auth users can update ticket_categories"
  on ticket_categories for update to authenticated using (true);
create policy "auth users can delete ticket_categories"
  on ticket_categories for delete to authenticated using (true);

-- Add category_id column to sprint_tickets
alter table sprint_tickets
  add column if not exists category_id text references ticket_categories(id) on delete set null;
