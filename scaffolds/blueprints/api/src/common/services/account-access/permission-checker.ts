/**
 * Resources
 */
import { ForbiddenException } from '@nestjs/common'

/**
 * Dependencies
 */
import { filterAssignmentsForTarget, keepPlatformAssignments } from '@common/services/account-access/scope-filter'

/**
 * Type
 */
import type { EntityScopeTarget, ScopedAssignment, ScopeRequest, ScopeTarget } from '@common/services/account-access/scope-filter'

/**
 * A role assignment with the permission names of its role, which is all a permission check reads. The ids of the
 * role's active sections are there only when the checker was built with them (`withSubModules`).
 */
export interface PermissionAssignment extends ScopedAssignment {
  role: { scope: string; permissionsLinked: { permission: { name: string } }[]; subModulesLinked?: { subModuleId: number }[] }
}

/**
 * Answers "does this user hold this permission in this account or entity?" any number of times without
 * touching the database again: the user's assignments and the entities involved are loaded once
 * (`AccountAccessService.getPermissionChecker`), and every check is then a pure call to the scope filter.
 *
 * Use it when one request checks several targets (an invitation to many accounts and entities, a user
 * update with many entity slices). A request that checks one scope can call
 * `AccountAccessService.assertPermissionInScope` instead.
 */
export class ScopedPermissionChecker {
  constructor(
    private readonly assignments: readonly PermissionAssignment[],
    private readonly entityTargets: ReadonlyMap<string, EntityScopeTarget>,
    private readonly withSubModules = false
  ) {}

  /** The resolved entity (its account and ancestor chain). The entity must have been named when the checker was built. */
  entityTarget(entityId: string): EntityScopeTarget {
    const target = this.entityTargets.get(entityId)
    if (!target) throw new Error(`Entity ${entityId} was not resolved when this permission checker was built`)
    return target
  }

  /** Does the user hold `permission` through an assignment that applies to `scope`? */
  has(permission: string, scope: ScopeRequest): boolean {
    return this.assignmentsFor(scope).some((assignment) => assignment.role.permissionsLinked.some((link) => link.permission.name === permission))
  }

  /**
   * Does the user hold `permission` through a PLATFORM assignment? Platform authority, whatever the target: what a
   * PLATFORM_ADMINISTRATION route requires, and what changing a system role requires.
   */
  hasOnPlatform(permission: string): boolean {
    return keepPlatformAssignments(this.assignments).some((assignment) => assignment.role.permissionsLinked.some((link) => link.permission.name === permission))
  }

  /** Does the user hold the section (sub-module) `subModuleId`, active, through an assignment that applies to `scope`? Needs a checker built `withSubModules`. */
  hasSubModule(subModuleId: number, scope: ScopeRequest): boolean {
    if (!this.withSubModules) throw new Error('This permission checker was built without the sections: build it with `withSubModules`')
    return this.assignmentsFor(scope).some((assignment) => (assignment.role.subModulesLinked ?? []).some((link) => link.subModuleId === subModuleId))
  }

  /** Same as `has`, but throws a 403 (authenticated, not authorised) when the permission is missing. */
  assert(permission: string, scope: ScopeRequest, message = 'You do not have the required permissions'): void {
    if (!this.has(permission, scope)) throw new ForbiddenException(message)
  }

  private assignmentsFor(scope: ScopeRequest): PermissionAssignment[] {
    const target: ScopeTarget =
      scope.kind === 'ENTITY' ? this.entityTarget(scope.entityId) : { kind: 'ACCOUNT', accountId: scope.accountId, includeEntityAssignments: scope.includeEntityAssignments === true }
    return filterAssignmentsForTarget(this.assignments, target)
  }
}
