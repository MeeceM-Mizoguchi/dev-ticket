-- ============================================================
-- Dev Ticket — 完全修復SQL
-- Supabase Dashboard → SQL Editor → New query に貼り付けて実行
-- ※ 全て冪等（何度実行しても安全）
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. 不足テーブルの作成
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS permission_groups (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  permissions JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE,
  label            TEXT NOT NULL,
  base_permissions JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_member_permissions (
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  member_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  permissions JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, member_id)
);

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

-- ────────────────────────────────────────────────────────────
-- 2. 不足カラムの追加
-- ────────────────────────────────────────────────────────────

-- projects: group_ids
ALTER TABLE projects ADD COLUMN IF NOT EXISTS group_ids INTEGER[] DEFAULT '{}';

-- profiles: permission_group_id, permissions
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS permission_group_id INTEGER REFERENCES permission_groups(id) ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS permissions JSONB;

-- sprint_tickets: 追加カラム
ALTER TABLE sprint_tickets ADD COLUMN IF NOT EXISTS description      TEXT;
ALTER TABLE sprint_tickets ADD COLUMN IF NOT EXISTS reviewer_name   TEXT;
ALTER TABLE sprint_tickets ADD COLUMN IF NOT EXISTS review_round    INTEGER DEFAULT 0;
ALTER TABLE sprint_tickets ADD COLUMN IF NOT EXISTS assignees       TEXT[] DEFAULT '{}';
ALTER TABLE sprint_tickets ADD COLUMN IF NOT EXISTS generated_prompt TEXT;
ALTER TABLE sprint_tickets ADD COLUMN IF NOT EXISTS images          JSONB DEFAULT '[]';

-- ticket_comments: comment_type（既存テーブルに不足の場合）
ALTER TABLE ticket_comments ADD COLUMN IF NOT EXISTS comment_type TEXT NOT NULL DEFAULT 'comment';

-- ────────────────────────────────────────────────────────────
-- 3. 制約の修正
-- ────────────────────────────────────────────────────────────

-- sprint_tickets.status: in-review / review-done / stg-test / uat / closed を追加
ALTER TABLE sprint_tickets DROP CONSTRAINT IF EXISTS sprint_tickets_status_check;
ALTER TABLE sprint_tickets ADD CONSTRAINT sprint_tickets_status_check
  CHECK (status IN ('todo','in-progress','in-review','review-done','stg-test','uat','done','closed'));

-- ────────────────────────────────────────────────────────────
-- 4. RLS 有効化
-- ────────────────────────────────────────────────────────────

ALTER TABLE permission_groups          ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_member_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_comments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_source_files        ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────
-- 5. RLS ポリシーを DROP → CREATE で確実に適用
-- ────────────────────────────────────────────────────────────

-- profiles
DROP POLICY IF EXISTS "auth_select_profiles"    ON profiles;
DROP POLICY IF EXISTS "auth_update_profiles"    ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own"     ON profiles;
CREATE POLICY "auth_select_profiles"  ON profiles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_update_profiles"  ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own"   ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- projects
DROP POLICY IF EXISTS "auth_select_projects" ON projects;
DROP POLICY IF EXISTS "auth_insert_projects" ON projects;
DROP POLICY IF EXISTS "auth_update_projects" ON projects;
DROP POLICY IF EXISTS "auth_delete_projects" ON projects;
CREATE POLICY "auth_select_projects" ON projects FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_insert_projects" ON projects FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_update_projects" ON projects FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "auth_delete_projects" ON projects FOR DELETE USING (auth.role() = 'authenticated');

-- sprints
DROP POLICY IF EXISTS "auth_select_sprints" ON sprints;
DROP POLICY IF EXISTS "auth_insert_sprints" ON sprints;
DROP POLICY IF EXISTS "auth_update_sprints" ON sprints;
DROP POLICY IF EXISTS "auth_delete_sprints" ON sprints;
CREATE POLICY "auth_select_sprints" ON sprints FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_insert_sprints" ON sprints FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_update_sprints" ON sprints FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "auth_delete_sprints" ON sprints FOR DELETE USING (auth.role() = 'authenticated');

-- sprint_tickets
DROP POLICY IF EXISTS "auth_select_sprint_tickets" ON sprint_tickets;
DROP POLICY IF EXISTS "auth_insert_sprint_tickets" ON sprint_tickets;
DROP POLICY IF EXISTS "auth_update_sprint_tickets" ON sprint_tickets;
DROP POLICY IF EXISTS "auth_delete_sprint_tickets" ON sprint_tickets;
CREATE POLICY "auth_select_sprint_tickets" ON sprint_tickets FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_insert_sprint_tickets" ON sprint_tickets FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_update_sprint_tickets" ON sprint_tickets FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "auth_delete_sprint_tickets" ON sprint_tickets FOR DELETE USING (auth.role() = 'authenticated');

-- clients
DROP POLICY IF EXISTS "auth_select_clients" ON clients;
DROP POLICY IF EXISTS "auth_insert_clients" ON clients;
DROP POLICY IF EXISTS "auth_update_clients" ON clients;
DROP POLICY IF EXISTS "auth_delete_clients" ON clients;
DROP POLICY IF EXISTS "clients_delete_authenticated" ON clients;
CREATE POLICY "auth_select_clients" ON clients FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth_insert_clients" ON clients FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_update_clients" ON clients FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "auth_delete_clients" ON clients FOR DELETE USING (auth.role() = 'authenticated');

