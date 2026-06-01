import { env } from '../../config/env'
import {
  GlpiCreateDocumentResponse,
  GlpiCreateTicketRequest,
  GlpiCreateTicketResponse,
  GlpiLinkDocumentItemRequest,
  GlpiLinkDocumentItemResponse,
  GlpiMyEntitiesResponse,
  GlpiSessionResponse,
  GlpiTicketUserItem
} from './glpi.types'

export class GlpiUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GlpiUnavailableError'
  }
}

export class GlpiRequestError extends Error {
  statusCode: number
  responseBody: unknown

  constructor(message: string, statusCode: number, responseBody: unknown) {
    super(message)
    this.name = 'GlpiRequestError'
    this.statusCode = statusCode
    this.responseBody = responseBody
  }
}

function requireGlpiConfig() {
  if (!env.glpiBaseUrl || !env.glpiAppToken || !env.glpiAuthorizationToken) {
    throw new GlpiUnavailableError('GLPI integration is not fully configured')
  }
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init)
  const rawText = await response.text()
  const parsedBody = rawText.length > 0 ? safeParseJson(rawText) : null

  if (!response.ok) {
    throw new GlpiRequestError(
      `GLPI request failed with status ${response.status}`,
      response.status,
      parsedBody
    )
  }

  return parsedBody as T
}

async function fetchWithoutJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init)
  const rawText = await response.text()
  const parsedBody = rawText.length > 0 ? safeParseJson(rawText) : null

  if (!response.ok) {
    throw new GlpiRequestError(
      `GLPI request failed with status ${response.status}`,
      response.status,
      parsedBody
    )
  }

  return parsedBody as T
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return { raw: value }
  }
}

export async function initGlpiSession() {
  requireGlpiConfig()

  return fetchJson<GlpiSessionResponse>(`${env.glpiBaseUrl}/initSession`, {
    method: 'GET',
    headers: {
      'App-Token': env.glpiAppToken!,
      'Content-Type': 'application/json',
      Authorization: `user_token ${env.glpiAuthorizationToken!}`
    }
  })
}

export async function getGlpiMyEntities(sessionToken: string) {
  requireGlpiConfig()

  return fetchJson<GlpiMyEntitiesResponse>(
    `${env.glpiBaseUrl}/getMyEntities?is_recursive=1`,
    {
      method: 'GET',
      headers: {
        'App-Token': env.glpiAppToken!,
        'Content-Type': 'application/json',
        'Session-Token': sessionToken
      }
    }
  )
}

export async function createGlpiTicket(
  sessionToken: string,
  payload: GlpiCreateTicketRequest
) {
  requireGlpiConfig()

  return fetchJson<GlpiCreateTicketResponse>(`${env.glpiBaseUrl}/Ticket/`, {
    method: 'POST',
    headers: {
      'App-Token': env.glpiAppToken!,
      'Content-Type': 'application/json',
      'Session-Token': sessionToken
    },
    body: JSON.stringify(payload)
  })
}

export async function createGlpiDocument(
  sessionToken: string,
  formData: FormData
) {
  requireGlpiConfig()

  return fetchWithoutJson<GlpiCreateDocumentResponse>(
    `${env.glpiBaseUrl}/Document/`,
    {
      method: 'POST',
      headers: {
        'App-Token': env.glpiAppToken!,
        'Session-Token': sessionToken
      },
      body: formData
    }
  )
}

export async function linkGlpiDocumentToTicket(
  sessionToken: string,
  payload: GlpiLinkDocumentItemRequest
) {
  requireGlpiConfig()

  return fetchJson<GlpiLinkDocumentItemResponse>(
    `${env.glpiBaseUrl}/Document_Item`,
    {
      method: 'POST',
      headers: {
        'App-Token': env.glpiAppToken!,
        'Content-Type': 'application/json',
        'Session-Token': sessionToken
      },
      body: JSON.stringify(payload)
    }
  )
}

export async function getGlpiTicketUsers(
  sessionToken: string,
  ticketId: number
) {
  requireGlpiConfig()

  return fetchJson<GlpiTicketUserItem[]>(
    `${env.glpiBaseUrl}/Ticket/${ticketId}/Ticket_User`,
    {
      method: 'GET',
      headers: {
        'App-Token': env.glpiAppToken!,
        'Content-Type': 'application/json',
        'Session-Token': sessionToken
      }
    }
  )
}
