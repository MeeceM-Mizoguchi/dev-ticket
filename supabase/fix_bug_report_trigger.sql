-- ============================================================
-- バグ報告ステータス同期トリガーの修正
-- Run in: Supabase Dashboard → SQL Editor → New query
--
-- 問題:
--   旧トリガーは bug_reports.backlog_item_id を使って検索していたが、
--   bug_reports への UPDATE ポリシーがないため backlog_item_id が
--   常に NULL になっており、トリガーが機能していなかった。
--
-- 修正:
--   backlog_items.bug_report_id（正しくセットされている）を使う方向に変更。
-- ============================================================

-- ── RLSポリシー: bug_reports の UPDATE を許可（本人のみ）──────────
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'bug_reports'
      and policyname = 'own_update_bug_reports'
  ) then
    execute 'create policy "own_update_bug_reports" on bug_reports for update using (auth.uid() = user_id)';
  end if;
end
$$;

-- ── 修正済みトリガー関数 ─────────────────────────────────────────
create or replace function sync_bug_report_status()
returns trigger language plpgsql security definer as $$
begin
  if NEW.status = 'released' and (OLD.status is null or OLD.status <> 'released') then
    update bug_reports
    set    status     = 'resolved',
           updated_at = now()
    where  id in (
      select bug_report_id
      from   backlog_items
      where  converted_ticket_id = NEW.id
        and  is_user_inquiry     = true
        and  bug_report_id       is not null
    );
  end if;
  return NEW;
end;
$$;

-- トリガーは既存のものをそのまま使用（関数の差し替えのみで有効）

-- ── 既存の「リリース済み」チケットに紐づくバグ報告を手動で解決済みにする ──
update bug_reports br
set    status     = 'resolved',
       updated_at = now()
where  br.status  = 'open'
  and  br.id in (
    select bi.bug_report_id
    from   backlog_items bi
    join   sprint_tickets st on st.id = bi.converted_ticket_id
    where  bi.is_user_inquiry = true
      and  bi.bug_report_id  is not null
      and  st.status         = 'released'
  );