-- ticket_comments
DROP POLICY IF EXISTS "tc_select" ON ticket_comments;
DROP POLICY IF EXISTS "tc_insert" ON ticket_comments;
DROP POLICY IF EXISTS "tc_update" ON ticket_comments;
DROP POLICY IF EXISTS "tc_delete" ON ticket_comments;
CREATE POLICY "tc_select" ON ticket_comments FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "tc_insert" ON ticket_comments FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "tc_update" ON ticket_comments FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "tc_delete" ON ticket_comments FOR DELETE USING (auth.role() = 'authenticated');

-- ticket_source_files
DROP POLICY IF EXISTS "tsf_select" ON ticket_source_files;
DROP POLICY IF EXISTS "tsf_insert" ON ticket_source_files;
DROP POLICY IF EXISTS "tsf_update" ON ticket_source_files;
DROP POLICY IF EXISTS "tsf_delete" ON ticket_source_files;
CREATE POLICY "tsf_select" ON ticket_source_files FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "tsf_insert" ON ticket_source_files FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "tsf_update" ON ticket_source_files FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "tsf_delete" ON ticket_source_files FOR DELETE USING (auth.role() = 'authenticated');

-- permission_groups
DROP POLICY IF EXISTS "pg_select" ON permission_groups;
DROP POLICY IF EXISTS "pg_insert" ON permission_groups;
DROP POLICY IF EXISTS "pg_update" ON permission_groups;
DROP POLICY IF EXISTS "pg_delete" ON permission_groups;
CREATE POLICY "pg_select" ON permission_groups FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "pg_insert" ON permission_groups FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "pg_update" ON permission_groups FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "pg_delete" ON permission_groups FOR DELETE USING (auth.role() = 'authenticated');

-- roles
DROP POLICY IF EXISTS "roles_select" ON roles;
DROP POLICY IF EXISTS "roles_insert" ON roles;
DROP POLICY IF EXISTS "roles_update" ON roles;
DROP POLICY IF EXISTS "roles_delete" ON roles;
CREATE POLICY "roles_select" ON roles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "roles_insert" ON roles FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "roles_update" ON roles FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "roles_delete" ON roles FOR DELETE USING (auth.role() = 'authenticated');

-- project_member_permissions
DROP POLICY IF EXISTS "pmp_all" ON project_member_permissions;
CREATE POLICY "pmp_all" ON project_member_permissions FOR ALL USING (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────
-- 6. デフォルトデータ
-- ────────────────────────────────────────────────────────────

INSERT INTO roles (name, label, base_permissions) VALUES
  ('admin',           '管理者',                   '{"canCreateTicket":true,"canCreateSprint":true,"canEditDelete":true,"canReview":true,"canGeneratePrompt":true,"canAccessMembers":true,"canAccessRoles":true,"canAccessGroups":true}'),
  ('project-manager', 'プロジェクトマネージャー', '{"canCreateTicket":true,"canCreateSprint":true,"canEditDelete":true,"canReview":true,"canGeneratePrompt":true,"canAccessMembers":true,"canAccessRoles":false,"canAccessGroups":true}'),
  ('developer',       '開発者',                   '{"canCreateTicket":true,"canCreateSprint":false,"canEditDelete":false,"canReview":false,"canGeneratePrompt":true,"canAccessMembers":false,"canAccessRoles":false,"canAccessGroups":false}'),
  ('designer',        'デザイナー',               '{"canCreateTicket":true,"canCreateSprint":false,"canEditDelete":false,"canReview":false,"canGeneratePrompt":false,"canAccessMembers":false,"canAccessRoles":false,"canAccessGroups":false}')
ON CONFLICT (name) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 7. profile 修復（auth.users に存在するが profiles がないユーザー）
-- ────────────────────────────────────────────────────────────

INSERT INTO public.profiles (id, name, email, role, group_name, status)
SELECT
  u.id,
  COALESCE(NULLIF(u.raw_user_meta_data->>'name', ''), SPLIT_PART(u.email, '@', 1)),
  u.email,
  'admin',
  '',
  'active'
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 8. Storage バケット設定（public = true で公開読み取りを有効化）
-- ※ storage.objects へのポリシーは Supabase Dashboard の
--   Storage → Policies から設定すること（SQL Editor では権限不足）
-- ────────────────────────────────────────────────────────────

-- ticket-files バケット（ソースファイル用）を public に設定
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('ticket-files', 'ticket-files', true, 52428800)
ON CONFLICT (id) DO UPDATE SET public = true;

-- ticket-images バケット（チケット・コメント画像用）を public で作成
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ticket-images', 'ticket-images', true, 10485760,
  ARRAY['image/jpeg','image/png','image/gif','image/webp','image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET public = true;

-- ────────────────────────────────────────────────────────────
-- 9. 確認クエリ（実行結果で全ポリシーが揃っているか確認）
-- ────────────────────────────────────────────────────────────

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN (
  'profiles','projects','sprints','sprint_tickets',
  'clients','ticket_comments','ticket_source_files',
  'permission_groups','roles','project_member_permissions'
)
ORDER BY tablename, cmd;
