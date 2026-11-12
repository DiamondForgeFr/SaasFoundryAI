/**
 * Scope filter: the single source of truth for "which role assignments count for this target".
 *
 * PermissionsGuard (route level) and AccountAccessService (service level) both call it, so a route
 * and the service behind it can never disagree on whose roles apply. It is a pure function: no
 * database access, no framework dependency, everything it needs is on the arguments.
 *
 * Why it exists: a user holds several role assignments (PLATFORM, ACCOUNT on one account, ENTITY on
 * one entity...). Checking a permission against the union of all of them lets a role held in one
 * place authorise an action somewhere else. The filter keeps only the assignments that apply to the
 * account or entity the request acts on.
 *
 * Rule per target:
 *   - ACCOUNT target A: PLATFORM; ACCOUNT assignments on A; ENTITY assignments on an entity that
 *     belongs to A, only when the caller opts in (`includeEntityAssignments`). An ACCOUNT assignment
 *     on another account never counts.
 *   - ENTITY target E: PLATFORM; ACCOUNT assignments on E's account; ENTITY assignments on E or on
 *     one of its ancestors. An assignment on a descendant, a sibling or another account never counts.
 */

/**
 * Types
 */
export interface ScopedAssignment {
  accountId: string | null
  entityId: string | null
  role: { scope: string }
  /** The entity the assignment is held on (id and owning account). Absent when not loaded: such an ENTITY assignment never counts. */
  entity?: { id: string; accountId: string } | null
}

export interface AccountScopeTarget {
  kind: 'ACCOUNT'
  accountId: string
  /** Also count ENTITY assignments held on an entity of this account. Default false. */
  includeEntityAssignments?: boolean
}

export interface EntityScopeTarget {
  kind: 'ENTITY'
  entityId: string
  /** The account the entity belongs to, or null when the entity does not exist (only PLATFORM counts then). */
  accountId: string | null
  /** The entity itself and every ancestor up to the root (no order). Empty when the entity does not exist. */
  ancestorEntityIds: string[]
}

export type ScopeTarget = AccountScopeTarget | EntityScopeTarget

/**
 * The account or entity a check acts on, before an ENTITY is resolved (its account and ancestor chain).
 * `includeEntityAssignments` has the same meaning as on `@ScopeFrom`.
 */
export type ScopeRequest = { kind: 'ACCOUNT'; accountId: string; includeEntityAssignments?: boolean } | { kind: 'ENTITY'; entityId: string }

/**
 * Declaration
 */

/** A PLATFORM assignment is the only one that reaches every account: it is bound to no account and no entity. */
export const isPlatformAssignment = (assignment: ScopedAssignment): boolean => assignment.role.scope === 'PLATFORM' && assignment.accountId === null && assignment.entityId === null

/** Keep only the PLATFORM assignments (used by PLATFORM_ADMINISTRATION routes, whatever the target). */
export function keepPlatformAssignments<T extends ScopedAssignment>(assignments: readonly T[]): T[] {
  return assignments.filter(isPlatformAssignment)
}

/** Keep the assignments that apply to `target` (rule in the file header). */
export function filterAssignmentsForTarget<T extends ScopedAssignment>(assignments: readonly T[], target: ScopeTarget): T[] {
  return assignments.filter((assignment) => {
    switch (assignment.role.scope) {
      case 'PLATFORM':
        return isPlatformAssignment(assignment)

      case 'ACCOUNT':
        if (assignment.accountId === null || assignment.entityId !== null) return false
        return target.accountId !== null && assignment.accountId === target.accountId

      case 'ENTITY': {
        if (assignment.entityId === null) return false
        if (target.kind === 'ACCOUNT') {
          // Opt-in only, and only for an entity that belongs to the target account.
          return target.includeEntityAssignments === true && assignment.entity?.id === assignment.entityId && assignment.entity.accountId === target.accountId
        }
        return target.ancestorEntityIds.includes(assignment.entityId)
      }

      default:
        return false
    }
  })
}
