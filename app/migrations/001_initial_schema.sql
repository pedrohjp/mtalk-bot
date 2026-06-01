CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE conversation_sessions (
  id BIGSERIAL PRIMARY KEY,
  mtalk_ticket_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'NEW',
  contact_name TEXT,
  contact_number TEXT,
  company_name TEXT,
  problem_summary TEXT,
  problem_details TEXT,
  awaiting_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
  last_message_at TIMESTAMPTZ NOT NULL,
  next_processing_at TIMESTAMPTZ,
  processing_started_at TIMESTAMPTZ,
  last_processed_at TIMESTAMPTZ,
  glpi_ticket_id TEXT,
  glpi_created_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversation_sessions_status_check CHECK (
    status IN (
      'NEW',
      'COLLECTING_COMPANY',
      'COLLECTING_PROBLEM',
      'AWAITING_CONFIRMATION',
      'CREATING_GLPI_TICKET',
      'DONE',
      'HANDOFF_TO_HUMAN',
      'ERROR'
    )
  )
);

CREATE TABLE conversation_messages (
  id BIGSERIAL PRIMARY KEY,
  mtalk_ticket_id TEXT NOT NULL REFERENCES conversation_sessions (mtalk_ticket_id) ON DELETE CASCADE,
  external_message_id TEXT,
  direction TEXT NOT NULL,
  message_type TEXT NOT NULL,
  content TEXT,
  media_url TEXT,
  raw_payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversation_messages_direction_check CHECK (
    direction IN ('inbound', 'outbound')
  ),
  CONSTRAINT conversation_messages_type_check CHECK (
    message_type IN ('text', 'image', 'document', 'audio', 'unknown')
  ),
  CONSTRAINT conversation_messages_external_unique UNIQUE (
    mtalk_ticket_id,
    external_message_id
  )
);

CREATE TABLE conversation_attachments (
  id BIGSERIAL PRIMARY KEY,
  conversation_message_id BIGINT NOT NULL REFERENCES conversation_messages (id) ON DELETE CASCADE,
  mtalk_ticket_id TEXT NOT NULL REFERENCES conversation_sessions (mtalk_ticket_id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  download_status TEXT NOT NULL DEFAULT 'PENDING',
  mime_type TEXT,
  file_name TEXT,
  storage_path TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversation_attachments_download_status_check CHECK (
    download_status IN ('PENDING', 'DOWNLOADED', 'FAILED', 'SKIPPED')
  )
);

CREATE INDEX conversation_sessions_next_processing_idx
  ON conversation_sessions (next_processing_at)
  WHERE next_processing_at IS NOT NULL;

CREATE INDEX conversation_sessions_status_idx
  ON conversation_sessions (status);

CREATE INDEX conversation_messages_ticket_received_idx
  ON conversation_messages (mtalk_ticket_id, received_at);

CREATE INDEX conversation_messages_unprocessed_idx
  ON conversation_messages (processed_at)
  WHERE processed_at IS NULL;

CREATE INDEX conversation_attachments_ticket_idx
  ON conversation_attachments (mtalk_ticket_id);

CREATE TRIGGER conversation_sessions_set_updated_at
BEFORE UPDATE ON conversation_sessions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER conversation_messages_set_updated_at
BEFORE UPDATE ON conversation_messages
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER conversation_attachments_set_updated_at
BEFORE UPDATE ON conversation_attachments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
