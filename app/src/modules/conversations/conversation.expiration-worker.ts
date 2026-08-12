import { FastifyBaseLogger } from 'fastify'
import { env } from '../../config/env'
import {
  markConversationAutomationExpired,
  markConversationExpirationCheckFailed,
  claimNextConversationSessionForExpiration
} from './conversation.repository'
import {
  closeTicketzTicket,
  TicketzRequestError
} from '../mtalk/ticketz.client'
import { deliverConversationExpirationNotice } from './conversation.expiration-delivery'

type StopWorker = () => Promise<void>

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isPermissionDeniedError(error: unknown) {
  return (
    error instanceof TicketzRequestError &&
    error.statusCode === 403 &&
    typeof error.responseBody === 'object' &&
    error.responseBody !== null &&
    'error' in error.responseBody &&
    error.responseBody.error === 'ERR_NO_PERMISSION'
  )
}

async function processOneExpirationCheck(logger: FastifyBaseLogger) {
  const session = await claimNextConversationSessionForExpiration()

  if (!session) {
    return false
  }

  try {
    try {
      await deliverConversationExpirationNotice(logger, session)

      const closedTicket = await closeTicketzTicket(session.mtalkTicketId)

      await markConversationAutomationExpired(session.mtalkTicketId, {
        reason: 'inactivity_timeout_closed',
        mtalkClosed: true
      })

      logger.info({
        msg: 'Conversation automation expired and MTALK conversation was closed',
        mtalkTicketId: session.mtalkTicketId,
        status: session.status,
        lastMessageAt: session.lastMessageAt,
        mtalkStatus: closedTicket.status,
        mtalkQueueId: closedTicket.queueId ?? null,
        mtalkUserId: closedTicket.userId ?? null
      })

      return true
    } catch (error) {
      if (!isPermissionDeniedError(error)) {
        throw error
      }

      const permissionError = error as TicketzRequestError

      await markConversationAutomationExpired(session.mtalkTicketId, {
        reason: 'inactivity_timeout_close_permission_denied',
        mtalkClosed: false
      })

      logger.warn({
        msg: 'Conversation automation expired but MTALK close was denied',
        mtalkTicketId: session.mtalkTicketId,
        status: session.status,
        lastMessageAt: session.lastMessageAt,
        error: {
          name: permissionError.name,
          message: permissionError.message,
          statusCode: permissionError.statusCode,
          responseBody: permissionError.responseBody
        }
      })

      return true
    }
  } catch (error) {
    await markConversationExpirationCheckFailed(session.mtalkTicketId)

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
      msg: 'Conversation automation expiration check failed',
      mtalkTicketId: session.mtalkTicketId,
      status: session.status,
      lastMessageAt: session.lastMessageAt,
      error: errorDetails
    })
  }

  return true
}

export function startConversationExpirationWorker(
  logger: FastifyBaseLogger
): StopWorker {
  if (!env.automationExpirationEnabled) {
    logger.info({ msg: 'Conversation expiration worker disabled by configuration' })
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
      msg: 'Conversation expiration worker started',
      pollIntervalMs: env.automationExpirationPollIntervalMs,
      inactivityMinutes: env.automationExpirationInactivityMinutes
    })

    while (!stopped) {
      const processedAny = await processOneExpirationCheck(logger)

      if (stopped) {
        break
      }

      if (processedAny) {
        continue
      }

      await schedule(env.automationExpirationPollIntervalMs)
    }

    logger.info({ msg: 'Conversation expiration worker stopped' })
  })()

  return async () => {
    stopped = true

    if (currentDelayHandle) {
      clearTimeout(currentDelayHandle)
      currentDelayHandle = null
    }

    await Promise.race([
      loopPromise,
      wait(env.automationExpirationPollIntervalMs + 100)
    ])
  }
}
