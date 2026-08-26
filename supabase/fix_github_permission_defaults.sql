-- BRU13-034 GitHub権限が「権限なし」表示のままマージできてしまう件の既存データ補正
-- Supabase Dashboard → SQL Editor で実行してください（何度流しても安全）。
--
-- GitHub連携(add_github_integration.sql)を入れる前から存在していた権限レコードには
-- githubPermission キーそのものが入っていない。キーが無い＝未設定として扱われ、
-- グループ → ロール既定 の順にフォールバックしていたため、
-- アサイン計画のモーダルには「権限なし」と出ているのに PR が見えてマージもできる、
-- という食い違いが起きていた（保存ボタンを一度押すとキーが入って直る、という症状）。
--
-- コード側では admin / project-manager への暗黙の merge を廃止済み。
-- こちらは残っている既存レコードを「明示的に none」にして、画面の表示と一致させる。

-- ① 個別のプロジェクト権限
update project_member_permissions
   set permissions = coalesce(permissions, '{}'::jsonb) || '{"githubPermission":"none"}'::jsonb
 where not (coalesce(permissions, '{}'::jsonb) ? 'githubPermission');

-- ② 権限グループ
update permission_groups
   set permissions = coalesce(permissions, '{}'::jsonb) || '{"githubPermission":"none"}'::jsonb
 where not (coalesce(permissions, '{}'::jsonb) ? 'githubPermission');

-- ③ ロール既定。GitHub権限の付与はアサイン計画の画面だけで行う決まりなので、
--    ロールを根拠に配ってしまわないよう none を明示しておく。
--    （個別に「このロールは常にマージ可」にしたい場合は、ここを手で書き換える）
update roles
   set base_permissions = coalesce(base_permissions, '{}'::jsonb) || '{"githubPermission":"none"}'::jsonb
 where not (coalesce(base_permissions, '{}'::jsonb) ? 'githubPermission');

-- 確認用
-- select count(*) filter (where permissions->>'githubPermission' = 'none')  as none,
--        count(*) filter (where permissions->>'githubPermission' = 'view')  as view,
--        count(*) filter (where permissions->>'githubPermission' = 'merge') as merge
--   from project_member_permissions;
