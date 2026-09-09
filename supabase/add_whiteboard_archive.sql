-- ============================================================
-- ホワイトボード アーカイブ
--   使い終わったボードを一覧から畳む。削除ではないので中身は残り、いつでも戻せる。
--   Run in: Supabase Dashboard → SQL Editor → New query
--
-- 設計上の要点:
--   ・アーカイブは「片付け」であって節約策ではない。DB の実サイズを減らすのは
--     doc_state の圧縮（src/app/lib/whiteboardCompact.ts）の担当。
--   ・アーカイブ済みでもリンクからは開ける（過去の資料を参照できなくなると困る）。
--     一覧の既定の並びから外れるだけ。
--   ・RLS は add_whiteboard_private.sql / add_whiteboard_shares.sql の wb_update に
--     そのまま乗る（列を足すだけでポリシーの変更は要らない）。
--     ＝公開ボードは編集権のある人が、プライベートボードは作成者だけが畳める。
-- ============================================================

alter table whiteboards
  add column if not exists archived_at timestamptz,               -- null = 現役
  add column if not exists archived_by text not null default '';  -- 畳んだ人 = auth.uid()::text

-- 一覧は「現役だけ」を既定で引くので、その形に合わせた部分インデックスを張る。
create index if not exists idx_whiteboards_active
  on whiteboards(project_id, updated_at desc)
  where archived_at is null;
