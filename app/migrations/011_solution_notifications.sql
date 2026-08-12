ALTER TABLE conversation_sessions
  ADD COLUMN solution_tracking_started_at TIMESTAMPTZ,
  ADD COLUMN last_solution_check_at TIMESTAMPTZ,
  ADD COLUMN solution_check_started_at TIMESTAMPTZ,
  ADD COLUMN solution_notified_at TIMESTAMPTZ,
  ADD COLUMN glpi_last_status INTEGER;

CREATE INDEX conversation_sessions_solution_pending_idx
  ON conversation_sessions (
    solution_tracking_started_at,
    solution_notified_at,
    last_solution_check_at
  )
  WHERE glpi_ticket_id IS NOT NULL
    AND solution_tracking_started_at IS NOT NULL
    AND solution_notified_at IS NULL;

CREATE INDEX conversation_sessions_solution_check_started_idx
  ON conversation_sessions (solution_check_started_at)
  WHERE solution_check_started_at IS NOT NULL;
