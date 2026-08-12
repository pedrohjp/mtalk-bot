import { PoolClient } from 'pg'
import { env } from '../../config/env'
import { withDbTransaction } from '../../database/db'
import { CompanyIdentificationStatus } from '../glpi/glpi.types'
import {
  ConversationMode,
  ConversationStatus,
  MessageDirection
} from './conversation.types'
import { NormalizedMtalkMessage } from '../mtalk/mtalk.types'

type InsertConversationMessageRow = {
  id: string
}

type ConversationIngestResult = {
  conversationSessionCreated: boolean
  messageStored: boolean
  messageId: number | null
  attachmentStored: boolean
  nextProcessingAt: Date | null
}

type ClaimedConversationSessionRow = {
  mtalk_ticket_id: string
  status: ConversationStatus
  conversation_mode: ConversationMode
  contact_name: string | null
  contact_number: string | null
  company_name: string | null
  welcome_sent_at: Date | null
  mtalk_closed_at: Date | null
  human_handoff_transferred_at: Date | null
  automation_expired_at: Date | null
  automation_expiration_reason: string | null
  glpi_ticket_id: string | null
  glpi_created_at: Date | null
  assigned_glpi_user_id: string | null
  assigned_glpi_user_name: string | null
  last_expiration_check_at: Date | null
  expiration_started_at: Date | null
  expiration_notice_sent_at: Date | null
  last_assignment_check_at: Date | null
  assignment_check_started_at: Date | null
  assignment_notified_at: Date | null
  glpi_entity_id: string | null
  glpi_entity_name: string | null
  company_identification_status: CompanyIdentificationStatus
  company_lookup_attempted_at: Date | null
  problem_details: string | null
  problem_summary: string | null
  clarification_attempts: number
  company_prompt_attempts: number
  awaiting_confirmation: boolean
  last_message_at: Date
  next_processing_at: Date | null
  processing_started_at: Date | null
}

type PendingConversationMessageRow = {
  id: string
  mtalk_ticket_id: string
  external_message_id: string | null
  direction: MessageDirection
  message_type: string
  content: string | null
  media_url: string | null
  received_at: Date
}

type PendingConversationAttachmentRow = {
  id: string
  conversation_message_id: string
  mtalk_ticket_id: string
  media_url: string
  download_status: string
  mime_type: string | null
  file_name: string | null
  last_error: string | null
  glpi_document_id: string | null
  glpi_uploaded_at: Date | null
  glpi_linked_at: Date | null
}

export type ClaimedConversationSession = {
  mtalkTicketId: string
  status: ConversationStatus
  conversationMode: ConversationMode
  contactName: string | null
  contactNumber: string | null
  companyName: string | null
  welcomeSentAt: Date | null
  mtalkClosedAt: Date | null
  humanHandoffTransferredAt: Date | null
  automationExpiredAt: Date | null
  automationExpirationReason: string | null
  glpiTicketId: number | null
  glpiCreatedAt: Date | null
  assignedGlpiUserId: number | null
  assignedGlpiUserName: string | null
  lastExpirationCheckAt: Date | null
  expirationStartedAt: Date | null
  expirationNoticeSentAt: Date | null
  lastAssignmentCheckAt: Date | null
  assignmentCheckStartedAt: Date | null
  assignmentNotifiedAt: Date | null
  glpiEntityId: number | null
  glpiEntityName: string | null
  companyIdentificationStatus: CompanyIdentificationStatus
  companyLookupAttemptedAt: Date | null
  problemDetails: string | null
  problemSummary: string | null
  clarificationAttempts: number
  companyPromptAttempts: number
  awaitingConfirmation: boolean
  lastMessageAt: Date
  nextProcessingAt: Date | null
  processingStartedAt: Date
}

export type ConversationSolutionCheckSession = {
  mtalkTicketId: string
  contactNumber: string | null
  glpiTicketId: number
  solutionCheckStartedAt: Date
}

export type PendingConversationMessage = {
  id: number
  mtalkTicketId: string
  externalMessageId: string | null
  direction: MessageDirection
  messageType: string
  content: string | null
  mediaUrl: string | null
  receivedAt: Date
}

