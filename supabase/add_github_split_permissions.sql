-- BRU13-054: GitHub権限を操作ごとに分ける
--
-- これまで githubPermission (none/view/merge) 1本で
-- 「閲覧」と「マージ・PR作成」をまとめて表していた。
-- ブランチ作成を足すにあたって、取り返しのつきやすさが操作ごとに違うことが問題になる。
-- ブランチは消せば済むが、main へのマージは戻せない。1本で持っていると
-- 「マージはさせたくないがブランチは切らせたい」人に渡せる権限が無い。
--
-- そこで3つのキーに分ける。値はいずれも none / view / write。
--   githubBranchPermission … ブランチの作成
--   githubPullPermission   … プルリクエストの作成
--   githubMergePermission  … マージ・レビュー承認・コメント投稿
--
-- 「閲覧」は軸ごとに分けない。軸ごとの閲覧ゲートを作ると
-- 「PRは見えるがマージ状況は見えない」という破綻した組み合わせが設定できてしまう。
-- GitHubタブを開けるかどうかは3軸の論理和で判定する（src/app/lib/githubPerms.ts）。
--
-- 旧キー githubPermission は消さずに残し、ここで新キーと同じ内容に保つ。
-- このSQLを当てていない環境のフロント／サーバーが読んでも結論が変わらないようにするため。
--
-- 冪等。既に新キーがある行は触らない。

-- 対応表:
--   merge → 3軸とも write（当時の最上位）
--   view  → 3軸とも view
--   none / 未設定 → 3軸とも none
create or replace function github_split_perms(p jsonb) returns jsonb
language sql immutable as $$
  select case coalesce(p ->> 'githubPermission', 'none')
    when 'merge' then '{"githubBranchPermission":"write","githubPullPermission":"write","githubMergePermission":"write"}'::jsonb
    when 'view'  then '{"githubBranchPermission":"view","githubPullPermission":"view","githubMergePermission":"view"}'::jsonb
    else              '{"githubBranchPermission":"none","githubPullPermission":"none","githubMergePermission":"none"}'::jsonb
  end;
$$;

-- ① 個別のプロジェクト権限
update project_member_permissions
   set permissions = coalesce(permissions, '{}'::jsonb)
                     || github_split_perms(coalesce(permissions, '{}'::jsonb))
 where not (coalesce(permissions, '{}'::jsonb) ? 'githubBranchPermission');

-- ② 権限グループ
update permission_groups
   set permissions = coalesce(permissions, '{}'::jsonb)
                     || github_split_perms(coalesce(permissions, '{}'::jsonb))
 where not (coalesce(permissions, '{}'::jsonb) ? 'githubBranchPermission');

-- ③ ロール既定。GitHubはプロジェクト単位で付与する決まりなので、
--    ここは実質すべて none のまま展開されるだけ（BRU13-034 と同じ考え方）
update roles
   set base_permissions = coalesce(base_permissions, '{}'::jsonb)
                          || github_split_perms(coalesce(base_permissions, '{}'::jsonb))
 where not (coalesce(base_permissions, '{}'::jsonb) ? 'githubBranchPermission');

drop function if exists github_split_perms(jsonb);
