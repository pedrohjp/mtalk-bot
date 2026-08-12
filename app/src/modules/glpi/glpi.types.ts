export type GlpiSessionResponse = {
  session_token?: string
}

export type GlpiCreateTicketInput = {
  name: string
  content: string
  entities_id?: number
  status: number
  urgency: number
  impact: number
  priority: number
  _users_id_requester: number
  type: number
}

export type GlpiCreateTicketRequest = {
  input: GlpiCreateTicketInput
}

export type GlpiCreateTicketResponse = {
  id?: number
  message?: string
}

export type GlpiTicket = {
  id?: number | string
  status?: number | string
  solvedate?: string | null
  closedate?: string | null
  [key: string]: unknown
}

export type GlpiCreateDocumentResponse = {
  id?: number
  message?: string
}

export type GlpiLinkDocumentItemRequest = {
  input: {
    documents_id: number
    itemtype: 'Ticket'
    items_id: number
  }
}

export type GlpiLinkDocumentItemResponse = {
  id?: number
  message?: string
}

export type GlpiEntityApiItem = {
  id: number
  name: string
}

export type GlpiMyEntitiesResponse = {
  myentities?: GlpiEntityApiItem[]
}

export type GlpiEntityCacheRow = {
  glpi_entity_id: string
  full_name_raw: string
  display_name: string
  normalized_name: string
  synced_at: Date
}

export type GlpiEntityCacheItem = {
  glpiEntityId: number
  fullNameRaw: string
  displayName: string
  normalizedName: string
  syncedAt: Date
}

export type CompanyIdentificationStatus =
  | 'PENDING'
  | 'IDENTIFIED'
  | 'NOT_IDENTIFIED'

export type CompanyResolutionResult = {
  companyName: string | null
  glpiEntityId: number | null
  glpiEntityName: string | null
  companyIdentificationStatus: CompanyIdentificationStatus
  companyLookupAttemptedAt: Date | null
}
