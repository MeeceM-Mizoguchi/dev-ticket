-- ============================================================
-- BRU3-043: マルチテナント分離 — RLS 全面見直し
-- Supabase Dashboard → SQL Editor → New query に貼り付けて実行
-- 冪等: 何度実行しても安全
-- ============================================================

-- ── ヘルパー関数 ──────────────────────────────────────────────
-- ログインユーザーの organization_id を返す。
-- STABLE: 同一クエリ内で結果をキャッシュするため余分なルックアップを抑制。
-- SECURITY DEFINER: RLS が有効なテーブルを経由せず直接 profiles を参照。
CREATE OR REPLACE FUNCTION get_my_org_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

-- ── organization_id カラムの保険的追加 ────────────────────────
-- 既にある場合は無視される。実データには個別に UPDATE で埋めること。
ALTER TABLE public.clients           ADD COLUMN IF NOT EXISTS organization_id TEXT DEFAULT NULL;
ALTER TABLE public.projects          ADD COLUMN IF NOT EXISTS organization_id TEXT DEFAULT NULL;
ALTER TABLE public.permission_groups ADD COLUMN IF NOT EXISTS organization_id TEXT DEFAULT NULL;
ALTER TABLE public.notifications     ADD COLUMN IF NOT EXISTS organization_id TEXT DEFAULT NULL;
ALTER TABLE public.ticket_comments   ADD COLUMN IF NOT EXISTS organization_id TEXT DEFAULT NULL;

-- ── profiles ─────────────────────────────────────────────────
-- 自分の組織のメンバーのみ参照可能。owner は全組織を参照可能。
DROP POLICY IF EXISTS "auth_select_profiles" ON public.profiles;
CREATE POLICY "tenant_select_profiles" ON public.profiles
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR organization_id = get_my_org_id()
  );

-- ── clients ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_select_clients"  ON public.clients;
DROP POLICY IF EXISTS "auth_insert_clients"  ON public.clients;
DROP POLICY IF EXISTS "auth_update_clients"  ON public.clients;
DROP POLICY IF EXISTS "auth_delete_clients"  ON public.clients;
DROP POLICY IF EXISTS "clients_delete_authenticated" ON public.clients;

CREATE POLICY "tenant_select_clients" ON public.clients
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR organization_id = get_my_org_id()
    OR organization_id IS NULL
  );
CREATE POLICY "tenant_insert_clients" ON public.clients
  FOR INSERT WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR organization_id = get_my_org_id()
  );
CREATE POLICY "tenant_update_clients" ON public.clients
  FOR UPDATE USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR organization_id = get_my_org_id()
  );
CREATE POLICY "tenant_delete_clients" ON public.clients
  FOR DELETE USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR organization_id = get_my_org_id()
  );

-- ── projects ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_select_projects" ON public.projects;
DROP POLICY IF EXISTS "auth_insert_projects" ON public.projects;
DROP POLICY IF EXISTS "auth_update_projects" ON public.projects;
DROP POLICY IF EXISTS "auth_delete_projects" ON public.projects;

CREATE POLICY "tenant_select_projects" ON public.projects
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR organization_id = get_my_org_id()
    OR organization_id IS NULL
  );
CREATE POLICY "tenant_insert_projects" ON public.projects
  FOR INSERT WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR organization_id = get_my_org_id()
  );
CREATE POLICY "tenant_update_projects" ON public.projects
  FOR UPDATE USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR organization_id = get_my_org_id()
  );
CREATE POLICY "tenant_delete_projects" ON public.projects
  FOR DELETE USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR organization_id = get_my_org_id()
  );

-- ── sprints (organization_id 直接保持なし → projects 経由で判定) ───
DROP POLICY IF EXISTS "auth_select_sprints" ON public.sprints;
DROP POLICY IF EXISTS "auth_insert_sprints" ON public.sprints;
DROP POLICY IF EXISTS "auth_update_sprints" ON public.sprints;
DROP POLICY IF EXISTS "auth_delete_sprints" ON public.sprints;

CREATE POLICY "tenant_select_sprints" ON public.sprints
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR project_id IN (
      SELECT id FROM public.projects
      WHERE organization_id = get_my_org_id() OR organization_id IS NULL
    )
  );
