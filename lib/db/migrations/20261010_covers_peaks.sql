-- Notebook covers (colour and emoji) and stored mini waveforms. Safe to run on every deploy.
ALTER TABLE idea_subjects ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE idea_subjects ADD COLUMN IF NOT EXISTS icon text;
ALTER TABLE audio_library ADD COLUMN IF NOT EXISTS peaks jsonb;
