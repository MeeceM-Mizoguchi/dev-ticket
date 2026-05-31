-- パスワード設定済み（ログイン済み）にもかかわらず招待中のままのメンバーのステータスを修正
UPDATE public.profiles
SET status = 'active'
WHERE status = 'invited'
  AND id IN (
    SELECT id
    FROM auth.users
    WHERE last_sign_in_at IS NOT NULL
  );
