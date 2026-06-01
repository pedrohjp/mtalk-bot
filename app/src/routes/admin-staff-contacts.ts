import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ensureAdminToken } from '../modules/admin/admin-auth'
import {
  addStaffContact,
  listStaffContacts,
  removeStaffContact
} from '../modules/staff/staff.repository'

type AddStaffContactBody = {
  number?: string
}

type RemoveStaffContactParams = {
  number: string
}

export async function adminStaffContactRoutes(app: FastifyInstance) {
  app.get(
    '/admin/staff-contacts',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authError = ensureAdminToken(request, reply)

      if (authError) {
        return authError
      }

      const contacts = await listStaffContacts()

      return reply.status(200).send(contacts)
    }
  )

  app.post(
    '/admin/staff-contacts',
    async (
      request: FastifyRequest<{ Body: AddStaffContactBody }>,
      reply: FastifyReply
    ) => {
      const authError = ensureAdminToken(request, reply)

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
    '/admin/staff-contacts/:number',
    async (
      request: FastifyRequest<{ Params: RemoveStaffContactParams }>,
      reply: FastifyReply
    ) => {
      const authError = ensureAdminToken(request, reply)

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
}
