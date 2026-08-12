import { queryDb, withDbTransaction } from '../../database/db'

const MTALK_ROUTING_CONFIG_KEY = 'mtalk_routing_config'

type AppSettingRow = {
  setting_key: string
  setting_value: MtalkRoutingConfig
}

export type MtalkRoutingConfig = {
  initialQueueId: number | null
  aiQueueId: number | null
  humanQueueId: number | null
}

const DEFAULT_MTALK_ROUTING_CONFIG: MtalkRoutingConfig = {
  initialQueueId: null,
  aiQueueId: null,
  humanQueueId: null
}

function normalizeQueueId(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsedValue = Number(value)
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null
}

function normalizeRoutingConfig(value: unknown): MtalkRoutingConfig {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}

  return {
    initialQueueId: normalizeQueueId(source.initialQueueId),
    aiQueueId: normalizeQueueId(source.aiQueueId),
    humanQueueId: normalizeQueueId(source.humanQueueId)
  }
}

async function findRoutingConfig() {
  const result = await queryDb<AppSettingRow>(
    `
      SELECT setting_key, setting_value
      FROM app_settings
      WHERE setting_key = $1
      LIMIT 1
    `,
    [MTALK_ROUTING_CONFIG_KEY]
  )

  return result.rows[0]
    ? normalizeRoutingConfig(result.rows[0].setting_value)
    : null
}

export async function ensureMtalkRoutingConfig() {
  const existingConfig = await findRoutingConfig()

  if (existingConfig) {
    return existingConfig
  }

  return withDbTransaction(async (client) => {
    const currentResult = await client.query<AppSettingRow>(
      `
        SELECT setting_key, setting_value
        FROM app_settings
        WHERE setting_key = $1
        LIMIT 1
      `,
      [MTALK_ROUTING_CONFIG_KEY]
    )

    if (currentResult.rows[0]) {
      return normalizeRoutingConfig(currentResult.rows[0].setting_value)
    }

    await client.query(
      `
        INSERT INTO app_settings (
          setting_key,
          setting_value
        )
        VALUES ($1, $2::jsonb)
      `,
      [MTALK_ROUTING_CONFIG_KEY, JSON.stringify(DEFAULT_MTALK_ROUTING_CONFIG)]
    )

    return DEFAULT_MTALK_ROUTING_CONFIG
  })
}

export async function getMtalkRoutingConfig() {
  return ensureMtalkRoutingConfig()
}

export async function updateMtalkRoutingConfig(
  nextConfig: Partial<MtalkRoutingConfig>
) {
  const currentConfig = await ensureMtalkRoutingConfig()
  const normalizedConfig = normalizeRoutingConfig({
    ...currentConfig,
    ...nextConfig
  })

  return withDbTransaction(async (client) => {
    await client.query(
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
      [MTALK_ROUTING_CONFIG_KEY, JSON.stringify(normalizedConfig)]
    )

    return normalizedConfig
  })
}