export type PendingConversationAttachment = {
  id: number
  conversationMessageId: number
  mtalkTicketId: string
  mediaUrl: string
  downloadStatus: string
  mimeType: string | null
  fileName: string | null
  lastError: string | null
  glpiDocumentId: number | null
  glpiUploadedAt: Date | null
  glpiLinkedAt: Date | null
}

function buildNextProcessingAt(receivedAt: Date): Date {
  return new Date(
    receivedAt.getTime() + env.messageDebounceSeconds * 1000
  )
}

async function ensureConversationSession(
  client: PoolClient,
  message: NormalizedMtalkMessage,
  nextProcessingAt: Date,
  conversationMode: ConversationMode
) {
  const result = await client.query(
    `
      INSERT INTO conversation_sessions (
        mtalk_ticket_id,
        status,
        conversation_mode,
        contact_name,
        contact_number,
        last_message_at,
        next_processing_at
      )
      VALUES ($1, 'NEW', $2, $3, $4, $5, $6)
      ON CONFLICT (mtalk_ticket_id) DO NOTHING
      RETURNING id
    `,
    [
      message.mtalkTicketId,
      conversationMode,
      message.contactName,
      message.contactNumber,
      message.receivedAt,
      nextProcessingAt
    ]
  )

  return (result.rowCount ?? 0) > 0
}

async function insertConversationMessage(
  client: PoolClient,
  message: NormalizedMtalkMessage,
  direction: MessageDirection
) {
  const result = await client.query<InsertConversationMessageRow>(
    `
      INSERT INTO conversation_messages (
        mtalk_ticket_id,
        external_message_id,
        direction,
        message_type,
        content,
        media_url,
        raw_payload,
        received_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      ON CONFLICT (mtalk_ticket_id, external_message_id) DO NOTHING
      RETURNING id
    `,
    [
      message.mtalkTicketId,
      message.externalMessageId,
      direction,
      message.messageType,
      message.content,
      message.mediaUrl,
      JSON.stringify(message.rawPayload),
      message.receivedAt
    ]
  )

  if (result.rowCount === 0) {
    return null
  }

  return Number(result.rows[0].id)
}

async function updateConversationSessionAfterInboundMessage(
  client: PoolClient,
  message: NormalizedMtalkMessage,
  nextProcessingAt: Date,
  conversationMode: ConversationMode
) {
  await client.query(
    `
      UPDATE conversation_sessions
      SET
        conversation_mode = CASE
          WHEN conversation_mode = 'STAFF_FAST_TICKET' THEN conversation_mode
          ELSE $2
        END,
        contact_name = COALESCE($3, contact_name),
        contact_number = COALESCE($4, contact_number),
        last_message_at = GREATEST(last_message_at, $5),
        next_processing_at = $6
      WHERE mtalk_ticket_id = $1
    `,
    [
      message.mtalkTicketId,
      conversationMode,
      message.contactName,
      message.contactNumber,
      message.receivedAt,
      nextProcessingAt
    ]
  )
}

async function insertConversationAttachment(
  client: PoolClient,
  mtalkTicketId: string,
  conversationMessageId: number,
  mediaUrl: string
) {
  const result = await client.query(
    `
      INSERT INTO conversation_attachments (
        conversation_message_id,
        mtalk_ticket_id,
        media_url
      )
      VALUES ($1, $2, $3)
      RETURNING id
    `,
    [conversationMessageId, mtalkTicketId, mediaUrl]
  )

  return (result.rowCount ?? 0) > 0
}

export async function persistInboundConversationMessage(
  message: NormalizedMtalkMessage,
  conversationMode: ConversationMode
): Promise<ConversationIngestResult> {
  const nextProcessingAt = buildNextProcessingAt(message.receivedAt)

  return withDbTransaction(async (client) => {
    const conversationSessionCreated = await ensureConversationSession(
      client,
      message,
      nextProcessingAt,
      conversationMode
    )

    const messageId = await insertConversationMessage(client, message, 'inbound')

    if (!messageId) {
      return {
        conversationSessionCreated,
        messageStored: false,
        messageId: null,
        attachmentStored: false,
        nextProcessingAt: null
      }
    }

    await updateConversationSessionAfterInboundMessage(
      client,
      message,
      nextProcessingAt,
      conversationMode
    )

    const attachmentStored = message.mediaUrl
      ? await insertConversationAttachment(
          client,
          message.mtalkTicketId,
          messageId,
          message.mediaUrl
        )
      : false

    return {
      conversationSessionCreated,
      messageStored: true,
      messageId,
      attachmentStored,
      nextProcessingAt
    }
  })
}

