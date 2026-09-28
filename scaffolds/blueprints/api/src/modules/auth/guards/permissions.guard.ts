/**
 * Resources
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

/**
 * Dependencies
 */
import { FULL_ACCESS, MODULE_KEY, PERMISSIONS_KEY, REQUIRE_ALL_KEY, SUB_MODULE_KEY } from '@common/decorators/require-permissions.decorator'
import { Logger } from '@common/services/logger/logger.service'

/**
 * Type
 */
import type { AuthenticatedUser } from '@common/types/authenticated-request.type'
import type { Request } from 'express'

type ScopeContext = {
  /** When set, restrict ACCOUNT-scoped assignments to those targeting this account. */
  accountId?: string
  /** When set, restrict ENTITY-scoped assignments to those targeting this entity. */
  entityId?: string
  /**
   * When true, ignore scope filtering and use the union of all assignments
   * (backwards-compatible behavior for endpoints that don't carry a scope hint).
   */
  permissive: boolean
}

/**
 * Declaration
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private logger: Logger
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()])
    const requiredModule = this.reflector.getAllAndOverride<string>(MODULE_KEY, [context.getHandler(), context.getClass()])
    const requiredSubModule = this.reflector.getAllAndOverride<string>(SUB_MODULE_KEY, [context.getHandler(), context.getClass()])
    const requireAll = this.reflector.getAllAndOverride<boolean>(REQUIRE_ALL_KEY, [context.getHandler(), context.getClass()])

    if (!requiredModule) return true

    const request = context.switchToHttp().getRequest<Request>()
    const user: AuthenticatedUser | undefined = request.user as AuthenticatedUser | undefined

    // 401 is reserved for unauthenticated/no-session; authenticated-but-unauthorised yields 403 (D7).
    if (!user?.id) {
      this.logger.warn('Access denied: No user found in request', 'PermissionsGuard')
      throw new UnauthorizedException('Authentication required')
    }

    const scope = this.resolveScopeContext(request)
    const relevantAssignments = this.filterAssignmentsByScope(user, scope)

    const hasModuleAccess = relevantAssignments.some((assignment) => assignment.role.modulesLinked.some((moduleLink) => moduleLink.module.name === requiredModule))

    if (!hasModuleAccess) {
      this.logger.warn(`Access denied: User ${user.id} has no access to ${requiredModule} in scope ${this.describeScope(scope)}`, 'PermissionsGuard')
      throw new ForbiddenException(`You do not have access to ${requiredModule.toLowerCase().replace('_', ' ')}`)
    }

    // Sub-module (section visibility) gate for read endpoints. The section is visible when the
    // actor holds it through a scoped assignment that also holds the parent module.
    if (requiredSubModule) {
      const hasSubModuleAccess = relevantAssignments.some((assignment) => assignment.role.subModulesLinked.some((subModuleLink) => subModuleLink.subModule.name === requiredSubModule))

      if (!hasSubModuleAccess) {
        this.logger.warn(`Access denied: User ${user.id} has no access to section ${requiredSubModule} in scope ${this.describeScope(scope)}`, 'PermissionsGuard')
        throw new ForbiddenException(`You do not have access to the ${requiredSubModule.toLowerCase().replace(/_/g, ' ')} section`)
      }
    }

    if (!requiredPermissions || requiredPermissions.length === 0) return true
    if (requiredPermissions.includes(FULL_ACCESS)) return true

    const userPermissions = relevantAssignments.flatMap((assignment) => assignment.role.permissionsLinked.map((permissionLink) => permissionLink.permission.name))

    const hasRequiredPermissions =
      requireAll === false ? requiredPermissions.some((permission) => userPermissions.includes(permission)) : requiredPermissions.every((permission) => userPermissions.includes(permission))

    if (!hasRequiredPermissions) {
      const requiredText = requireAll === false ? 'at least one of' : 'all of'
      this.logger.warn(`Access denied: User ${user.id} does not have ${requiredText} required permissions in scope ${this.describeScope(scope)}: ${requiredPermissions.join(', ')}`, 'PermissionsGuard')
      throw new ForbiddenException('You do not have the required permissions')
    }

    return true
  }

  /**
   * Read the scope hint from the request. Resolution order:
   *   1. `X-Scope-Account-Id` header
   *   2. `X-Scope-Entity-Id` header
   *   3. `:accountId` path param  (e.g. /accounts/:accountId/...)
   *   4. `:entityId`  path param  (e.g. /entities/:entityId/...)
   *
   * If none are present, the guard falls back to the *permissive* union of all
   * assignments — same behavior as before this rework, so endpoints that don't
   * carry a scope (e.g. /me, /auth/*) keep working.
   */
  private resolveScopeContext(request: Request): ScopeContext {
    const accountHeader = this.firstString(request.headers['x-scope-account-id'])
    const entityHeader = this.firstString(request.headers['x-scope-entity-id'])

    if (accountHeader) return { accountId: accountHeader, permissive: false }
    if (entityHeader) return { entityId: entityHeader, permissive: false }

    const params = (request.params || {}) as Record<string, string | undefined>
    if (params.accountId) return { accountId: params.accountId, permissive: false }
    if (params.entityId) return { entityId: params.entityId, permissive: false }

    return { permissive: true }
  }

  private filterAssignmentsByScope(user: AuthenticatedUser, scope: ScopeContext): AuthenticatedUser['roleAssignments'] {
    if (scope.permissive) return user.roleAssignments

    return user.roleAssignments.filter((assignment) => {
      // PLATFORM-scoped assignments (e.g. platform-admin) override every scope.
      if (assignment.role.scope === 'PLATFORM') return true

      if (assignment.role.scope === 'ACCOUNT') {
        // Match the explicit account; or, when the scope is ENTITY, allow the
        // account-admin to act on entities of *their* account (descent rule).
        if (scope.accountId) return assignment.accountId === scope.accountId
        return false
      }

      if (assignment.role.scope === 'ENTITY') {
        if (scope.entityId) return assignment.entityId === scope.entityId
        return false
      }

      return false
    })
  }

  private firstString(headerValue: string | string[] | undefined): string | undefined {
    if (!headerValue) return undefined
    return Array.isArray(headerValue) ? headerValue[0] : headerValue
  }

  private describeScope(scope: ScopeContext): string {
    if (scope.permissive) return 'permissive'
    if (scope.accountId) return `account:${scope.accountId}`
    if (scope.entityId) return `entity:${scope.entityId}`
    return 'unknown'
  }
}
