import { env } from './config/env'
import { closeDbPool } from './database/db'
import { runMigrations } from './database/migrations'
import { startConversationExpirationWorker } from './modules/conversations/conversation.expiration-worker'
import { startConversationSolutionWorker } from './modules/conversations/conversation.solution-worker'
import { startConversationWorker } from './modules/conversations/conversation.worker'
import { buildApp } from './app'

async function main() {
  await runMigrations()

  const app = buildApp()
  const stopConversationWorker = startConversationWorker(app.log)
  const stopConversationExpirationWorker =
    startConversationExpirationWorker(app.log)
  const stopConversationSolutionWorker =
    startConversationSolutionWorker(app.log)
  app.addHook('onClose', async () => {
    await stopConversationSolutionWorker()
    await stopConversationExpirationWorker()
    await stopConversationWorker()
    await closeDbPool()
  })

  const port = env.port
  const host = env.host

  try {
    await app.listen({ port, host })
    app.log.info(`HTTP server running on http://${host}:${port}`)
  } catch (error) {
    app.log.error(error)
    process.exit(1)
  }
}

void main()
