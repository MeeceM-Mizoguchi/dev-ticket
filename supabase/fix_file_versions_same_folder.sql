-- ============================================================
-- ファイルボックス：同じファイルの版を同じフォルダに揃える
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- ファイルの引き当てキーを (project_id, file_name) から (project_id, parent_id, file_name) に変えた。
-- 以前は別フォルダに同名のファイルがあるだけで、アップロードや改名に「(1)」が付いていたため。
-- （api/project-files/[action].ts の inFolder のコメント参照）
--
-- ところが以前の WebDAV 保存（Excel/Word で Ctrl+S）は新しい版に parent_id を入れておらず、
-- 「古い版はフォルダの中、新しい版だけルート直下」という行が残っている可能性がある。
-- 名前だけで版を束ねていた頃は、最新版の場所に1つだけ見えていたので気づかれなかったが、
-- フォルダも見るようになると、同じファイルが2か所に分かれて見えてしまう。
--
-- そこで、通常のファイル（フォルダ・Googleファイル以外）の全版を、最新版と同じフォルダへ揃える。
-- ＝これまで画面に見えていた場所に揃えるだけなので、見た目は変わらない。
--
-- これまで通常のファイルの名前はプロジェクト内で一意だった（同名＝同じファイルの版）ので、
-- (project_id, file_name) で束ねて問題ない。何度流しても結果は同じ。

update project_files p
set parent_id = latest.parent_id
from (
  select distinct on (project_id, file_name)
    project_id, file_name, parent_id
  from project_files
  where coalesce(is_folder, false) = false
    and external_provider is null
  order by project_id, file_name, version desc, created_at desc, id desc
) latest
where p.project_id = latest.project_id
  and p.file_name = latest.file_name
  and coalesce(p.is_folder, false) = false
  and p.external_provider is null
  and p.parent_id is distinct from latest.parent_id;
