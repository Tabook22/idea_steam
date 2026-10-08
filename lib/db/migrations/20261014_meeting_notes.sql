-- The meeting notepad (notes, photos, documents, drawings). Safe to run on every deploy.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS notes jsonb NOT NULL DEFAULT '[]';
