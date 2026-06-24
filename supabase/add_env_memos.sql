-- Add env_memos column to projects table for storing environment URLs (production, staging, etc.)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS env_memos jsonb DEFAULT '[]'::jsonb;
