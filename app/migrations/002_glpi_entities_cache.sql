CREATE TABLE glpi_entities_cache (
  glpi_entity_id BIGINT PRIMARY KEY,
  full_name_raw TEXT NOT NULL,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE conversation_sessions
  ADD COLUMN glpi_entity_id BIGINT,
  ADD COLUMN glpi_entity_name TEXT,
  ADD COLUMN company_identification_status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN company_lookup_attempted_at TIMESTAMPTZ;

ALTER TABLE conversation_sessions
  ADD CONSTRAINT conversation_sessions_company_identification_status_check CHECK (
    company_identification_status IN ('PENDING', 'IDENTIFIED', 'NOT_IDENTIFIED')
  );

CREATE INDEX glpi_entities_cache_normalized_name_idx
  ON glpi_entities_cache (normalized_name);

CREATE INDEX conversation_sessions_glpi_entity_id_idx
  ON conversation_sessions (glpi_entity_id);

CREATE INDEX conversation_sessions_company_identification_status_idx
  ON conversation_sessions (company_identification_status);

CREATE TRIGGER glpi_entities_cache_set_updated_at
BEFORE UPDATE ON glpi_entities_cache
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
