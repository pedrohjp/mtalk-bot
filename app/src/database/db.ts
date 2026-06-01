import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'
import { env } from '../config/env'

let pool: Pool | null = null

export function getDbPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: env.databaseUrl
    })
  }

  return pool
}

export async function queryDb<T extends QueryResultRow>(
  text: string,
  values?: unknown[]
): Promise<QueryResult<T>> {
  return getDbPool().query<T>(text, values)
}

export async function withDbClient<T>(
  handler: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getDbPool().connect()

  try {
    return await handler(client)
  } finally {
    client.release()
  }
}

export async function withDbTransaction<T>(
  handler: (client: PoolClient) => Promise<T>
): Promise<T> {
  return withDbClient(async (client) => {
    await client.query('BEGIN')

    try {
      const result = await handler(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  })
}

export async function closeDbPool() {
  if (!pool) {
    return
  }

  await pool.end()
  pool = null
}
