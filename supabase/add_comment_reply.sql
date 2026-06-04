-- Add reply_to column to ticket_comments for comment reply threading
-- reply_to references the parent comment; NULL means top-level comment
ALTER TABLE ticket_comments ADD COLUMN IF NOT EXISTS reply_to TEXT REFERENCES ticket_comments(id) ON DELETE SET NULL;
