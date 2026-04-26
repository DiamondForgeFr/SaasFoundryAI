import type { AccountSummary } from './account'
import type { IsoDateString } from './common'
import type { Entity } from './entity'

export interface People {
  firstname: string | null
  lastname: string | null
}

export interface MeResponse {
  userId: string
  email: string
  people: People
  roles: string[]
  modules: string[]
  permissions: string[]
  accounts: AccountSummary[]
  entities: Entity[]
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
