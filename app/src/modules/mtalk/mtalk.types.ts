export type MtalkWebhookPayload = {
  type?: string
  content?: string
  mediaUrl?: string
  metadata?: {
    ticketId?: number | string
    from?: {
      name?: string
      number?: string
    }
    customPayload?: {
      key?: {
        id?: string
      }
    }
  }
  customPayload?: {
    key?: {
      id?: string
    }
  }
  [key: string]: unknown
}

export const MTALK_MESSAGE_TYPES = [
  'text',
  'image',
  'document',
  'audio',
  'unknown'
] as const

export type MtalkMessageType = (typeof MTALK_MESSAGE_TYPES)[number]

export type NormalizedMtalkMessage = {
  mtalkTicketId: string
  externalMessageId: string
  contactName: string | null
  contactNumber: string | null
  messageType: MtalkMessageType
  content: string | null
  mediaUrl: string | null
  receivedAt: Date
  rawPayload: MtalkWebhookPayload
}
