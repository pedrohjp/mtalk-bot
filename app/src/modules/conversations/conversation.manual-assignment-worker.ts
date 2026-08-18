import { FastifyBaseLogger } from 'fastify'
import { env } from '../../config/env'
import {
  claimNextConversationSessionForManualAssignmentCheck,
  markConversationManualAssignmentChecked,
  markConversationManualAssignmentCheckFailed,
  markConversationManualAssignmentDetected
} from './conversation.repository'
import { getTicketzTicket } from '../mtalk/ticketz.client'

type StopWorker = () => Promise<void>

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function getAssignedUserId(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return String(value)
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const normalizedValue = value.trim()
    const numericValue = Number(normalizedValue)

    return Number.isInteger(numericValue) && numericValue > 0
      ? String(numericValue)
      : null
  }

  return null
}

async function processOneManualAssignmentCheck(logger: FastifyBaseLogger) {
  const session = await claimNextConversationSessionForManualAssignmentCheck()

  if (!session) {
    return false
  }

  try {
    const ticket = await getTicketzTicket(session.mtalkTicketId)
    const assignedUserId = getAssignedUserId(ticket.userId)

    if (!assignedUserId) {
      await markConversationManualAssignmentChecked(session.mtalkTicketId)

      logger.debug({
        msg: 'MTALK manual assignment check completed without assigned user',
        mtalkTicketId: session.mtalkTicketId,
        mtalkStatus: ticket.status ?? null,
        mtalkQueueId: ticket.queueId ?? null
      })

      return true
    }

    await markConversationManualAssignmentDetected(
      session.mtalkTicketId,
      assignedUserId
    )

    logger.info({
      msg: 'MTALK manual assignment detected; conversation automation stopped',
      mtalkTicketId: session.mtalkTicketId,
      mtalkUserId: assignedUserId,
      mtalkStatus: ticket.status ?? null,
      mtalkQueueId: ticket.queueId ?? null
    })

    return true
  } catch (error) {
    await markConversationManualAssignmentCheckFailed(session.mtalkTicketId)

    const errorDetails =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            ...(error instanceof Error &&
            'statusCode' in error &&
            typeof error.statusCode === 'number'
              ? { statusCode: error.statusCode }
              : {}),
            ...(error instanceof Error && 'responseBody' in error
              ? { responseBody: error.responseBody }
              : {})
          }
        : { error }

    logger.error({
      msg: 'MTALK manual assignment check failed',
      mtalkTicketId: session.mtalkTicketId,
      error: errorDetails
    })
  }

  return true
}

export function startConversationManualAssignmentWorker(
  logger: FastifyBaseLogger
): StopWorker {
  if (!env.workerEnabled || !env.manualAssignmentWatcherEnabled) {
    logger.info({
      msg: 'MTALK manual assignment worker disabled by configuration'
    })
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
      msg: 'MTALK manual assignment worker started',
      pollIntervalMs: env.manualAssignmentPollIntervalMs
    })

    while (!stopped) {
      const processedAny = await processOneManualAssignmentCheck(logger)

      if (stopped) {
        break
      }

      if (processedAny) {
        continue
      }

      await schedule(env.manualAssignmentPollIntervalMs)
    }

    logger.info({ msg: 'MTALK manual assignment worker stopped' })
  })()

  return async () => {
    stopped = true

    if (currentDelayHandle) {
      clearTimeout(currentDelayHandle)
      currentDelayHandle = null
    }

    await Promise.race([
      loopPromise,
      wait(env.manualAssignmentPollIntervalMs + 100)
    ])
  }
}
