-- App settings kept on the server (e.g. the Telegram capture bot). Safe to run on every deploy.
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
