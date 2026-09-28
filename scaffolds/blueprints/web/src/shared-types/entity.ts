import type { IsoDateString } from './common'
import type { OrganizationRef } from './organization'

export interface EntityAccountRef {
  id: string
  name: string
  isActive: boolean
}

export interface Entity {
  id: string
  name: string
  isActive: boolean
  accountId: string
  organization: OrganizationRef | null
  account?: EntityAccountRef | null
}

export interface EntityWithOrgRef {
  id: string
  name: string
  organization: OrganizationRef | null
}

// The entity carries no name/description of its own (D-ENT-6) — its identity is the org profile.
export interface CreateEntityPayload {
  accountId: string
  organizationId?: string
  organization?: CreateOrganizationInline
}

export interface CreateOrganizationInline {
  name: string
  type: 'COMPANY' | 'ASSOCIATION' | 'COMMUNITY'
}

export interface CreateEntityResponse {
  id: string
  name: string
  isActive: boolean
  accountId: string
  organization: OrganizationRef | null
  createdAt: IsoDateString
  updatedAt: IsoDateString
}
