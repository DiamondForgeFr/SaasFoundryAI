/**
 * Resources
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

/**
 * Dependencies
 */
import { type MeResponseDto } from '@/hooks/api/auth'
import apiClient from '@/lib/api/client'

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
      return apiClient.patch<{ id: string; name: string; description: string | null; isActive: boolean }>(`/entities/${entityId}`, body)
    },
    onSuccess: async (_data, variables) => {
      if (variables.accountId) {
        queryClient.invalidateQueries({ queryKey: ['account', variables.accountId] })
        queryClient.invalidateQueries({ queryKey: ['account', variables.accountId, 'entities'] })
      }
      // Toggling an entity's isActive may hide it from /me — refresh manually since `useMe` is `enabled: false`.
      try {
        const fresh = await apiClient.get<MeResponseDto>('/auth/me')
        queryClient.setQueryData(['authMe'], fresh)
      } catch (e) {
        console.warn('Failed to refresh authMe after entity update', e)
      }
    }
  })
  return { ...mutation, isLoading: mutation.isPending }
}
