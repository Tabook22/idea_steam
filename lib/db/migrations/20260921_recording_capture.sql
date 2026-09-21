-- Apply to the intended database before deploying the recording sync API.
-- Nullable: existing ideas and ordinary text captures are unaffected.
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS client_capture_id text;
CREATE UNIQUE INDEX IF NOT EXISTS ideas_client_capture_id_unique
  ON ideas (client_capture_id);
