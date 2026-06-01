ALTER TABLE conversation_attachments
  ADD COLUMN glpi_document_id BIGINT,
  ADD COLUMN glpi_uploaded_at TIMESTAMPTZ,
  ADD COLUMN glpi_linked_at TIMESTAMPTZ;

CREATE INDEX conversation_attachments_glpi_document_id_idx
  ON conversation_attachments (glpi_document_id)
  WHERE glpi_document_id IS NOT NULL;

CREATE INDEX conversation_attachments_glpi_linked_at_idx
  ON conversation_attachments (glpi_linked_at)
  WHERE glpi_linked_at IS NOT NULL;
