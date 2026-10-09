-- Earlier versions of each visual (to go back after a retouch or redraw). Safe to run on every deploy.
ALTER TABLE compilation_visuals ADD COLUMN IF NOT EXISTS history jsonb NOT NULL DEFAULT '[]'::jsonb;
