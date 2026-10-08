-- The meeting handwriting notebook. Safe to run on every deploy.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS notebook jsonb;
