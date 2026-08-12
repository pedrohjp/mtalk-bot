import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  getConversationPrompt,
  updateConversationPrompt
} from '../modules/admin/prompt.repository'
import {
  getMtalkRoutingConfig,
  updateMtalkRoutingConfig
} from '../modules/admin/mtalk-routing.repository'
import {
  addStaffContact,
  listStaffContacts,
  removeStaffContact
} from '../modules/staff/staff.repository'
import { listTicketzQueues } from '../modules/mtalk/ticketz.client'
import {
  getConversationWelcomeMessage,
  updateConversationWelcomeMessage
} from '../modules/admin/welcome-message.repository'

const ADMIN_UI_USERNAME = 'admin'
const ADMIN_UI_PASSWORD = '123456'
const ADMIN_UI_COOKIE_NAME = 'mtalk_admin_ui_session'
const ADMIN_UI_SESSION_TTL_SECONDS = 60 * 60 * 12

type LoginBody = {
  username?: string
  password?: string
}

type UpdatePromptBody = {
  content?: string
}

type UpdateWelcomeMessageBody = {
  content?: string
}

type AddStaffContactBody = {
  number?: string
}

type UpdateMtalkRoutingConfigBody = {
  initialQueueId?: number | null
  aiQueueId?: number | null
  humanQueueId?: number | null
}

type RemoveStaffContactParams = {
  number: string
}

const assetsDirectory = path.join(process.cwd(), 'src', 'admin-ui')

function getAdminUiSessionSecret() {
  const secretSeed = process.env.ADMIN_API_TOKEN || 'mtalk-admin-ui-session-secret'

  return crypto
    .createHash('sha256')
    .update(secretSeed)
    .digest('hex')
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function signAdminUiValue(value: string) {
  return crypto
    .createHmac('sha256', getAdminUiSessionSecret())
    .update(value)
    .digest('base64url')
}

function createAdminUiSessionCookieValue() {
  const payload = {
    username: ADMIN_UI_USERNAME,
    exp: Math.floor(Date.now() / 1000) + ADMIN_UI_SESSION_TTL_SECONDS
  }

  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const signature = signAdminUiValue(encodedPayload)

  return `${encodedPayload}.${signature}`
}

function parseCookies(cookieHeader: string | undefined) {
  if (!cookieHeader) {
    return {}
  }

  return cookieHeader.split(';').reduce<Record<string, string>>((acc, item) => {
    const separatorIndex = item.indexOf('=')

    if (separatorIndex === -1) {
      return acc
    }

    const key = item.slice(0, separatorIndex).trim()
    const value = item.slice(separatorIndex + 1).trim()
    acc[key] = value
    return acc
  }, {})
}

function isAdminUiAuthenticated(request: FastifyRequest) {
  const cookies = parseCookies(request.headers.cookie)
  const rawValue = cookies[ADMIN_UI_COOKIE_NAME]

  if (!rawValue) {
    return false
  }

  const separatorIndex = rawValue.lastIndexOf('.')

  if (separatorIndex === -1) {
    return false
  }

  const encodedPayload = rawValue.slice(0, separatorIndex)
  const receivedSignature = rawValue.slice(separatorIndex + 1)
  const expectedSignature = signAdminUiValue(encodedPayload)
  const receivedBuffer = Buffer.from(receivedSignature)
  const expectedBuffer = Buffer.from(expectedSignature)

  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return false
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as {
      username?: string
      exp?: number
    }

    if (
      payload.username !== ADMIN_UI_USERNAME ||
      typeof payload.exp !== 'number' ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return false
    }

    return true
  } catch {
    return false
  }
}

