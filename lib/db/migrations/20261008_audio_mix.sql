-- Background music as a removable layer: the voice-only audio and the music settings. Safe to run on every deploy.
ALTER TABLE audio_library ADD COLUMN IF NOT EXISTS mix jsonb;
