import { queryDb, withDbTransaction } from '../../database/db'

const CONVERSATION_WELCOME_MESSAGE_KEY = 'conversation_welcome_message'

export const DEFAULT_CONVERSATION_WELCOME_MESSAGE = `Olá! Sou a OMNI, assistente virtual de suporte da ONTECH Assessoria Tecnológica.

Estou aqui para agilizar seu atendimento: vou entender sua solicitação e registrar um chamado para nossa equipe técnica.

Para começarmos, informe sua empresa ou unidade e conte com detalhes como posso ajudar.

Se houver alguma mensagem de erro na tela, você também pode enviar um print.`

type AppSettingRow = {
  setting_value: unknown
}

function normalizeWelcomeMessage(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

async function findWelcomeMessage() {
  const result = await queryDb<AppSettingRow>(
    `
      SELECT setting_value
      FROM app_settings
      WHERE setting_key = $1
      LIMIT 1
    `,
    [CONVERSATION_WELCOME_MESSAGE_KEY]
  )

  const content = normalizeWelcomeMessage(result.rows[0]?.setting_value)
  return content || null
}

export async function ensureConversationWelcomeMessage() {
  const existingMessage = await findWelcomeMessage()

  if (existingMessage) {
    return existingMessage
  }

  return withDbTransaction(async (client) => {
    const result = await client.query<AppSettingRow>(
      `
        INSERT INTO app_settings (
          setting_key,
          setting_value
        )
        VALUES ($1, $2::jsonb)
        ON CONFLICT (setting_key)
        DO UPDATE SET
          setting_value = CASE
            WHEN jsonb_typeof(app_settings.setting_value) = 'string'
              AND length(trim(app_settings.setting_value #>> '{}')) > 0
              THEN app_settings.setting_value
            ELSE EXCLUDED.setting_value
          END,
          updated_at = NOW()
        RETURNING setting_value
      `,
      [
        CONVERSATION_WELCOME_MESSAGE_KEY,
        JSON.stringify(DEFAULT_CONVERSATION_WELCOME_MESSAGE)
      ]
    )

    return (
      normalizeWelcomeMessage(result.rows[0]?.setting_value) ||
      DEFAULT_CONVERSATION_WELCOME_MESSAGE
    )
  })
}

export async function getConversationWelcomeMessage() {
  return ensureConversationWelcomeMessage()
}

export async function updateConversationWelcomeMessage(content: string) {
  const normalizedContent = content.trim()

  if (!normalizedContent) {
    throw new Error('Welcome message content cannot be empty')
  }

  await withDbTransaction((client) =>
    client.query(
      `
        INSERT INTO app_settings (
          setting_key,
          setting_value
        )
        VALUES ($1, $2::jsonb)
        ON CONFLICT (setting_key)
        DO UPDATE SET
          setting_value = EXCLUDED.setting_value,
          updated_at = NOW()
      `,
      [CONVERSATION_WELCOME_MESSAGE_KEY, JSON.stringify(normalizedContent)]
    )
  )

  return normalizedContent
}
