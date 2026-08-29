-- ============================================================
-- ホワイトボード プライベートモードの「限定公開」
--   プライベートにしたボードを、作成者が選んだメンバーにだけ見せられるようにする。
--   Run in: Supabase Dashboard → SQL Editor → New query
--   前提: supabase/add_whiteboard_private.sql が適用済みであること。
--
-- 設計上の要点（docs/whiteboard-private-mode-design.md §9）:
--   ・visibility は 'project' / 'private' の二値のまま。'private' + 共有行 = 限定公開。
--     3値目を足さないのは、RLS の条件が「or 共有されている」1項の追加で済むため。
--   ・共有された人は private_key（Realtime チャンネルの秘密トークン）も一緒に読めるようになる。
--     チャンネル名を計算できる＝同期に参加できる、という設計をそのまま流用する。
--   ・共有を外したら private_key を作り直す（アプリ側 rotatePrivateKey）。
--     外された人はチャンネル名を知っているので、鍵を変えないと同期を覗き続けられる。
--   ・whiteboards ⇄ whiteboard_shares の相互参照は RLS が循環して 500 になるため、
--     security definer 関数を挟んで迂回する（add_tasks.sql の task_shares と同型）。
-- ============================================================

create table if not exists whiteboard_shares (
  whiteboard_id uuid not null references whiteboards(id) on delete cascade,
  profile_id    uuid not null references profiles(id)    on delete cascade,
  -- 誰が共有を張ったか（＝ボード作成者）。監査用に残すだけで判定には使わない
  created_by    text not null default '',
  created_at    timestamptz not null default now(),
  primary key (whiteboard_id, profile_id)
);

create index if not exists idx_whiteboard_shares_profile on whiteboard_shares(profile_id);

-- ── RLS の再帰よけ ────────────────────────────────────────────
-- 自分に共有されているか（whiteboard_shares の RLS を経由しない）
create or replace function is_whiteboard_shared_with_me(p_board_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.whiteboard_shares s
    where s.whiteboard_id = p_board_id and s.profile_id = auth.uid()
  )
$$;

-- 自分が作成者か（whiteboards の RLS を経由しない）。
-- private_by ではなく created_by を見るのは、公開に戻した後（private_by='')でも
-- 共有行の管理者が誰かを判定できるようにするため。
create or replace function is_whiteboard_creator(p_board_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.whiteboards w
    where w.id = p_board_id and w.created_by <> '' and w.created_by = (auth.uid())::text
  )
$$;

-- ── whiteboards の RLS を張り替え（「or 共有されている」を足す） ──
drop policy if exists "wb_select" on whiteboards;
drop policy if exists "wb_update" on whiteboards;
drop policy if exists "wb_delete" on whiteboards;

-- 閲覧: 公開ボードは全員 / プライベートは作成者と共有された人
create policy "wb_select" on whiteboards for select
  using (
    auth.role() = 'authenticated'
    and (
      visibility <> 'private'
      or private_by = (auth.uid())::text
      or is_whiteboard_shared_with_me(id)
    )
  );

-- 更新: 見えている行のみ。
--   with check から「作成者のみ」の条件を外し、代わりに下の BEFORE UPDATE トリガーで
--   visibility / private_by / private_key / created_by の書き換えを作成者に限る。
--   共有された人も doc_state を保存する必要があり（保存できないと編集が黙って消える）、
--   RLS の with check は OLD 行を見られないため「所有権に関わる列だけ守る」ことができない。
create policy "wb_update" on whiteboards for update
  using (
    auth.role() = 'authenticated'
    and (
      visibility <> 'private'
      or private_by = (auth.uid())::text
      or is_whiteboard_shared_with_me(id)
    )
  )
  with check (
    visibility <> 'private'
    or private_by = (auth.uid())::text
    or is_whiteboard_shared_with_me(id)
  );

-- 削除: 見えている行のみ（公開ボードの削除権は従来どおり）。
-- プライベートボードは作成者だけが消せる（共有された人には消させない）。
create policy "wb_delete" on whiteboards for delete
  using (
    auth.role() = 'authenticated'
    and (visibility <> 'private' or private_by = (auth.uid())::text)
  );

-- ── 所有権に関わる列の書き換えを作成者に限る ──
-- これが「プライベート化／解除／共有先の張り替えができるのは作成者だけ」の実体。
-- UI でメニューを出さないのは見た目の補助にすぎず、ここが唯一の防壁。
create or replace function whiteboards_guard_ownership()
returns trigger
language plpgsql
as $$
begin
  if new.visibility  is not distinct from old.visibility
 and new.private_by  is not distinct from old.private_by
 and new.private_key is not distinct from old.private_key
 and new.created_by  is not distinct from old.created_by then
    return new;                       -- 内容(doc_state など)の保存は誰でも通す
  end if;
  -- SQL Editor / service_role（JWT が無い）からの運用操作は素通しする。
  -- 作成者が退職した時の救済など、DB 直操作を塞いでしまわないため。
  if auth.uid() is null then
    return new;
  end if;
  if old.created_by = '' or old.created_by is distinct from (auth.uid())::text then
    raise exception 'whiteboards: only the creator can change visibility/sharing';
  end if;
  return new;
end
$$;

drop trigger if exists trg_whiteboards_guard_ownership on whiteboards;
create trigger trg_whiteboards_guard_ownership
  before update on whiteboards
  for each row execute function whiteboards_guard_ownership();

-- ── 共有行の RLS ──────────────────────────────────────────────
alter table whiteboard_shares enable row level security;

drop policy if exists "wb_shares_select" on whiteboard_shares;
drop policy if exists "wb_shares_write"  on whiteboard_shares;

-- 参照: 自分宛の行 / 作成者 / 同じボードに共有されている人。
-- 3つ目を許すのは、共有相手どうしが「誰と共有されているか」を見て
-- コメントのメンション通知先を判断するため（見えないと通知が届かない相手が出る）。
create policy "wb_shares_select" on whiteboard_shares for select using (
  profile_id = auth.uid()
  or is_whiteboard_creator(whiteboard_id)
  or is_whiteboard_shared_with_me(whiteboard_id)
);

-- 付け外し: ボードの作成者のみ
create policy "wb_shares_write" on whiteboard_shares for all
  using (is_whiteboard_creator(whiteboard_id))
  with check (is_whiteboard_creator(whiteboard_id));
