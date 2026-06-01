import { FastifyBaseLogger } from 'fastify'
import { deliverConversationResponse } from './conversation.delivery'
import {
  ClaimedConversationSession,
  claimNextConversationSessionForProcessing,
  listConversationAttachmentsPendingGlpiSync,
  listPendingConversationMessagesForProcessing,
  markConversationGlpiTicketCreated,
  markConversationProcessingCompleted,
  markConversationProcessingFailed,
  updateConversationSessionAfterAnalysis
} from './conversation.repository'
import { processConversationTurn } from './conversation.processor'
import {
  buildGlpiTicketCandidate,
  buildGlpiTicketRequestPayload
} from './conversation.ticket-candidate'
import { env } from '../../config/env'
import {
  normalizeCompanyName,
  resolveCompanyFromGlpiEntities
} from '../glpi/glpi.entities'
import { CompanyResolutionResult } from '../glpi/glpi.types'
import { createGlpiTicket, initGlpiSession } from '../glpi/glpi.client'
import { syncConversationAttachmentsToGlpi } from '../glpi/glpi-attachment-sync'

type StopWorker = () => Promise<void>

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function processOneConversationBatch(logger: FastifyBaseLogger) {
  const session = await claimNextConversationSessionForProcessing()

  if (!session) {
    return false
  }

  try {
    let resolvedCompany: CompanyResolutionResult = {
      companyName: session.companyName,
      glpiEntityId: session.glpiEntityId,
      glpiEntityName: session.glpiEntityName,
      companyIdentificationStatus: session.companyIdentificationStatus,
      companyLookupAttemptedAt: session.companyLookupAttemptedAt
    }
    let createdGlpiTicketId: number | null = session.glpiTicketId

    const messages = await listPendingConversationMessagesForProcessing(
      session.mtalkTicketId,
      session.processingStartedAt
    )

    const processingResult = await processConversationTurn({
      session,
      messages
    })

    if (processingResult.aiAnalysis) {
      resolvedCompany = await resolveConversationCompany(
        logger,
        session,
        processingResult.extractedData.companyName
      )

      await updateConversationSessionAfterAnalysis(session.mtalkTicketId, {
        contactName: processingResult.extractedData.contactName,
        companyName:
          resolvedCompany.companyName ??
          processingResult.extractedData.companyName,
        glpiEntityId: resolvedCompany.glpiEntityId,
        glpiEntityName: resolvedCompany.glpiEntityName,
        companyIdentificationStatus:
          resolvedCompany.companyIdentificationStatus,
        companyLookupAttemptedAt: resolvedCompany.companyLookupAttemptedAt,
        problemDetails: processingResult.extractedData.problemDetails,
        problemSummary: processingResult.extractedData.problemSummary,
        awaitingConfirmation: processingResult.awaitingConfirmation,
        status: processingResult.nextStatus
      })
    }

    const pendingAttachments =
      processingResult.shouldCreateTicket || session.glpiTicketId
        ? await listConversationAttachmentsPendingGlpiSync(session.mtalkTicketId)
        : []

    if (
      processingResult.shouldCreateTicket ||
      (session.glpiTicketId && pendingAttachments.length > 0)
    ) {
      const glpiTicketCandidate = buildGlpiTicketCandidate({
        session: {
          ...session,
          glpiTicketId: session.glpiTicketId,
          glpiCreatedAt: session.glpiCreatedAt,
          companyName: resolvedCompany.companyName ?? session.companyName,
          glpiEntityId: resolvedCompany.glpiEntityId,
          glpiEntityName: resolvedCompany.glpiEntityName,
          companyIdentificationStatus: resolvedCompany.companyIdentificationStatus,
          companyLookupAttemptedAt: resolvedCompany.companyLookupAttemptedAt
        },
        ticketDraft: processingResult.ticketDraft,
        extractedData: processingResult.extractedData
      })
      const glpiPayload = buildGlpiTicketRequestPayload(glpiTicketCandidate)

      createdGlpiTicketId = await createOrReuseGlpiTicket(
        logger,
        session,
        glpiTicketCandidate,
        glpiPayload,
        pendingAttachments
      )

      logger.info({
        msg: 'GLPI ticket candidate generated',
        mtalkTicketId: session.mtalkTicketId,
        glpiTicketId: createdGlpiTicketId,
        attachmentCount: pendingAttachments.length,
        companyName: glpiTicketCandidate.companyName,
        ticketType: glpiTicketCandidate.type,
        ticketPriority: glpiTicketCandidate.priority,
        ticketTitle: glpiTicketCandidate.title,
        ticketContent: glpiTicketCandidate.content
      })
    }

    const outboundResult = await deliverConversationResponse(logger, {
      session,
      nextAction: processingResult.nextAction,
      assistantResponse: processingResult.aiAnalysis?.assistantResponse ?? null,
      glpiTicketId: createdGlpiTicketId
    })

    await markConversationProcessingCompleted(
      session.mtalkTicketId,
      messages.map((message) => message.id)
    )

    logger.info({
      msg: 'Conversation session processed',
      mtalkTicketId: session.mtalkTicketId,
      messageCount: processingResult.messageCount,
      hasMedia: processingResult.hasMedia,
      textPreview: processingResult.textPreview,
      nextStatus: processingResult.nextStatus,
      nextAction: processingResult.nextAction,
      assistantResponse: processingResult.aiAnalysis?.assistantResponse ?? null,
      outboundDelivered: outboundResult.delivered,
      outboundBody: outboundResult.body,
      companyName: resolvedCompany.companyName ?? session.companyName,
      glpiTicketId: createdGlpiTicketId,
      glpiEntityName: resolvedCompany.glpiEntityName,
      companyIdentificationStatus: resolvedCompany.companyIdentificationStatus,
      ticketType: processingResult.ticketDraft.type,
      ticketPriority: processingResult.ticketDraft.priority,
      readyForConfirmation:
        processingResult.aiAnalysis?.readyForConfirmation ?? false,
      shouldCreateTicket: processingResult.shouldCreateTicket,
      shouldRequestHumanHandoff:
        processingResult.shouldRequestHumanHandoff,
      missingFields: processingResult.aiAnalysis?.missingFields ?? []
    })
  } catch (error) {
    await markConversationProcessingFailed(session.mtalkTicketId)

    const errorDetails =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            ...(error instanceof Error && 'stage' in error
              ? { stage: error.stage }
              : {}),
            ...(error instanceof Error &&
            'statusCode' in error &&
            typeof error.statusCode === 'number'
              ? { statusCode: error.statusCode }
              : {}),
            ...(error instanceof Error && 'responseBody' in error
              ? { responseBody: error.responseBody }
              : {}),
            ...(error instanceof Error &&
            'status' in error &&
            typeof error.status === 'number'
              ? { status: error.status }
              : {}),
            ...(error instanceof Error &&
            'cause' in error &&
            error.cause instanceof Error
              ? {
                  cause: {
                    name: error.cause.name,
                    message: error.cause.message,
                    ...('statusCode' in error.cause &&
                    typeof error.cause.statusCode === 'number'
                      ? { statusCode: error.cause.statusCode }
                      : {}),
                    ...('responseBody' in error.cause
                      ? { responseBody: error.cause.responseBody }
                      : {})
                  }
                }
              : {})
          }
        : { error }

    logger.error({
      msg: 'Conversation session processing failed',
      mtalkTicketId: session.mtalkTicketId,
      error: errorDetails
    })
  }

  return true
}

