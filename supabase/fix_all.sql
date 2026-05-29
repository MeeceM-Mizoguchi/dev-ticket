-- ============================================================
-- Supabase Dashboard → SQL Editor → New query で実行してください
-- これ1本で全部直します
-- ============================================================

-- ① 全テーブルの SELECT ポリシーを確実に作成
DO $$ BEGIN
  -- profiles
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='auth_select_profiles') THEN
    CREATE POLICY "auth_select_profiles" ON profiles FOR SELECT USING (auth.role()='authenticated');
  END IF;
  -- projects
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='projects' AND policyname='auth_select_projects') THEN
    CREATE POLICY "auth_select_projects" ON projects FOR SELECT USING (auth.role()='authenticated');
  END IF;
  -- sprints
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sprints' AND policyname='auth_select_sprints') THEN
    CREATE POLICY "auth_select_sprints" ON sprints FOR SELECT USING (auth.role()='authenticated');
  END IF;
  -- sprint_tickets
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sprint_tickets' AND policyname='auth_select_sprint_tickets') THEN
    CREATE POLICY "auth_select_sprint_tickets" ON sprint_tickets FOR SELECT USING (auth.role()='authenticated');
  END IF;
  -- clients
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='clients' AND policyname='auth_select_clients') THEN
    CREATE POLICY "auth_select_clients" ON clients FOR SELECT USING (auth.role()='authenticated');
  END IF;
  -- ticket_comments
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ticket_comments' AND policyname='tc_select') THEN
    CREATE POLICY "tc_select" ON ticket_comments FOR SELECT USING (auth.role()='authenticated');
  END IF;
  -- ticket_source_files
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ticket_source_files' AND policyname='tsf_select') THEN
    CREATE POLICY "tsf_select" ON ticket_source_files FOR SELECT USING (auth.role()='authenticated');
  END IF;
END $$;

-- ② profile が存在しないユーザーを作成
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

-- ③ 名前が空のprofileを email prefix で更新
UPDATE public.profiles
SET
  name = SPLIT_PART(email, '@', 1),
  role = 'admin'
WHERE (name IS NULL OR name = '')
  AND email IS NOT NULL;

-- ④ INSERT ポリシー追加（欠落していた場合に追加）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sprints' AND policyname='auth_insert_sprints') THEN
    CREATE POLICY "auth_insert_sprints" ON sprints FOR INSERT WITH CHECK (auth.role()='authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sprints' AND policyname='auth_update_sprints') THEN
    CREATE POLICY "auth_update_sprints" ON sprints FOR UPDATE USING (auth.role()='authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sprint_tickets' AND policyname='auth_insert_sprint_tickets') THEN
    CREATE POLICY "auth_insert_sprint_tickets" ON sprint_tickets FOR INSERT WITH CHECK (auth.role()='authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sprint_tickets' AND policyname='auth_update_sprint_tickets') THEN
    CREATE POLICY "auth_update_sprint_tickets" ON sprint_tickets FOR UPDATE USING (auth.role()='authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='projects' AND policyname='auth_insert_projects') THEN
    CREATE POLICY "auth_insert_projects" ON projects FOR INSERT WITH CHECK (auth.role()='authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='projects' AND policyname='auth_update_projects') THEN
    CREATE POLICY "auth_update_projects" ON projects FOR UPDATE USING (auth.role()='authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='clients' AND policyname='auth_insert_clients') THEN
    CREATE POLICY "auth_insert_clients" ON clients FOR INSERT WITH CHECK (auth.role()='authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='clients' AND policyname='auth_update_clients') THEN
    CREATE POLICY "auth_update_clients" ON clients FOR UPDATE USING (auth.role()='authenticated');
  END IF;
END $$;

-- ⑤ DELETE ポリシー追加（sprints / projects / clients が不足していた）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sprints' AND policyname='auth_delete_sprints') THEN
    CREATE POLICY "auth_delete_sprints" ON sprints FOR DELETE USING (auth.role()='authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='projects' AND policyname='auth_delete_projects') THEN
    CREATE POLICY "auth_delete_projects" ON projects FOR DELETE USING (auth.role()='authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='clients' AND policyname='auth_delete_clients') THEN
    CREATE POLICY "auth_delete_clients" ON clients FOR DELETE USING (auth.role()='authenticated');
  END IF;
END $$;

-- ⑤ 確認（実行後にこの結果を見てください）
SELECT id, name, email, role, status FROM profiles;
