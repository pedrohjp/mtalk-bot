import { queryDb, withDbTransaction } from '../../database/db'
import { ConversationMode } from '../conversations/conversation.types'

type StaffContactRow = {
  phone_number: string
}

export function normalizeStaffPhoneNumber(value: string) {
  return value.replace(/\D/g, '').trim()
}

export function isStaffFastTicketCommand(content: string | null) {
  if (!content) {
    return false
  }

  return /^novo chamado\b/i.test(content.trim())
}

export function stripStaffFastTicketCommand(content: string | null) {
  if (!content) {
    return null
  }

  const normalizedContent = content.trim().replace(/^novo chamado\b[:\s-]*/i, '')
  return normalizedContent.length > 0 ? normalizedContent : null
}

export async function listStaffContacts() {
  const result = await queryDb<StaffContactRow>(
    `
      SELECT phone_number
      FROM staff_contacts
      ORDER BY phone_number ASC
    `
  )

  return result.rows.map((row) => row.phone_number)
}

export async function addStaffContact(phoneNumber: string) {
  const normalizedPhoneNumber = normalizeStaffPhoneNumber(phoneNumber)

  if (normalizedPhoneNumber.length === 0) {
    throw new Error('Phone number cannot be empty')
  }

  await withDbTransaction(async (client) => {
    await client.query(
      `
        INSERT INTO staff_contacts (phone_number)
        VALUES ($1)
        ON CONFLICT (phone_number) DO NOTHING
      `,
      [normalizedPhoneNumber]
    )
  })

  return normalizedPhoneNumber
}

export async function removeStaffContact(phoneNumber: string) {
  const normalizedPhoneNumber = normalizeStaffPhoneNumber(phoneNumber)

  if (normalizedPhoneNumber.length === 0) {
    throw new Error('Phone number cannot be empty')
  }

  const result = await withDbTransaction((client) =>
    client.query(
      `
        DELETE FROM staff_contacts
        WHERE phone_number = $1
      `,
      [normalizedPhoneNumber]
    )
  )

  return (result.rowCount ?? 0) > 0
}

export async function isStaffContact(phoneNumber: string | null) {
  if (!phoneNumber) {
    return false
  }

  const normalizedPhoneNumber = normalizeStaffPhoneNumber(phoneNumber)

  if (normalizedPhoneNumber.length === 0) {
    return false
  }

  const result = await queryDb<StaffContactRow>(
    `
      SELECT phone_number
      FROM staff_contacts
      WHERE phone_number = $1
      LIMIT 1
    `,
    [normalizedPhoneNumber]
  )

  return (result.rowCount ?? 0) > 0
}

export async function resolveConversationMode(
  contactNumber: string | null,
  content: string | null
): Promise<ConversationMode> {
  const staffContact = await isStaffContact(contactNumber)

  if (staffContact && isStaffFastTicketCommand(content)) {
    return 'STAFF_FAST_TICKET'
  }

  return 'USER'
}