function mapClaimedConversationSession(
  row: ClaimedConversationSessionRow
): ClaimedConversationSession {
  if (!row.processing_started_at) {
    throw new Error('Claimed conversation session is missing processing_started_at')
  }

  return {
    mtalkTicketId: row.mtalk_ticket_id,
    status: row.status,
    conversationMode: row.conversation_mode,
    contactName: row.contact_name,
    contactNumber: row.contact_number,
    companyName: row.company_name,
    welcomeSentAt: row.welcome_sent_at,
    mtalkClosedAt: row.mtalk_closed_at,
    humanHandoffTransferredAt: row.human_handoff_transferred_at,
    automationExpiredAt: row.automation_expired_at,
    automationExpirationReason: row.automation_expiration_reason,
    glpiTicketId: row.glpi_ticket_id ? Number(row.glpi_ticket_id) : null,
    glpiCreatedAt: row.glpi_created_at,
    assignedGlpiUserId: row.assigned_glpi_user_id
      ? Number(row.assigned_glpi_user_id)
      : null,
    assignedGlpiUserName: row.assigned_glpi_user_name,
    lastExpirationCheckAt: row.last_expiration_check_at,
    expirationStartedAt: row.expiration_started_at,
    expirationNoticeSentAt: row.expiration_notice_sent_at,
    lastAssignmentCheckAt: row.last_assignment_check_at,
    assignmentCheckStartedAt: row.assignment_check_started_at,
    assignmentNotifiedAt: row.assignment_notified_at,
    glpiEntityId: row.glpi_entity_id ? Number(row.glpi_entity_id) : null,
    glpiEntityName: row.glpi_entity_name,
    companyIdentificationStatus: row.company_identification_status,
    companyLookupAttemptedAt: row.company_lookup_attempted_at,
    problemDetails: row.problem_details,
    problemSummary: row.problem_summary,
    clarificationAttempts: row.clarification_attempts,
    companyPromptAttempts: row.company_prompt_attempts,
    awaitingConfirmation: row.awaiting_confirmation,
    lastMessageAt: row.last_message_at,
    nextProcessingAt: row.next_processing_at,
    processingStartedAt: row.processing_started_at
  }
}

function mapAssignmentCheckConversationSession(
  row: ClaimedConversationSessionRow
): ClaimedConversationSession {
  return {
    mtalkTicketId: row.mtalk_ticket_id,
    status: row.status,
    conversationMode: row.conversation_mode,
    contactName: row.contact_name,
    contactNumber: row.contact_number,
    companyName: row.company_name,
    welcomeSentAt: row.welcome_sent_at,
    mtalkClosedAt: row.mtalk_closed_at,
    humanHandoffTransferredAt: row.human_handoff_transferred_at,
    automationExpiredAt: row.automation_expired_at,
    automationExpirationReason: row.automation_expiration_reason,
    glpiTicketId: row.glpi_ticket_id ? Number(row.glpi_ticket_id) : null,
    glpiCreatedAt: row.glpi_created_at,
    assignedGlpiUserId: row.assigned_glpi_user_id
      ? Number(row.assigned_glpi_user_id)
      : null,
    assignedGlpiUserName: row.assigned_glpi_user_name,
    lastExpirationCheckAt: row.last_expiration_check_at,
    expirationStartedAt: row.expiration_started_at,
    expirationNoticeSentAt: row.expiration_notice_sent_at,
    lastAssignmentCheckAt: row.last_assignment_check_at,
    assignmentCheckStartedAt: row.assignment_check_started_at,
    assignmentNotifiedAt: row.assignment_notified_at,
    glpiEntityId: row.glpi_entity_id ? Number(row.glpi_entity_id) : null,
    glpiEntityName: row.glpi_entity_name,
    companyIdentificationStatus: row.company_identification_status,
    companyLookupAttemptedAt: row.company_lookup_attempted_at,
    problemDetails: row.problem_details,
    problemSummary: row.problem_summary,
    clarificationAttempts: row.clarification_attempts,
    companyPromptAttempts: row.company_prompt_attempts,
    awaitingConfirmation: row.awaiting_confirmation,
    lastMessageAt: row.last_message_at,
    nextProcessingAt: row.next_processing_at,
    processingStartedAt: row.processing_started_at ?? new Date(0)
  }
}

