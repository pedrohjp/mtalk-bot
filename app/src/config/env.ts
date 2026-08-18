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
  ticketzBaseUrl: readOptionalEnv('TICKETZ_BASE_URL'),
  ticketzPanelEmail: readOptionalEnv('TICKETZ_PANEL_EMAIL'),
  ticketzPanelPassword: readOptionalEnv('TICKETZ_PANEL_PASSWORD'),
  glpiBaseUrl:
    readOptionalEnv('GLPI_BASE_URL') ??
    'https://ontech.verdanadesk.com/apirest.php',
  glpiAppToken: readOptionalEnv('GLPI_APP_TOKEN'),
  glpiAuthorizationToken: readOptionalEnv('GLPI_AUTHORIZATION_TOKEN'),
  glpiEntityCacheTtlMinutes: readNumberEnv('GLPI_ENTITY_CACHE_TTL_MINUTES', 360),
  geminiApiKey: readOptionalEnv('GEMINI_API_KEY'),
  geminiModel: readOptionalEnv('GEMINI_MODEL') ?? 'gemini-3.5-flash-lite',
  messageDebounceSeconds: readNumberEnv('MESSAGE_DEBOUNCE_SECONDS', 5),
  workerEnabled: readOptionalEnv('WORKER_ENABLED') !== 'false',
  workerPollIntervalMs: readNumberEnv('WORKER_POLL_INTERVAL_MS', 1000),
  workerRetrySeconds: readNumberEnv('WORKER_RETRY_SECONDS', 10),
  workerStaleProcessingSeconds: readNumberEnv(
    'WORKER_STALE_PROCESSING_SECONDS',
    300
  ),
  solutionNotifierEnabled:
    readOptionalEnv('SOLUTION_NOTIFIER_ENABLED') !== 'false',
  solutionPollIntervalMs: readNumberEnv(
    'SOLUTION_POLL_INTERVAL_MS',
    20000
  ),
  solutionWorkerStaleProcessingSeconds: readNumberEnv(
    'SOLUTION_WORKER_STALE_PROCESSING_SECONDS',
    300
  ),
  automationExpirationEnabled:
    readOptionalEnv('AUTOMATION_EXPIRATION_ENABLED') !== 'false',
  automationExpirationInactivityMinutes: readNumberEnv(
    'AUTOMATION_EXPIRATION_INACTIVITY_MINUTES',
    60
  ),
  automationExpirationPollIntervalMs: readNumberEnv(
    'AUTOMATION_EXPIRATION_POLL_INTERVAL_MS',
    20000
  ),
  automationExpirationWorkerStaleProcessingSeconds: readNumberEnv(
    'AUTOMATION_EXPIRATION_WORKER_STALE_PROCESSING_SECONDS',
    300
  ),
  manualAssignmentWatcherEnabled:
    readOptionalEnv('MTALK_MANUAL_ASSIGNMENT_WATCHER_ENABLED') !== 'false',
  manualAssignmentPollIntervalMs: readNumberEnv(
    'MTALK_MANUAL_ASSIGNMENT_POLL_INTERVAL_MS',
    20000
  ),
  manualAssignmentWorkerStaleProcessingSeconds: readNumberEnv(
    'MTALK_MANUAL_ASSIGNMENT_WORKER_STALE_PROCESSING_SECONDS',
    300
  ),
  mtalkOutboundSaveOnTicket:
    (readOptionalEnv('MTALK_OUTBOUND_SAVE_ON_TICKET') ?? 'true') !== 'false'
}
