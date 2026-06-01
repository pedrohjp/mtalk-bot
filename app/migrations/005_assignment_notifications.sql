ALTER TABLE conversation_sessions
  ADD COLUMN assigned_glpi_user_id BIGINT,
  ADD COLUMN assigned_glpi_user_name TEXT,
  ADD COLUMN last_assignment_check_at TIMESTAMPTZ,
  ADD COLUMN assignment_check_started_at TIMESTAMPTZ,
  ADD COLUMN assignment_notified_at TIMESTAMPTZ;

CREATE INDEX conversation_sessions_assignment_pending_idx
  ON conversation_sessions (glpi_ticket_id, assignment_notified_at)
  WHERE glpi_ticket_id IS NOT NULL
    AND assignment_notified_at IS NULL;

CREATE INDEX conversation_sessions_assignment_check_started_idx
  ON conversation_sessions (assignment_check_started_at)
  WHERE assignment_check_started_at IS NOT NULL;
