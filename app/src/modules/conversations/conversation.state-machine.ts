import { ConversationAiAnalysis } from './conversation.ai'
import { ClaimedConversationSession } from './conversation.repository'
import { ConversationAction, ConversationStatus } from './conversation.types'

type ConversationStateMachineInput = {
  session: ClaimedConversationSession
  aiAnalysis: ConversationAiAnalysis
  extractedData: {
    contactName: string | null
    companyName: string | null
    problemDetails: string | null
    problemSummary: string | null
  }
}

export type ConversationStateTransition = {
  nextStatus: ConversationStatus
  nextAction: ConversationAction
  awaitingConfirmation: boolean
  shouldCreateTicket: boolean
  shouldRequestHumanHandoff: boolean
}

const ALLOWED_STATUS_TRANSITIONS: Record<
  ConversationStatus,
  ConversationStatus[]
> = {
  NEW: [
    'COLLECTING_COMPANY',
    'COLLECTING_PROBLEM',
    'AWAITING_CONFIRMATION',
    'HANDOFF_TO_HUMAN'
  ],
  COLLECTING_COMPANY: [
    'COLLECTING_COMPANY',
    'COLLECTING_PROBLEM',
    'AWAITING_CONFIRMATION',
    'HANDOFF_TO_HUMAN'
  ],
  COLLECTING_PROBLEM: [
    'COLLECTING_COMPANY',
    'COLLECTING_PROBLEM',
    'AWAITING_CONFIRMATION',
    'HANDOFF_TO_HUMAN'
  ],
  AWAITING_CONFIRMATION: [
    'COLLECTING_COMPANY',
    'COLLECTING_PROBLEM',
    'AWAITING_CONFIRMATION',
    'CREATING_GLPI_TICKET',
    'HANDOFF_TO_HUMAN'
  ],
  CREATING_GLPI_TICKET: ['CREATING_GLPI_TICKET', 'DONE', 'ERROR'],
  DONE: ['DONE'],
  HANDOFF_TO_HUMAN: ['HANDOFF_TO_HUMAN'],
  ERROR: ['ERROR', 'HANDOFF_TO_HUMAN']
}

function hasValue(value: string | null) {
  return Boolean(value && value.trim().length > 0)
}

function deriveStatusFromConversationData(
  input: ConversationStateMachineInput
): ConversationStatus {
  const { session, aiAnalysis, extractedData } = input
  const hasCompanyName = hasValue(extractedData.companyName)
  const hasProblemDetails = hasValue(extractedData.problemDetails)
  const hasProblemSummary = hasValue(extractedData.problemSummary)

  if (session.status === 'HANDOFF_TO_HUMAN') {
    return 'HANDOFF_TO_HUMAN'
  }

  if (session.status === 'DONE') {
    return 'DONE'
  }

  if (aiAnalysis.intent === 'handoff_to_human') {
    return 'HANDOFF_TO_HUMAN'
  }

  if (
    aiAnalysis.userConfirmed &&
    aiAnalysis.shouldCreateTicket &&
    hasCompanyName &&
    hasProblemDetails &&
    hasProblemSummary
  ) {
    return 'CREATING_GLPI_TICKET'
  }

  if (
    aiAnalysis.readyForConfirmation &&
    hasCompanyName &&
    hasProblemDetails &&
    hasProblemSummary
  ) {
    return 'AWAITING_CONFIRMATION'
  }

  if (!hasCompanyName || aiAnalysis.intent === 'collect_company') {
    return 'COLLECTING_COMPANY'
  }

  if (!hasProblemDetails || aiAnalysis.intent === 'collect_problem') {
    return 'COLLECTING_PROBLEM'
  }

  if (session.awaitingConfirmation) {
    return 'AWAITING_CONFIRMATION'
  }

  return 'COLLECTING_PROBLEM'
}

function ensureAllowedTransition(
  currentStatus: ConversationStatus,
  desiredStatus: ConversationStatus
) {
  const allowedStatuses = ALLOWED_STATUS_TRANSITIONS[currentStatus]

  if (allowedStatuses.includes(desiredStatus)) {
    return desiredStatus
  }

  return currentStatus
}

function deriveNextAction(nextStatus: ConversationStatus): ConversationAction {
  switch (nextStatus) {
    case 'COLLECTING_COMPANY':
      return 'ASK_COMPANY'
    case 'COLLECTING_PROBLEM':
      return 'ASK_PROBLEM'
    case 'AWAITING_CONFIRMATION':
      return 'ASK_CONFIRMATION'
    case 'CREATING_GLPI_TICKET':
      return 'CREATE_GLPI_TICKET'
    case 'HANDOFF_TO_HUMAN':
      return 'HANDOFF_TO_HUMAN'
    default:
      return 'WAIT_FOR_USER'
  }
}

export function resolveConversationStateTransition(
  input: ConversationStateMachineInput
): ConversationStateTransition {
  const desiredStatus = deriveStatusFromConversationData(input)
  const nextStatus = ensureAllowedTransition(
    input.session.status,
    desiredStatus
  )
  const nextAction = deriveNextAction(nextStatus)

  return {
    nextStatus,
    nextAction,
    awaitingConfirmation: nextStatus === 'AWAITING_CONFIRMATION',
    shouldCreateTicket: nextStatus === 'CREATING_GLPI_TICKET',
    shouldRequestHumanHandoff: nextStatus === 'HANDOFF_TO_HUMAN'
  }
}
