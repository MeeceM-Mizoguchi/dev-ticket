-- Add mention_context column to notifications table
-- Run this in the Supabase SQL Editor
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS mention_context TEXT NOT NULL DEFAULT '';
