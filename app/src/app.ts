import Fastify from 'fastify'
import { healthRoutes } from './routes/health'
import { adminPromptRoutes } from './routes/admin-prompts'
import { adminStaffContactRoutes } from './routes/admin-staff-contacts'
import { mtalkWebhookRoutes } from './routes/mtalk-webhook'

export function buildApp() {
  const app = Fastify({
    logger: true
  })

  app.register(healthRoutes)
  app.register(adminPromptRoutes)
  app.register(adminStaffContactRoutes)
  app.register(mtalkWebhookRoutes)

  return app
}
