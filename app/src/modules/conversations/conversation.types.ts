export const CONVERSATION_STATUSES = [
  'NEW',
  'COLLECTING_COMPANY',
  'COLLECTING_PROBLEM',
  'AWAITING_CONFIRMATION',
  'CREATING_GLPI_TICKET',
  'DONE',
  'HANDOFF_TO_HUMAN',
  'ERROR'
] as const

export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number]

export const CONVERSATION_ACTIONS = [
  'WAIT_FOR_USER',
  'ASK_COMPANY',
  'ASK_PROBLEM',
  'ASK_CONFIRMATION',
  'CREATE_GLPI_TICKET',
  'HANDOFF_TO_HUMAN'
] as const

export type ConversationAction = (typeof CONVERSATION_ACTIONS)[number]

export const CONVERSATION_MODES = ['USER', 'STAFF_FAST_TICKET'] as const

export type ConversationMode = (typeof CONVERSATION_MODES)[number]

export const MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const

export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number]

export const ATTACHMENT_DOWNLOAD_STATUSES = [
  'PENDING',
  'DOWNLOADED',
  'FAILED',
  'SKIPPED'
] as const

export type AttachmentDownloadStatus =
  (typeof ATTACHMENT_DOWNLOAD_STATUSES)[number]
