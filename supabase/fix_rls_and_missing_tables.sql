-- ============================================================
-- このファイルをSupabaseダッシュボードのSQL Editorで実行してください
-- https://supabase.com/dashboard → SQL Editor → New query
-- ============================================================

-- ------------------------------------------------------------
-- 1. permission_groups テーブルを作成（先に作成する必要あり）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permission_groups (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  permissions JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE permission_groups ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='permission_groups' AND policyname='pg_select') THEN
    CREATE POLICY "pg_select" ON permission_groups FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='permission_groups' AND policyname='pg_insert') THEN
    CREATE POLICY "pg_insert" ON permission_groups FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='permission_groups' AND policyname='pg_update') THEN
    CREATE POLICY "pg_update" ON permission_groups FOR UPDATE USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='permission_groups' AND policyname='pg_delete') THEN
    CREATE POLICY "pg_delete" ON permission_groups FOR DELETE USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. profiles テーブルに不足カラムを追加
-- ------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS permission_group_id INTEGER REFERENCES permission_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS permissions JSONB;

-- ------------------------------------------------------------
-- 3. roles テーブルを作成（未作成の場合）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE,
  label            TEXT NOT NULL,
  base_permissions JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='roles' AND policyname='roles_select') THEN
    CREATE POLICY "roles_select" ON roles FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='roles' AND policyname='roles_insert') THEN
    CREATE POLICY "roles_insert" ON roles FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='roles' AND policyname='roles_update') THEN
    CREATE POLICY "roles_update" ON roles FOR UPDATE USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='roles' AND policyname='roles_delete') THEN
    CREATE POLICY "roles_delete" ON roles FOR DELETE USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- デフォルトロールを seed（既に存在する場合はスキップ）
INSERT INTO roles (name, label, base_permissions) VALUES
  ('admin',           '管理者',                    '{"canCreateTicket":true,"canCreateSprint":true,"canEditDelete":true,"canReview":true,"canGeneratePrompt":true}'),
  ('project-manager', 'プロジェクトマネージャー',  '{"canCreateTicket":true,"canCreateSprint":true,"canEditDelete":true,"canReview":true,"canGeneratePrompt":true}'),
  ('developer',       '開発者',                    '{"canCreateTicket":true,"canCreateSprint":false,"canEditDelete":false,"canReview":false,"canGeneratePrompt":true}'),
  ('designer',        'デザイナー',                '{"canCreateTicket":true,"canCreateSprint":false,"canEditDelete":false,"canReview":false,"canGeneratePrompt":false}')
ON CONFLICT (name) DO NOTHING;

-- ------------------------------------------------------------
-- 4. project_member_permissions テーブルを作成（未作成の場合）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_member_permissions (
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  permissions JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, member_id)
);

ALTER TABLE project_member_permissions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='project_member_permissions' AND policyname='pmp_all') THEN
    CREATE POLICY "pmp_all" ON project_member_permissions FOR ALL USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- ------------------------------------------------------------
-- 5. profiles の INSERT ポリシーを追加（招待ユーザー対応）
-- ------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='profiles_insert_own') THEN
    CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 6. auth.users に存在するが profiles がないユーザーを修復
--    ※ トリガー設置前に作成されたユーザーへの対応
-- ------------------------------------------------------------
INSERT INTO public.profiles (id, name, email, role, group_name, status)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'name', SPLIT_PART(u.email, '@', 1)),
  u.email,
  COALESCE(u.raw_user_meta_data->>'role', 'developer'),
  COALESCE(u.raw_user_meta_data->>'group_name', ''),
  'active'
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;
