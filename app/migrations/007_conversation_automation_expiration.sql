ALTER TABLE conversation_sessions
  ADD COLUMN automation_expired_at TIMESTAMPTZ,
  ADD COLUMN automation_expiration_reason TEXT,
  ADD COLUMN last_expiration_check_at TIMESTAMPTZ,
  ADD COLUMN expiration_started_at TIMESTAMPTZ;

CREATE INDEX conversation_sessions_expiration_pending_idx
  ON conversation_sessions (
    status,
    automation_expired_at,
    last_message_at
  );
