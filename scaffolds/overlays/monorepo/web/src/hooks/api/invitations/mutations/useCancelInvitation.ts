/**
 * Resources
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

/**
 * Dependencies
 */
import { apiClientMutator } from '@{{PROJECT_NAME}}/api-client'

/**
 * Cancels a pending invitation. Idempotent on already-finalized invitations.
 *
 * Backend behavior:
 *   - sets status = CANCELED
 *   - revokes the underlying invitation token so the link stops working
 */
export const useCancelInvitation = () => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (invitationId: string) => {
      return apiClientMutator<{ id: string; status: string }>({
        url: `/api/invitations/${invitationId}`,
        method: 'DELETE'
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] })
      queryClient.invalidateQueries({ queryKey: ['invitedUsers'] })
    }
  })
  return { ...mutation, isLoading: mutation.isPending }
}
