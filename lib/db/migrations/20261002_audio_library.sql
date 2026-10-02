-- Audio library: an independent list of every recording. Safe to run on every deploy.
BEGIN;
CREATE TABLE IF NOT EXISTS audio_library (
  id serial PRIMARY KEY,
  url text NOT NULL UNIQUE,
  title text,
  mime_type text,
  duration_seconds integer,
  transcript text,
  source_idea_id integer,
  source_subject_title text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audio_library_captured_at_idx ON audio_library (captured_at);

-- One-time copy of recordings made before the library existed. Recorded in
-- schema_migrations so items you later delete from the library are never re-added.
CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
INSERT INTO audio_library (url, mime_type, transcript, source_idea_id, source_subject_title, captured_at)
SELECT DISTINCT ON (item->>'url')
  item->>'url', item->>'mimeType', NULLIF(item->>'transcript', ''), ideas.id, idea_subjects.title, ideas.created_at
FROM ideas
JOIN idea_subjects ON idea_subjects.id = ideas.subject_id
CROSS JOIN LATERAL jsonb_array_elements(ideas.attachments) AS item
WHERE ideas.source = 'voice'
  AND item->>'type' = 'audio'
  AND coalesce(item->>'url', '') <> ''
  AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '20261002_audio_library_backfill')
ORDER BY item->>'url', ideas.created_at
ON CONFLICT (url) DO NOTHING;
INSERT INTO schema_migrations (name) VALUES ('20261002_audio_library_backfill') ON CONFLICT DO NOTHING;
COMMIT;
