/**
 * Resources
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

/**
 * Dependencies
 */
import { type MeResponseDto } from '@/hooks/api/auth'
import apiClient from '@/lib/api/client'

// The entity carries no name/description of its own (D-ENT-6) — its identity is the org profile.
export type CreateOwnEntityPayload = {
  accountId: string
  organization: {
    name: string
    type: 'COMPANY' | 'ASSOCIATION' | 'COMMUNITY'
    description?: string | null
    website?: string | null
  }
}

export type CreateOwnEntityResponse = {
  id: string
  name: string
  description: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  organization?: { id: string; name: string }
}

/**
 * Multi-entity self-create — an entity admin with ENTITY_OWN_CREATE spins up a brand-new entity
 * inside their parent account and is auto-bound as entity-admin on it. After success we refresh
 * /me so the scope switcher picks the fresh entity up immediately.
 */
export const useCreateOwnEntity = () => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (payload: CreateOwnEntityPayload) => {
      return apiClient.post<CreateOwnEntityResponse>('/entities/own', payload)
    },
    onSuccess: async (_data, variables) => {
      try {
        const fresh = await apiClient.get<MeResponseDto>('/auth/me')
        queryClient.setQueryData(['authMe'], fresh)
      } catch (e) {
        console.warn('Failed to refresh authMe after creating an own entity', e)
      }
      queryClient.invalidateQueries({ queryKey: ['account', variables.accountId] })
      queryClient.invalidateQueries({ queryKey: ['accountEntities'] })
    }
  })
  return { ...mutation, isLoading: mutation.isPending }
}
