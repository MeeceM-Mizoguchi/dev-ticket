-- ============================================================
-- アサイン計画対応マイグレーション
-- group_members (多対多) テーブルを追加し、
-- 既存 profiles.permission_group_id データを移行する
-- Supabase Dashboard → SQL Editor に貼り付けて実行
-- 冪等: 何度実行しても安全
-- ============================================================

-- 1. group_members テーブル作成
--    メンバーは複数グループに所属可能（多対多）
CREATE TABLE IF NOT EXISTS group_members (
  group_id   INTEGER  NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE,
  member_id  UUID     NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, member_id)
);

-- 2. RLS 有効化
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;

-- 3. RLS ポリシー
DROP POLICY IF EXISTS "group_members_all" ON group_members;
CREATE POLICY "group_members_all" ON group_members
  FOR ALL USING (true) WITH CHECK (true);

-- 4. 既存データ移行: profiles.permission_group_id → group_members
--    既存の単一グループ紐付けを多対多テーブルに移行
INSERT INTO group_members (group_id, member_id)
SELECT permission_group_id, id
FROM profiles
WHERE permission_group_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 5. インデックス（パフォーマンス用）
CREATE INDEX IF NOT EXISTS idx_group_members_group_id  ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_member_id ON group_members(member_id);
