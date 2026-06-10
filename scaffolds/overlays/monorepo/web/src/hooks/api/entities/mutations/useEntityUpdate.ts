/**
 * Resources
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

/**
 * Dependencies
 */
import { apiClientMutator } from '@{{PROJECT_NAME}}/api-client'
import { authControllerGetMe } from '@{{PROJECT_NAME}}/api-client/generated/api/authentication/authentication'

export type UpdateEntityPayload = {
  entityId: string
  /** Used by the cache invalidator to refresh the right account view; not sent to the backend. */
  accountId?: string
  name?: string
  description?: string | null
  isActive?: boolean
  organization?: {
    name?: string
    type?: 'COMPANY' | 'ASSOCIATION' | 'COMMUNITY'
    description?: string | null
    website?: string | null
  }
}

export const useEntityUpdate = () => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async ({ entityId, accountId: _accountId, ...body }: UpdateEntityPayload) => {
      return apiClientMutator<{ id: string; name: string; description: string | null; isActive: boolean }>({
        url: `/api/entities/${entityId}`,
        method: 'PATCH',
        data: body
      })
    },
    onSuccess: async (_data, variables) => {
      if (variables.accountId) {
        queryClient.invalidateQueries({ queryKey: ['account', variables.accountId] })
        queryClient.invalidateQueries({ queryKey: ['account', variables.accountId, 'entities'] })
      }
      // Toggling an entity's isActive may hide it from /me — refresh manually since `useMe` is `enabled: false`.
      try {
        const fresh = await authControllerGetMe()
        queryClient.setQueryData(['authMe'], fresh)
      } catch (e) {
        console.warn('Failed to refresh authMe after entity update', e)
      }
    }
  })
  return { ...mutation, isLoading: mutation.isPending }
}
