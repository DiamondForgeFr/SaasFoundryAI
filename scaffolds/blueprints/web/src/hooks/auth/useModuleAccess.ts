/**
 * Dependencies
 */
import { useGuest } from '@/hooks/api/auth'
import { useAdminScope } from './useAdminScope'

/**
 * Resolves access by intersecting the guest baseline (anonymous reach) with
 * the scope-filtered permissions of the current authenticated session. The
 * current scope comes from useAdminScope (server-elected default + optional
 * client override stored in sessionStorage).
 */
export const useModuleAccess = () => {
  const { data: guest } = useGuest()
  const { modules: scopedModules, subModules: scopedSubModules, permissions: scopedPermissions } = useAdminScope()

  const hasModuleAccess = (module: string): boolean => {
    return scopedModules.includes(module) || !!guest?.modules?.includes(module)
  }

  // Sub-modules are section-level read gates. Unlike modules, there is no guest baseline to
  // intersect — an anonymous visitor never reaches a complex module's sections — so we resolve
  // purely from the scoped sub-module set elected by useAdminScope.
  const hasSubModule = (name: string): boolean => {
    return scopedSubModules.includes(name)
  }

  const hasPermission = (permission: string): boolean => {
    return scopedPermissions.includes(permission) || !!guest?.permissions?.includes(permission)
  }

  return {
    hasModuleAccess,
    hasSubModule,
    hasPermission,
    awaitsPlatformAdmin: !!guest?.awaitsPlatformAdmin
  }
}
