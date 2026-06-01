import { FastifyBaseLogger } from 'fastify'
import { sendMtalkTextMessage } from '../mtalk/mtalk-outbound'
import {
  ClaimedConversationSession,
  persistOutboundConversationMessage
} from './conversation.repository'
import { ConversationAction } from './conversation.types'

type DeliverConversationResponseInput = {
  session: ClaimedConversationSession
  nextAction: ConversationAction
  assistantResponse: string | null
  glpiTicketId?: number | null
}

function resolveOutboundMessage(input: DeliverConversationResponseInput) {
  if (!input.assistantResponse) {
    return null
  }

  if (input.nextAction === 'WAIT_FOR_USER') {
    return null
  }

  if (input.nextAction === 'CREATE_GLPI_TICKET') {
    if (input.glpiTicketId) {
      return `Perfeito. Seu chamado foi criado com o numero ${input.glpiTicketId}. Em breve um atendente entrara em contato.`
    }

    return 'Perfeito. Recebi sua confirmacao e registrei internamente os dados do chamado para a proxima etapa.'
  }

  return input.assistantResponse
}

export async function deliverConversationResponse(
  logger: FastifyBaseLogger,
  input: DeliverConversationResponseInput
) {
  const messageBody = resolveOutboundMessage(input)

  if (!messageBody) {
    return {
      delivered: false,
      body: null
    }
  }

  if (!input.session.contactNumber) {
    throw new Error('Cannot send outbound MTALK message without contact number')
  }

  const responsePayload = await sendMtalkTextMessage({
    number: input.session.contactNumber,
    body: messageBody
  })

  await persistOutboundConversationMessage({
    mtalkTicketId: input.session.mtalkTicketId,
    content: messageBody,
    rawPayload: {
      provider: 'mtalk',
      request: {
        number: input.session.contactNumber,
        body: messageBody
      },
      response: responsePayload
    }
  })

  logger.info({
    msg: 'Conversation outbound message delivered',
    mtalkTicketId: input.session.mtalkTicketId,
    nextAction: input.nextAction,
    contactNumber: input.session.contactNumber
  })

  return {
    delivered: true,
    body: messageBody
  }
}