function mapPendingConversationMessage(
  row: PendingConversationMessageRow
): PendingConversationMessage {
  return {
    id: Number(row.id),
    mtalkTicketId: row.mtalk_ticket_id,
    externalMessageId: row.external_message_id,
    direction: row.direction,
    messageType: row.message_type,
    content: row.content,
    mediaUrl: row.media_url,
    receivedAt: row.received_at
  }
}

function mapPendingConversationAttachment(
  row: PendingConversationAttachmentRow
): PendingConversationAttachment {
  return {
    id: Number(row.id),
    conversationMessageId: Number(row.conversation_message_id),
    mtalkTicketId: row.mtalk_ticket_id,
    mediaUrl: row.media_url,
    downloadStatus: row.download_status,
    mimeType: row.mime_type,
    fileName: row.file_name,
    lastError: row.last_error,
    glpiDocumentId: row.glpi_document_id ? Number(row.glpi_document_id) : null,
    glpiUploadedAt: row.glpi_uploaded_at,
    glpiLinkedAt: row.glpi_linked_at
  }
}

export async function claimNextConversationSessionForProcessing() {
  return withDbTransaction(async (client) => {
    const result = await client.query<ClaimedConversationSessionRow>(
      `
        WITH candidate AS (
          SELECT mtalk_ticket_id
          FROM conversation_sessions
          WHERE next_processing_at IS NOT NULL
            AND next_processing_at <= NOW()
            AND (
              processing_started_at IS NULL
              OR processing_started_at < NOW() - ($1 * INTERVAL '1 second')
            )
          ORDER BY next_processing_at ASC, last_message_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE conversation_sessions AS conversation_session
        SET processing_started_at = NOW()
        FROM candidate
        WHERE conversation_session.mtalk_ticket_id = candidate.mtalk_ticket_id
        RETURNING
          conversation_session.mtalk_ticket_id,
          conversation_session.status,
          conversation_session.conversation_mode,
          conversation_session.contact_name,
          conversation_session.contact_number,
          conversation_session.company_name,
          conversation_session.welcome_sent_at,
          conversation_session.mtalk_closed_at,
          conversation_session.human_handoff_transferred_at,
          conversation_session.automation_expired_at,
          conversation_session.automation_expiration_reason,
          conversation_session.glpi_ticket_id,
          conversation_session.glpi_created_at,
          conversation_session.assigned_glpi_user_id,
          conversation_session.assigned_glpi_user_name,
          conversation_session.last_expiration_check_at,
          conversation_session.expiration_started_at,
          conversation_session.expiration_notice_sent_at,
          conversation_session.last_assignment_check_at,
          conversation_session.assignment_check_started_at,
          conversation_session.assignment_notified_at,
          conversation_session.glpi_entity_id,
          conversation_session.glpi_entity_name,
          conversation_session.company_identification_status,
          conversation_session.company_lookup_attempted_at,
          conversation_session.problem_details,
          conversation_session.problem_summary,
          conversation_session.clarification_attempts,
          conversation_session.company_prompt_attempts,
          conversation_session.awaiting_confirmation,
          conversation_session.last_message_at,
          conversation_session.next_processing_at,
          conversation_session.processing_started_at
      `,
      [env.workerStaleProcessingSeconds]
    )

    if ((result.rowCount ?? 0) === 0) {
      return null
    }

    return mapClaimedConversationSession(result.rows[0])
  })
}

