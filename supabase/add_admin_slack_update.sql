-- ============================================================
-- admin が他メンバーの slack_member_id を更新できるよう RLS を拡張
-- 背景: 設定画面廃止に伴い、Slack メンバー ID の登録を
--       通知管理画面（admin-settings）に集約する
-- ※ 冪等（何度実行しても安全）
-- ============================================================

-- ── 1. profiles UPDATE ポリシーを差し替え ────────────────────
--
-- 変更前: 本人のみ更新可
-- 変更後: 本人 OR admin ロールのユーザーが更新可
--
-- USING    … 対象行を特定する条件（どの行を操作できるか）
-- WITH CHECK … 書き込み後の値の検証（不正なロール昇格などを防ぐ）

DROP POLICY IF EXISTS "auth_update_profiles" ON profiles;

CREATE POLICY "auth_update_profiles" ON profiles
  FOR UPDATE
  USING (
    -- 本人
    auth.uid() = id
    OR
    -- admin ロールのユーザー
    (
      SELECT role FROM profiles
      WHERE id = auth.uid()
    ) = 'admin'
  )
  WITH CHECK (
    auth.uid() = id
    OR
    (
      SELECT role FROM profiles
      WHERE id = auth.uid()
    ) = 'admin'
  );


-- ── 2. 確認クエリ（実行後に結果を目視確認してください）────────
--
-- 以下を SQL Editor で実行すると、ポリシーが正しく登録されているか確認できます:
--
-- SELECT policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE tablename = 'profiles' AND policyname = 'auth_update_profiles';
--
-- 期待結果:
--   policyname           | auth_update_profiles
--   cmd                  | UPDATE
--   qual                 | (auth.uid() = id OR (...) = 'admin')
--   with_check           | (同上)
-- ============================================================
