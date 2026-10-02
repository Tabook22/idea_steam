-- Recordings made straight into the audio library (no idea in any subject).
-- The capture ID makes upload retries idempotent. Safe to run on every deploy.
ALTER TABLE audio_library ADD COLUMN IF NOT EXISTS client_capture_id text;
CREATE UNIQUE INDEX IF NOT EXISTS audio_library_client_capture_id_unique ON audio_library (client_capture_id);
