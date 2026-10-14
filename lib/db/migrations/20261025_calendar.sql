-- Calendar: scheduled meetings and events with places and reminders; places on recorded meetings;
-- phones that get reminder notifications; task reminders. Safe to run on every deploy.
CREATE TABLE IF NOT EXISTS events (
  id serial PRIMARY KEY,
  kind text NOT NULL DEFAULT 'meeting',
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  location jsonb,
  subject_id integer,
  participants jsonb NOT NULL DEFAULT '[]'::jsonb,
  agenda text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  reminders jsonb NOT NULL DEFAULT '[30]'::jsonb,
  reminded jsonb NOT NULL DEFAULT '[]'::jsonb,
  meeting_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_starts_idx ON events (starts_at);
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS location jsonb;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS event_id integer;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint text PRIMARY KEY,
  keys jsonb NOT NULL,
  device text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
