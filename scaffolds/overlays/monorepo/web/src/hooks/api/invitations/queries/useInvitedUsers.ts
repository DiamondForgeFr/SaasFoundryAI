/**
 * Resources
 */
import { useQuery } from '@tanstack/react-query'
import i18next from 'i18next'
import { z } from 'zod'

import { invitationControllerGetUserInvitations } from '@{{PROJECT_NAME}}/api-client/generated/api/invitations/invitations'

// Translation
const tInvitations = (key: string) => i18next.t(key, { ns: 'invitations' })

/**
 * Schemas & DTOs
 */
export const useInvitedUsersSchema = () => {
  const accountSchema = z.object({
    id: z.string(),
    name: z.string()
  })

  const entitySchema = z.object({
    id: z.string(),
    name: z.string()
  })

  const roleSchema = z.object({
    id: z.number(),
    name: z.string()
  })

  const invitedUserSchema = z.object({
    id: z.string(),
    inviterUserId: z.string(),
    inviteeUserId: z.string().optional(),
    inviteeUserEmail: z.string(),
    status: z.enum(['SENT', 'EXPIRED', 'ACCEPTED']),
    invitedAt: z.string().transform((str) => new Date(str)),
    acceptedAt: z
      .string()
      .optional()
      .transform((str) => (str ? new Date(str) : null)),
    accounts: z.array(accountSchema),
    entities: z.array(entitySchema),
    roles: z.array(roleSchema)
  })

  const response = z.object({
    invitations: z.array(invitedUserSchema)
  })

  return { response }
}

export type InvitedUsersResponseDto = z.infer<ReturnType<typeof useInvitedUsersSchema>['response']>

/**
 * Hook declaration
 */
export const useInvitedUsers = () => {
  const schemas = useInvitedUsersSchema()

  return useQuery({
    queryKey: ['invitations'],
    queryFn: async () => {
      try {
        const response = await invitationControllerGetUserInvitations()
        return schemas.response.parse(response)
      } catch (error) {
        console.error(tInvitations('errors.tk_fetchInvitationsError_'), error)
        throw error
      }
    },
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true
  })
}

/**
 * Platform-admin: every account-owner invitation across the platform (SENT + EXPIRED),
 * regardless of who originally sent them. Drives the "Pending account owner invitations"
 * panel on the Accounts tab.
 */
export const usePlatformAccountOwnerInvitations = (params: { enabled?: boolean } = {}) => {
  const schemas = useInvitedUsersSchema()
  const { enabled = true } = params

  return useQuery({
    queryKey: ['invitations', 'platform', 'account-owners'],
    queryFn: async () => {
      const { apiClientMutator } = await import('@{{PROJECT_NAME}}/api-client')
      const raw = await apiClientMutator({ url: '/api/invitations/platform/account-owners', method: 'GET' })
      return schemas.response.parse(raw)
    },
    enabled,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    retry: false
  })
}
