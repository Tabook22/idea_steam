-- Workshop Pulse: when each reaction and vote happened, for the live activity screen. Safe to run on every deploy.
ALTER TABLE live_reactions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE live_votes ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
