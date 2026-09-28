/**
 * Resources
 */
import { Navigate, Outlet } from 'react-router-dom'

/**
 * Dependencies
 */
import { useGuest } from '@/hooks/api/auth'
import { useAdminScope } from '@/hooks/auth/useAdminScope'
import { useIsSessionActive } from '@/hooks/auth/useIsSession'
import { useModuleAccess } from '@/hooks/auth/useModuleAccess'

/**
 * Types
 */
type ModuleAccessRouteProps = {
  module: string
}

/**
 * Declarations
 */
export const PrivateOnlyRoute = () => {
  const { isSessionActive } = useIsSessionActive()

  if (!isSessionActive) return <Navigate to="/signin" replace />

  return <Outlet />
}

export const PublicOnlyRoute = () => {
  const { isSessionActive } = useIsSessionActive()

  if (isSessionActive) return <Navigate to="/dashboard" replace />

  return <Outlet />
}

export const ModuleAccessRoute = ({ module }: ModuleAccessRouteProps) => {
  const { hasModuleAccess } = useModuleAccess()
  const { isLoading } = useGuest()

  if (isLoading) return null // On attend le chargement des données

  if (!hasModuleAccess(module)) return <Navigate to="/signin" replace />

  return <Outlet />
}

/**
 * Account-disabled gate: when the user has access only to disabled accounts (i.e. they are
 * not a platform-admin and every account they belong to has `isActive === false`), redirect
 * every private route except `/account/reactivation` and `/profile` to the reactivation page.
 *
 * Platform-admins are unaffected — they can still navigate freely.
 */
export const AccountDisabledRoute = () => {
  const { isPlatformAdmin, allAccounts } = useAdminScope()
  const { isLoading } = useGuest()

  if (isLoading) return null

  if (isPlatformAdmin) return <Outlet />

  // No account at all (entity-only user) → carry on; entity routes can decide separately.
  if (allAccounts.length === 0) return <Outlet />

  const hasAnyActiveAccount = allAccounts.some((a) => a.isActive)
  if (hasAnyActiveAccount) return <Outlet />

  // Every account is disabled — redirect.
  return <Navigate to="/account/reactivation" replace />
}
