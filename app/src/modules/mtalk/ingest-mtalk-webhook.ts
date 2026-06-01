import { normalizeMtalkMessage } from './normalize-mtalk-message'
import { MtalkWebhookPayload } from './mtalk.types'
import { persistInboundConversationMessage } from '../conversations/conversation.repository'
import { resolveConversationMode } from '../staff/staff.repository'

export class InvalidMtalkWebhookPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidMtalkWebhookPayloadError'
  }
}

export async function ingestMtalkWebhook(payload: MtalkWebhookPayload) {
  let normalizedMessage

  try {
    normalizedMessage = normalizeMtalkMessage(payload)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Invalid MTALK payload'

    throw new InvalidMtalkWebhookPayloadError(message)
  }

  const conversationMode = await resolveConversationMode(
    normalizedMessage.contactNumber,
    normalizedMessage.content
  )

  const persistenceResult = await persistInboundConversationMessage(
    normalizedMessage,
    conversationMode
  )

  return {
    normalizedMessage,
    conversationMode,
    persistenceResult
  }
}
