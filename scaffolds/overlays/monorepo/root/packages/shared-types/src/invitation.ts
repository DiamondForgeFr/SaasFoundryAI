import type { IsoDateString } from './common'

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED'

export interface InvitationAccountRef {
  id: string
  name: string
}

export interface InvitationEntityRef {
  id: string
  name: string
}

export interface InvitationRoleRef {
  id: number
  name: string
}

export interface InvitationListItem {
  id: string
  inviterUserId: string
  inviteeUserId?: string
  inviteeUserEmail: string
  status: string
  invitedAt: IsoDateString
  acceptedAt?: IsoDateString
  accounts: InvitationAccountRef[]
  entities: InvitationEntityRef[]
  roles: InvitationRoleRef[]
}

export interface CreateInvitationPayload {
  email: string
  firstname?: string
  lastname?: string
  roleIds?: number[]
  accountIds?: string[]
  entityIds?: string[]
  locale?: string
}

export interface InvitationResponse {
  message: string
  invitationToken?: string
}

export interface AcceptInvitationPayload {
  token: string
  password: string
  firstname?: string
  lastname?: string
}
