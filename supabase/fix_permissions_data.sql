-- ============================================================
-- 権限データの確認と修正
-- Supabase Dashboard → SQL Editor → New query で実行
-- ============================================================

-- 【STEP 1】現在の権限状態を確認
-- このSELECTを実行して、各メンバーのwiki/backlog/minutesPermissionを確認する
SELECT
  proj.name as project_name,
  p.name as member_name,
  p.role as member_role,
  pmp.permissions->>'wikiPermission'    as wiki,
  pmp.permissions->>'backlogPermission' as backlog,
  pmp.permissions->>'minutesPermission' as minutes,
  pmp.permissions->>'canAccessWiki'     as old_wiki_flag,
  pmp.created_at
FROM project_member_permissions pmp
JOIN profiles p    ON p.id = pmp.member_id
JOIN projects proj ON proj.id = pmp.project_id
ORDER BY proj.name, p.name;

-- ============================================================
-- 【STEP 2】古いデータを修正
-- wiki/backlog/minutesPermission が NULL のまま古いフラグだけある行を修正
-- → 全行に wikiPermission: "none" etc. を追加（上書き）
-- ============================================================
UPDATE project_member_permissions
SET permissions = permissions
  || '{"wikiPermission":"none","backlogPermission":"none","minutesPermission":"none"}'::jsonb
WHERE
  -- wikiPermission が未設定の行のみ対象（設定済みの行は触らない）
  NOT (permissions ? 'wikiPermission');

-- 修正後の確認
SELECT
  proj.name as project_name,
  p.name as member_name,
  pmp.permissions->>'wikiPermission'    as wiki,
  pmp.permissions->>'backlogPermission' as backlog,
  pmp.permissions->>'minutesPermission' as minutes
FROM project_member_permissions pmp
JOIN profiles p    ON p.id = pmp.member_id
JOIN projects proj ON proj.id = pmp.project_id
ORDER BY proj.name, p.name;
