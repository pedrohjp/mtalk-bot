import { env } from './config/env'
import { closeDbPool } from './database/db'
import { runMigrations } from './database/migrations'
import { startConversationAssignmentWorker } from './modules/conversations/conversation.assignment-worker'
import { startConversationWorker } from './modules/conversations/conversation.worker'
import { buildApp } from './app'

async function main() {
  await runMigrations()

  const app = buildApp()
  const stopConversationWorker = startConversationWorker(app.log)
  const stopConversationAssignmentWorker =
    startConversationAssignmentWorker(app.log)
  app.addHook('onClose', async () => {
    await stopConversationAssignmentWorker()
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
