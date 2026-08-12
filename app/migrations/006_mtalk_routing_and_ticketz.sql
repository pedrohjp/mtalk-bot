CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS mtalk_closed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS human_handoff_transferred_at TIMESTAMPTZ NULL;
