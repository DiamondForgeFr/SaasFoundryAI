import { useQueryClient } from '@tanstack/react-query'
import { useModuleAccess } from './useModuleAccess'
import type { MeResponseDto } from '@/hooks/api/auth'

export function useAdminScope() {
  const queryClient = useQueryClient()
  const { hasPermission } = useModuleAccess()

  const authMe = queryClient.getQueryData<MeResponseDto>(['authMe'])

  const isAccountAdmin = hasPermission('USER_ACCOUNTS_INVITATION')
  const isEntityAdmin = !isAccountAdmin && hasPermission('USER_ENTITIES_INVITATION')

  const activeAccount = authMe?.accounts.find((a) => a.isActive) ?? null
  const allAccounts = authMe?.accounts ?? []
  const isMultiAccount = allAccounts.length > 1

  // For entity-admin: the entities they manage
  const managedEntities = authMe?.entities ?? []

  return {
    isAccountAdmin,
    isEntityAdmin,
    activeAccount,
    allAccounts,
    isMultiAccount,
    managedEntities,
    authMe
  }
}
