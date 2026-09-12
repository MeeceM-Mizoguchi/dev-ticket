-- ============================================================
-- チケットの引継ぎ（担当交代）機能
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- 【解決したい問題】
--   sprint_tickets は「現在の担当者」(assignee) を1つ持つだけで、
--   過去に誰が担当していたかを一切残していなかった。そのため
--     ① 担当を交代してもコメント履歴に何も残らない（通知は既読で消える）
--     ② 実績工数は calcTicketActualHours がチケット単位で出した値を
--        そのまま「現 assignee のもの」として集計していたため、
--        着手〜7割を進めた元担当の実績が交代した瞬間に消え、
--        引き継いだ人の実績になっていた。
--        （レポートのメンバー別負荷・スキル自動判定 analyze-skills まで巻き込む）
--
-- 【方式】「誰がいつからいつまで担当したか」の区間を別テーブルに持つ。
--   実績はチケット合計をこの区間で按分する（合計は常にチケット実績と一致）。
--   区間が1件も無いチケットはアプリ側で「現担当が100%」にフォールバックするので、
--   このSQLを流す前のデータが壊れることはない。

create table if not exists ticket_assignments (
  id             uuid        primary key default gen_random_uuid(),
  ticket_id      text        not null,
  -- 担当者は profiles.id ではなく名前の文字列。sprint_tickets.assignee と同じ持ち方に揃える
  --（既存の集計が軒並み名前で名寄せしているため。改名時は下の MemberEditDialog 側で追随する）
  assignee       text        not null,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,            -- null = 現担当。1チケットにつき常に1本だけ開いている
  -- 按分値を人が修正したときだけ入る（時間単位）。入っている区間は按分の対象外にして、
  -- 残りの時間を他の区間へ配る。null のままなら区間の稼働時間比で自動按分。
  hours_override numeric,
  handover_note  text        not null default '',   -- 引継ぎ理由・申し送り
  handed_over_by text        not null default '',   -- 引継ぎ操作をした人
  created_at     timestamptz not null default now()
);

-- 区間はチケット単位で必ず時系列に読む。BUG-01 対策の .order() が効くようにも index を張る
create index if not exists idx_ticket_assignments_ticket
  on ticket_assignments (ticket_id, started_at, id);

-- 「今この人が担当しているチケット」を引くクエリ用
create index if not exists idx_ticket_assignments_open
  on ticket_assignments (assignee) where ended_at is null;

alter table ticket_assignments enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='ticket_assignments' and policyname='ta_select') then
    create policy "ta_select" on ticket_assignments for select using (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename='ticket_assignments' and policyname='ta_insert') then
    create policy "ta_insert" on ticket_assignments for insert with check (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename='ticket_assignments' and policyname='ta_update') then
    create policy "ta_update" on ticket_assignments for update using (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename='ticket_assignments' and policyname='ta_delete') then
    create policy "ta_delete" on ticket_assignments for delete using (auth.role() = 'authenticated');
  end if;
end $$;

-- ============================================================
-- 区間の維持は DB トリガでやる（★アプリ側の書き込み経路を数えない）
-- ============================================================
--
-- assignee を書く経路はチケット詳細の担当プルダウンだけではない:
--   ・NewTicketDialog / BulkTicketCreateDialog / MdBulkCreateDialog（新規作成時の担当）
--   ・useBulkTicketActions の一括自動アサイン
--   ・MemberEditDialog のメンバー改名
--   ・今後増えるかもしれない経路
-- ここを1つでも取りこぼすと区間が実態とズレて、実績が誤った人に付く。
-- 「assignee が変わったら区間を締めて開く」を DB 側の不変条件にすれば、
-- どの経路から書かれても記録が欠けない。
-- アプリ側（引継ぎダイアログ）は、トリガが作った行に理由と実績の修正値を後から書き足すだけ。

create or replace function sync_ticket_assignment()
returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    if coalesce(new.assignee, '') <> '' then
      insert into ticket_assignments (ticket_id, assignee, started_at)
      values (new.id, new.assignee, coalesce(new.started_at, new.created_at, now()));
    end if;
    return new;
  end if;

  -- 担当が変わっていないなら何もしない（更新のたびに走るので早期 return が効く）
  if coalesce(new.assignee, '') is not distinct from coalesce(old.assignee, '') then
    return new;
  end if;

  -- 開いている区間を締める
  update ticket_assignments
     set ended_at = now()
   where ticket_id = new.id
     and ended_at is null;

  -- 割り当て解除('')のときは新しい区間を開かない。次にアサインされた時点から再開する
  if coalesce(new.assignee, '') <> '' then
    insert into ticket_assignments (ticket_id, assignee, started_at)
    values (new.id, new.assignee, now());
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_sync_ticket_assignment on sprint_tickets;
create trigger trg_sync_ticket_assignment
  after insert or update of assignee on sprint_tickets
  for each row execute function sync_ticket_assignment();

-- ============================================================
-- 既存チケットの初期区間を作る（1回だけ・再実行しても増えない）
-- ============================================================
-- 起点は「着手日 → 無ければ作成日」。着手前のチケットは実績0なので起点がどこでも結果は変わらない。
insert into ticket_assignments (ticket_id, assignee, started_at)
select t.id, t.assignee, coalesce(t.started_at, t.created_at, now())
  from sprint_tickets t
 where coalesce(t.assignee, '') <> ''
   and not exists (select 1 from ticket_assignments a where a.ticket_id = t.id);
