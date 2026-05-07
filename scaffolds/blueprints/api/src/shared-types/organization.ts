import type { IsoDateString } from './common'

export type OrganizationType = 'COMPANY' | 'ASSOCIATION' | 'COMMUNITY'

export interface OrganizationRef {
  id: string
  name: string
  type?: OrganizationType
}

export interface Organization {
  id: string
  name: string
  type: OrganizationType
  description: string | null
  website: string | null
  logoUrl: string | null
  createdAt: IsoDateString
  updatedAt: IsoDateString
}

export interface CreateOrganizationPayload {
  name: string
  type: OrganizationType
  accountId: string
  description?: string
  website?: string
  logoUrl?: string
}
