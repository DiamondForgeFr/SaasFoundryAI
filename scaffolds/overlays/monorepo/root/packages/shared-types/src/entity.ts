import type { IsoDateString } from './common'
import type { OrganizationRef } from './organization'

export interface Entity {
  id: string
  name: string
  isActive: boolean
  accountId: string
  organization: OrganizationRef | null
}

export interface EntityWithOrgRef {
  id: string
  name: string
  organization: OrganizationRef | null
}

export interface CreateEntityPayload {
  name: string
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
