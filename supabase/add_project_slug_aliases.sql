-- ============================================================
-- プロジェクト識別子(slug)の旧値エイリアス
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
-- ============================================================
--
-- 目的:
--   プロジェクト識別子は URL の先頭セグメント(/PJ/BRU4-016)にそのまま入る。
--   これを変更すると、本文に貼られた内部リンク・Slack通知・メール・GitHubのPR本文・
--   ブラウザのブックマークなど「すでに外へ出たURL」が一斉に無効になる。
--   projects.slug は単純な UPDATE で上書きされ旧値がどこにも残らないため、
--   ここに旧値を記録し、旧URLで着地したときに現行プロジェクトへ橋渡しする。
--
-- 設計メモ:
--   ・projects.id は uuid ではなく text（`P-<timestamp>`）。参照型を合わせること。
--   ・organization_id も text。projects と同じく NULL を許す（組織未設定の古いデータ）。
--   ・旧slugは「予約済み」として扱う。別プロジェクトが同じ文字列を取れてしまうと、
--     旧URLがどちらを指すか決められなくなるため、アプリ側の重複チェックが
--     projects.slug と old_slug の両方を見る（lib/projectResolve.ts）。

create table if not exists public.project_slug_aliases (
  id              uuid primary key default gen_random_uuid(),
  project_id      text not null references public.projects(id) on delete cascade,
  -- 重複判定を projects と同じ土俵(組織単位)で行うために非正規化して持つ。
  -- プロジェクトの所属組織が変わることは想定していない。
  organization_id text,
  old_slug        text not null,
  changed_by      text not null default '',
  created_at      timestamptz not null default now()
);

-- 組織内で旧slugは一意。slug は英数大文字に正規化して保存するが、
-- 過去データの取りこぼしを防ぐため upper() を噛ませて索引を張る。
create unique index if not exists uq_project_slug_aliases_org_slug
  on public.project_slug_aliases (coalesce(organization_id, ''), upper(old_slug));

-- 旧URL着地時の引き当て。クライアントは PostgREST 経由で
-- `old_slug in (…)` を投げるため、関数索引ではなく素の列に張る。
create index if not exists idx_project_slug_aliases_old_slug
  on public.project_slug_aliases (old_slug);

create index if not exists idx_project_slug_aliases_project
  on public.project_slug_aliases (project_id);

alter table public.project_slug_aliases enable row level security;

-- ポリシーは projects (fix_multitenant_rls.sql) にそろえる。
-- 参照は「自組織 or 組織未設定」、書き込みは「自組織」。owner は全組織。
-- 実際の追加・削除は下の SECURITY DEFINER トリガーが行う（RLS を通らない）。
-- ここの insert/delete ポリシーは、記録を手で直したいときのための口。
drop policy if exists "tenant_select_project_slug_aliases" on public.project_slug_aliases;
create policy "tenant_select_project_slug_aliases" on public.project_slug_aliases
  for select using (
    (select role from public.profiles where id = auth.uid()) = 'owner'
    or organization_id = get_my_org_id()
    or organization_id is null
  );

drop policy if exists "tenant_insert_project_slug_aliases" on public.project_slug_aliases;
create policy "tenant_insert_project_slug_aliases" on public.project_slug_aliases
  for insert with check (
    (select role from public.profiles where id = auth.uid()) = 'owner'
    or organization_id = get_my_org_id()
  );

drop policy if exists "tenant_delete_project_slug_aliases" on public.project_slug_aliases;
create policy "tenant_delete_project_slug_aliases" on public.project_slug_aliases
  for delete using (
    (select role from public.profiles where id = auth.uid()) = 'owner'
    or organization_id = get_my_org_id()
  );

-- ── 記録はトリガーで行う ─────────────────────────────────────
-- クライアント側の保存処理に足すと、識別子を更新する経路（編集ダイアログが3つ、
-- 将来のAPI/SQL修正）のどれか1つでも漏らした時点で旧URLが失われる。
-- projects の UPDATE そのものに紐付けておけば取りこぼしようがない。
-- SECURITY DEFINER: 呼び出したユーザーの RLS に関係なく記録を残す
-- （記録できないと「変更できたのに旧URLは死ぬ」という一番まずい状態になるため）。
create or replace function public.record_project_slug_alias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.slug is distinct from old.slug then
    -- 自分の旧識別子へ戻した場合は、その予約を解放する。
    -- 現行slugと旧slugが同じ文字列で並ぶと、他プロジェクトからは永久に予約済みに見える。
    delete from public.project_slug_aliases
     where project_id = new.id
       and upper(old_slug) = upper(new.slug);

    if old.slug is not null and old.slug <> '' then
      insert into public.project_slug_aliases (project_id, organization_id, old_slug, changed_by)
      values (new.id, new.organization_id, old.slug, coalesce(auth.uid()::text, ''))
      -- 同じ旧slugが既に記録済み（識別子を行き来した等）なら黙って据え置く
      on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_record_project_slug_alias on public.projects;
create trigger trg_record_project_slug_alias
  after update of slug on public.projects
  for each row execute function public.record_project_slug_alias();

comment on table public.project_slug_aliases is
  'プロジェクト識別子(slug)の旧値。配布済みの旧URLを現行プロジェクトへ橋渡しするために保持する';
comment on column public.project_slug_aliases.old_slug is
  '変更前の projects.slug。組織内で一意（現行slugとも衝突させないこと）';

-- 確認用
-- select p.slug as current_slug, a.old_slug, a.created_at
--   from public.project_slug_aliases a
--   join public.projects p on p.id = a.project_id
--  order by a.created_at desc;
