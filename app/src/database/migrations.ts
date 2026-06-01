import { promises as fs } from 'node:fs'
import path from 'node:path'
import { withDbClient } from './db'

type AppliedMigrationRow = {
  name: string
}

export async function runMigrations() {
  const migrationsDirectory = path.resolve(process.cwd(), 'migrations')
  const migrationFiles = (await fs.readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort()

  return withDbClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const appliedMigrationsResult = await client.query<AppliedMigrationRow>(
      'SELECT name FROM schema_migrations'
    )

    const appliedMigrationNames = new Set(
      appliedMigrationsResult.rows.map((row) => row.name)
    )

    const executedMigrations: string[] = []

    for (const fileName of migrationFiles) {
      if (appliedMigrationNames.has(fileName)) {
        continue
      }

      const migrationPath = path.join(migrationsDirectory, fileName)
      const migrationSql = await fs.readFile(migrationPath, 'utf8')

      await client.query('BEGIN')

      try {
        await client.query(migrationSql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [
          fileName
        ])
        await client.query('COMMIT')
        executedMigrations.push(fileName)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }

    return executedMigrations
  })
}