async function createOrReuseGlpiTicket(
  logger: FastifyBaseLogger,
  session: ClaimedConversationSession,
  candidate: ReturnType<typeof buildGlpiTicketCandidate>,
  payload: ReturnType<typeof buildGlpiTicketRequestPayload>,
  pendingAttachments: Awaited<
    ReturnType<typeof listConversationAttachmentsPendingGlpiSync>
  >
) {
  const glpiSession = await initGlpiSession()

  if (!glpiSession.session_token) {
    throw new Error('GLPI initSession returned no session_token for ticket creation')
  }

  let glpiTicketId = session.glpiTicketId

  if (glpiTicketId) {
    logger.info({
      msg: 'GLPI ticket already exists for conversation session',
      mtalkTicketId: session.mtalkTicketId,
      glpiTicketId
    })
  } else {
    const response = await createGlpiTicket(glpiSession.session_token, payload)
    const createdTicketId = response.id

    if (typeof createdTicketId !== 'number') {
      throw new Error('GLPI ticket creation returned no id')
    }

    glpiTicketId = createdTicketId

    await markConversationGlpiTicketCreated(session.mtalkTicketId, glpiTicketId)

    logger.info({
      msg: 'GLPI ticket created successfully',
      mtalkTicketId: session.mtalkTicketId,
      glpiTicketId,
      companyName: candidate.companyName,
      ticketType: candidate.type,
      ticketPriority: candidate.priority
    })
  }

  if (pendingAttachments.length > 0) {
    await syncConversationAttachmentsToGlpi({
      logger,
      sessionToken: glpiSession.session_token,
      glpiTicketId,
      glpiEntityId: candidate.glpiEntityId,
      attachments: pendingAttachments
    })
  }

  if (typeof glpiTicketId !== 'number') {
    throw new Error('GLPI ticket id is unavailable after ticket synchronization')
  }

  return glpiTicketId
}

