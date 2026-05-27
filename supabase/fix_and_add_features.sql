-- ============================================================
-- このファイルをSupabaseダッシュボードのSQL Editorで実行してください
-- https://supabase.com/dashboard → SQL Editor → New query
-- ============================================================

-- ------------------------------------------------------------
-- 1. クライアント削除バグ修正: DELETE RLSポリシーを追加
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'clients' AND policyname = 'clients_delete_authenticated'
  ) THEN
    CREATE POLICY "clients_delete_authenticated" ON clients
    FOR DELETE USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. sprint_ticketsに新しい列を追加
-- ------------------------------------------------------------
ALTER TABLE sprint_tickets
  ADD COLUMN IF NOT EXISTS description     TEXT,
  ADD COLUMN IF NOT EXISTS reviewer_name  TEXT,
  ADD COLUMN IF NOT EXISTS review_round   INTEGER DEFAULT 0;

-- ------------------------------------------------------------
-- 3. チケットコメントテーブル
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_comments (
  id            TEXT PRIMARY KEY,
  ticket_id     TEXT NOT NULL,
  user_name     TEXT NOT NULL,
  content       TEXT NOT NULL,
  ticket_status TEXT NOT NULL DEFAULT 'todo',
  comment_type  TEXT NOT NULL DEFAULT 'comment',
  images        JSONB DEFAULT '[]',
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 既存テーブルへの追加（既に作成済みの場合）
ALTER TABLE ticket_comments ADD COLUMN IF NOT EXISTS comment_type TEXT NOT NULL DEFAULT 'comment';

ALTER TABLE ticket_comments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ticket_comments' AND policyname='tc_select') THEN
    CREATE POLICY "tc_select" ON ticket_comments FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ticket_comments' AND policyname='tc_insert') THEN
    CREATE POLICY "tc_insert" ON ticket_comments FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ticket_comments' AND policyname='tc_delete') THEN
    CREATE POLICY "tc_delete" ON ticket_comments FOR DELETE USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. ソースファイルテーブル
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_source_files (
  id            TEXT PRIMARY KEY,
  ticket_id     TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  file_size     INTEGER DEFAULT 0,
  file_type     TEXT DEFAULT '',
  uploaded_by   TEXT NOT NULL,
  review_round  INTEGER DEFAULT 1,
  file_url      TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ticket_source_files ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ticket_source_files' AND policyname='tsf_select') THEN
    CREATE POLICY "tsf_select" ON ticket_source_files FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ticket_source_files' AND policyname='tsf_insert') THEN
    CREATE POLICY "tsf_insert" ON ticket_source_files FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ticket_source_files' AND policyname='tsf_delete') THEN
    CREATE POLICY "tsf_delete" ON ticket_source_files FOR DELETE USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- ------------------------------------------------------------
-- 5. Supabase Storage バケット作成 (ticket-files)
--    ※ ダッシュボード > Storage > New bucket > ticket-files
--    　 Public bucket: ON で作成してください
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 6. sprint_ticketsのstatusチェック制約を更新（in-review等を追加）
--    元の制約は ('todo','in-progress','done') のみで保存が失敗していた
-- ------------------------------------------------------------
ALTER TABLE sprint_tickets DROP CONSTRAINT IF EXISTS sprint_tickets_status_check;
ALTER TABLE sprint_tickets ADD CONSTRAINT sprint_tickets_status_check
  CHECK (status IN ('todo','in-progress','in-review','review-done','stg-test','uat','done','closed'));

-- ------------------------------------------------------------
-- 7. sprint_ticketsにassignees列を追加（複数担当者対応）
-- ------------------------------------------------------------
ALTER TABLE sprint_tickets ADD COLUMN IF NOT EXISTS assignees TEXT[] DEFAULT '{}';

-- ------------------------------------------------------------
-- 8. handle_new_userトリガー更新
--    招待受諾時にprofileのstatusをinvited→activeに更新する
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, role, group_name, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', SPLIT_PART(NEW.email,'@',1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'developer'),
    COALESCE(NEW.raw_user_meta_data->>'group_name', ''),
    'active'
  )
  ON CONFLICT (id) DO UPDATE SET
    status = 'active',
    name = COALESCE(EXCLUDED.name, profiles.name),
    email = EXCLUDED.email;
  RETURN NEW;
END;
$$;
