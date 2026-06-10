import type { RoleScope } from './auth'
import type { IsoDateString } from './common'
import type { EntityWithOrgRef } from './entity'

export type AccountDeactivationScope = 'PLATFORM' | 'ACCOUNT_OWNER'

export interface AccountSummary {
  id: string
  name: string
  description: string | null
  isActive: boolean
  /**
   * When the account is currently disabled, indicates WHO triggered the deactivation:
   *   - PLATFORM      : a platform-admin disabled it (account-admin cannot self-reactivate)
   *   - ACCOUNT_OWNER : an account-admin disabled their own account (eligible for a reactivation request)
   * `null` when the account is active or has never been deactivated.
   */
  deactivatedByScope: AccountDeactivationScope | null
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
  scope: RoleScope
  isSystem: boolean
  isActive: boolean
  /** True when accountId is NULL (system / template role visible to every account). */
  isGlobal: boolean
  /** Modules this role grants access to (names). */
  modules: string[]
  /** Permissions granted by this role (names). */
  permissions: string[]
  createdAt: IsoDateString
  updatedAt: IsoDateString
}

export interface AccountWithDetails extends AccountSummary {
  entities: EntityWithOrgRef[]
}
