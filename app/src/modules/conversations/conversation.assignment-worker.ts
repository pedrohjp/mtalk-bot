import { FastifyBaseLogger } from 'fastify'
import { env } from '../../config/env'
import {
  claimNextConversationSessionForAssignmentCheck,
  markConversationAssignmentChecked,
  markConversationAssignmentCheckFailed
} from './conversation.repository'
import { initGlpiSession, getGlpiTicketUsers } from '../glpi/glpi.client'
import { deliverAssignmentNotification } from './conversation.assignment-delivery'
import { GlpiTicketUserItem } from '../glpi/glpi.types'

type StopWorker = () => Promise<void>

type AssignedTechnician = {
  userId: number
  userName: string | null
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function parseNumericValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsedValue = Number(value)
    return Number.isFinite(parsedValue) ? parsedValue : null
  }

  return null
}

function extractAssignedTechnician(ticketUsers: GlpiTicketUserItem[]) {
  const assignedTicketUser = ticketUsers.find((ticketUser) => {
    const typeValue = parseNumericValue(ticketUser.type)
    const userId = parseNumericValue(ticketUser.users_id)

    return typeValue === 2 && typeof userId === 'number' && userId > 0
  })

  if (!assignedTicketUser) {
    return null
  }

  const userId = parseNumericValue(assignedTicketUser.users_id)

  if (typeof userId !== 'number') {
    return null
  }

  const userName =
    typeof assignedTicketUser['users_id_name'] === 'string'
      ? assignedTicketUser['users_id_name']
      : typeof assignedTicketUser['name'] === 'string'
        ? assignedTicketUser['name']
        : null

  return {
    userId,
    userName
  } satisfies AssignedTechnician
}

async function processOneAssignmentCheck(logger: FastifyBaseLogger) {
  const session = await claimNextConversationSessionForAssignmentCheck()

  if (!session) {
    return false
  }

  try {
    if (!session.glpiTicketId) {
      await markConversationAssignmentChecked(session.mtalkTicketId)
      return true
    }

    const glpiSession = await initGlpiSession()

    if (!glpiSession.session_token) {
      throw new Error(
        'GLPI initSession returned no session_token for assignment polling'
      )
    }

    const ticketUsers = await getGlpiTicketUsers(
      glpiSession.session_token,
      session.glpiTicketId
    )
    const assignedTechnician = extractAssignedTechnician(ticketUsers)

    if (!assignedTechnician) {
      await markConversationAssignmentChecked(session.mtalkTicketId)

      logger.info({
        msg: 'GLPI assignment check completed with no assigned technician',
        mtalkTicketId: session.mtalkTicketId,
        glpiTicketId: session.glpiTicketId
      })

      return true
    }

    await deliverAssignmentNotification(logger, session)

    await markConversationAssignmentChecked(session.mtalkTicketId, {
      assignedGlpiUserId: assignedTechnician.userId,
      assignedGlpiUserName: assignedTechnician.userName,
      assignmentNotifiedAt: new Date()
    })

    logger.info({
      msg: 'GLPI assignment notification completed',
      mtalkTicketId: session.mtalkTicketId,
      glpiTicketId: session.glpiTicketId,
      assignedGlpiUserId: assignedTechnician.userId,
      assignedGlpiUserName: assignedTechnician.userName
    })
  } catch (error) {
    await markConversationAssignmentCheckFailed(session.mtalkTicketId)

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
      msg: 'Conversation assignment check failed',
      mtalkTicketId: session.mtalkTicketId,
      glpiTicketId: session.glpiTicketId,
      error: errorDetails
    })
  }

  return true
}

export function startConversationAssignmentWorker(
  logger: FastifyBaseLogger
): StopWorker {
  if (!env.assignmentNotifierEnabled) {
    logger.info({ msg: 'Conversation assignment worker disabled by configuration' })
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
      msg: 'Conversation assignment worker started',
      pollIntervalMs: env.assignmentPollIntervalMs
    })

    while (!stopped) {
      const processedAny = await processOneAssignmentCheck(logger)

      if (stopped) {
        break
      }

      if (processedAny) {
        continue
      }

      await schedule(env.assignmentPollIntervalMs)
    }

    logger.info({ msg: 'Conversation assignment worker stopped' })
  })()

  return async () => {
    stopped = true

    if (currentDelayHandle) {
      clearTimeout(currentDelayHandle)
      currentDelayHandle = null
    }

    await Promise.race([loopPromise, wait(env.assignmentPollIntervalMs + 100)])
  }
}
