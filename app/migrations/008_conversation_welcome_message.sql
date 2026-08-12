ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS welcome_sent_at TIMESTAMPTZ NULL;
