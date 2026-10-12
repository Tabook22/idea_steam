-- Live workshops: sessions people join with a code, their teams, idea cards, reactions and comments. Safe to run on every deploy.
CREATE TABLE IF NOT EXISTS live_sessions (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  challenge text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  team_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS live_participants (
  id serial PRIMARY KEY,
  session_id integer NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  name text NOT NULL,
  emoji text NOT NULL DEFAULT '🙂',
  team integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_participants_session_idx ON live_participants (session_id);
CREATE TABLE IF NOT EXISTS live_cards (
  id serial PRIMARY KEY,
  session_id integer NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  participant_id integer REFERENCES live_participants(id) ON DELETE CASCADE,
  space text NOT NULL DEFAULT 'me',
  team integer,
  text text NOT NULL DEFAULT '',
  media_url text,
  media_type text,
  parent_id integer,
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_cards_session_idx ON live_cards (session_id);
CREATE TABLE IF NOT EXISTS live_reactions (
  card_id integer NOT NULL REFERENCES live_cards(id) ON DELETE CASCADE,
  participant_id integer NOT NULL DEFAULT 0,
  emoji text NOT NULL,
  PRIMARY KEY (card_id, participant_id, emoji)
);
CREATE TABLE IF NOT EXISTS live_comments (
  id serial PRIMARY KEY,
  card_id integer NOT NULL REFERENCES live_cards(id) ON DELETE CASCADE,
  participant_id integer,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_comments_card_idx ON live_comments (card_id);
