-- ============================================================
-- スプリント並び替え「全員に適用」を、後からアサインしたメンバーにも届ける
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
--
-- ── 何が起きていたか ─────────────────────────────────────────
-- 「全員に適用」の並び順は sprint_orders の member_id が null の1行に置いていた
-- （BRU10-068 / add_sprint_orders.sql）。この作りだと
--   ・プロジェクトが見えるか
--   ・その並び順の行が読めるか
-- が別々の判定になり、片方だけ通らない状態があり得る。実際の症状は
-- 「後からプロジェクトにアサインしたメンバーの画面だけ既定順（開始日順）のまま」。
--
-- ── どう直すか ───────────────────────────────────────────────
-- プロジェクト共通の並び順は、そもそもプロジェクトの属性なので projects 行へ移す。
-- 一覧を開けている＝projects 行は読めている、なので
-- 「プロジェクトが見えるのに並び順だけ見えない」が原理的に起きなくなる。
--
-- 「個人のみに適用」の並び順は本人だけのものなので sprint_orders に残す
-- （member_id = 本人の行）。読むときの優先度は 個人設定 > 共通設定 のまま。
-- ============================================================

alter table public.projects
  add column if not exists sprint_order text[] not null default '{}';

comment on column public.projects.sprint_order is
  'スプリント一覧の表示順（sprints.id の配列）。「全員に適用」で保存されるプロジェクト共通の並び順。空配列＝未設定（これまで通り開始日順）。個人ごとの並び順は sprint_orders 側。';

-- ── 既存の共通並び順を移送 ───────────────────────────────────
-- すでに projects 側へ入っている場合は上書きしない（再実行しても壊れない）。
update public.projects p
set    sprint_order = so.sprint_ids
from   public.sprint_orders so
where  so.project_id = p.id
  and  so.member_id is null
  and  coalesce(array_length(p.sprint_order, 1), 0) = 0;

-- 旧保存先（sprint_orders の member_id is null の行）は消さない。
-- 配布済みのネイティブアプリなど、まだ旧コードで動いているクライアントが
-- そちらを読むため。新しいクライアントは保存時に両方へ書き、
-- 読むときは projects.sprint_order を優先する（src/app/lib/sprintOrder.ts）。

-- ============================================================
-- 動作確認クエリ（任意）
-- ============================================================
-- select id, slug, name, sprint_order from public.projects
--  where coalesce(array_length(sprint_order, 1), 0) > 0;
--
-- -- 共通ぶんが projects 側へ移っているか（0件になっていれば移送済み）
-- select so.project_id
--   from public.sprint_orders so
--   join public.projects p on p.id = so.project_id
--  where so.member_id is null
--    and coalesce(array_length(p.sprint_order, 1), 0) = 0;