export async function markConversationGlpiTicketCreated(
  mtalkTicketId: string,
  glpiTicketId: number
) {
  return withDbTransaction(async (client) => {
    await client.query(
      `
        UPDATE conversation_sessions
        SET
          glpi_ticket_id = $2,
          glpi_created_at = NOW(),
          mtalk_closed_at = NULL,
          solution_tracking_started_at = NOW(),
          last_solution_check_at = NULL,
          solution_check_started_at = NULL,
          solution_notified_at = NULL,
          glpi_last_status = 1,
          last_assignment_check_at = NULL,
          assignment_check_started_at = NULL,
          assignment_notified_at = NULL,
          awaiting_confirmation = FALSE,
          status = 'DONE'
        WHERE mtalk_ticket_id = $1
      `,
      [mtalkTicketId, String(glpiTicketId)]
    )
  })
}

export async function markConversationMtalkClosed(mtalkTicketId: string) {
  return withDbTransaction(async (client) => {
    await client.query(
      `
        UPDATE conversation_sessions
        SET mtalk_closed_at = NOW()
        WHERE mtalk_ticket_id = $1
      `,
      [mtalkTicketId]
    )
  })
}

export async function markConversationHumanHandoffTransferred(
  mtalkTicketId: string
) {
  return withDbTransaction(async (client) => {
    await client.query(
      `
        UPDATE conversation_sessions
        SET human_handoff_transferred_at = NOW()
        WHERE mtalk_ticket_id = $1
      `,
      [mtalkTicketId]
    )
  })
}

export async function claimNextConversationSessionForExpiration() {
  return withDbTransaction(async (client) => {
    const result = await client.query<ClaimedConversationSessionRow>(
      `
        WITH candidate AS (
          SELECT mtalk_ticket_id
          FROM conversation_sessions
          WHERE automation_expired_at IS NULL
            AND status NOT IN ('DONE', 'HANDOFF_TO_HUMAN', 'ERROR')
            AND last_message_at <= NOW() - ($2 * INTERVAL '1 second')
            AND (
              expiration_started_at IS NULL
              OR expiration_started_at < NOW() - ($1 * INTERVAL '1 second')
            )
            AND (
              last_expiration_check_at IS NULL
              OR last_expiration_check_at <= NOW() - ($3 * INTERVAL '1 second')
            )
          ORDER BY last_message_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE conversation_sessions AS conversation_session
        SET expiration_started_at = NOW()
        FROM candidate
        WHERE conversation_session.mtalk_ticket_id = candidate.mtalk_ticket_id
        RETURNING
          conversation_session.mtalk_ticket_id,
          conversation_session.status,
          conversation_session.conversation_mode,
          conversation_session.contact_name,
          conversation_session.contact_number,
          conversation_session.company_name,
          conversation_session.welcome_sent_at,
          conversation_session.mtalk_closed_at,
          conversation_session.human_handoff_transferred_at,
          conversation_session.automation_expired_at,
          conversation_session.automation_expiration_reason,
          conversation_session.glpi_ticket_id,
          conversation_session.glpi_created_at,
          conversation_session.assigned_glpi_user_id,
          conversation_session.assigned_glpi_user_name,
          conversation_session.last_expiration_check_at,
          conversation_session.expiration_started_at,
          conversation_session.expiration_notice_sent_at,
          conversation_session.last_assignment_check_at,
          conversation_session.assignment_check_started_at,
          conversation_session.assignment_notified_at,
          conversation_session.glpi_entity_id,
          conversation_session.glpi_entity_name,
          conversation_session.company_identification_status,
          conversation_session.company_lookup_attempted_at,
          conversation_session.problem_details,
          conversation_session.problem_summary,
          conversation_session.clarification_attempts,
          conversation_session.company_prompt_attempts,
          conversation_session.awaiting_confirmation,
          conversation_session.last_message_at,
          conversation_session.next_processing_at,
          conversation_session.processing_started_at
      `,
      [
        env.automationExpirationWorkerStaleProcessingSeconds,
        env.automationExpirationInactivityMinutes * 60,
        Math.ceil(env.automationExpirationPollIntervalMs / 1000)
      ]
    )

    if ((result.rowCount ?? 0) === 0) {
      return null
    }

    return mapAssignmentCheckConversationSession(result.rows[0])
  })
}

