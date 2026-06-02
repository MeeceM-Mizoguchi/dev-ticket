-- 子チケット機能: parent_id カラム追加
-- sprint_tickets.id は TEXT 型のため parent_id も TEXT 型で定義する
-- 現在は1階層（親→子）のみサポート。将来的に孫チケット（depth カラムによる多階層管理）を実装予定。
ALTER TABLE sprint_tickets
  ADD COLUMN IF NOT EXISTS parent_id TEXT REFERENCES sprint_tickets(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_sprint_tickets_parent_id ON sprint_tickets(parent_id);
