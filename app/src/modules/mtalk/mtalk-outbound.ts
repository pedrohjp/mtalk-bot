import { env } from '../../config/env'

type SendMtalkTextMessageInput = {
  number: string
  body: string
}

type MtalkSendMessageResponse = {
  [key: string]: unknown
}

export class MtalkOutboundUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MtalkOutboundUnavailableError'
  }
}

export class MtalkOutboundRequestError extends Error {
  statusCode: number
  responseBody: unknown

  constructor(message: string, statusCode: number, responseBody: unknown) {
    super(message)
    this.name = 'MtalkOutboundRequestError'
    this.statusCode = statusCode
    this.responseBody = responseBody
  }
}

export async function sendMtalkTextMessage(
  input: SendMtalkTextMessageInput
): Promise<MtalkSendMessageResponse | null> {
  if (!env.mtalkApiSendMessageUrl || !env.mtalkApiToken) {
    throw new MtalkOutboundUnavailableError(
      'MTALK outbound API is not configured'
    )
  }

  const response = await fetch(env.mtalkApiSendMessageUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.mtalkApiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      number: input.number,
      body: input.body,
      saveOnTicket: env.mtalkOutboundSaveOnTicket,
      linkPreview: false,
      startChatbot: false
    })
  })

  const rawText = await response.text()
  const parsedBody = rawText.length > 0 ? safeParseJson(rawText) : null

  if (!response.ok) {
    throw new MtalkOutboundRequestError(
      `MTALK outbound request failed with status ${response.status}`,
      response.status,
      parsedBody
    )
  }

  return parsedBody
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value) as MtalkSendMessageResponse
  } catch {
    return {
      raw: value
    }
  }
}
