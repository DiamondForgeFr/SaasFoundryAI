/**
 * Resources
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

/**
 * Dependencies
 */
import { apiClientMutator } from '@{{PROJECT_NAME}}/api-client'
import { authControllerGetMe } from '@{{PROJECT_NAME}}/api-client/generated/api/authentication/authentication'

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
      return apiClientMutator<{ id: string; isActive: boolean }>({
        url: `/api/accounts/${accountId}/users/${targetUserId}`,
        method: 'PATCH',
        data: body
      })
    },
    onSuccess: async (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['account', variables.accountId] })
      queryClient.invalidateQueries({ queryKey: ['account', variables.accountId, 'users'] })
      // Editing yourself? `useMe` is `enabled: false`, so manual refetch + cache write.
      try {
        const fresh = await authControllerGetMe()
        queryClient.setQueryData(['authMe'], fresh)
      } catch (e) {
        console.warn('Failed to refresh authMe after account-user update', e)
      }
    }
  })
  return { ...mutation, isLoading: mutation.isPending }
}
