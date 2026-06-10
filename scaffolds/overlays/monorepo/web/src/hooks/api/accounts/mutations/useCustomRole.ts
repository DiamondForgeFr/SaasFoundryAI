/**
 * Resources
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

/**
 * Dependencies
 */
import { apiClientMutator } from '@{{PROJECT_NAME}}/api-client'
import { authControllerGetMe } from '@{{PROJECT_NAME}}/api-client/generated/api/authentication/authentication'

export type CreateCustomRolePayload = {
  /** `null` for PLATFORM-scoped custom roles (platform-admin only). */
  accountId: string | null
  name: string
  description?: string | null
  scope: 'PLATFORM' | 'ACCOUNT' | 'ENTITY'
  /** Sections (read-visibility) granted to the role. A permission's section is auto-included server-side. */
  subModuleIds?: number[]
  permissionIds: number[]
}

export const useCreateCustomRole = () => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async ({ accountId, ...body }: CreateCustomRolePayload) => {
      // Two backend routes for two scope-tiers: PLATFORM-scoped roles live as global templates
      // alongside the seeded system roles; ACCOUNT/ENTITY roles live under their owning account.
      const url = accountId === null ? '/api/accounts/platform/roles' : `/api/accounts/${accountId}/roles`
      return apiClientMutator<{ id: number; name: string; scope: 'PLATFORM' | 'ACCOUNT' | 'ENTITY' }>({
        url,
        method: 'POST',
        data: body
      })
    },
    onSuccess: (_data, variables) => {
      // A global template (accountId=null) is visible from every account view too — invalidate
      // both caches so list pages refresh regardless of whether the user is platform-admin or
      // scoped into a specific account when the template gets used.
      if (variables.accountId) {
        queryClient.invalidateQueries({ queryKey: ['account', variables.accountId, 'roles'] })
        queryClient.invalidateQueries({ queryKey: ['account', variables.accountId] })
      } else {
        // Global template — every account-scoped roles list now potentially has a new entry.
        queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'account' && q.queryKey[2] === 'roles' })
      }
      queryClient.invalidateQueries({ queryKey: ['systemRoles'] })
    }
  })
  return { ...mutation, isLoading: mutation.isPending }
}

export type UpdateCustomRolePayload = {
  roleId: number
  /** Owning account when editing a custom role; `null` for system roles. */
  accountId: string | null
  name?: string
  description?: string | null
  /** Sections (read-visibility) granted to the role. A permission's section is auto-included server-side. */
  subModuleIds?: number[]
  permissionIds?: number[]
}

export const useUpdateCustomRole = () => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async ({ roleId, accountId: _accountId, ...body }: UpdateCustomRolePayload) => {
      return apiClientMutator<{ id: number; name: string }>({
        url: `/api/accounts/roles/${roleId}`,
        method: 'PATCH',
        data: body
      })
    },
    onSuccess: async (_data, variables) => {
      // Invalidate both account-scoped and platform-wide role caches — a role edit can affect either list.
      queryClient.invalidateQueries({ queryKey: ['account', variables.accountId, 'roles'] })
      queryClient.invalidateQueries({ queryKey: ['account', variables.accountId] })
      queryClient.invalidateQueries({ queryKey: ['systemRoles'] })

      // System role permission changes affect the current user's effective permissions.
      // `useMe` is `enabled: false`, so we manually refetch and push to the cache.
      try {
        const fresh = await authControllerGetMe()
        queryClient.setQueryData(['authMe'], fresh)
      } catch (e) {
        console.warn('Failed to refresh authMe after role update', e)
      }
    }
  })
  return { ...mutation, isLoading: mutation.isPending }
}

export type ToggleRoleStatusPayload = {
  roleId: number
  isActive: boolean
  /** Owning account (for cache invalidation); null for global templates / system roles. */
  accountId: string | null
}

/**
 * Toggle a role's `isActive` flag. Backend enforces the auth matrix
 * (cf. account.service.ts:toggleRoleStatus). System roles are platform-admin only.
 */
export const useToggleRoleStatus = () => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async ({ roleId, isActive }: ToggleRoleStatusPayload) => {
      return apiClientMutator<{ id: number; isActive: boolean }>({
        url: `/api/accounts/roles/${roleId}/status`,
        method: 'PATCH',
        data: { isActive }
      })
    },
    onSuccess: (_data, variables) => {
      if (variables.accountId) {
        queryClient.invalidateQueries({ queryKey: ['account', variables.accountId, 'roles'] })
        queryClient.invalidateQueries({ queryKey: ['account', variables.accountId] })
      }
      queryClient.invalidateQueries({ queryKey: ['systemRoles'] })
      // Also invalidate every account-scoped roles list — a global template flip affects all accounts.
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'account' && q.queryKey[2] === 'roles' })
    }
  })
  return { ...mutation, isLoading: mutation.isPending }
}

export const useDeleteCustomRole = () => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async ({ roleId, accountId: _accountId }: { roleId: number; accountId: string }) => {
      return apiClientMutator<{ id: number }>({
        url: `/api/accounts/roles/${roleId}`,
        method: 'DELETE'
      })
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['account', variables.accountId, 'roles'] })
      queryClient.invalidateQueries({ queryKey: ['account', variables.accountId] })
    }
  })
  return { ...mutation, isLoading: mutation.isPending }
}
