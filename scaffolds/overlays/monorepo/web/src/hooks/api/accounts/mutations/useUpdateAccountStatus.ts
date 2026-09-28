/**
 * Resources
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

/**
 * Dependencies
 */
import { apiClientMutator } from '@{{PROJECT_NAME}}/api-client'
import { persistAuthMe } from '@/hooks/api/auth/utils/persistAuthMe'

export type UpdateAccountStatusPayload = {
  accountId: string
  isActive: boolean
}

/**
 * Activate / deactivate an account. Backend endpoint: `PATCH /accounts/:id/status`.
 *
 * Authorization: ACCOUNT_UPDATE in ACCOUNT_ADMINISTRATION (account-admins on their own account,
 * or platform-admins on any account via the access bypass).
 *
 * Cache invalidation: refresh the account detail, the platform-wide accounts list and aggregated
 * platform overview, plus a manual /me refetch since `enabled: false` on useMe blocks normal
 * invalidation refetches.
 */
export const useUpdateAccountStatus = () => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async ({ accountId, isActive }: UpdateAccountStatusPayload) => {
      return apiClientMutator<{ id: string; name: string; isActive: boolean }>({
        url: `/api/accounts/${accountId}/status`,
        method: 'PATCH',
        data: { isActive }
      })
    },
    onSuccess: async (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['account', variables.accountId] })
      queryClient.invalidateQueries({ queryKey: ['allAccounts'] })
      queryClient.invalidateQueries({ queryKey: ['platformOverview'] })
      await persistAuthMe(queryClient)
    }
  })
  return { ...mutation, isLoading: mutation.isPending }
}
