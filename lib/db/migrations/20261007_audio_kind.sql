-- Library items are recordings or music (uploaded songs used as background music). Safe to run on every deploy.
ALTER TABLE audio_library ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'recording';
