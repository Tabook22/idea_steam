-- Workshops step 2: guided phases with a timer, dot voting, and the AI's themes. Safe to run on every deploy.
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'free';
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS phase_ends_at timestamptz;
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS votes_per_person integer NOT NULL DEFAULT 3;
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS synthesis jsonb;
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS synthesis_at timestamptz;
CREATE TABLE IF NOT EXISTS live_votes (
  card_id integer NOT NULL REFERENCES live_cards(id) ON DELETE CASCADE,
  participant_id integer NOT NULL REFERENCES live_participants(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, participant_id)
);
