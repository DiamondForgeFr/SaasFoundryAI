/**
 * Resources
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

/**
 * Dependencies
 */
import { useMe } from '@/hooks/api/auth/queries/useMe'
import type { MeResponseDto, RoleScope } from '@/hooks/api/auth'

/**
 * Local-only override of the current scope. Persisted across reloads in
 * sessionStorage so the user keeps the same context while navigating.
 *
 * Shape:
 *   `${kind}::${id ?? ''}`   e.g. "ACCOUNT::cln123" or "PLATFORM::"
 *
 * Cleared when the user logs out (handled in auth signOut hook — TODO).
 */
const STORAGE_KEY = 'currentScopeOverride'
type ScopeOverride = { kind: RoleScope; id: string | null } | null

/**
 * `useSyncExternalStore` requires `getSnapshot` to return a *stable* reference when the
 * underlying value hasn't changed — otherwise React assumes "changed", re-renders, calls
 * `getSnapshot` again, gets yet another new reference, and you get a Maximum update depth
 * error.
 *
 * We therefore expose the raw storage string as the snapshot (strings are reference-stable
 * across calls when their content matches) and parse it via `useMemo` inside the hook.
 */
const readOverrideRaw = (): string | null => {
  if (typeof window === 'undefined') return null
  return window.sessionStorage.getItem(STORAGE_KEY)
}

const parseOverride = (raw: string | null): ScopeOverride => {
  if (!raw) return null
  const [kind, idPart] = raw.split('::')
  if (kind !== 'PLATFORM' && kind !== 'ACCOUNT' && kind !== 'ENTITY') return null
  return { kind, id: idPart || null }
}

const subscribers = new Set<() => void>()
const subscribe = (cb: () => void) => {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}
const notify = () => subscribers.forEach((cb) => cb())

const writeOverride = (next: ScopeOverride) => {
  if (typeof window === 'undefined') return
  if (!next) window.sessionStorage.removeItem(STORAGE_KEY)
  else window.sessionStorage.setItem(STORAGE_KEY, `${next.kind}::${next.id ?? ''}`)
  notify()
}

export type CurrentScope = { kind: RoleScope; id: string | null }

export interface UseAdminScopeResult {
  /** Effective scope: client override > server-elected currentScope. */
  currentScope: CurrentScope
  /** All assignments the user has, in the order returned by the server. */
  assignments: NonNullable<MeResponseDto>['roleAssignments']
  /** Permissions effective in the current scope (PLATFORM grants override everything). */
  permissions: string[]
  /** Modules effective in the current scope. */
  modules: string[]
  /** Sub-modules (visible sections) effective in the current scope. */
  subModules: string[]
  /** Effective role names in the current scope. */
  roles: string[]
  /** Convenience flags derived from the current scope + assignments. */
  isPlatformAdmin: boolean
  isAccountAdmin: boolean
  isEntityAdmin: boolean
  /** True when the user can switch between multiple scopes. */
  hasMultipleScopes: boolean
  /** Distinct accounts the user has an ACCOUNT-scoped assignment on. */
  scopedAccountIds: string[]
  /** Distinct entities the user has an ENTITY-scoped assignment on. */
  scopedEntityIds: string[]
  /** Active account record (for ACCOUNT scope) when resolvable. */
  activeAccount: NonNullable<MeResponseDto>['accounts'][number] | null
  /** All accounts the user is linked to. */
  allAccounts: NonNullable<MeResponseDto>['accounts']
  isMultiAccount: boolean
  managedEntities: NonNullable<MeResponseDto>['entities']
  /** Active entity (for ENTITY scope) — explicitly selected via currentScope.id, else first managed entity. */
  activeEntity: NonNullable<MeResponseDto>['entities'][number] | null
  /** True when the user manages more than one entity (drives the entity switcher visibility). */
  isMultiEntity: boolean
  /** Raw /me payload — handy for legacy callers. */
  authMe: MeResponseDto | undefined
  /** Mutate the current scope (persisted in sessionStorage). */
  setCurrentScope: (next: CurrentScope | null) => void
}

