-- Visuals made from a Creation studio draft (pictures and diagrams). Safe to run on every deploy.
CREATE TABLE IF NOT EXISTS compilation_visuals (
  id serial PRIMARY KEY,
  compilation_id integer NOT NULL REFERENCES idea_subject_compilations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL DEFAULT '',
  caption text NOT NULL DEFAULT '',
  why text NOT NULL DEFAULT '',
  anchor text NOT NULL DEFAULT '',
  style text NOT NULL DEFAULT '',
  spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ready',
  image_url text,
  error text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS compilation_visuals_compilation_idx ON compilation_visuals (compilation_id);
