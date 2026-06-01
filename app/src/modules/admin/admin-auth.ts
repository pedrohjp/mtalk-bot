import { FastifyReply, FastifyRequest } from 'fastify'
import { env } from '../../config/env'

export function readBearerToken(authorizationHeader: string | undefined) {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    return null
  }

  const token = authorizationHeader.substring(7).trim()
  return token.length > 0 ? token : null
}

export function ensureAdminToken(
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (!env.adminApiToken) {
    return reply.status(503).send({
      ok: false,
      error: 'admin_api_disabled'
    })
  }

  const receivedToken = readBearerToken(request.headers.authorization)

  if (!receivedToken || receivedToken !== env.adminApiToken) {
    return reply.status(401).send({
      ok: false,
      error: 'invalid_admin_token'
    })
  }

  return null
}
