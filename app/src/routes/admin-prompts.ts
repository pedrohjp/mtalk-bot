import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ensureAdminToken } from '../modules/admin/admin-auth'
import {
  getConversationPrompt,
  updateConversationPrompt
} from '../modules/admin/prompt.repository'

type UpdateConversationPromptBody = {
  content?: string
}

export async function adminPromptRoutes(app: FastifyInstance) {
  app.get(
    '/admin/prompts/conversation',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authError = ensureAdminToken(request, reply)

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
    }
  )

  app.put(
    '/admin/prompts/conversation',
    async (
      request: FastifyRequest<{ Body: UpdateConversationPromptBody }>,
      reply: FastifyReply
    ) => {
      const authError = ensureAdminToken(request, reply)

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
}
