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
  companyPromptRequested: boolean
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

function normalizeForClarification(value: string | null) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function isUrgentRequest(problemDetails: string | null) {
  return /\b(urgente|emergencia|critico|critica|parada total|empresa parada|sem conseguir atender)\b/.test(
    normalizeForClarification(problemDetails)
  )
}

function buildEquipmentClarificationQuestion(problemDetails: string | null) {
  const normalizedDetails = normalizeForClarification(problemDetails)
  const mentionsEquipment =
    /\b(computador|pc|desktop|notebook|impressora|monitor|servidor|celular|equipamento)\b/.test(
      normalizedDetails
    )
  const identifiesEquipment =
    /\b(computador|pc|desktop|notebook|impressora|monitor|servidor|celular|equipamento)\s*(?:n(?:umero)?\s*)?\d+\b/.test(
      normalizedDetails
    ) ||
    /\b(patrimonio|etiqueta|numero|setor|recepcao|financeiro|sala|caixa|guiche)\b/.test(
      normalizedDetails
    )

  if (!mentionsEquipment || identifiesEquipment) {
    return null
  }

  if (/\bimpressora\b/.test(normalizedDetails)) {
    return 'Qual impressora está apresentando o problema? Se ela tiver um nome ou número de identificação, pode me informar.'
  }

  if (/\b(computador|pc|desktop|notebook)\b/.test(normalizedDetails)) {
    return 'Qual computador está apresentando o problema? Se ele tiver um nome ou número de identificação, pode me informar.'
  }

  return 'Qual equipamento está apresentando o problema? Se ele tiver um nome ou número de identificação, pode me informar.'
}

function applyOptionalCompanyPolicy(
  aiAnalysis: ConversationAiAnalysis,
  extractedData: ConversationProcessingResult['extractedData']
): ConversationAiAnalysis {
  if (aiAnalysis.intent !== 'collect_company') {
    return aiAnalysis
  }

  if (extractedData.problemDetails && extractedData.problemSummary) {
    return {
      ...aiAnalysis,
      intent: 'ready_for_confirmation',
      readyForConfirmation: true,
      shouldCreateTicket: false,
      userConfirmed: false,
      clarificationRequested: false
    }
  }

  return {
    ...aiAnalysis,
    intent: 'collect_problem',
    readyForConfirmation: false,
    shouldCreateTicket: false,
    userConfirmed: false,
    clarificationRequested: false,
    assistantResponse: 'Como posso te ajudar? Conte brevemente sua solicitação.'
  }
}

function applyClarificationPolicy(
  session: ClaimedConversationSession,
  aiAnalysis: ConversationAiAnalysis,
  extractedData: ConversationProcessingResult['extractedData']
): ConversationAiAnalysis {
  const clarificationAllowed =
    session.conversationMode === 'USER' &&
    session.clarificationAttempts < 1 &&
    !isUrgentRequest(extractedData.problemDetails)
  const equipmentClarificationQuestion = buildEquipmentClarificationQuestion(
    extractedData.problemDetails
  )

  if (
    clarificationAllowed &&
    equipmentClarificationQuestion &&
    !aiAnalysis.userConfirmed &&
    !['handoff_to_human', 'service_inquiry'].includes(aiAnalysis.intent)
  ) {
    return {
      ...aiAnalysis,
      intent: 'collect_problem',
      clarificationRequested: true,
      readyForConfirmation: false,
      shouldCreateTicket: false,
      userConfirmed: false,
      assistantResponse: equipmentClarificationQuestion
    }
  }

  const isOptionalClarification =
    aiAnalysis.intent === 'collect_problem' &&
    Boolean(extractedData.problemDetails)

  if (!isOptionalClarification) {
    return {
      ...aiAnalysis,
      clarificationRequested: false
    }
  }

  if (clarificationAllowed) {
    return {
      ...aiAnalysis,
      intent: 'collect_problem',
      clarificationRequested: true,
      readyForConfirmation: false,
      shouldCreateTicket: false,
      userConfirmed: false
    }
  }

  const summary = extractedData.problemSummary ?? extractedData.problemDetails

  return {
    ...aiAnalysis,
    intent: 'ready_for_confirmation',
    clarificationRequested: false,
    readyForConfirmation: true,
    shouldCreateTicket: false,
    userConfirmed: false,
    assistantResponse: `Entendido, só para confirmar: ${summary}. Posso abrir o chamado assim ou deseja adicionar mais detalhes?`,
    extractedData: {
      ...aiAnalysis.extractedData,
      problemSummary: summary
    }
  }
}