function setAdminUiSessionCookie(reply: FastifyReply) {
  const cookieValue = createAdminUiSessionCookieValue()
  const maxAge = ADMIN_UI_SESSION_TTL_SECONDS

  reply.header(
    'set-cookie',
    `${ADMIN_UI_COOKIE_NAME}=${cookieValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
  )
}

function clearAdminUiSessionCookie(reply: FastifyReply) {
  reply.header(
    'set-cookie',
    `${ADMIN_UI_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  )
}

function ensureAdminUiSession(request: FastifyRequest, reply: FastifyReply) {
  if (isAdminUiAuthenticated(request)) {
    return null
  }

  return reply.status(401).send({
    ok: false,
    error: 'unauthorized'
  })
}

async function sendAdminUiAsset(
  reply: FastifyReply,
  fileName: string,
  contentType: string
) {
  const filePath = path.join(assetsDirectory, fileName)
  const content = await fs.readFile(filePath, 'utf8')
  return reply.type(contentType).send(content)
}

export async function adminWebRoutes(app: FastifyInstance) {
  app.get('/admin-ui', async (_request, reply) => {
    return sendAdminUiAsset(reply, 'index.html', 'text/html; charset=utf-8')
  })

  app.get('/admin-ui/', async (_request, reply) => {
    return sendAdminUiAsset(reply, 'index.html', 'text/html; charset=utf-8')
  })

  app.get('/admin-ui/app.js', async (_request, reply) => {
    return sendAdminUiAsset(
      reply,
      'app.js',
      'application/javascript; charset=utf-8'
    )
  })

  app.get('/admin-ui/styles.css', async (_request, reply) => {
    return sendAdminUiAsset(reply, 'styles.css', 'text/css; charset=utf-8')
  })

  app.get('/admin-ui/api/session', async (request, reply) => {
    return reply.status(200).send({
      authenticated: isAdminUiAuthenticated(request)
    })
  })

  app.post(
    '/admin-ui/api/login',
    async (
      request: FastifyRequest<{ Body: LoginBody }>,
      reply: FastifyReply
    ) => {
      const username =
        typeof request.body?.username === 'string' ? request.body.username : ''
      const password =
        typeof request.body?.password === 'string' ? request.body.password : ''

      if (
        username !== ADMIN_UI_USERNAME ||
        password !== ADMIN_UI_PASSWORD
      ) {
        clearAdminUiSessionCookie(reply)

        return reply.status(401).send({
          ok: false,
          error: 'invalid_credentials'
        })
      }

      setAdminUiSessionCookie(reply)

      return reply.status(200).send({
        ok: true
      })
    }
  )

  app.post('/admin-ui/api/logout', async (_request, reply) => {
    clearAdminUiSessionCookie(reply)

    return reply.status(200).send({
      ok: true
    })
  })

  app.get('/admin-ui/api/prompt', async (request, reply) => {
    const authError = ensureAdminUiSession(request, reply)

    if (authError) {
      return authError
    }

    const prompt = await getConversationPrompt()

    return reply.status(200).send({
      key: prompt.key,
      version: prompt.version,
      content: prompt.content,
      isActive: prompt.isActive,
      createdAt: prompt.createdAt
    })
  })

  app.put(
    '/admin-ui/api/prompt',
    async (
      request: FastifyRequest<{ Body: UpdatePromptBody }>,
      reply: FastifyReply
    ) => {
      const authError = ensureAdminUiSession(request, reply)

      if (authError) {
        return authError
      }

      const content =
        typeof request.body?.content === 'string' ? request.body.content : ''

      if (content.trim().length === 0) {
        return reply.status(400).send({
          ok: false,
          error: 'invalid_prompt_content'
        })
      }

      const prompt = await updateConversationPrompt(content)

      return reply.status(200).send({
        ok: true,
        key: prompt.key,
        version: prompt.version,
        content: prompt.content,
        isActive: prompt.isActive,
        createdAt: prompt.createdAt
      })
    }
  )

  app.get('/admin-ui/api/welcome-message', async (request, reply) => {
    const authError = ensureAdminUiSession(request, reply)

    if (authError) {
      return authError
    }

    const content = await getConversationWelcomeMessage()

    return reply.status(200).send({ content })
  })

  app.put(
    '/admin-ui/api/welcome-message',
    async (
      request: FastifyRequest<{ Body: UpdateWelcomeMessageBody }>,
      reply: FastifyReply
    ) => {
      const authError = ensureAdminUiSession(request, reply)

      if (authError) {
        return authError
      }

      const content =
        typeof request.body?.content === 'string' ? request.body.content : ''

      if (!content.trim()) {
        return reply.status(400).send({
          ok: false,
          error: 'invalid_welcome_message_content'
        })
      }

      const updatedContent = await updateConversationWelcomeMessage(content)

      return reply.status(200).send({
        ok: true,
        content: updatedContent
      })
    }
  )

  app.get('/admin-ui/api/staff-contacts', async (request, reply) => {
    const authError = ensureAdminUiSession(request, reply)

    if (authError) {
      return authError
    }

    const contacts = await listStaffContacts()

    return reply.status(200).send(contacts)
  })

  app.post(
    '/admin-ui/api/staff-contacts',
    async (
      request: FastifyRequest<{ Body: AddStaffContactBody }>,
      reply: FastifyReply
    ) => {
      const authError = ensureAdminUiSession(request, reply)

      if (authError) {
        return authError
      }

      const number =
        typeof request.body?.number === 'string' ? request.body.number : ''

      if (number.trim().length === 0) {
        return reply.status(400).send({
          ok: false,
          error: 'invalid_phone_number'
        })
      }

      const normalizedNumber = await addStaffContact(number)

      return reply.status(201).send({
        ok: true,
        number: normalizedNumber
      })
    }
  )

  app.delete(
    '/admin-ui/api/staff-contacts/:number',
    async (
      request: FastifyRequest<{ Params: RemoveStaffContactParams }>,
      reply: FastifyReply
    ) => {
      const authError = ensureAdminUiSession(request, reply)

      if (authError) {
        return authError
      }

      const removed = await removeStaffContact(request.params.number)

      return reply.status(200).send({
        ok: true,
        removed
      })
    }
  )

  app.get('/admin-ui/api/queues', async (request, reply) => {
    const authError = ensureAdminUiSession(request, reply)

    if (authError) {
      return authError
    }

    const queues = await listTicketzQueues()

    return reply.status(200).send(queues)
  })

  app.get('/admin-ui/api/mtalk-routing-config', async (request, reply) => {
    const authError = ensureAdminUiSession(request, reply)

    if (authError) {
      return authError
    }

    const config = await getMtalkRoutingConfig()

    return reply.status(200).send(config)
  })

  app.put(
    '/admin-ui/api/mtalk-routing-config',
    async (
      request: FastifyRequest<{ Body: UpdateMtalkRoutingConfigBody }>,
      reply: FastifyReply
    ) => {
      const authError = ensureAdminUiSession(request, reply)

      if (authError) {
        return authError
      }

      const config = await updateMtalkRoutingConfig({
        initialQueueId: request.body?.initialQueueId ?? null,
        aiQueueId: request.body?.aiQueueId ?? null,
        humanQueueId: request.body?.humanQueueId ?? null
      })

      return reply.status(200).send({
        ok: true,
        ...config
      })
    }
  )
}
