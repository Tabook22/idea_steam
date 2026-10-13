-- Study packs: notes, key terms, a concept map, a quiz and flashcards made from a recording, notebook or draft. Safe to run on every deploy.
CREATE TABLE IF NOT EXISTS study_packs (
  id serial PRIMARY KEY,
  source_kind text NOT NULL,
  source_id integer NOT NULL,
  title text NOT NULL,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'making',
  error text,
  data jsonb,
  reviews jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS study_packs_source_idx ON study_packs (source_kind, source_id);
