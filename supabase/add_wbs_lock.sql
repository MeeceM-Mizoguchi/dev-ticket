-- ============================================================
-- BRU22-008 WBSのロック（誤削除の防止）
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
--
-- 前提（適用済みであること）: add_wbs.sql
--
-- ★ このSQLは、対応するアプリを本番へ出す「前」に流すこと。
--   アプリは列が無い環境ではロックのボタンを出さずに今のまま動く（WBSの作成でも is_locked は送らない）。
--
-- 設計上の要点:
--   ・ロックの状態は wbs_sheets.is_locked に持つ。既存のWBSと新しく作るWBSは false（ロックなし）。
--   ・ロック中のWBSは、画面の「削除」を押せなくするだけでなく、DB でも削除を拒否する
--     （PostgREST を直接呼んでも消せない）。消すときは、先にロックを解除する。
--   ・プロジェクトごと消すときの連鎖の削除は止めない（プロジェクトの行が既に無いことで見分ける）。
--   ・ロックの付け外しは、WBSを更新できる人（既存の wbs_sheets_update ポリシーのとおり）が行える。
-- ============================================================

alter table public.wbs_sheets add column if not exists is_locked boolean not null default false;

-- security definer なのは、プロジェクトの行が残っているかを RLS に関係なく確かめるため
create or replace function wbs_sheets_guard_locked_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(old.is_locked, false) then
    return old;
  end if;
  if not exists (select 1 from public.projects p where p.id = old.project_id) then
    return old;
  end if;
  raise exception 'wbs_sheets: this WBS is locked. Unlock it before deleting (DT_WBS_LOCKED)';
end
$$;

drop trigger if exists trg_wbs_sheets_guard_locked_delete on public.wbs_sheets;
create trigger trg_wbs_sheets_guard_locked_delete
  before delete on public.wbs_sheets
  for each row execute function wbs_sheets_guard_locked_delete();

-- PostgREST に新しい列を知らせる
notify pgrst, 'reload schema';
