import {
  ConversationTicketDraft,
  TicketPriority,
  TicketType
} from './conversation.ai'
import { ClaimedConversationSession } from './conversation.repository'

type BuildTicketCandidateInput = {
  session: ClaimedConversationSession
  ticketDraft: ConversationTicketDraft
  extractedData: {
    contactName: string | null
    companyName: string | null
    problemDetails: string | null
    problemSummary: string | null
  }
}

export type GlpiTicketCandidate = {
  companyName: string
  glpiEntityId: number | null
  type: TicketType
  priority: TicketPriority
  title: string
  content: string
}

export type GlpiTicketRequestPayload = {
  input: {
    name: string
    content: string
    entities_id?: number
    status: number
    urgency: number
    impact: number
    priority: number
    _users_id_requester: number
    type: number
  }
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function removeDiacritics(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function normalizeForClassification(value: string | null) {
  return removeDiacritics(compactWhitespace(value ?? '').toLowerCase())
}

function buildTicketTitle(companyName: string | null, problemSummary: string | null) {
  const normalizedSummary = problemSummary
    ? compactWhitespace(problemSummary)
    : 'Solicitacao de suporte'

  return (companyName
    ? `${companyName} - ${normalizedSummary}`
    : normalizedSummary
  ).slice(0, 120)
}

function inferTicketType(problemDetails: string | null): TicketType {
  const normalizedText = normalizeForClassification(problemDetails)

  if (
    /\b(duvida|como|solicita|solicitacao|configura|cadastro|ajuste|instalar|instalacao|acesso|liberar)\b/.test(
      normalizedText
    )
  ) {
    return 'request'
  }

  return 'incident'
}

function inferTicketPriority(problemDetails: string | null): TicketPriority {
  const normalizedText = normalizeForClassification(problemDetails)

  if (
    /\b(critico|critica|risco grave|perigo|emergencia)\b/.test(
      normalizedText
    )
  ) {
    return 'critical'
  }

  if (
    /\b(muito urgente|urgencia maxima|parado total|empresa parada)\b/.test(
      normalizedText
    )
  ) {
    return 'very_high'
  }

  if (
    /\b(urgente|parado|sem atender|sem conseguir atender|nao consigo trabalhar|impactando clientes)\b/.test(
      normalizedText
    )
  ) {
    return 'high'
  }

  if (
    /\b(duvida simples|sem pressa|quando puder|sem urgencia)\b/.test(
      normalizedText
    )
  ) {
    return 'low'
  }

  return 'medium'
}

export function buildGlpiTicketCandidate(
  input: BuildTicketCandidateInput
): GlpiTicketCandidate {
  const informedCompanyName =
    input.session.glpiEntityName ??
    input.extractedData.companyName
  const companyName = informedCompanyName ?? 'Empresa nao informada'
  const requesterName = input.extractedData.contactName ?? 'Nao informado'
  const contactNumber = input.session.contactNumber ?? 'Nao informado'
  const problemSummary =
    input.extractedData.problemSummary ?? 'Resumo nao informado'
  const problemDetails =
    input.extractedData.problemDetails ?? 'Detalhes nao informados'
  const ticketType =
    input.ticketDraft.type ?? inferTicketType(input.extractedData.problemDetails)
  const ticketPriority =
    input.ticketDraft.priority ??
    inferTicketPriority(input.extractedData.problemDetails)
  const title =
    input.ticketDraft.title ??
    buildTicketTitle(informedCompanyName, input.extractedData.problemSummary)
  const description =
    input.ticketDraft.description ??
    [
      `Empresa: ${companyName}`,
      `Solicitante: ${requesterName}`,
      `Telefone: ${contactNumber}`,
      '',
      `Resumo: ${problemSummary}`,
      '',
      `Detalhes: ${problemDetails}`
    ].join('\n')

  return {
    companyName,
    glpiEntityId: input.session.glpiEntityId,
    type: ticketType,
    priority: ticketPriority,
    title,
    content: description
  }
}

function mapTicketTypeToGlpi(type: TicketType) {
  return type === 'incident' ? 1 : 2
}

function mapTicketPriorityToGlpi(priority: TicketPriority) {
  switch (priority) {
    case 'low':
      return 2
    case 'medium':
      return 3
    case 'high':
      return 4
    case 'very_high':
      return 5
    case 'critical':
      return 6
  }
}

export function buildGlpiTicketRequestPayload(
  candidate: GlpiTicketCandidate
): GlpiTicketRequestPayload {
  const glpiPriority = mapTicketPriorityToGlpi(candidate.priority)

  return {
    input: {
      name: candidate.title,
      content: candidate.content,
      ...(candidate.glpiEntityId
        ? { entities_id: candidate.glpiEntityId }
        : {}),
      status: 1,
      urgency: glpiPriority,
      impact: glpiPriority,
      priority: glpiPriority,
      _users_id_requester: 81,
      type: mapTicketTypeToGlpi(candidate.type)
    }
  }
}
