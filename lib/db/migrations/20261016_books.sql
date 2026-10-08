-- Handwriting books for subjects, recordings, or on their own. Safe to run on every deploy.
CREATE TABLE IF NOT EXISTS books (
  id serial PRIMARY KEY,
  title text NOT NULL,
  subject_id integer,
  library_item_id integer,
  cover text NOT NULL DEFAULT 'ocean',
  doc jsonb,
  idea_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS books_subject_idx ON books (subject_id);
CREATE INDEX IF NOT EXISTS books_item_idx ON books (library_item_id);
