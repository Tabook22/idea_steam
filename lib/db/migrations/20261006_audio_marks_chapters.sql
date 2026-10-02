-- Bookmarks tapped while recording, and AI chapters with a summary. Safe to run on every deploy.
ALTER TABLE audio_library ADD COLUMN IF NOT EXISTS marks jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE audio_library ADD COLUMN IF NOT EXISTS original_marks jsonb;
ALTER TABLE audio_library ADD COLUMN IF NOT EXISTS chapters jsonb;
ALTER TABLE audio_library ADD COLUMN IF NOT EXISTS summary text;
