import { FastifyBaseLogger } from 'fastify'
import { formatOmniMessage } from '../mtalk/mtalk-message'
import { sendMtalkTextMessage } from '../mtalk/mtalk-outbound'
import {
  ClaimedConversationSession,
  markConversationExpirationNoticeSent,
  persistOutboundConversationMessage
} from './conversation.repository'

const EXPIRATION_NOTICE_MESSAGE =
  'Como não recebemos uma resposta na última hora, este atendimento será encerrado. Quando precisar, envie uma nova mensagem para iniciar outro atendimento.'

export async function deliverConversationExpirationNotice(
  logger: FastifyBaseLogger,
  session: ClaimedConversationSession
) {
  if (session.expirationNoticeSentAt) {
    return false
  }

  if (!session.contactNumber) {
    throw new Error('Cannot send expiration notice without contact number')
  }

  const messageBody = formatOmniMessage(EXPIRATION_NOTICE_MESSAGE)
  const responsePayload = await sendMtalkTextMessage({
    number: session.contactNumber,
    body: messageBody
  })

  await persistOutboundConversationMessage({
    mtalkTicketId: session.mtalkTicketId,
    content: messageBody,
    rawPayload: {
      provider: 'mtalk',
      event: 'conversation_expiration_notice',
      request: {
        number: session.contactNumber,
        body: messageBody
      },
      response: responsePayload
    }
  })

  await markConversationExpirationNoticeSent(session.mtalkTicketId)

  logger.info({
    msg: 'Conversation expiration notice delivered',
    mtalkTicketId: session.mtalkTicketId,
    contactNumber: session.contactNumber
  })

  return true
}
