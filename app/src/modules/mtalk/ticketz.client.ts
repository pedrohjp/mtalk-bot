import { env } from '../../config/env'

type TicketzLoginResponse = {
  token?: string
}

type TicketzLoginRequestPayload = {
  email: string
  password: string
  replaceSessionsMode: 'all'
  sameDeviceTypeOnly: boolean
  pushSubscription: {
    endpoint: string
    expirationTime: null
    keys: {
      p256dh: string
      auth: string
    }
  }
}

const DEFAULT_TICKETZ_PUSH_SUBSCRIPTION = {
  endpoint:
    'https://fcm.googleapis.com/fcm/send/e-92ArOnceA:APA91bFIYgn2KvCCO57xOeepadiZb_TvknFzb3QDZGmN0muDCfU9iLvrnCQR7pxFSoyq65fYwpnrDDoT4NYrgW9lcFdGfLgVHcntaFYtqcRlRc7qPbrbpsDXZ-TQ1pzh101xBR5a01IJ',
  expirationTime: null,
  keys: {
    p256dh:
      'BF-KdDBPy9fIpjtG58MfUGIF9iThGEp8uLnewzMA3SAPo8pfPUhB1kO5C9SQKtdqReSv9FYjDSQLmJIfJVTGKhU',
    auth: 'WPmKGOyaPpNuFcF5z4ut5w'
  }
} as const

export type TicketzQueue = {
  id: number
  name: string
  color: string | null
}

type TicketzAuthSession = {
  token: string
  cookieHeader: string
}

type TicketzTicketResponse = {
  id?: number
  status?: string
  queueId?: number | null
  userId?: number | null
  [key: string]: unknown
}

type TicketzUpdateTicketPayload = {
  status?: string
  justClose?: boolean
  userId?: number | null
  queueId?: number | null
}

export class TicketzConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TicketzConfigurationError'
  }
}

export class TicketzRequestError extends Error {
  statusCode: number
  responseBody: unknown

  constructor(message: string, statusCode: number, responseBody: unknown) {
    super(message)
    this.name = 'TicketzRequestError'
    this.statusCode = statusCode
    this.responseBody = responseBody
  }
}

function resolveTicketzBaseUrl() {
  if (env.ticketzBaseUrl) {
    return env.ticketzBaseUrl.replace(/\/+$/, '')
  }

  if (!env.mtalkApiSendMessageUrl) {
    throw new TicketzConfigurationError(
      'Ticketz base URL could not be derived because MTALK_API_SEND_MESSAGE_URL is missing'
    )
  }

  const sendMessageUrl = new URL(env.mtalkApiSendMessageUrl)
  const derivedPath = sendMessageUrl.pathname.replace(
    /\/api\/messages\/send\/?$/i,
    ''
  )

  return `${sendMessageUrl.origin}${derivedPath}`
}

function getTicketzCredentials() {
  const email = env.ticketzPanelEmail
  const password = env.ticketzPanelPassword

  if (!email || !password) {
    throw new TicketzConfigurationError(
      'Ticketz panel credentials are not configured'
    )
  }

  return { email, password }
}

async function parseResponseBody(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return response.json()
  }

  return response.text()
}

async function ticketzRequest<T>(
  path: string,
  init: RequestInit & { token: string }
) {
  const baseUrl = resolveTicketzBaseUrl()
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${init.token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {})
    }
  })

  const responseBody = await parseResponseBody(response)

  if (!response.ok) {
    throw new TicketzRequestError(
      `Ticketz request failed with status ${response.status}`,
      response.status,
      responseBody
    )
  }

  return responseBody as T
}

function buildTicketzAuthHeaders(auth: TicketzAuthSession) {
  return auth.cookieHeader
    ? {
        Cookie: auth.cookieHeader
      }
    : undefined
}

async function authenticateTicketzPanel() {
  const { email, password } = getTicketzCredentials()
  const baseUrl = resolveTicketzBaseUrl()
  const loginUrl = `${baseUrl}/auth/login`
  const loginPayload: TicketzLoginRequestPayload = {
    email,
    password,
    replaceSessionsMode: 'all',
    sameDeviceTypeOnly: false,
    pushSubscription: DEFAULT_TICKETZ_PUSH_SUBSCRIPTION
  }

  console.log(
    [
      '===== TICKETZ LOGIN REQUEST START =====',
      `url: ${loginUrl}`,
      `body: ${JSON.stringify(loginPayload, null, 2)}`,
      '===== TICKETZ LOGIN REQUEST END ====='
    ].join('\n')
  )

  const response = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(loginPayload)
  })

  const responseBody = (await parseResponseBody(
    response
  )) as TicketzLoginResponse | string

  console.log(
    [
      '===== TICKETZ LOGIN RESPONSE START =====',
      `url: ${loginUrl}`,
      `status: ${response.status}`,
      `ok: ${response.ok}`,
      `body: ${
        typeof responseBody === 'string'
          ? responseBody
          : JSON.stringify(responseBody, null, 2)
      }`,
      '===== TICKETZ LOGIN RESPONSE END ====='
    ].join('\n')
  )

  if (!response.ok) {
    throw new TicketzRequestError(
      `Ticketz login failed with status ${response.status}`,
      response.status,
      responseBody
    )
  }

  if (
    !responseBody ||
    typeof responseBody !== 'object' ||
    typeof responseBody.token !== 'string'
  ) {
    throw new TicketzRequestError(
      'Ticketz login returned no token',
      response.status,
      responseBody
    )
  }

  const rawSetCookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : []
  const cookieHeader = rawSetCookies
    .map((entry) => entry.split(';', 1)[0]?.trim())
    .filter((entry): entry is string => Boolean(entry))
    .join('; ')

  return {
    token: responseBody.token,
    cookieHeader
  }
}

export async function listTicketzQueues() {
  const auth = await authenticateTicketzPanel()
  const queues = await ticketzRequest<
    Array<{ id: number; name: string; color?: string | null }>
  >('/queue', {
    method: 'GET',
    token: auth.token,
    headers: buildTicketzAuthHeaders(auth)
  })

  return queues.map((queue) => ({
    id: Number(queue.id),
    name: queue.name,
    color: queue.color ?? null
  }))
}

export async function closeTicketzTicket(ticketId: string) {
  const auth = await authenticateTicketzPanel()

  const closedTicket = await ticketzRequest<TicketzTicketResponse>(
    `/tickets/${ticketId}`,
    {
    method: 'PUT',
    token: auth.token,
    headers: buildTicketzAuthHeaders(auth),
    body: JSON.stringify({
      status: 'closed',
      justClose: true,
      userId: null,
      queueId: null
    } satisfies TicketzUpdateTicketPayload)
    }
  )

  if (closedTicket.status !== 'closed') {
    throw new TicketzRequestError(
      'Ticketz close request did not return a closed ticket',
      200,
      closedTicket
    )
  }

  return closedTicket
}

export async function transferTicketzTicketToQueue(
  ticketId: string,
  queueId: number
) {
  const auth = await authenticateTicketzPanel()

  return ticketzRequest(`/tickets/${ticketId}`, {
    method: 'PUT',
    token: auth.token,
    headers: buildTicketzAuthHeaders(auth),
    body: JSON.stringify({
      queueId,
      status: 'pending',
      userId: null
    } satisfies TicketzUpdateTicketPayload)
  })
}
