-- "Ask your library" index (passages with embeddings). Safe to run on every deploy.
CREATE TABLE IF NOT EXISTS ask_passages (
  id serial PRIMARY KEY,
  source text NOT NULL,
  source_id integer NOT NULL,
  part integer NOT NULL,
  hash text NOT NULL,
  start real,
  header text NOT NULL,
  text text NOT NULL,
  embedding real[],
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ask_passages_source_part_idx ON ask_passages (source, source_id, part);
