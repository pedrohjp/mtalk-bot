ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS company_prompt_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE conversation_sessions
  ADD CONSTRAINT conversation_sessions_company_prompt_attempts_check
  CHECK (company_prompt_attempts >= 0);
