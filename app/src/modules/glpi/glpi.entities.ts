import { FastifyBaseLogger } from 'fastify'
import { queryDb, withDbTransaction } from '../../database/db'
import {
  CompanyIdentificationStatus,
  CompanyResolutionResult,
  GlpiEntityApiItem,
  GlpiEntityCacheItem,
  GlpiEntityCacheRow
} from './glpi.types'
import { getGlpiMyEntities, initGlpiSession } from './glpi.client'
import { env } from '../../config/env'

const COMPANY_STOPWORDS = new Set([
  'a',
  'as',
  'o',
  'os',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'empresa',
  'unidade',
  'sou',
  'cliente'
])

type GlpiEntitiesCacheStatsRow = {
  entity_count: string
  last_synced_at: Date | null
}

function decodeHtmlEntities(value: string) {
  return value.replace(/&#62;|&gt;/gi, '>')
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function removeDiacritics(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function normalizeCompanyName(value: string) {
  return compactWhitespace(
    removeDiacritics(value)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
  )
}

function extractDisplayName(fullNameRaw: string) {
  const decodedValue = decodeHtmlEntities(fullNameRaw)
  const parts = decodedValue
    .split('>')
    .map((part) => compactWhitespace(part))
    .filter((part) => part.length > 0)

  return parts.length > 0 ? parts[parts.length - 1] : compactWhitespace(decodedValue)
}

function mapGlpiEntityCacheRow(row: GlpiEntityCacheRow): GlpiEntityCacheItem {
  return {
    glpiEntityId: Number(row.glpi_entity_id),
    fullNameRaw: row.full_name_raw,
    displayName: row.display_name,
    normalizedName: row.normalized_name,
    syncedAt: row.synced_at
  }
}

function normalizeEntityApiItem(entity: GlpiEntityApiItem) {
  const displayName = extractDisplayName(entity.name)

  return {
    glpiEntityId: entity.id,
    fullNameRaw: entity.name,
    displayName,
    normalizedName: normalizeCompanyName(displayName)
  }
}

async function readGlpiEntitiesCacheStats() {
  const result = await queryDb<GlpiEntitiesCacheStatsRow>(
    `
      SELECT
        COUNT(*)::text AS entity_count,
        MAX(synced_at) AS last_synced_at
      FROM glpi_entities_cache
    `
  )

  return {
    entityCount: Number(result.rows[0]?.entity_count ?? '0'),
    lastSyncedAt: result.rows[0]?.last_synced_at ?? null
  }
}

function shouldSyncGlpiEntitiesCache(stats: {
  entityCount: number
  lastSyncedAt: Date | null
}) {
  if (stats.entityCount === 0 || !stats.lastSyncedAt) {
    return true
  }

  const ttlMs = env.glpiEntityCacheTtlMinutes * 60 * 1000
  return Date.now() - stats.lastSyncedAt.getTime() >= ttlMs
}

async function upsertGlpiEntitiesCache(entities: GlpiEntityApiItem[]) {
  const normalizedEntities = entities.map(normalizeEntityApiItem)

  await withDbTransaction(async (client) => {
    await client.query('DELETE FROM glpi_entities_cache')

    for (const entity of normalizedEntities) {
      await client.query(
        `
          INSERT INTO glpi_entities_cache (
            glpi_entity_id,
            full_name_raw,
            display_name,
            normalized_name,
            synced_at
          )
          VALUES ($1, $2, $3, $4, NOW())
        `,
        [
          entity.glpiEntityId,
          entity.fullNameRaw,
          entity.displayName,
          entity.normalizedName
        ]
      )
    }
  })
}

export async function ensureGlpiEntitiesCacheFresh(logger: FastifyBaseLogger) {
  const stats = await readGlpiEntitiesCacheStats()

  if (!shouldSyncGlpiEntitiesCache(stats)) {
    return
  }

  const session = await initGlpiSession()

  if (!session.session_token) {
    throw new Error('GLPI initSession returned no session_token')
  }

  const entitiesResponse = await getGlpiMyEntities(session.session_token)
  const entities = entitiesResponse.myentities ?? []

  await upsertGlpiEntitiesCache(entities)

  logger.info({
    msg: 'GLPI entities cache synchronized',
    entityCount: entities.length
  })
}

async function listGlpiEntitiesCache() {
  const result = await queryDb<GlpiEntityCacheRow>(
    `
      SELECT
        glpi_entity_id,
        full_name_raw,
        display_name,
        normalized_name,
        synced_at
      FROM glpi_entities_cache
      ORDER BY display_name ASC
    `
  )

  return result.rows.map(mapGlpiEntityCacheRow)
}

function tokenizeCompanyName(value: string) {
  return normalizeCompanyName(value)
    .split(' ')
    .filter(
      (token) =>
        token.length >= 3 &&
        !COMPANY_STOPWORDS.has(token)
    )
}

function scoreCompanyMatch(
  userInput: string,
  entity: GlpiEntityCacheItem
) {
  const normalizedInput = normalizeCompanyName(userInput)
  const normalizedEntityName = entity.normalizedName

  if (normalizedInput.length === 0 || normalizedEntityName.length === 0) {
    return 0
  }

  if (normalizedInput === normalizedEntityName) {
    return 100
  }

  const queryTokens = tokenizeCompanyName(userInput)
  const entityTokens = tokenizeCompanyName(entity.displayName)

  if (queryTokens.length === 0 || entityTokens.length === 0) {
    return 0
  }

  const queryJoined = queryTokens.join(' ')
  const entityJoined = entityTokens.join(' ')

  if (queryJoined === entityJoined) {
    return 95
  }

  if (
    queryJoined.length >= 5 &&
    (entityJoined.includes(queryJoined) || queryJoined.includes(entityJoined))
  ) {
    return 85
  }

  const sharedTokens = queryTokens.filter((token) => entityTokens.includes(token))

  if (sharedTokens.length >= 2 && sharedTokens.length === queryTokens.length) {
    return 80
  }

  if (
    sharedTokens.length === 1 &&
    queryTokens.length === 1 &&
    entityTokens.length === 1 &&
    sharedTokens[0].length >= 5
  ) {
    return 78
  }

  return 0
}

function resolveBestCompanyMatch(
  userInput: string,
  entities: GlpiEntityCacheItem[]
) {
  const scoredEntities = entities
    .map((entity) => ({
      entity,
      score: scoreCompanyMatch(userInput, entity)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)

  if (scoredEntities.length === 0) {
    return null
  }

  const bestMatch = scoredEntities[0]
  const secondBestMatch = scoredEntities[1]

  if (bestMatch.score < 78) {
    return null
  }

  if (secondBestMatch && secondBestMatch.score === bestMatch.score) {
    return null
  }

  return bestMatch.entity
}

export async function resolveCompanyFromGlpiEntities(
  logger: FastifyBaseLogger,
  companyName: string | null
): Promise<CompanyResolutionResult> {
  if (!companyName || companyName.trim().length === 0) {
    return {
      companyName: null,
      glpiEntityId: null,
      glpiEntityName: null,
      companyIdentificationStatus: 'PENDING',
      companyLookupAttemptedAt: null
    }
  }

  await ensureGlpiEntitiesCacheFresh(logger)

  const entities = await listGlpiEntitiesCache()
  const matchedEntity = resolveBestCompanyMatch(companyName, entities)
  const lookupTimestamp = new Date()

  if (!matchedEntity) {
    return {
      companyName,
      glpiEntityId: null,
      glpiEntityName: null,
      companyIdentificationStatus: 'NOT_IDENTIFIED',
      companyLookupAttemptedAt: lookupTimestamp
    }
  }

  return {
    companyName: matchedEntity.displayName,
    glpiEntityId: matchedEntity.glpiEntityId,
    glpiEntityName: matchedEntity.displayName,
    companyIdentificationStatus: 'IDENTIFIED',
    companyLookupAttemptedAt: lookupTimestamp
  }
}
