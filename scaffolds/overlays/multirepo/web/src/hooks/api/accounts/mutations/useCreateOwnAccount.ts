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

export type CreateOwnAccountPayload = {
  name: string
  description?: string | null
}

export type CreateOwnAccountResponse = {
  id: string
  name: string
  description: string | null
  isActive: boolean
  createdAt: string
}

/**
 * Multi-account self-create — an account admin with ACCOUNT_OWN_CREATE spins up a brand-new
 * account they automatically own. After success we refresh /me so the scope switcher picks the
 * fresh account up immediately.
 */
export const useCreateOwnAccount = () => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (payload: CreateOwnAccountPayload) => {
      return apiClient.post<CreateOwnAccountResponse>('/accounts/own', payload)
    },
    onSuccess: async () => {
      try {
        const fresh = await apiClient.get<MeResponseDto>('/auth/me')
        queryClient.setQueryData(['authMe'], fresh)
      } catch (e) {
        console.warn('Failed to refresh authMe after creating an own account', e)
      }
      queryClient.invalidateQueries({ queryKey: ['allAccounts'] })
      queryClient.invalidateQueries({ queryKey: ['platformOverview'] })
    }
  })
  return { ...mutation, isLoading: mutation.isPending }
}
