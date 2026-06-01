CREATE TABLE ai_prompts (
  id BIGSERIAL PRIMARY KEY,
  prompt_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_prompts_prompt_key_version_unique UNIQUE (prompt_key, version)
);

CREATE UNIQUE INDEX ai_prompts_active_key_unique
  ON ai_prompts (prompt_key)
  WHERE is_active = TRUE;

CREATE TABLE staff_contacts (
  id BIGSERIAL PRIMARY KEY,
  phone_number TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE conversation_sessions
  ADD COLUMN conversation_mode TEXT NOT NULL DEFAULT 'USER';

ALTER TABLE conversation_sessions
  ADD CONSTRAINT conversation_sessions_mode_check CHECK (
    conversation_mode IN ('USER', 'STAFF_FAST_TICKET')
  );

CREATE INDEX staff_contacts_phone_number_idx
  ON staff_contacts (phone_number);

CREATE INDEX conversation_sessions_mode_idx
  ON conversation_sessions (conversation_mode);
