-- Meetings: speakers, markers and minutes for a recorded meeting. Safe to run on every deploy.
CREATE TABLE IF NOT EXISTS meetings (
  id serial PRIMARY KEY,
  library_item_id integer NOT NULL UNIQUE,
  title text NOT NULL,
  subject_id integer,
  participants jsonb NOT NULL DEFAULT '[]',
  agenda text NOT NULL DEFAULT '',
  markers jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'processing',
  stage text,
  error text,
  segments jsonb,
  speakers jsonb NOT NULL DEFAULT '{}',
  minutes jsonb,
  idea_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
