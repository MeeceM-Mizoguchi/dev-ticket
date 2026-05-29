-- ============================================================
-- 診断 & 修復SQL
-- Supabase Dashboard → SQL Editor → New query で実行
-- ============================================================

-- ① profilesテーブルの中身を確認
SELECT id, name, email, role, status FROM profiles;

-- ② auth.usersにいるがprofileがないユーザーを確認
SELECT u.id, u.email, u.raw_user_meta_data
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

-- ③ projectsテーブルへのRLSポリシーを確認
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'projects';

-- ④ profileがないユーザーを直接作成（②で行が出た場合に実行）
INSERT INTO public.profiles (id, name, email, role, group_name, status)
SELECT
  u.id,
  COALESCE(NULLIF(u.raw_user_meta_data->>'name', ''), SPLIT_PART(u.email, '@', 1)),
  u.email,
  COALESCE(NULLIF(u.raw_user_meta_data->>'role', ''), 'admin'),
  COALESCE(u.raw_user_meta_data->>'group_name', ''),
  'active'
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO UPDATE SET
  name  = EXCLUDED.name,
  email = EXCLUDED.email,
  status = 'active';

-- ⑤ 実行後にprofileが作られたか確認
SELECT id, name, email, role FROM profiles;
