ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS expiration_notice_sent_at TIMESTAMPTZ NULL;
