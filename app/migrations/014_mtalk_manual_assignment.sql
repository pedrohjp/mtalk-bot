ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS mtalk_manual_assignment_detected_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS mtalk_manual_assignment_user_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_manual_assignment_check_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS manual_assignment_check_started_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS conversation_sessions_manual_assignment_idx
  ON conversation_sessions (last_manual_assignment_check_at, last_message_at)
  WHERE mtalk_manual_assignment_detected_at IS NULL
    AND status NOT IN ('DONE', 'HANDOFF_TO_HUMAN', 'ERROR');
