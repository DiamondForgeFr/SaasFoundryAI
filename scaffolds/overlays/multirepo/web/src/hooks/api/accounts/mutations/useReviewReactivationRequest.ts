/**
 * Resources
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

/**
 * Dependencies
 */
import apiClient from '@/lib/api/client'
import { persistAuthMe } from '@/hooks/api/auth/utils/persistAuthMe'

type ReviewPayload = { requestId: string; note?: string }

/**
 * Approve or reject a reactivation request (platform-admin only). Both flows hit the same
 * cache-invalidation set: the request list, the account list, the platform overview, and
 * a manual /me refetch (in case the reviewer happens to also be a member of the account).
 */
const buildReviewMutation = (action: 'approve' | 'reject') => () => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async ({ requestId, note }: ReviewPayload) => {
      return apiClient.post<{ id: string; status: 'APPROVED' | 'REJECTED' }>(`/accounts/platform/reactivation-requests/${requestId}/${action}`, { note })
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['platformReactivationRequests'] })
      queryClient.invalidateQueries({ queryKey: ['allAccounts'] })
      queryClient.invalidateQueries({ queryKey: ['platformOverview'] })
      queryClient.invalidateQueries({ queryKey: ['latestReactivationRequest'] })
      await persistAuthMe(queryClient)
    }
  })
  return { ...mutation, isLoading: mutation.isPending }
}

export const useApproveReactivationRequest = buildReviewMutation('approve')
export const useRejectReactivationRequest = buildReviewMutation('reject')
