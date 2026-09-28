/**
 * Resources
 */
import { queryClient } from '@/lib/react-query/query-client'
import { setUnauthorizedHandler } from '@{{PROJECT_NAME}}/api-client/http-client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactNode } from 'react'

/**
 * Dependencies
 */
import { useGuest } from '@/hooks/api/auth'
import { clearAuthSession, persistAuthMe } from '@/hooks/api/auth/utils/persistAuthMe'

/**
 * TS Types
 */
interface QueryProviderProps {
  children: ReactNode
}

/**
 * Cached data — rehydrate the cached /me snapshot so the first paint after a refresh has
 * the user's identity available immediately. Then schedule a background refresh so any
 * staleness (account deactivation, role change, module toggle that happened between the last
 * mutation persisting the snapshot and now) corrects itself within seconds.
 *
 * `useMe` is declared with `enabled: false`, so without this background refresh the cache
 * would live indefinitely on whatever state the localStorage snapshot was last written in.
 */
// Centralised auth-failure handling for generated api-client calls: any 401 tears the session
// down (cache + localStorage + scope override) so a stale/phantom login can't survive — the route
// guards then redirect to /signin.
setUnauthorizedHandler(() => clearAuthSession(queryClient))

const cachedMe = localStorage.getItem('authMe')
if (cachedMe) {
  queryClient.setQueryData(['authMe'], JSON.parse(cachedMe))
  // Re-validate the cached session against the server. `persistAuthMe` purges the stale snapshot
  // on a session-invalidating response (bad token / deleted user/account → 401/403/404) and keeps
  // it on a transient network error.
  void persistAuthMe(queryClient)
}

/**
 * React declaration
 */
function InitGuest() {
  const guest = useGuest()
  guest.refetch()
  return <></>
}

export function QueryProvider({ children }: QueryProviderProps) {
  return (
    <QueryClientProvider client={queryClient}>
      {!cachedMe && <InitGuest />}
      {children}
    </QueryClientProvider>
  )
}
