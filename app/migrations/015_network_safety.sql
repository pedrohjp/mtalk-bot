ALTER TABLE conversation_attachments
  ADD COLUMN IF NOT EXISTS sync_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sync_attempt_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS sync_abandoned_at TIMESTAMPTZ NULL;

ALTER TABLE conversation_attachments
  DROP CONSTRAINT IF EXISTS conversation_attachments_sync_attempts_check;

ALTER TABLE conversation_attachments
  ADD CONSTRAINT conversation_attachments_sync_attempts_check
  CHECK (sync_attempts >= 0);

CREATE INDEX IF NOT EXISTS conversation_attachments_sync_pending_idx
  ON conversation_attachments (mtalk_ticket_id, sync_attempts)
  WHERE glpi_linked_at IS NULL
    AND sync_abandoned_at IS NULL;