export async function markConversationAutomationExpired(
  mtalkTicketId: string,
  update: {
    reason: string
    mtalkClosed: boolean
  }
) {
  return withDbTransaction(async (client) => {
    await client.query(
      `
        UPDATE conversation_sessions
        SET
          status = 'DONE',
          automation_expired_at = NOW(),
          automation_expiration_reason = $2,
          expiration_started_at = NULL,
          last_expiration_check_at = NOW(),
          next_processing_at = NULL,
          processing_started_at = NULL,
          mtalk_closed_at = CASE
            WHEN $3 THEN COALESCE(mtalk_closed_at, NOW())
            ELSE mtalk_closed_at
          END
        WHERE mtalk_ticket_id = $1
      `,
      [mtalkTicketId, update.reason, update.mtalkClosed]
    )
  })
}

export async function markConversationExpirationCheckFailed(
  mtalkTicketId: string
) {
  return withDbTransaction(async (client) => {
    await client.query(
      `
        UPDATE conversation_sessions
        SET
          expiration_started_at = NULL,
          last_expiration_check_at = NOW()
        WHERE mtalk_ticket_id = $1
      `,
      [mtalkTicketId]
    )
  })
}

export async function markConversationExpirationNoticeSent(
  mtalkTicketId: string
) {
  return withDbTransaction((client) =>
    client.query(
      `
        UPDATE conversation_sessions
        SET expiration_notice_sent_at = COALESCE(
          expiration_notice_sent_at,
          NOW()
        )
        WHERE mtalk_ticket_id = $1
      `,
      [mtalkTicketId]
    )
  )
}

export async function claimNextConversationSessionForSolutionCheck() {
  return withDbTransaction(async (client) => {
    const result = await client.query<{
      mtalk_ticket_id: string
      contact_number: string | null
      glpi_ticket_id: string
      solution_check_started_at: Date
    }>(
      `
        WITH candidate AS (
          SELECT mtalk_ticket_id
          FROM conversation_sessions
          WHERE glpi_ticket_id IS NOT NULL
            AND solution_tracking_started_at IS NOT NULL
            AND solution_notified_at IS NULL
            AND status = 'DONE'
            AND (
              solution_check_started_at IS NULL
              OR solution_check_started_at < NOW() - ($1 * INTERVAL '1 second')
            )
            AND (
              last_solution_check_at IS NULL
              OR last_solution_check_at <= NOW() - ($2 * INTERVAL '1 second')
            )
          ORDER BY COALESCE(
            last_solution_check_at,
            solution_tracking_started_at
          ) ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE conversation_sessions AS conversation_session
        SET solution_check_started_at = NOW()
        FROM candidate
        WHERE conversation_session.mtalk_ticket_id = candidate.mtalk_ticket_id
        RETURNING
          conversation_session.mtalk_ticket_id,
          conversation_session.contact_number,
          conversation_session.glpi_ticket_id,
          conversation_session.solution_check_started_at
      `,
      [
        env.solutionWorkerStaleProcessingSeconds,
        Math.ceil(env.solutionPollIntervalMs / 1000)
      ]
    )

    if ((result.rowCount ?? 0) === 0) {
      return null
    }

    const row = result.rows[0]

    return {
      mtalkTicketId: row.mtalk_ticket_id,
      contactNumber: row.contact_number,
      glpiTicketId: Number(row.glpi_ticket_id),
      solutionCheckStartedAt: row.solution_check_started_at
    } satisfies ConversationSolutionCheckSession
  })
}

export async function markConversationSolutionChecked(
  mtalkTicketId: string,
  update: {
    glpiStatus: number
    solutionNotifiedAt?: Date | null
  }
) {
  return withDbTransaction(async (client) => {
    await client.query(
      `
        UPDATE conversation_sessions
        SET
          solution_check_started_at = NULL,
          last_solution_check_at = NOW(),
          glpi_last_status = $2,
          solution_notified_at = COALESCE($3, solution_notified_at)
        WHERE mtalk_ticket_id = $1
      `,
      [
        mtalkTicketId,
        update.glpiStatus,
        update.solutionNotifiedAt ?? null
      ]
    )
  })
}

