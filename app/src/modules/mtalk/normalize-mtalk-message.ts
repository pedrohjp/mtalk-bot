import {
  MTALK_MESSAGE_TYPES,
  MtalkMessageType,
  MtalkWebhookPayload,
  NormalizedMtalkMessage
} from './mtalk.types'

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid or missing required field: ${fieldName}`)
  }

  const normalizedValue = value.trim()

  if (normalizedValue.length === 0) {
    throw new Error(`Invalid or missing required field: ${fieldName}`)
  }

  return normalizedValue
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim()
  return normalizedValue.length > 0 ? normalizedValue : null
}

function normalizeMessageType(type: unknown): MtalkMessageType {
  if (typeof type !== 'string') {
    return 'unknown'
  }

  return MTALK_MESSAGE_TYPES.includes(type as MtalkMessageType)
    ? (type as MtalkMessageType)
    : 'unknown'
}

export function normalizeMtalkMessage(
  payload: MtalkWebhookPayload,
  receivedAt: Date = new Date()
): NormalizedMtalkMessage {
  const ticketId = payload.metadata?.ticketId
  const externalMessageId =
    payload.customPayload?.key?.id ?? payload.metadata?.customPayload?.key?.id

  return {
    mtalkTicketId: readRequiredString(
      ticketId === undefined || ticketId === null ? undefined : String(ticketId),
      'metadata.ticketId'
    ),
    externalMessageId: readRequiredString(
      externalMessageId,
      'customPayload.key.id'
    ),
    contactName: readOptionalString(payload.metadata?.from?.name),
    contactNumber: readOptionalString(payload.metadata?.from?.number),
    messageType: normalizeMessageType(payload.type),
    content: readOptionalString(payload.content),
    mediaUrl: readOptionalString(payload.mediaUrl),
    receivedAt,
    rawPayload: payload
  }
}
