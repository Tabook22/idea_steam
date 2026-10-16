-- The shared board: where each note sits and its paper colour. Safe to run on every deploy.
ALTER TABLE live_cards ADD COLUMN IF NOT EXISTS board_x real;
ALTER TABLE live_cards ADD COLUMN IF NOT EXISTS board_y real;
ALTER TABLE live_cards ADD COLUMN IF NOT EXISTS color text;
