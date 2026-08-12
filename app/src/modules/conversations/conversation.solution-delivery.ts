import { FastifyBaseLogger } from 'fastify'
import { formatOmniMessage } from '../mtalk/mtalk-message'
import { sendMtalkTextMessage } from '../mtalk/mtalk-outbound'
import { persistOutboundConversationMessage } from './conversation.repository'

type DeliverSolutionNotificationInput = {
  mtalkTicketId: string
  contactNumber: string | null
  glpiTicketId: number
  glpiStatus: number
}

export async function deliverSolutionNotification(
  logger: FastifyBaseLogger,
  input: DeliverSolutionNotificationInput
) {
  if (!input.contactNumber) {
    throw new Error('Cannot send solution notification without contact number')
  }

  const messageBody = formatOmniMessage(
    `Seu chamado nº ${input.glpiTicketId} foi concluído com sucesso. Agradecemos o contato.`
  )
  const responsePayload = await sendMtalkTextMessage({
    number: input.contactNumber,
    body: messageBody,
    saveOnTicket: false
  })

  await persistOutboundConversationMessage({
    mtalkTicketId: input.mtalkTicketId,
    content: messageBody,
    rawPayload: {
      provider: 'mtalk',
      event: 'solution_notification',
      request: {
        number: input.contactNumber,
        body: messageBody,
        saveOnTicket: false
      },
      glpiTicketId: input.glpiTicketId,
      glpiStatus: input.glpiStatus,
      response: responsePayload
    }
  })

  logger.info({
    msg: 'Conversation solution notification delivered',
    mtalkTicketId: input.mtalkTicketId,
    glpiTicketId: input.glpiTicketId,
    glpiStatus: input.glpiStatus,
    contactNumber: input.contactNumber
  })
}
