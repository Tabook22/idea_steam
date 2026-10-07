-- Idea Connections: one weekly digest per week. Safe to run on every deploy.
CREATE TABLE IF NOT EXISTS weekly_digests (
  week text PRIMARY KEY,
  language text NOT NULL DEFAULT 'en',
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
