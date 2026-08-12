import { FastifyBaseLogger } from 'fastify'
import { env } from '../../config/env'
import { getGlpiTicket, initGlpiSession } from '../glpi/glpi.client'
import {
  claimNextConversationSessionForSolutionCheck,
  markConversationSolutionChecked,
  markConversationSolutionCheckFailed
} from './conversation.repository'
import { deliverSolutionNotification } from './conversation.solution-delivery'

type StopWorker = () => Promise<void>

const GLPI_SOLVED_STATUS = 5
const GLPI_CLOSED_STATUS = 6

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function parseNumericStatus(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsedValue = Number(value)
    return Number.isInteger(parsedValue) ? parsedValue : null
  }

  return null
}

function isCompletedGlpiStatus(status: number) {
  return status === GLPI_SOLVED_STATUS || status === GLPI_CLOSED_STATUS
}

async function processOneSolutionCheck(logger: FastifyBaseLogger) {
  const session = await claimNextConversationSessionForSolutionCheck()

  if (!session) {
    return false
  }

  try {
    const glpiSession = await initGlpiSession()

    if (!glpiSession.session_token) {
      throw new Error(
        'GLPI initSession returned no session_token for solution polling'
      )
    }

    const ticket = await getGlpiTicket(
      glpiSession.session_token,
      session.glpiTicketId
    )
    const glpiStatus = parseNumericStatus(ticket.status)

    if (glpiStatus === null) {
      throw new Error(
        `GLPI ticket ${session.glpiTicketId} returned an invalid status`
      )
    }

    if (!isCompletedGlpiStatus(glpiStatus)) {
      await markConversationSolutionChecked(session.mtalkTicketId, {
        glpiStatus
      })

      logger.debug({
        msg: 'GLPI solution check completed with ticket still open',
        mtalkTicketId: session.mtalkTicketId,
        glpiTicketId: session.glpiTicketId,
        glpiStatus
      })

      return true
    }

    await deliverSolutionNotification(logger, {
      mtalkTicketId: session.mtalkTicketId,
      contactNumber: session.contactNumber,
      glpiTicketId: session.glpiTicketId,
      glpiStatus
    })

    await markConversationSolutionChecked(session.mtalkTicketId, {
      glpiStatus,
      solutionNotifiedAt: new Date()
    })

    logger.info({
      msg: 'GLPI solution notification completed',
      mtalkTicketId: session.mtalkTicketId,
      glpiTicketId: session.glpiTicketId,
      glpiStatus
    })
  } catch (error) {
    await markConversationSolutionCheckFailed(session.mtalkTicketId)

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
      msg: 'Conversation solution check failed',
      mtalkTicketId: session.mtalkTicketId,
      glpiTicketId: session.glpiTicketId,
      error: errorDetails
    })
  }

  return true
}

export function startConversationSolutionWorker(
  logger: FastifyBaseLogger
): StopWorker {
  if (!env.solutionNotifierEnabled) {
    logger.info({ msg: 'Conversation solution worker disabled by configuration' })
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
      msg: 'Conversation solution worker started',
      pollIntervalMs: env.solutionPollIntervalMs
    })

    while (!stopped) {
      const processedAny = await processOneSolutionCheck(logger)

      if (stopped) {
        break
      }

      if (processedAny) {
        continue
      }

      await schedule(env.solutionPollIntervalMs)
    }

    logger.info({ msg: 'Conversation solution worker stopped' })
  })()

  return async () => {
    stopped = true

    if (currentDelayHandle) {
      clearTimeout(currentDelayHandle)
      currentDelayHandle = null
    }

    await Promise.race([loopPromise, wait(env.solutionPollIntervalMs + 100)])
  }
}