export function useAdminScope(): UseAdminScopeResult {
  // Subscribe to the `authMe` cache via `useMe` (a `useQuery` observer) instead of reading
  // it once with `getQueryData`. Without a subscription, this hook would not re-render
  // when the cache is invalidated/updated by mutations (e.g. toggling a platform module),
  // so the UI kept serving the previous permission set until a manual reload.
  const { data: authMe } = useMe()

  // Snapshot is the raw string (reference-stable when content matches) — we parse below.
  const overrideRaw = useSyncExternalStore(subscribe, readOverrideRaw, () => null)
  const override = useMemo(() => parseOverride(overrideRaw), [overrideRaw])

  const setCurrentScope = useCallback((next: CurrentScope | null) => {
    writeOverride(next)
  }, [])

  // Sweep stale PLATFORM overrides left in sessionStorage by a previous user session.
  // The memo below already coerces the in-memory scope; this just keeps the storage truthful.
  useEffect(() => {
    if (!authMe || !override || override.kind !== 'PLATFORM') return
    const hasPlatformAssignment = authMe.roleAssignments.some((a) => a.scope === 'PLATFORM')
    if (!hasPlatformAssignment) writeOverride(null)
  }, [authMe, override])

  return useMemo<UseAdminScopeResult>(() => {
    const fallbackScope: CurrentScope = authMe?.currentScope ?? { kind: 'PLATFORM', id: null }
    const rawScope: CurrentScope = override ?? fallbackScope

    const assignments = authMe?.roleAssignments ?? []

    // Defensive coercion: a non-platform-admin must never sit on a PLATFORM scope, even if a
    // stale `currentScopeOverride` from a previous session (e.g. a platform-admin that logged
    // out without clearing sessionStorage) suggests otherwise. Fall back to their first ACCOUNT
    // (or ENTITY) assignment, and erase the stale override so subsequent reads stay coherent.
    const hasPlatformAssignment = assignments.some((a) => a.scope === 'PLATFORM')
    let currentScope: CurrentScope = rawScope
    if (rawScope.kind === 'PLATFORM' && !hasPlatformAssignment) {
      const accountAssignment = assignments.find((a) => a.scope === 'ACCOUNT' && a.accountId)
      const entityAssignment = assignments.find((a) => a.scope === 'ENTITY' && a.entityId)
      if (accountAssignment?.accountId) currentScope = { kind: 'ACCOUNT', id: accountAssignment.accountId }
      else if (entityAssignment?.entityId) currentScope = { kind: 'ENTITY', id: entityAssignment.entityId }
    }
    const allAccounts = authMe?.accounts ?? []
    const managedEntities = authMe?.entities ?? []

    const relevant = assignments.filter((a) => {
      if (a.scope === 'PLATFORM') return true
      if (a.scope === 'ACCOUNT') return currentScope.kind === 'ACCOUNT' ? a.accountId === currentScope.id : currentScope.kind === 'PLATFORM'
      if (a.scope === 'ENTITY') return currentScope.kind === 'ENTITY' ? a.entityId === currentScope.id : currentScope.kind === 'PLATFORM'
      return false
    })

    const permissions = Array.from(new Set(relevant.flatMap((a) => a.permissions)))
    const modules = Array.from(new Set(relevant.flatMap((a) => a.modules)))
    const subModules = Array.from(new Set(relevant.flatMap((a) => a.subModules ?? [])))
    const roles = Array.from(new Set(relevant.map((a) => a.roleName)))

    const isPlatformAdmin = assignments.some((a) => a.scope === 'PLATFORM')
    const isAccountAdmin = relevant.some((a) => a.scope === 'ACCOUNT' && a.permissions.includes('USER_ACCOUNTS_INVITATION'))
    const isEntityAdmin = !isAccountAdmin && relevant.some((a) => a.scope === 'ENTITY' && a.permissions.includes('USER_ENTITIES_INVITATION'))

    const scopedAccountIds = Array.from(new Set(assignments.filter((a) => a.scope === 'ACCOUNT' && a.accountId).map((a) => a.accountId as string)))
    const scopedEntityIds = Array.from(new Set(assignments.filter((a) => a.scope === 'ENTITY' && a.entityId).map((a) => a.entityId as string)))

    const hasMultipleScopes = (isPlatformAdmin ? 1 : 0) + (scopedAccountIds.length > 0 ? 1 : 0) + (scopedEntityIds.length > 0 ? 1 : 0) > 1 || scopedAccountIds.length > 1 || scopedEntityIds.length > 1

    const activeAccount = currentScope.kind === 'ACCOUNT' && currentScope.id ? (allAccounts.find((acc) => acc.id === currentScope.id) ?? null) : (allAccounts.find((a) => a.isActive) ?? null)
    // Active entity resolution mirrors activeAccount: prefer the explicitly scoped entity, else
    // the first active managed entity. Drives the entity switcher / scope header in entity-admin views.
    const activeEntity = currentScope.kind === 'ENTITY' && currentScope.id ? (managedEntities.find((e) => e.id === currentScope.id) ?? null) : (managedEntities.find((e) => e.isActive) ?? null)

    return {
      currentScope,
      assignments,
      permissions,
      modules,
      subModules,
      roles,
      isPlatformAdmin,
      isAccountAdmin,
      isEntityAdmin,
      hasMultipleScopes,
      scopedAccountIds,
      scopedEntityIds,
      activeAccount,
      allAccounts,
      isMultiAccount: allAccounts.length > 1,
      managedEntities,
      activeEntity,
      isMultiEntity: managedEntities.length > 1,
      authMe,
      setCurrentScope
    }
  }, [authMe, override, setCurrentScope])
}
