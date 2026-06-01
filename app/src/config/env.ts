function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : undefined
}

function readRequiredEnv(name: string): string {
  const value = readOptionalEnv(name)

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

function readNumberEnv(name: string, fallback: number): number {
  const value = readOptionalEnv(name)

  if (!value) {
    return fallback
  }

  const parsedValue = Number(value)

  if (!Number.isFinite(parsedValue)) {
    throw new Error(`Invalid numeric environment variable: ${name}`)
  }

  return parsedValue
}

export const env = {
  nodeEnv: readOptionalEnv('NODE_ENV') ?? 'development',
  host: readOptionalEnv('HOST') ?? '0.0.0.0',
  port: readNumberEnv('PORT', 3000),
  databaseUrl: readRequiredEnv('DATABASE_URL'),
  adminApiToken: readOptionalEnv('ADMIN_API_TOKEN'),
  mtalkWebhookToken: readOptionalEnv('MTALK_WEBHOOK_TOKEN'),
  mtalkApiSendMessageUrl: readOptionalEnv('MTALK_API_SEND_MESSAGE_URL'),
  mtalkApiToken: readOptionalEnv('MTALK_API_TOKEN'),
  glpiBaseUrl:
    readOptionalEnv('GLPI_BASE_URL') ??
    'https://ontech.verdanadesk.com/apirest.php',
  glpiAppToken: readOptionalEnv('GLPI_APP_TOKEN'),
  glpiAuthorizationToken: readOptionalEnv('GLPI_AUTHORIZATION_TOKEN'),
  glpiEntityCacheTtlMinutes: readNumberEnv('GLPI_ENTITY_CACHE_TTL_MINUTES', 360),
  geminiApiKey: readOptionalEnv('GEMINI_API_KEY'),
  geminiModel: readOptionalEnv('GEMINI_MODEL') ?? 'gemini-2.5-flash',
  geminiTemperature: readNumberEnv('GEMINI_TEMPERATURE', 0.2),
  messageDebounceSeconds: readNumberEnv('MESSAGE_DEBOUNCE_SECONDS', 5),
  workerEnabled: readOptionalEnv('WORKER_ENABLED') !== 'false',
  workerPollIntervalMs: readNumberEnv('WORKER_POLL_INTERVAL_MS', 1000),
  workerRetrySeconds: readNumberEnv('WORKER_RETRY_SECONDS', 10),
  workerStaleProcessingSeconds: readNumberEnv(
    'WORKER_STALE_PROCESSING_SECONDS',
    300
  ),
  assignmentNotifierEnabled:
    readOptionalEnv('ASSIGNMENT_NOTIFIER_ENABLED') !== 'false',
  assignmentPollIntervalMs: readNumberEnv(
    'ASSIGNMENT_POLL_INTERVAL_MS',
    20000
  ),
  assignmentWorkerRetrySeconds: readNumberEnv(
    'ASSIGNMENT_WORKER_RETRY_SECONDS',
    20
  ),
  assignmentWorkerStaleProcessingSeconds: readNumberEnv(
    'ASSIGNMENT_WORKER_STALE_PROCESSING_SECONDS',
    300
  ),
  mtalkOutboundSaveOnTicket:
    (readOptionalEnv('MTALK_OUTBOUND_SAVE_ON_TICKET') ?? 'true') !== 'false'
}
