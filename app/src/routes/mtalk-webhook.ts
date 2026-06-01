import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { env } from '../config/env'
import {
  ingestMtalkWebhook,
  InvalidMtalkWebhookPayloadError
} from '../modules/mtalk/ingest-mtalk-webhook'
import { MtalkWebhookPayload } from '../modules/mtalk/mtalk.types'

export async function mtalkWebhookRoutes(app: FastifyInstance) {
  app.post(
    '/webhooks/mtalk',
    async (
      request: FastifyRequest<{ Body: MtalkWebhookPayload }>,
      reply: FastifyReply
    ) => {
      const body = request.body
      const expectedToken = env.mtalkWebhookToken

      const authHeader = request.headers.authorization
      const receivedToken = authHeader?.startsWith('Bearer ')
        ? authHeader.substring(7)
        : undefined

     if (!receivedToken || receivedToken !== expectedToken) {
        app.log.warn({
          msg: 'Invalid MTALK webhook token',
          receivedToken
        })

        return reply.status(401).send({
          ok: false,
          error: 'invalid_token'
        })
      }

      try {
        const { normalizedMessage, conversationMode, persistenceResult } =
          await ingestMtalkWebhook(body)

        app.log.info({
          msg: 'MTALK webhook persisted',
          mtalkTicketId: normalizedMessage.mtalkTicketId,
          externalMessageId: normalizedMessage.externalMessageId,
          conversationMode,
          messageType: normalizedMessage.messageType,
          messageStored: persistenceResult.messageStored,
          conversationSessionCreated:
            persistenceResult.conversationSessionCreated,
          attachmentStored: persistenceResult.attachmentStored,
          nextProcessingAt: persistenceResult.nextProcessingAt,
          rawBody: body
        })

        return reply.status(200).send({
          ok: true,
          messageStored: persistenceResult.messageStored
        })
      } catch (error) {
        if (error instanceof InvalidMtalkWebhookPayloadError) {
          app.log.warn({
            msg: 'Invalid MTALK webhook payload',
            error: error.message,
            rawBody: body
          })

          return reply.status(400).send({
            ok: false,
            error: 'invalid_payload',
            message: error.message
          })
        }

        app.log.error({
          msg: 'Failed to persist MTALK webhook',
          error,
          rawBody: body
        })

        return reply.status(500).send({
          ok: false,
          error: 'internal_error'
        })
      }
    }
  )
}
