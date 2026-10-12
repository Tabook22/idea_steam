-- Ideas can keep formatting (bold, lists, images, alignment) next to their plain text. Safe to run on every deploy.
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS rich_content text;
