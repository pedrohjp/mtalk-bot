ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS clarification_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE conversation_sessions
  ADD CONSTRAINT conversation_sessions_clarification_attempts_check
  CHECK (clarification_attempts >= 0);
