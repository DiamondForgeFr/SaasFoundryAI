import type { QueryClient } from '@tanstack/react-query'

import { authControllerGetMe } from '@{{PROJECT_NAME}}/api-client/generated/api/authentication/authentication'

const STORAGE_KEY = 'authMe'

/**
 * HTTP statuses that mean "this session is no longer valid" — the token is bad/expired (401/403)
 * or the user/account it pointed at no longer exists (404, e.g. after a DB reset). On any of these
 * we must purge the locally-cached identity so the route guards bounce the user to /signin instead
 * of leaving them "logged in" to a phantom account.
 */
const SESSION_INVALIDATING_STATUSES = new Set([401, 403, 404])

/**
 * Purge every trace of the authenticated session (React-Query cache + localStorage snapshot +
 * the scope override), then re-init guest access so the public pages (signin) have what they need.
 * Exported so the api-client's `onUnauthorized` handler reuses the exact same teardown.
 */
export const clearAuthSession = (queryClient: QueryClient) => {
  queryClient.setQueryData([STORAGE_KEY], null)
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem('authMe')
    window.localStorage.removeItem('guestAccess')
    window.sessionStorage.removeItem('currentScopeOverride')
  }
  // guest is declared `enabled: false`; force a refetch so signin has the guest baseline.
  void queryClient.refetchQueries({ queryKey: ['guestAccess'] })
}

/**
 * Update the `authMe` cache in BOTH places where it lives: the React-Query store and the
 * localStorage snapshot used for cache rehydration after a browser refresh.
 *
 * Why this exists — `useMe` is set up with `enabled: false` and `staleTime: Infinity`, so it
 * never auto-refetches. The first paint after a refresh reads from localStorage. If we only
 * call `setQueryData(['authMe'], fresh)` after a mutation, the in-memory cache is correct but
 * the localStorage copy is now stale, and the next refresh resurrects the pre-mutation state.
 *
 * Use this helper in every mutation that needs a fresh /me afterwards. On startup it also acts as
 * the session re-validation: if /me reports the session is gone (bad token / deleted user/account),
 * we purge the stale snapshot so a phantom login can't survive a DB reset; transient network
 * errors keep the cached snapshot (don't log the user out just because they're briefly offline).
 */
export const persistAuthMe = async (queryClient: QueryClient) => {
  try {
    const fresh = await authControllerGetMe()
    queryClient.setQueryData([STORAGE_KEY], fresh)
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh))
    return fresh
  } catch (e) {
    const status = (e as { status?: number } | null)?.status
    if (typeof status === 'number' && SESSION_INVALIDATING_STATUSES.has(status)) {
      // Session no longer valid — tear it down; route guards will redirect to /signin.
      clearAuthSession(queryClient)
    } else {
      // Transient (network/offline) — keep the cached session, just log it.
      console.warn('Failed to refresh authMe (transient — keeping cached session)', e)
    }
    return null
  }
}
