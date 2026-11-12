import { SetMetadata } from '@nestjs/common'

export const PERMISSIONS_KEY = 'permissions'
export const MODULE_KEY = 'required_module'
export const SUB_MODULE_KEY = 'required_sub_module'
export const REQUIRE_ALL_KEY = 'require_all_permissions'
export const SCOPE_FROM_KEY = 'scope_from'

// Special permission to indicate full access without specific permissions
export const FULL_ACCESS = '$_FULL_ACCESS'

export interface PermissionRequirement {
  module: string
  permissions: string[]
  requireAll?: boolean
}

export interface PermissionOptions {
  requireAll?: boolean
}

export const RequirePermissions = (permissions: string[], module: string, options?: PermissionOptions) => {
  const requireAll = options?.requireAll !== undefined ? options.requireAll : true

  return (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    SetMetadata(PERMISSIONS_KEY, permissions)(target, key!, descriptor!)
    SetMetadata(MODULE_KEY, module)(target, key!, descriptor!)
    SetMetadata(REQUIRE_ALL_KEY, requireAll)(target, key!, descriptor!)
    return descriptor
  }
}

/** What a path parameter designates: an account id or an entity id. */
export type ScopeFromKind = 'ACCOUNT' | 'ENTITY'

export interface ScopeFromOptions {
  /**
   * ACCOUNT targets only. When true, ENTITY-scoped assignments held on an entity that belongs to the
   * target account count too (the entity-admin flows on account routes: reading the users / roles of
   * its account, allocating roles in its entity). The service then narrows the action to that
   * entity's subtree. Default false: only PLATFORM and the ACCOUNT assignments of that account count.
   */
  includeEntityAssignments?: boolean
}

export interface ScopeFromMetadata {
  param: string
  kind: ScopeFromKind
  includeEntityAssignments: boolean
}

/**
 * Declare which account or entity a route acts on, so PermissionsGuard only counts the role
 * assignments that apply to it (instead of the union of every assignment the actor holds).
 *
 *   @ScopeFrom('id', 'ACCOUNT')                                     // :id is an account id
 *   @ScopeFrom('id', 'ACCOUNT', { includeEntityAssignments: true }) // ...and entity roles of that account count
 *   @ScopeFrom('id', 'ENTITY')                                      // :id is an entity id
 *
 * Rule per target (see PermissionsGuard and `filterAssignmentsForTarget`):
 *   - ACCOUNT A: PLATFORM; ACCOUNT assignments on A; ENTITY assignments on an entity of A only when
 *     `includeEntityAssignments` is set.
 *   - ENTITY E: PLATFORM; ACCOUNT assignments on E's account; ENTITY assignments on E or one of its
 *     ancestors, never on a descendant.
 *
 * A route without @ScopeFrom keeps the permissive union of every assignment, so declare it on every
 * route that takes an account or entity id.
 */
export const ScopeFrom = (param: string, kind: ScopeFromKind, options?: ScopeFromOptions) => {
  const metadata: ScopeFromMetadata = { param, kind, includeEntityAssignments: options?.includeEntityAssignments === true }
  return SetMetadata(SCOPE_FROM_KEY, metadata)
}

export interface AccessRequirement {
  /** Module that must be reachable (READ visibility of the screen). */
  module: string
  /** Sub-module (section) that must be visible. When omitted, only the module is required (simple modules). */
  subModule?: string
}

/**
 * Read-access gate (RBAC v2). Authorises a read endpoint when the actor holds the module and,
 * when set, the matching sub-module (section visibility). No action permission is required —
 * a read-only role granted the section can READ. Writes keep using @RequirePermissions.
 */
export const RequireAccess = ({ module, subModule }: AccessRequirement) => {
  return (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    SetMetadata(MODULE_KEY, module)(target, key!, descriptor!)
    if (subModule) SetMetadata(SUB_MODULE_KEY, subModule)(target, key!, descriptor!)
    SetMetadata(PERMISSIONS_KEY, [])(target, key!, descriptor!)
    return descriptor
  }
}
