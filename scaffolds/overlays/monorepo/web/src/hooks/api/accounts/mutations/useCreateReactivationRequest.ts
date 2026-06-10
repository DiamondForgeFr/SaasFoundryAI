/**
 * Resources
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

/**
 * Dependencies
 */
import { apiClientMutator } from '@{{PROJECT_NAME}}/api-client'

export type CreateReactivationRequestPayload = {
  accountId: string
  message: string
}

/**
 * Submit a reactivation request for a self-deactivated account.
 * Backend enforces: account inactive AND deactivatedByScope === ACCOUNT_OWNER, no other PENDING request.
 */
export const useCreateReactivationRequest = () => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async ({ accountId, message }: CreateReactivationRequestPayload) => {
      return apiClientMutator<{ id: string; status: 'PENDING' }>({
        url: `/api/accounts/${accountId}/reactivation-requests`,
        method: 'POST',
        data: { message }
      })
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['latestReactivationRequest', variables.accountId] })
      queryClient.invalidateQueries({ queryKey: ['platformReactivationRequests'] })
    }
  })
  return { ...mutation, isLoading: mutation.isPending }
}
