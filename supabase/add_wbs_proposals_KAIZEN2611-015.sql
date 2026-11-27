-- ============================================================
-- KAIZEN2611-015 WBS：AI からの更新の案を、反映の前に WBS 画面で新旧を見比べてから反映できるようにする
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全（すでに作られているものは作り直さない・同じ中身で置き換えるだけ）
--
-- 前提（適用済みであること）: add_wbs.sql / add_wbs_snapshots.sql / add_wbs_api_KAIZEN2611-013.sql
--
-- ★ アプリ（POST /api/v1/wbs-proposal）より後に流しても、既存の機能は壊れない。
--   このSQLを流すまでの間、wbs-proposal と、画面の「この内容で反映」「取り消す」だけが
--   「SQL が未適用」のエラーを返す（WBS の画面・wbs-update は今のまま動く）。
--
-- 設計上の要点:
--   ・AI が送った変更は、API（api/_lib/wbsApi.ts）が wbs-update と同じ確かめをしてから、
--     wbs_api_apply に渡す形（ops）のまま wbs_proposals に預ける。WBS は変えない。
--   ・画面で「この内容で反映」を押すと、wbs_proposal_decide が、押した人の権限で wbs_api_apply を呼ぶ。
--     版の番号（案を作ったときの edit_version）が今と違えば反映しない（conflict）。
--     反映は wbs_api_apply と同じく、すべて反映するか何も反映しないか。反映の前の状態は before_api に残る。
--   ・読めるのは、その WBS を見られる人（RLS）。書き込みは service_role（API と関数）だけ。
-- ============================================================

-- ── 1. 案を預けるテーブル ─────────────────────────────────────
create table if not exists public.wbs_proposals (
  id               uuid        primary key default gen_random_uuid(),
  wbs_sheet_id     uuid        not null references public.wbs_sheets(id) on delete cascade,
  project_id       text        not null references public.projects(id) on delete cascade,
  -- wbs_api_apply に渡す形の操作の配列（insert / update / link / unlink）
  ops              jsonb       not null default '[]'::jsonb,
  -- 変更の一覧（文）と、確かめで出た注意（文）
  changes          jsonb       not null default '[]'::jsonb,
  warnings         jsonb       not null default '[]'::jsonb,
  -- 案を作ったときの版の番号。反映のときに今の版の番号と比べる
  base_version     bigint      not null,
  -- 案を作った人（API キーの発行者）と、使った API キー
  created_by       uuid        references public.profiles(id) on delete set null,
  created_by_name  text        not null default '',
  api_key_id       uuid,
  api_key_name     text        not null default '',
  status           text        not null default 'pending',
  created_at       timestamptz not null default now(),
  decided_by       uuid        references public.profiles(id) on delete set null,
  decided_by_name  text        not null default '',
  decided_at       timestamptz
);

alter table public.wbs_proposals drop constraint if exists wbs_proposals_status_check;
alter table public.wbs_proposals add constraint wbs_proposals_status_check
  check (status in ('pending', 'applied', 'rejected'));

create index if not exists idx_wbs_proposals_sheet on public.wbs_proposals(wbs_sheet_id, status, created_at);

alter table public.wbs_proposals enable row level security;
drop policy if exists "wbs_proposals_select" on public.wbs_proposals;
create policy "wbs_proposals_select" on public.wbs_proposals for select using (can_view_wbs_sheet(wbs_sheet_id));

-- ── 2. 案を反映する／取り消す ─────────────────────────────────
-- p_action: 'apply'（この内容で反映）/ 'reject'（取り消す）
-- 返り値: { ok: true, version? } / { ok: false, reason: not_found|forbidden|decided|archived|locked|conflict|invalid, ... }
create or replace function public.wbs_proposal_decide(p_user_id uuid, p_proposal_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pr public.wbs_proposals%rowtype;
  v_name text;
  v_result jsonb;
begin
  select * into pr from public.wbs_proposals where id = p_proposal_id for update;
  if not found or not public.wbs_user_can_view(p_user_id, pr.wbs_sheet_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not public.wbs_user_can_edit(p_user_id, pr.wbs_sheet_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if pr.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'decided', 'status', pr.status);
  end if;
  select p.name into v_name from public.profiles p where p.id = p_user_id;

  if p_action = 'reject' then
    update public.wbs_proposals
       set status = 'rejected', decided_by = p_user_id, decided_by_name = coalesce(v_name, ''), decided_at = now()
     where id = p_proposal_id;
    return jsonb_build_object('ok', true);
  end if;

  if p_action is distinct from 'apply' then
    return jsonb_build_object('ok', false, 'reason', 'invalid', 'detail', 'action は apply か reject です');
  end if;

  -- 権限・アーカイブ・ロック・版の番号の確認、反映前のバックアップ、行の反映は wbs_api_apply が行う
  v_result := public.wbs_api_apply(p_user_id, pr.wbs_sheet_id, pr.base_version, pr.ops);
  if coalesce((v_result->>'ok')::boolean, false) is not true then
    return v_result;
  end if;

  update public.wbs_proposals
     set status = 'applied', decided_by = p_user_id, decided_by_name = coalesce(v_name, ''), decided_at = now()
   where id = p_proposal_id;
  return v_result;
end
$$;

-- ── 3. 関数を呼べる人 ───────────────────────────────────────
-- 呼んだ人の id を受け取るので、service_role（api/wbs の proposal-apply / proposal-reject）だけが呼べるようにする
revoke all on function public.wbs_proposal_decide(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.wbs_proposal_decide(uuid, uuid, text) to service_role;

-- PostgREST に新しいテーブル・関数を知らせる
notify pgrst, 'reload schema';