export async function markConversationSolutionCheckFailed(
  mtalkTicketId: string
) {
  return withDbTransaction(async (client) => {
    await client.query(
      `
        UPDATE conversation_sessions
        SET
          solution_check_started_at = NULL,
          last_solution_check_at = NOW()
        WHERE mtalk_ticket_id = $1
      `,
      [mtalkTicketId]
    )
  })
}

export async function listConversationAttachmentsPendingGlpiSync(
  mtalkTicketId: string
) {
  const result = await withDbTransaction((client) =>
    client.query<PendingConversationAttachmentRow>(
      `
        SELECT
          id,
          conversation_message_id,
          mtalk_ticket_id,
          media_url,
          download_status,
          mime_type,
          file_name,
          last_error,
          glpi_document_id,
          glpi_uploaded_at,
          glpi_linked_at
        FROM conversation_attachments
        WHERE mtalk_ticket_id = $1
          AND glpi_linked_at IS NULL
        ORDER BY id ASC
      `,
      [mtalkTicketId]
    )
  )

  return result.rows.map(mapPendingConversationAttachment)
}

export async function markConversationAttachmentUploaded(
  attachmentId: number,
  update: {
    glpiDocumentId: number
    mimeType: string | null
    fileName: string | null
  }
) {
  return withDbTransaction(async (client) => {
    await client.query(
      `
        UPDATE conversation_attachments
        SET
          glpi_document_id = $2,
          glpi_uploaded_at = COALESCE(glpi_uploaded_at, NOW()),
          download_status = 'DOWNLOADED',
          mime_type = COALESCE($3, mime_type),
          file_name = COALESCE($4, file_name),
          storage_path = NULL,
          last_error = NULL
        WHERE id = $1
      `,
      [attachmentId, update.glpiDocumentId, update.mimeType, update.fileName]
    )
  })
}

export async function markConversationAttachmentLinked(
  attachmentId: number,
  glpiDocumentId: number
) {
  return withDbTransaction(async (client) => {
    await client.query(
      `
        UPDATE conversation_attachments
        SET
          glpi_document_id = $2,
          glpi_linked_at = NOW(),
          download_status = 'DOWNLOADED',
          storage_path = NULL,
          last_error = NULL
        WHERE id = $1
      `,
      [attachmentId, glpiDocumentId]
    )
  })
}

export async function markConversationAttachmentFailed(
  attachmentId: number,
  message: string
) {
  return withDbTransaction(async (client) => {
    await client.query(
      `
        UPDATE conversation_attachments
        SET
          download_status = 'FAILED',
          storage_path = NULL,
          last_error = $2
        WHERE id = $1
      `,
      [attachmentId, message]
    )
  })
}

export async function listPendingConversationMessagesForProcessing(
  mtalkTicketId: string,
  processingStartedAt: Date
) {
  const result = await withDbTransaction((client) =>
    client.query<PendingConversationMessageRow>(
      `
        SELECT
          id,
          mtalk_ticket_id,
          external_message_id,
          direction,
          message_type,
          content,
          media_url,
          received_at
        FROM conversation_messages
        WHERE mtalk_ticket_id = $1
          AND direction = 'inbound'
          AND processed_at IS NULL
          AND received_at <= $2
        ORDER BY received_at ASC, id ASC
      `,
      [mtalkTicketId, processingStartedAt]
    )
  )

  return result.rows.map(mapPendingConversationMessage)
}

export async function markConversationProcessingCompleted(
  mtalkTicketId: string,
  messageIds: number[]
) {
  return withDbTransaction(async (client) => {
    if (messageIds.length > 0) {
      await client.query(
        `
          UPDATE conversation_messages
          SET processed_at = NOW()
          WHERE mtalk_ticket_id = $1
            AND id = ANY($2::bigint[])
            AND processed_at IS NULL
        `,
        [mtalkTicketId, messageIds]
      )
    }

    await client.query(
      `
        UPDATE conversation_sessions
        SET
          processing_started_at = NULL,
          last_processed_at = NOW(),
          next_processing_at = CASE
            WHEN EXISTS (
              SELECT 1
              FROM conversation_messages
              WHERE mtalk_ticket_id = $1
                AND direction = 'inbound'
                AND processed_at IS NULL
            )
              THEN COALESCE(next_processing_at, NOW())
            ELSE NULL
          END
        WHERE mtalk_ticket_id = $1
      `,
      [mtalkTicketId]
    )
  })
}

