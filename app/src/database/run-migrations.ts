import { closeDbPool } from './db'
import { runMigrations } from './migrations'

async function main() {
  try {
    const executedMigrations = await runMigrations()

    if (executedMigrations.length === 0) {
      console.log('No pending migrations.')
    } else {
      console.log(`Applied migrations: ${executedMigrations.join(', ')}`)
    }
  } finally {
    await closeDbPool()
  }
}

void main()
