ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS human_handoff_notice_sent_at TIMESTAMPTZ NULL;

-- Recover notices already delivered before this idempotency marker existed.
UPDATE conversation_sessions AS session
SET human_handoff_notice_sent_at = (
  SELECT MIN(message.created_at)
  FROM conversation_messages AS message
  WHERE message.mtalk_ticket_id = session.mtalk_ticket_id
    AND message.direction = 'outbound'
    AND LOWER(COALESCE(message.content, '')) LIKE '%encaminhar seu atendimento%'
)
WHERE session.human_handoff_notice_sent_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM conversation_messages AS message
    WHERE message.mtalk_ticket_id = session.mtalk_ticket_id
      AND message.direction = 'outbound'
      AND LOWER(COALESCE(message.content, '')) LIKE '%encaminhar seu atendimento%'
  );
