-- BRU11-041 タスクに進捗率（%）の列を足す。
--
-- チケット(sprint_tickets.progress)はステータスから自動で決まるが、
-- タスクの進捗率は手入力（0〜100の数字をキーボードで打つ）。
-- ステータスとは連動させない（未着手/進行中/完了の3段階では表せない粒度を
-- 自分で書き込むための列なので、勝手に上書きしない）。
--
-- 実行順:
--   1) このSQLを先に流す（列が無いまま新しい画面を出すと insert が落ちる）
--   2) アプリをデプロイする
--
-- 何度流しても同じ結果になる（列の追加も制約も冪等）。

-- 1) 列の追加。既存行は 0%（未入力）から始める
alter table public.tasks
  add column if not exists progress smallint not null default 0;

-- 2) 0〜100 に収める。画面側でも丸めるが、APIから直接触られても壊れないようにする
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tasks'::regclass
       and conname  = 'tasks_progress_range'
  ) then
    -- 既存行に範囲外があると制約を張れないので、先に丸めておく
    update public.tasks set progress = least(100, greatest(0, progress))
     where progress < 0 or progress > 100;
    alter table public.tasks
      add constraint tasks_progress_range check (progress between 0 and 100);
  end if;
end $$;

comment on column public.tasks.progress is
  '進捗率(0〜100)。手入力。status とは連動しない';

-- RLS は tasks の既存ポリシーがそのまま効くので変更不要。

-- 3) PostgREST に列の追加を知らせる。
--    これを忘れると、列はあるのにアプリ側だけ
--    「Could not find the 'progress' column of 'tasks' in the schema cache」で落ちる
notify pgrst, 'reload schema';
