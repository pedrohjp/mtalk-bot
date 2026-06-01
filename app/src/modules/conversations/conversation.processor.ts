import {
  ClaimedConversationSession,
  PendingConversationMessage
} from './conversation.repository'
import {
  analyzeConversationWithGemini,
  ConversationAiAnalysis,
  ConversationTicketDraft
} from './conversation.ai'
import { resolveConversationStateTransition } from './conversation.state-machine'
import { ConversationAction, ConversationStatus } from './conversation.types'

type ConversationProcessingInput = {
  session: ClaimedConversationSession
  messages: PendingConversationMessage[]
}

type ConversationProcessingResult = {
  messageCount: number
  hasMedia: boolean
  textPreview: string | null
  aiAnalysis: ConversationAiAnalysis | null
  nextStatus: ConversationStatus
  nextAction: ConversationAction
  awaitingConfirmation: boolean
  shouldCreateTicket: boolean
  shouldRequestHumanHandoff: boolean
  ticketDraft: ConversationTicketDraft
  extractedData: {
    contactName: string | null
    companyName: string | null
    problemDetails: string | null
    problemSummary: string | null
  }
}

function buildTextPreview(messages: PendingConversationMessage[]) {
  const preview = messages
    .map((message) => message.content)
    .filter((content): content is string => Boolean(content))
    .join(' ')
    .trim()

  if (preview.length === 0) {
    return null
  }

  return preview.length > 200 ? `${preview.slice(0, 200)}...` : preview
}

export async function processConversationTurn(
  input: ConversationProcessingInput
): Promise<ConversationProcessingResult> {
  if (input.messages.length === 0) {
    return {
      messageCount: 0,
      hasMedia: false,
      textPreview: null,
      aiAnalysis: null,
      nextStatus: input.session.status,
      nextAction: 'WAIT_FOR_USER',
      awaitingConfirmation: input.session.awaitingConfirmation,
      shouldCreateTicket: false,
      shouldRequestHumanHandoff: false,
      ticketDraft: {
        type: null,
        priority: null,
        title: null,
        description: null
      },
      extractedData: {
        contactName: input.session.contactName,
        companyName: input.session.companyName,
        problemDetails: input.session.problemDetails,
        problemSummary: input.session.problemSummary
      }
    }
  }

  const aiAnalysis = await analyzeConversationWithGemini(
    input.session,
    input.messages
  )

  const contactName =
    aiAnalysis.extractedData.requesterName ?? input.session.contactName
  const companyName =
    aiAnalysis.extractedData.companyName ?? input.session.companyName
  const problemDetails =
    aiAnalysis.extractedData.problemDetails ?? input.session.problemDetails
  const problemSummary =
    aiAnalysis.extractedData.problemSummary ?? input.session.problemSummary

  const transition = resolveConversationStateTransition({
    session: input.session,
    aiAnalysis,
    extractedData: {
      contactName,
      companyName,
      problemDetails,
      problemSummary
    }
  })

  return {
    messageCount: input.messages.length,
    hasMedia: input.messages.some((message) => Boolean(message.mediaUrl)),
    textPreview: buildTextPreview(input.messages),
    aiAnalysis,
    nextStatus: transition.nextStatus,
    nextAction: transition.nextAction,
    awaitingConfirmation: transition.awaitingConfirmation,
    shouldCreateTicket: transition.shouldCreateTicket,
    shouldRequestHumanHandoff: transition.shouldRequestHumanHandoff,
    ticketDraft: aiAnalysis.ticketDraft,
    extractedData: {
      contactName,
      companyName,
      problemDetails,
      problemSummary
    }
  }
}
