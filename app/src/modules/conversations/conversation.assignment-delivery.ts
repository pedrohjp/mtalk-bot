import { FastifyBaseLogger } from 'fastify'
import { sendMtalkTextMessage } from '../mtalk/mtalk-outbound'
import {
  ClaimedConversationSession,
  persistOutboundConversationMessage
} from './conversation.repository'

const ASSIGNMENT_NOTIFICATION_MESSAGE =
  'Seu chamado já foi assumido por um técnico e em breve ele entrará em contato.'

export async function deliverAssignmentNotification(
  logger: FastifyBaseLogger,
  session: ClaimedConversationSession
) {
  if (!session.contactNumber) {
    throw new Error('Cannot send assignment notification without contact number')
  }

  const responsePayload = await sendMtalkTextMessage({
    number: session.contactNumber,
    body: ASSIGNMENT_NOTIFICATION_MESSAGE
  })

  await persistOutboundConversationMessage({
    mtalkTicketId: session.mtalkTicketId,
    content: ASSIGNMENT_NOTIFICATION_MESSAGE,
    rawPayload: {
      provider: 'mtalk',
      event: 'assignment_notification',
      request: {
        number: session.contactNumber,
        body: ASSIGNMENT_NOTIFICATION_MESSAGE
      },
      response: responsePayload
    }
  })

  logger.info({
    msg: 'Conversation assignment notification delivered',
    mtalkTicketId: session.mtalkTicketId,
    glpiTicketId: session.glpiTicketId,
    contactNumber: session.contactNumber
  })
}