async function resolveConversationCompany(
  logger: FastifyBaseLogger,
  session: ClaimedConversationSession,
  companyName: string | null
): Promise<CompanyResolutionResult> {
  const normalizedCandidate = companyName ? normalizeCompanyName(companyName) : ''
  const normalizedCurrentCompany = session.companyName
    ? normalizeCompanyName(session.companyName)
    : ''

  if (!normalizedCandidate) {
    return {
      companyName: session.companyName,
      glpiEntityId: session.glpiEntityId,
      glpiEntityName: session.glpiEntityName,
      companyIdentificationStatus: session.companyIdentificationStatus,
      companyLookupAttemptedAt: session.companyLookupAttemptedAt
    }
  }

  if (
    normalizedCurrentCompany &&
    normalizedCurrentCompany === normalizedCandidate &&
    session.companyIdentificationStatus !== 'PENDING'
  ) {
    return {
      companyName: session.companyName,
      glpiEntityId: session.glpiEntityId,
      glpiEntityName: session.glpiEntityName,
      companyIdentificationStatus: session.companyIdentificationStatus,
      companyLookupAttemptedAt: session.companyLookupAttemptedAt
    }
  }

  try {
    const resolution = await resolveCompanyFromGlpiEntities(logger, companyName)

    logger.info({
      msg: 'Conversation company resolution evaluated',
      mtalkTicketId: session.mtalkTicketId,
      requestedCompanyName: companyName,
      resolvedCompanyName: resolution.companyName,
      glpiEntityId: resolution.glpiEntityId,
      glpiEntityName: resolution.glpiEntityName,
      companyIdentificationStatus: resolution.companyIdentificationStatus
    })

    return resolution
  } catch (error) {
    logger.warn({
      msg: 'Conversation company resolution skipped due to GLPI lookup failure',
      mtalkTicketId: session.mtalkTicketId,
      requestedCompanyName: companyName,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message
            }
          : error
    })

    return {
      companyName,
      glpiEntityId: session.glpiEntityId,
      glpiEntityName: session.glpiEntityName,
      companyIdentificationStatus: session.companyIdentificationStatus,
      companyLookupAttemptedAt: session.companyLookupAttemptedAt
    }
  }
}

export function startConversationWorker(logger: FastifyBaseLogger): StopWorker {
  if (!env.workerEnabled) {
    logger.info({ msg: 'Conversation worker disabled by configuration' })
    return async () => {}
  }

  let stopped = false
  let currentDelayHandle: NodeJS.Timeout | null = null
  let loopPromise: Promise<void> | null = null

  const schedule = (ms: number) =>
    new Promise<void>((resolve) => {
      currentDelayHandle = setTimeout(() => {
        currentDelayHandle = null
        resolve()
      }, ms)
    })

  loopPromise = (async () => {
    logger.info({
      msg: 'Conversation worker started',
      pollIntervalMs: env.workerPollIntervalMs
    })

    while (!stopped) {
      const processedAny = await processOneConversationBatch(logger)

      if (stopped) {
        break
      }

      if (processedAny) {
        continue
      }

      await schedule(env.workerPollIntervalMs)
    }

    logger.info({ msg: 'Conversation worker stopped' })
  })()

  return async () => {
    stopped = true

    if (currentDelayHandle) {
      clearTimeout(currentDelayHandle)
      currentDelayHandle = null
    }

    await Promise.race([loopPromise, wait(env.workerPollIntervalMs + 100)])
  }
}
