/**
 * Resources
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

/**
 * Dependencies
 */
import { apiClientMutator } from '@{{PROJECT_NAME}}/api-client'
import { authControllerGetMe } from '@{{PROJECT_NAME}}/api-client/generated/api/authentication/authentication'

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
      return apiClientMutator<CreateOwnAccountResponse>({
        url: '/api/accounts/own',
        method: 'POST',
        data: payload
      })
    },
    onSuccess: async () => {
      try {
        const fresh = await authControllerGetMe()
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
