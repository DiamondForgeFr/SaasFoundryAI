import type { AccountSummary } from './account'
import type { IsoDateString } from './common'
import type { Entity } from './entity'
import type { UserPreferences } from './user'

export interface People {
  firstname: string | null
  lastname: string | null
}

export type RoleScope = 'PLATFORM' | 'ACCOUNT' | 'ENTITY'

/**
 * One concrete role assigned to a user, scoped to a target.
 * - PLATFORM: accountId/entityId both null
 * - ACCOUNT : accountId set, entityId null
 * - ENTITY  : entityId set, accountId null
 */
export interface RoleAssignment {
  id: string
  roleId: number
  roleName: string
  scope: RoleScope
  accountId: string | null
  entityId: string | null
  modules: string[]
  subModules: string[]
  permissions: string[]
}

export interface CurrentScope {
  kind: RoleScope
  /** account or entity id when kind !== 'PLATFORM' */
  id: string | null
}

export interface MeResponse {
  userId: string
  email: string
  people: People
  /** Scoped role assignments (one row per role × target). */
  roleAssignments: RoleAssignment[]
  /** Server-elected default scope; clients may switch locally. */
  currentScope: CurrentScope
  /** Legacy flat union of role names; kept while we transition the UI. */
  roles: string[]
  /** Legacy flat union of module names. */
  modules: string[]
  /** Legacy flat union of sub-module names. */
  subModules: string[]
  /** Legacy flat union of permission names. */
  permissions: string[]
  accounts: AccountSummary[]
  entities: Entity[]
  preferences: UserPreferences
  createdAt: IsoDateString
}

export interface SignInResponse {
  userId: string
}

export interface SignUpResponse {
  message: string
  confirmationToken?: string
}

export interface SignInPayload {
  email: string
  password: string
}

export interface SignUpPayload {
  email: string
  password: string
  firstname?: string
  lastname?: string
  locale?: string
}

export interface GuestResponse {
  roles: string[]
  modules: string[]
  permissions: string[]
  awaitsPlatformAdmin: boolean
}

export interface RequestPasswordResetPayload {
  email: string
}

export interface ResetPasswordPayload {
  token: string
  newPassword: string
}

export interface MessageResponse {
  message: string
}
