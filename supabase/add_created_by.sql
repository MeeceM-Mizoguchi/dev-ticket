-- sprint_tickets に created_by カラムを追加
ALTER TABLE sprint_tickets
  ADD COLUMN IF NOT EXISTS created_by TEXT;
