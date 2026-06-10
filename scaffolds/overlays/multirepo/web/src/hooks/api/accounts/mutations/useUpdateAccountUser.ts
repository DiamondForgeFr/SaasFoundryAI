/**
 * Resources
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

/**
 * Dependencies
 */
import apiClient from '@/lib/api/client'

/**
 * Types
 */
import type { MeResponseDto } from '@/hooks/api/auth/queries/useMe'

export type UpdateAccountUserPayload = {
  accountId: string
  targetUserId: string
  isActive?: boolean
  /** Replace every ACCOUNT-scoped assignment on (user, account) by these role IDs. */
  accountRoleIds?: number[]
  /** Per-entity replacement of ENTITY-scoped assignments. */
  entityRoleIds?: { entityId: string; roleIds: number[] }[]
}

/**
 * Combined edit endpoint — mutates only the fields you supply (status / account roles / entity roles).
 *
 * Cache invalidation: the account detail (used by the users tab) and authMe (in case the actor
 * just edited their own assignments) are both refreshed.
 */
export const useUpdateAccountUser = () => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async ({ accountId, targetUserId, ...body }: UpdateAccountUserPayload) => {
      return apiClient.patch<{ id: string; isActive: boolean }>(`/accounts/${accountId}/users/${targetUserId}`, body)
    },
    onSuccess: async (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['account', variables.accountId] })
      queryClient.invalidateQueries({ queryKey: ['account', variables.accountId, 'users'] })
      // Editing yourself? `useMe` is `enabled: false`, so manual refetch + cache write.
      try {
        const fresh = await apiClient.get<MeResponseDto>('/auth/me')
        queryClient.setQueryData(['authMe'], fresh)
      } catch (e) {
        console.warn('Failed to refresh authMe after account-user update', e)
      }
    }
  })
  return { ...mutation, isLoading: mutation.isPending }
}
