import { FastifyBaseLogger } from 'fastify'
import { getConversationWelcomeMessage } from '../admin/welcome-message.repository'
import { formatOmniMessage } from '../mtalk/mtalk-message'
import { sendMtalkTextMessage } from '../mtalk/mtalk-outbound'
import {
  ClaimedConversationSession,
  markConversationWelcomeSent,
  PendingConversationMessage,
  persistOutboundConversationMessage
} from './conversation.repository'

const NON_SUBSTANTIVE_FIRST_MESSAGES = new Set([
  'oi',
  'ola',
  'bom dia',
  'boa tarde',
  'boa noite',
  'tudo bem',
  'suporte',
  'abrir chamado',
  'chamado'
])

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function hasSubstantiveFirstMessage(
  messages: PendingConversationMessage[]
) {
  return messages.some((message) => {
    if (message.mediaUrl) {
      return true
    }

    const content = normalizeText(message.content ?? '')

    if (!content || /^\d+$/.test(content)) {
      return false
    }

    return !NON_SUBSTANTIVE_FIRST_MESSAGES.has(content)
  })
}

export async function deliverConversationWelcome(
  logger: FastifyBaseLogger,
  session: ClaimedConversationSession
) {
  if (session.status !== 'NEW' || session.welcomeSentAt) {
    return false
  }

  if (!session.contactNumber) {
    throw new Error('Cannot send conversation welcome without contact number')
  }

  const content = formatOmniMessage(await getConversationWelcomeMessage())
  const responsePayload = await sendMtalkTextMessage({
    number: session.contactNumber,
    body: content
  })

  await persistOutboundConversationMessage({
    mtalkTicketId: session.mtalkTicketId,
    content,
    rawPayload: {
      provider: 'mtalk',
      purpose: 'conversation_welcome',
      request: {
        number: session.contactNumber,
        body: content
      },
      response: responsePayload
    }
  })

  await markConversationWelcomeSent(session.mtalkTicketId)

  logger.info({
    msg: 'Conversation welcome message delivered',
    mtalkTicketId: session.mtalkTicketId,
    contactNumber: session.contactNumber
  })

  return true
}
