-- パフォーマンス改善: インデックス確認・追加
-- add_child_tickets.sql で定義済みだが、未適用の場合はこちらを実行してください
-- Supabase Dashboard → SQL Editor → New query で実行

-- 子チケット取得 (WHERE parent_id = ?) を高速化
CREATE INDEX IF NOT EXISTS idx_sprint_tickets_parent_id ON sprint_tickets(parent_id);

-- チケット一覧取得 (WHERE sprint_id = ?) を高速化（大量チケット時）
CREATE INDEX IF NOT EXISTS idx_sprint_tickets_sprint_id ON sprint_tickets(sprint_id);

-- コメント取得 (WHERE ticket_id = ?) を高速化
CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket_id ON ticket_comments(ticket_id);

-- ソースファイル取得 (WHERE ticket_id = ?) を高速化
CREATE INDEX IF NOT EXISTS idx_ticket_source_files_ticket_id ON ticket_source_files(ticket_id);
