-- Word timings for editing audio by editing its text. Safe to run on every deploy.
ALTER TABLE audio_library ADD COLUMN IF NOT EXISTS words jsonb;