function explicitlyDeclinedCompany(messages: PendingConversationMessage[]) {
  const normalizedMessages = normalizeForClarification(
    messages
      .map((message) => message.content ?? '')
      .join(' ')
  )

  return /\b(nao tenho empresa|nao sou de empresa|nao se aplica|sou particular|atendimento particular)\b/.test(
    normalizedMessages
  )
}

function applyOptionalCompanyPromptPolicy(
  session: ClaimedConversationSession,
  messages: PendingConversationMessage[],
  aiAnalysis: ConversationAiAnalysis,
  extractedData: ConversationProcessingResult['extractedData']
) {
  const shouldRequestCompany =
    session.conversationMode === 'USER' &&
    session.companyPromptAttempts < 1 &&
    !extractedData.companyName &&
    Boolean(extractedData.problemDetails) &&
    Boolean(extractedData.problemSummary) &&
    !isUrgentRequest(extractedData.problemDetails) &&
    !aiAnalysis.clarificationRequested &&
    !aiAnalysis.userConfirmed &&
    !['handoff_to_human', 'service_inquiry'].includes(aiAnalysis.intent) &&
    !explicitlyDeclinedCompany(messages)

  if (!shouldRequestCompany) {
    return {
      aiAnalysis,
      companyPromptRequested: false
    }
  }

  return {
    aiAnalysis: {
      ...aiAnalysis,
      intent: 'collect_problem' as const,
      readyForConfirmation: false,
      shouldCreateTicket: false,
      userConfirmed: false,
      clarificationRequested: false,
      assistantResponse:
        'Antes de abrir o chamado, você pertence a alguma empresa ou unidade atendida pela ONTECH? Se sim, informe o nome. Se não, pode responder "não se aplica".'
    },
    companyPromptRequested: true
  }
}

export async function processConversationTurn(
  input: ConversationProcessingInput
): Promise<ConversationProcessingResult> {
  if (input.session.status === 'DONE') {
    return {
      messageCount: input.messages.length,
      hasMedia: input.messages.some((message) => Boolean(message.mediaUrl)),
      textPreview: buildTextPreview(input.messages),
      aiAnalysis: null,
      nextStatus: 'DONE',
      nextAction: 'WAIT_FOR_USER',
      awaitingConfirmation: false,
      shouldCreateTicket: false,
      shouldRequestHumanHandoff: false,
      companyPromptRequested: false,
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

  if (input.session.status === 'HANDOFF_TO_HUMAN') {
    return {
      messageCount: input.messages.length,
      hasMedia: input.messages.some((message) => Boolean(message.mediaUrl)),
      textPreview: buildTextPreview(input.messages),
      aiAnalysis: null,
      nextStatus: 'HANDOFF_TO_HUMAN',
      nextAction: 'HANDOFF_TO_HUMAN',
      awaitingConfirmation: false,
      shouldCreateTicket: false,
      shouldRequestHumanHandoff: true,
      companyPromptRequested: false,
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
      companyPromptRequested: false,
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

  const rawAiAnalysis = await analyzeConversationWithGemini(
    input.session,
    input.messages
  )

  const contactName =
    rawAiAnalysis.extractedData.requesterName ?? input.session.contactName
  const companyName =
    rawAiAnalysis.extractedData.companyName ?? input.session.companyName
  const problemDetails =
    rawAiAnalysis.extractedData.problemDetails ?? input.session.problemDetails
  const problemSummary =
    rawAiAnalysis.extractedData.problemSummary ?? input.session.problemSummary

  const extractedData = {
    contactName,
    companyName,
    problemDetails,
    problemSummary
  }
  const companyNormalizedAiAnalysis = applyOptionalCompanyPolicy(
    rawAiAnalysis,
    extractedData
  )
  const clarificationAdjustedAiAnalysis = applyClarificationPolicy(
    input.session,
    companyNormalizedAiAnalysis,
    extractedData
  )
  const companyPromptPolicy = applyOptionalCompanyPromptPolicy(
    input.session,
    input.messages,
    clarificationAdjustedAiAnalysis,
    extractedData
  )
  const aiAnalysis = companyPromptPolicy.aiAnalysis
  const normalizedProblemSummary =
    aiAnalysis.extractedData.problemSummary ?? problemSummary

  const transition = resolveConversationStateTransition({
    session: input.session,
    aiAnalysis,
    extractedData: {
      contactName,
      companyName,
      problemDetails,
      problemSummary: normalizedProblemSummary
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
    companyPromptRequested: companyPromptPolicy.companyPromptRequested,
    ticketDraft: aiAnalysis.ticketDraft,
    extractedData: {
      contactName,
      companyName,
      problemDetails,
      problemSummary: normalizedProblemSummary
    }
  }
}
