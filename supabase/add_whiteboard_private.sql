-- ============================================================
-- ホワイトボード プライベートモード
--   ボード単位で「作成者だけが見られる」状態を持てるようにする。
--   Run in: Supabase Dashboard → SQL Editor → New query
--
-- 設計上の要点（docs/whiteboard-private-mode-design.md）:
--   ・既存のホワイトボード権限（none/view/edit）はアプリ側 loadWhiteboardPerms が担保しているが、
--     プライベートは漏れた時の被害が質的に違うので RLS（DB）を唯一の防壁にする。
--   ・組織の owner/admin も見られない（＝仕様）。
--   ・プライベート化できるのは作成者のみ。これは UPDATE の with check で強制する
--     （メニューを出さないのは見た目の補助にすぎず、DevTools から直接叩かれても通らない）。
--   ・private_key は Yjs の Realtime チャンネル名に混ぜる秘密トークン。
--     Broadcast は Realtime Authorization を入れていない限り誰でも join できてしまい、
--     `wb:{boardId}` 固定のままだと過去に URL を知っていた人が同期内容を覗ける。
--     RLS でこの列ごと隠すことで、所有者以外はチャンネル名を計算できなくする。
-- ============================================================

alter table whiteboards
  add column if not exists visibility  text not null default 'project',
  add column if not exists private_by  text not null default '',   -- プライベート所有者 = auth.uid()::text
  add column if not exists private_key text not null default '';   -- Realtime チャンネルの秘密トークン

alter table whiteboards drop constraint if exists whiteboards_visibility_check;
alter table whiteboards add constraint whiteboards_visibility_check
  check (visibility in ('project','private'));

create index if not exists idx_whiteboards_private_by on whiteboards(private_by)
  where visibility = 'private';

-- ── RLS 差し替え（authenticated 全許可 → プライベート行だけ所有者に限定） ──
drop policy if exists "auth_select_whiteboards" on whiteboards;
drop policy if exists "auth_insert_whiteboards" on whiteboards;
drop policy if exists "auth_update_whiteboards" on whiteboards;
drop policy if exists "auth_delete_whiteboards" on whiteboards;
drop policy if exists "wb_select" on whiteboards;
drop policy if exists "wb_insert" on whiteboards;
drop policy if exists "wb_update" on whiteboards;
drop policy if exists "wb_delete" on whiteboards;

-- 閲覧: 公開ボードは従来どおり全員 / プライベートは所有者のみ
create policy "wb_select" on whiteboards for select
  using (
    auth.role() = 'authenticated'
    and (visibility <> 'private' or private_by = auth.uid()::text)
  );

-- 作成: 通常は公開で作る。プライベートで作る場合も自分名義に限る
create policy "wb_insert" on whiteboards for insert
  with check (
    auth.role() = 'authenticated'
    and (
      visibility <> 'private'
      or (private_by = auth.uid()::text and created_by = auth.uid()::text)
    )
  );

-- 更新: 見えている行のみ。かつプライベート化は「作成者が自分名義で」だけ許す
create policy "wb_update" on whiteboards for update
  using (
    auth.role() = 'authenticated'
    and (visibility <> 'private' or private_by = auth.uid()::text)
  )
  with check (
    visibility <> 'private'
    or (private_by = auth.uid()::text and created_by = auth.uid()::text)
  );

-- 削除: 見えている行のみ（公開ボードの削除権は従来どおり）
create policy "wb_delete" on whiteboards for delete
  using (
    auth.role() = 'authenticated'
    and (visibility <> 'private' or private_by = auth.uid()::text)
  );

-- ── 適用前の確認（任意） ──
-- created_by が空の行は「作成者」を判定できず、永久にプライベート化できない。
-- 該当があれば運用側で埋める。
--   select id, title, created_by from whiteboards where created_by = '';
