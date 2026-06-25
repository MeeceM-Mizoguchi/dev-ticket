-- Add tags column to projects table for storing project attribute tags (e.g. 重要顧客)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
