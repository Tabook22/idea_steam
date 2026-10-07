-- Voice to Action: tasks found in recordings or added by hand. Safe to run on every deploy.
CREATE TABLE IF NOT EXISTS tasks (
  id serial PRIMARY KEY,
  text text NOT NULL,
  due text,
  time text,
  person text,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  source text NOT NULL DEFAULT 'manual',
  source_id integer,
  at real,
  quote text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_source_idx ON tasks (source, source_id);
ALTER TABLE audio_library ADD COLUMN IF NOT EXISTS tasks_scanned_for text;
