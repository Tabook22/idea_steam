-- Key takeaways of an idea (made by AI on request, kept until the idea changes). Safe to run on every deploy.
CREATE TABLE IF NOT EXISTS idea_takeaways (
  idea_id integer PRIMARY KEY REFERENCES ideas(id) ON DELETE CASCADE,
  source_hash text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
