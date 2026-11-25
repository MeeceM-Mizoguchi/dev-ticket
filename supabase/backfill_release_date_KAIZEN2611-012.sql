-- KAIZEN2611-012-2 リリース日が空のままクローズになっているチケットに、クローズにした日をリリース日として入れる（データ修正）
--
-- 背景:
--   リリースノートは、リリース日（release_date）が空のチケットを表示しない（2026/06/19 の修正。
--   リリースノートを作る前のクローズを出さないため）。KAIZEN2611-005（API でクローズにしたときリリース日を入れる）が
--   本番に出た 2026/11/18 より前は、API などでクローズにしてもリリース日が入らなかったため、
--   その間にクローズにした親チケットがリリースノートに出ていない。
--
-- 対象（すべてに当たる行）:
--   ・親チケット（parent_id が空）
--   ・status がクローズ（released）
--   ・release_date が空で、is_release_date_undecided が false（未定にしたものは触らない）
--   ・release_not_required が true でない（リリース不要のものは触らない）
--   ・released_at が 2026/06/15（リリースノートを作った日。日本時間）以降
--   ・全プロジェクト
--
-- 入れる値: released_at を日本時間に直した日付（UTC のままだと、日本時間の 0:00〜8:59 にクローズにしたものが前の日になる）。
--
-- テーブル・列の変更は無い（データの更新だけ）。
-- 投入順序: KAIZEN2611-012-1（リリースノートの読み込みの修正）をリリースしたあとに流す。
--
-- release_not_required は KAIZEN2611-006（add_release_not_required.sql）で足した列。
-- その SQL がまだ流れていない DB でも失敗しないよう、to_jsonb(t) ->> 'release_not_required' で読む（列が無ければ false 扱い）。
--
-- ⚠️ 流し方: 上から1つずつ選んで実行し、結果を確かめてから次へ進む。
--   ・手順1の結果（対象の id と WBS）は、切り戻しに使うので保存しておく（CSV など）。
--   ・手順2の件数は、KAIZEN2611-012 のチケットのコメントに記録する。
--   ・手順3で released_at が空の行が1件以上あれば、その行にはリリース日を推測で入れない（手順4の対象にも入らない）。件数を記録して確認する。
--   ・手順3の境目の件数を見て、2026/06/15 を境目にしてよいかを確かめてから、手順4を流す。
--   ・誤ってファイル全体を流しても、最後の手順4の結果に、変えた行の id と WBS が出る（切り戻しに使える）。


-- ------------------------------------------------------------
-- 手順1. 対象の行を書き出す（結果を保存する）
-- ------------------------------------------------------------
select t.id, t.wbs, t.title, p.name as project_name, t.released_at,
       (t.released_at at time zone 'Asia/Tokyo')::date as release_date_to_set
from sprint_tickets t
join sprints s on s.id = t.sprint_id
join projects p on p.id = s.project_id
where t.parent_id is null
  and t.status = 'released'
  and t.release_date is null
  and t.is_release_date_undecided = false
  and coalesce((to_jsonb(t) ->> 'release_not_required')::boolean, false) = false
  and t.released_at >= timestamptz '2026-06-15 00:00:00+09'
order by p.name, t.released_at, t.id;


-- ------------------------------------------------------------
-- 手順2. 対象の件数をプロジェクトごとに数える（チケットのコメントに記録する）
-- ------------------------------------------------------------
select p.name as project_name, count(*) as target_count
from sprint_tickets t
join sprints s on s.id = t.sprint_id
join projects p on p.id = s.project_id
where t.parent_id is null
  and t.status = 'released'
  and t.release_date is null
  and t.is_release_date_undecided = false
  and coalesce((to_jsonb(t) ->> 'release_not_required')::boolean, false) = false
  and t.released_at >= timestamptz '2026-06-15 00:00:00+09'
group by p.name
order by p.name;


-- ------------------------------------------------------------
-- 手順3. 流す前の確認（released_at が空の行と、境目 2026/06/15 の前後の件数）
--   ・released_at_null … released_at が空のクローズの行。リリース日は推測で入れない（この SQL では変えない）
--   ・before_0615      … 2026/06/15 より前にクローズにした行（今と同じく変えない。リリースノートに出ない）
--   ・from_0615        … 2026/06/15 以降にクローズにした行（手順4で変える）
-- ------------------------------------------------------------
select p.name as project_name,
       count(*) filter (where t.released_at is null) as released_at_null,
       count(*) filter (where t.released_at < timestamptz '2026-06-15 00:00:00+09') as before_0615,
       count(*) filter (where t.released_at >= timestamptz '2026-06-15 00:00:00+09') as from_0615
from sprint_tickets t
join sprints s on s.id = t.sprint_id
join projects p on p.id = s.project_id
where t.parent_id is null
  and t.status = 'released'
  and t.release_date is null
  and t.is_release_date_undecided = false
  and coalesce((to_jsonb(t) ->> 'release_not_required')::boolean, false) = false
group by p.name
order by p.name;


-- ------------------------------------------------------------
-- 手順4. リリース日を入れる（結果に、変えた行の id・WBS・入れたリリース日が出る）
-- ------------------------------------------------------------
update sprint_tickets t
set release_date = (t.released_at at time zone 'Asia/Tokyo')::date,
    is_release_date_undecided = false
where t.parent_id is null
  and t.status = 'released'
  and t.release_date is null
  and t.is_release_date_undecided = false
  and coalesce((to_jsonb(t) ->> 'release_not_required')::boolean, false) = false
  and t.released_at >= timestamptz '2026-06-15 00:00:00+09'
returning t.id, t.wbs, t.release_date;


-- ------------------------------------------------------------
-- 手順5. 流したあとの確認（-- を外して実行し、0件であることを確かめる）
-- ------------------------------------------------------------
-- select count(*) as remaining
-- from sprint_tickets t
-- where t.parent_id is null
--   and t.status = 'released'
--   and t.release_date is null
--   and t.is_release_date_undecided = false
--   and coalesce((to_jsonb(t) ->> 'release_not_required')::boolean, false) = false
--   and t.released_at >= timestamptz '2026-06-15 00:00:00+09';


-- ------------------------------------------------------------
-- 切り戻し（必要なときだけ。-- を外し、手順1（または手順4）で保存した id を並べて実行する）
--   手順4で変えた行の release_date を空に戻す。is_release_date_undecided は流す前も false なので戻さない。
-- ------------------------------------------------------------
-- update sprint_tickets
-- set release_date = null
-- where id in ('<手順1で保存した id>', '<…>');