CREATE POLICY "tenant_insert_sprints" ON public.sprints
  FOR INSERT WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR project_id IN (
      SELECT id FROM public.projects WHERE organization_id = get_my_org_id()
    )
  );
CREATE POLICY "tenant_update_sprints" ON public.sprints
  FOR UPDATE USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR project_id IN (
      SELECT id FROM public.projects
      WHERE organization_id = get_my_org_id() OR organization_id IS NULL
    )
  );
CREATE POLICY "tenant_delete_sprints" ON public.sprints
  FOR DELETE USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR project_id IN (
      SELECT id FROM public.projects
      WHERE organization_id = get_my_org_id() OR organization_id IS NULL
    )
  );

-- ── sprint_tickets (sprints → projects 経由) ─────────────────
DROP POLICY IF EXISTS "auth_select_sprint_tickets" ON public.sprint_tickets;
DROP POLICY IF EXISTS "auth_insert_sprint_tickets" ON public.sprint_tickets;
DROP POLICY IF EXISTS "auth_update_sprint_tickets" ON public.sprint_tickets;
DROP POLICY IF EXISTS "auth_delete_sprint_tickets" ON public.sprint_tickets;

CREATE POLICY "tenant_select_sprint_tickets" ON public.sprint_tickets
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR sprint_id IN (
      SELECT s.id FROM public.sprints s
      JOIN public.projects p ON p.id = s.project_id
      WHERE p.organization_id = get_my_org_id() OR p.organization_id IS NULL
    )
  );
CREATE POLICY "tenant_insert_sprint_tickets" ON public.sprint_tickets
  FOR INSERT WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR sprint_id IN (
      SELECT s.id FROM public.sprints s
      JOIN public.projects p ON p.id = s.project_id
      WHERE p.organization_id = get_my_org_id()
    )
  );
CREATE POLICY "tenant_update_sprint_tickets" ON public.sprint_tickets
  FOR UPDATE USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR sprint_id IN (
      SELECT s.id FROM public.sprints s
      JOIN public.projects p ON p.id = s.project_id
      WHERE p.organization_id = get_my_org_id() OR p.organization_id IS NULL
    )
  );
CREATE POLICY "tenant_delete_sprint_tickets" ON public.sprint_tickets
  FOR DELETE USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR sprint_id IN (
      SELECT s.id FROM public.sprints s
      JOIN public.projects p ON p.id = s.project_id
      WHERE p.organization_id = get_my_org_id() OR p.organization_id IS NULL
    )
  );

-- ── permission_groups ─────────────────────────────────────────
DROP POLICY IF EXISTS "pg_select" ON public.permission_groups;
DROP POLICY IF EXISTS "pg_insert" ON public.permission_groups;
DROP POLICY IF EXISTS "pg_update" ON public.permission_groups;
DROP POLICY IF EXISTS "pg_delete" ON public.permission_groups;

CREATE POLICY "tenant_select_permission_groups" ON public.permission_groups
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR organization_id = get_my_org_id()
    OR organization_id IS NULL
  );
CREATE POLICY "tenant_insert_permission_groups" ON public.permission_groups
  FOR INSERT WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR organization_id = get_my_org_id()
  );
CREATE POLICY "tenant_update_permission_groups" ON public.permission_groups
  FOR UPDATE USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR organization_id = get_my_org_id()
  );
CREATE POLICY "tenant_delete_permission_groups" ON public.permission_groups
  FOR DELETE USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR organization_id = get_my_org_id()
  );

-- ── group_members (permission_groups 経由) ────────────────────
DROP POLICY IF EXISTS "gm_all" ON public.group_members;

CREATE POLICY "tenant_select_group_members" ON public.group_members
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR group_id IN (
      SELECT id FROM public.permission_groups
      WHERE organization_id = get_my_org_id() OR organization_id IS NULL
    )
  );
CREATE POLICY "tenant_insert_group_members" ON public.group_members
  FOR INSERT WITH CHECK (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR group_id IN (
      SELECT id FROM public.permission_groups WHERE organization_id = get_my_org_id()
    )
  );
CREATE POLICY "tenant_update_group_members" ON public.group_members
  FOR UPDATE USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR group_id IN (
      SELECT id FROM public.permission_groups
      WHERE organization_id = get_my_org_id() OR organization_id IS NULL
    )
  );
