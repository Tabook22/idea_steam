-- Edited library recordings remember their original audio so it can be restored.
-- Safe to run on every deploy.
ALTER TABLE audio_library ADD COLUMN IF NOT EXISTS original_url text;
