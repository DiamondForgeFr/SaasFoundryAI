import type { IsoDateString } from './common'
import type { EntityWithOrgRef } from './entity'

export interface AccountSummary {
  id: string
  name: string
  description: string | null
  isActive: boolean
}

export interface AccountUser {
  id: string
  email: string
  firstname: string | null
  lastname: string | null
  isActive: boolean
  createdAt: IsoDateString
  updatedAt: IsoDateString
}

export interface AccountRole {
  id: number
  name: string
  description: string | null
  isActive: boolean
  isGlobal: boolean
  createdAt: IsoDateString
  updatedAt: IsoDateString
}

export interface AccountWithDetails extends AccountSummary {
  entities: EntityWithOrgRef[]
}