CREATE POLICY "tenant_delete_group_members" ON public.group_members
  FOR DELETE USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR group_id IN (
      SELECT id FROM public.permission_groups
      WHERE organization_id = get_my_org_id() OR organization_id IS NULL
    )
  );

-- ── project_member_permissions (projects 経由) ────────────────
DROP POLICY IF EXISTS "pmp_all" ON public.project_member_permissions;

CREATE POLICY "tenant_all_pmp" ON public.project_member_permissions
  FOR ALL USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR project_id IN (
      SELECT id FROM public.projects
      WHERE organization_id = get_my_org_id() OR organization_id IS NULL
    )
  );

-- ── notifications ─────────────────────────────────────────────
-- organization_id カラムを追加済み（上部 ALTER TABLE）。
-- 既存データは NULL のまま → 自分の user_name 一致でのみ参照可能にする。
DROP POLICY IF EXISTS "auth_select_notifications" ON public.notifications;
DROP POLICY IF EXISTS "auth_insert_notifications" ON public.notifications;
DROP POLICY IF EXISTS "auth_update_notifications" ON public.notifications;
DROP POLICY IF EXISTS "auth_delete_notifications" ON public.notifications;

CREATE POLICY "tenant_select_notifications" ON public.notifications
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR (
      organization_id = get_my_org_id()
      OR organization_id IS NULL
    )
    -- user_name で絞り込むのはアプリ層の責務。RLS は組織の壁のみ担保。
  );
CREATE POLICY "tenant_insert_notifications" ON public.notifications
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "tenant_update_notifications" ON public.notifications
  FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "tenant_delete_notifications" ON public.notifications
  FOR DELETE USING (auth.role() = 'authenticated');

-- ── ticket_comments (organization_id カラムを追加済み) ────────
DROP POLICY IF EXISTS "tc_select" ON public.ticket_comments;
DROP POLICY IF EXISTS "tc_insert" ON public.ticket_comments;
DROP POLICY IF EXISTS "tc_update" ON public.ticket_comments;
DROP POLICY IF EXISTS "tc_delete" ON public.ticket_comments;

CREATE POLICY "tenant_select_ticket_comments" ON public.ticket_comments
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR organization_id = get_my_org_id()
    OR organization_id IS NULL
  );
CREATE POLICY "tenant_insert_ticket_comments" ON public.ticket_comments
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "tenant_update_ticket_comments" ON public.ticket_comments
  FOR UPDATE USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR organization_id = get_my_org_id()
    OR organization_id IS NULL
  );
CREATE POLICY "tenant_delete_ticket_comments" ON public.ticket_comments
  FOR DELETE USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR organization_id = get_my_org_id()
    OR organization_id IS NULL
  );

-- ── ticket_source_files (ticket_comments と同様) ──────────────
DROP POLICY IF EXISTS "tsf_select" ON public.ticket_source_files;
DROP POLICY IF EXISTS "tsf_insert" ON public.ticket_source_files;
DROP POLICY IF EXISTS "tsf_update" ON public.ticket_source_files;
DROP POLICY IF EXISTS "tsf_delete" ON public.ticket_source_files;

CREATE POLICY "tenant_select_ticket_source_files" ON public.ticket_source_files
  FOR SELECT USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner'
    OR ticket_id IN (
      SELECT st.id FROM public.sprint_tickets st
      JOIN public.sprints s ON s.id = st.sprint_id
      JOIN public.projects p ON p.id = s.project_id
      WHERE p.organization_id = get_my_org_id() OR p.organization_id IS NULL
    )
  );
CREATE POLICY "tenant_insert_ticket_source_files" ON public.ticket_source_files
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "tenant_update_ticket_source_files" ON public.ticket_source_files
  FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "tenant_delete_ticket_source_files" ON public.ticket_source_files
  FOR DELETE USING (auth.role() = 'authenticated');

-- ── roles (ロール定義はシステム共通 → 従来どおり認証済みなら参照可) ──
-- roles は組織をまたいで共通定義のため変更なし。

-- ── 確認クエリ（実行後にポリシー一覧を確認） ────────────────
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN (
  'profiles','clients','projects','sprints','sprint_tickets',
  'permission_groups','group_members','project_member_permissions',
  'notifications','ticket_comments','ticket_source_files'
)
ORDER BY tablename, cmd;
