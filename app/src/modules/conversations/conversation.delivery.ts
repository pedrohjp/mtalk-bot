import { FastifyBaseLogger } from 'fastify'
import { formatOmniMessage } from '../mtalk/mtalk-message'
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
  confirmationCompanyName?: string | null
  confirmationSummary?: string | null
}

function resolveOutboundMessage(input: DeliverConversationResponseInput) {
  if (input.nextAction === 'WAIT_FOR_USER') {
    return null
  }

  if (input.nextAction === 'HANDOFF_TO_HUMAN') {
    return 'Certo. Vou encaminhar seu atendimento para nossa equipe humana, e em breve um atendente dará continuidade por aqui.'
  }

  if (input.nextAction === 'ASK_CONFIRMATION' && input.confirmationSummary) {
    const companyText = input.confirmationCompanyName
      ? ` Empresa/unidade: ${input.confirmationCompanyName}.`
      : ''
    const summary = input.confirmationSummary.trim().replace(/[.!?]+$/, '')

    return `Entendido, só para confirmar:${companyText} Solicitação: ${summary}. Posso abrir o chamado assim ou deseja adicionar mais detalhes?`
  }

  if (input.nextAction === 'CREATE_GLPI_TICKET') {
    if (input.glpiTicketId) {
      return `Perfeito. Seu chamado foi criado com o número ${input.glpiTicketId}. Este atendimento será encerrado agora. Quando precisar, é só enviar uma nova mensagem.`
    }

    return 'Perfeito. Recebi sua confirmação e registrei internamente os dados do chamado para a próxima etapa.'
  }

  return input.assistantResponse
}

export async function deliverConversationResponse(
  logger: FastifyBaseLogger,
  input: DeliverConversationResponseInput
) {
  const resolvedMessage = resolveOutboundMessage(input)

  if (!resolvedMessage) {
    return {
      delivered: false,
      body: null
    }
  }

  const messageBody = formatOmniMessage(resolvedMessage)

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