export async function markConversationProcessingFailed(
  mtalkTicketId: string
) {
  return withDbTransaction(async (client) => {
    await client.query(
      `
        UPDATE conversation_sessions
        SET
          processing_started_at = NULL,
          next_processing_at = NOW() + ($2 * INTERVAL '1 second')
        WHERE mtalk_ticket_id = $1
      `,
      [mtalkTicketId, env.workerRetrySeconds]
    )
  })
}

type ConversationAnalysisSessionUpdate = {
  contactName: string | null
  companyName: string | null
  glpiEntityId: number | null
  glpiEntityName: string | null
  companyIdentificationStatus: CompanyIdentificationStatus
  companyLookupAttemptedAt: Date | null
  problemDetails: string | null
  problemSummary: string | null
  awaitingConfirmation: boolean
  status: ConversationStatus
}

export async function updateConversationSessionAfterAnalysis(
  mtalkTicketId: string,
  update: ConversationAnalysisSessionUpdate
) {
  return withDbTransaction(async (client) => {
    await client.query(
      `
        UPDATE conversation_sessions
        SET
          contact_name = COALESCE($2, contact_name),
          company_name = $3,
          glpi_entity_id = $4,
          glpi_entity_name = $5,
          company_identification_status = $6,
          company_lookup_attempted_at = $7,
          problem_details = COALESCE($8, problem_details),
          problem_summary = COALESCE($9, problem_summary),
          awaiting_confirmation = $10,
          status = $11
        WHERE mtalk_ticket_id = $1
      `,
      [
        mtalkTicketId,
        update.contactName,
        update.companyName,
        update.glpiEntityId,
        update.glpiEntityName,
        update.companyIdentificationStatus,
        update.companyLookupAttemptedAt,
        update.problemDetails,
        update.problemSummary,
        update.awaitingConfirmation,
        update.status
      ]
    )
  })
}

type PersistOutboundConversationMessageInput = {
  mtalkTicketId: string
  content: string
  rawPayload: unknown
  sentAt?: Date
}

export async function persistOutboundConversationMessage(
  input: PersistOutboundConversationMessageInput
) {
  const sentAt = input.sentAt ?? new Date()

  return withDbTransaction(async (client) => {
    await client.query(
      `
        INSERT INTO conversation_messages (
          mtalk_ticket_id,
          external_message_id,
          direction,
          message_type,
          content,
          media_url,
          raw_payload,
          received_at,
          processed_at
        )
        VALUES ($1, NULL, 'outbound', 'text', $2, NULL, $3::jsonb, $4, $4)
      `,
      [input.mtalkTicketId, input.content, JSON.stringify(input.rawPayload), sentAt]
    )
  })
}

export async function markConversationWelcomeSent(mtalkTicketId: string) {
  return withDbTransaction((client) =>
    client.query(
      `
        UPDATE conversation_sessions
        SET welcome_sent_at = COALESCE(welcome_sent_at, NOW())
        WHERE mtalk_ticket_id = $1
      `,
      [mtalkTicketId]
    )
  )
}

export async function incrementConversationClarificationAttempts(
  mtalkTicketId: string
) {
  return withDbTransaction((client) =>
    client.query(
      `
        UPDATE conversation_sessions
        SET clarification_attempts = clarification_attempts + 1
        WHERE mtalk_ticket_id = $1
      `,
      [mtalkTicketId]
    )
  )
}

export async function incrementConversationCompanyPromptAttempts(
  mtalkTicketId: string
) {
  return withDbTransaction((client) =>
    client.query(
      `
        UPDATE conversation_sessions
        SET company_prompt_attempts = company_prompt_attempts + 1
        WHERE mtalk_ticket_id = $1
      `,
      [mtalkTicketId]
    )
  )
}
