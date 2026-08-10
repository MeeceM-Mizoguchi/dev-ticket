-- ENHA2-032 タスクの分類を「1つの自由入力」から「複数の要素」へ広げる。
--
-- これまで tasks.category（text）に1つだけ入っていたものを tasks.categories（text[]）にする。
-- 画面では入力するたびに過去の分類が候補に出て、選べば同じ要素が付く（表記ゆれを増やさない）。
--
-- 実行順:
--   1) このSQLを先に流す（列が無いまま新しい画面を出すと insert が落ちる）
--   2) アプリをデプロイする
--
-- 何度流しても同じ結果になる（列の追加・埋め戻し・索引すべて冪等）。

-- 1) 列の追加
alter table public.tasks
  add column if not exists categories text[] not null default '{}';

-- 2) 既存の単一分類を配列へ移す。空文字は入れない（＝未分類のまま）
update public.tasks
   set categories = array[category]
 where categories = '{}'
   and coalesce(category, '') <> '';

-- 3) 旧列は消さずに残す（万一の突き合わせ用）。今後アプリは読み書きしない
comment on column public.tasks.category is
  '【旧】単一の分類。categories(text[]) へ移行済み。アプリからは読み書きしない';
comment on column public.tasks.categories is
  '分類の要素。自由入力＋過去の値をサジェスト。チケットの ticket_categories とは別物';

-- 4) 分類での絞り込み・候補集計のための索引
create index if not exists tasks_categories_idx
  on public.tasks using gin (categories);

-- RLS は tasks の既存ポリシーがそのまま効くので変更不要。

-- 5) PostgREST に列の追加を知らせる。
--    これを忘れると、列はあるのにアプリ側だけ
--    「Could not find the 'categories' column of 'tasks' in the schema cache」で落ちる
notify pgrst, 'reload schema';
