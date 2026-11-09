-- ============================================================
-- BRU25-002: コメントの「確認済み」チェック
--
-- Supabase Dashboard → SQL Editor → New query に貼り付けて実行。
-- 冪等: 何度実行しても安全。
--
-- 内容:
--   1. ticket_comments.resolved_at / resolved_by … null = 未確認
--   2. 既存のコメント（comment_type = comment）をすべて確認済みにする
--      ※ 列を初めて追加したときの1回だけ。2回目以降の実行で、新しい未確認のコメントを確認済みにしないため
--   3. 一覧の件数取得用の部分インデックス
--
-- 投入順序: 本番の DB にこの SQL を流してから、コードをマージする。
-- （コードは列が無くても壊れない作り。列が無い間は未確認の表示を出さない）
--
-- RLS: ticket_comments の UPDATE は、組織・プロジェクトのメンバーなら誰でもできる
-- （fix_multitenant_rls.sql の tenant_update_ticket_comments と
--   fix_project_level_rls_BRU14-001.sql の dt_rls_ticket_comments_scope）。
-- コメントを書いた本人以外もチェックできるので、権限の変更は無い。
-- ============================================================

do $do$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'ticket_comments' and column_name = 'resolved_at'
  ) then
    alter table public.ticket_comments add column resolved_at timestamptz;
    alter table public.ticket_comments add column if not exists resolved_by text;

    -- 既存のコメントは、すべて確認済みとして扱う
    update public.ticket_comments
       set resolved_at = now(),
           resolved_by = '（既存のコメント）'
     where comment_type = 'comment';
  end if;
end
$do$;

alter table public.ticket_comments add column if not exists resolved_by text;

-- スプリント一覧で、未確認のコメントの件数をチケットごとに数える
create index if not exists idx_ticket_comments_unresolved
  on public.ticket_comments (ticket_id)
  where resolved_at is null and comment_type = 'comment';
