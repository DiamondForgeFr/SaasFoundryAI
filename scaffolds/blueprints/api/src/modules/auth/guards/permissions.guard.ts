/**
 * Resources
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

/**
 * Dependencies
 */
import { FULL_ACCESS, MODULE_KEY, PERMISSIONS_KEY, REQUIRE_ALL_KEY, SCOPE_FROM_KEY, SUB_MODULE_KEY } from '@common/decorators/require-permissions.decorator'
import { AccountAccessService } from '@common/services/account-access/account-access.service'
import { filterAssignmentsForTarget, keepPlatformAssignments } from '@common/services/account-access/scope-filter'
import { Logger } from '@common/services/logger/logger.service'

/**
 * Type
 */
import type { ScopeFromMetadata } from '@common/decorators/require-permissions.decorator'
import type { ScopeTarget } from '@common/services/account-access/scope-filter'
import type { AuthenticatedUser } from '@common/types/authenticated-request.type'
import type { Request } from 'express'

/**
 * The account or entity a request acts on, and where the guard read it from.
 * `fromPath` is true when it comes from the URL (a declared scope or a legacy path param), false for a header.
 */
interface ResolvedScope {
  target: ScopeTarget
  fromPath: boolean
}

/**
 * The module whose routes belong to the platform operators. Only PLATFORM assignments count there, in
 * every mode: a custom role can carry a PLATFORM_ADMINISTRATION section, and that must not turn an
 * account or entity role into platform reach.
 */
const PLATFORM_ADMINISTRATION_MODULE = 'PLATFORM_ADMINISTRATION'

/**
 * Declaration
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private logger: Logger,
    private accountAccessService: AccountAccessService
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

    const resolved = await this.resolveScope(context, request, user)
    const scopedAssignments = resolved ? filterAssignmentsForTarget(user.roleAssignments, resolved.target) : user.roleAssignments
    const relevantAssignments = requiredModule === PLATFORM_ADMINISTRATION_MODULE ? keepPlatformAssignments(scopedAssignments) : scopedAssignments

    const hasModuleAccess = relevantAssignments.some((assignment) => assignment.role.modulesLinked.some((moduleLink) => moduleLink.module.name === requiredModule))

    if (!hasModuleAccess) {
      this.logger.warn(`Access denied: User ${user.id} has no access to ${requiredModule} in scope ${this.describeScope(resolved)}`, 'PermissionsGuard')
      throw await this.denial(resolved, `You do not have access to ${requiredModule.toLowerCase().replace('_', ' ')}`)
    }

    // Sub-module (section visibility) gate for read endpoints. The section is visible when the
    // actor holds it through a scoped assignment that also holds the parent module.
    if (requiredSubModule) {
      const hasSubModuleAccess = relevantAssignments.some((assignment) => assignment.role.subModulesLinked.some((subModuleLink) => subModuleLink.subModule.name === requiredSubModule))

      if (!hasSubModuleAccess) {
        this.logger.warn(`Access denied: User ${user.id} has no access to section ${requiredSubModule} in scope ${this.describeScope(resolved)}`, 'PermissionsGuard')
        throw await this.denial(resolved, `You do not have access to the ${requiredSubModule.toLowerCase().replace(/_/g, ' ')} section`)
      }
    }

    if (!requiredPermissions || requiredPermissions.length === 0) return true
    if (requiredPermissions.includes(FULL_ACCESS)) return true

    const userPermissions = relevantAssignments.flatMap((assignment) => assignment.role.permissionsLinked.map((permissionLink) => permissionLink.permission.name))

    const hasRequiredPermissions =
      requireAll === false ? requiredPermissions.some((permission) => userPermissions.includes(permission)) : requiredPermissions.every((permission) => userPermissions.includes(permission))

    if (!hasRequiredPermissions) {
      const requiredText = requireAll === false ? 'at least one of' : 'all of'
      this.logger.warn(
        `Access denied: User ${user.id} does not have ${requiredText} required permissions in scope ${this.describeScope(resolved)}: ${requiredPermissions.join(', ')}`,
        'PermissionsGuard'
      )
      throw await this.denial(resolved, 'You do not have the required permissions')
    }

    return true
  }

  /**
   * Work out which account or entity the request acts on. Resolution order, first match wins:
   *   1. `@ScopeFrom(param, kind)` on the route: the path parameter it names;
   *   2. the legacy path params `:accountId` (ACCOUNT) then `:entityId` (ENTITY);
   *   3. the `X-Scope-Account-Id` then `X-Scope-Entity-Id` headers.
   *
   * Headers are the weakest hint: they are read only when the route declares no scope and carries no
   * legacy param, so a header can never redirect a check away from the account or entity the URL
   * names. With no scope at all the guard keeps the permissive union of every assignment (routes that
   * do not carry a scope, e.g. /me or /auth/*, keep working); a route that takes an account or entity
   * id should declare it with @ScopeFrom.
   *
   * Returns `null` for the permissive case. A declared scope whose parameter is missing from the
   * request fails closed (403): it is a route declaration mistake, not a reason to widen the check.
   */
  private async resolveScope(context: ExecutionContext, request: Request, user: AuthenticatedUser): Promise<ResolvedScope | null> {
    const declared = this.reflector.getAllAndOverride<ScopeFromMetadata | undefined>(SCOPE_FROM_KEY, [context.getHandler(), context.getClass()])
    const params = (request.params || {}) as Record<string, string | undefined>

    if (declared) {
      const value = this.firstString(params[declared.param])
      if (!value) {
        this.logger.error(`Access denied: route declares @ScopeFrom('${declared.param}') but the request carries no such parameter (user ${user.id})`, 'PermissionsGuard')
        throw new ForbiddenException('You do not have the required permissions')
      }
      const target: ScopeTarget =
        declared.kind === 'ENTITY' ? await this.accountAccessService.resolveEntityTarget(value) : { kind: 'ACCOUNT', accountId: value, includeEntityAssignments: declared.includeEntityAssignments }
      return { target, fromPath: true }
    }

    if (params.accountId) return { target: { kind: 'ACCOUNT', accountId: params.accountId }, fromPath: true }
    if (params.entityId) return { target: await this.accountAccessService.resolveEntityTarget(params.entityId), fromPath: true }

    const accountHeader = this.firstString(request.headers['x-scope-account-id'])
    if (accountHeader) return { target: { kind: 'ACCOUNT', accountId: accountHeader }, fromPath: false }

    const entityHeader = this.firstString(request.headers['x-scope-entity-id'])
    if (entityHeader) return { target: await this.accountAccessService.resolveEntityTarget(entityHeader), fromPath: false }

    return null
  }

  /**
   * The exception for a denied request: 403, except when the URL names an account or entity that does
   * not exist. The services answer 404 for an unknown id, and a denied-by-scope request must not turn
   * that into a 403 (nothing is exposed that the 404 did not already say: only an existing target
   * the caller has no role on answers 403).
   */
  private async denial(resolved: ResolvedScope | null, message: string): Promise<ForbiddenException | NotFoundException> {
    if (resolved?.fromPath) {
      const { target } = resolved
      if (target.kind === 'ENTITY' && target.accountId === null) return new NotFoundException(`Entity with ID ${target.entityId} not found`)
      if (target.kind === 'ACCOUNT' && !(await this.accountAccessService.accountExists(target.accountId))) return new NotFoundException(`Account with ID ${target.accountId} not found`)
    }
    return new ForbiddenException(message)
  }

  private firstString(value: string | string[] | undefined): string | undefined {
    if (!value) return undefined
    return Array.isArray(value) ? value[0] : value
  }

  private describeScope(resolved: ResolvedScope | null): string {
    if (!resolved) return 'permissive'
    const { target } = resolved
    return target.kind === 'ACCOUNT' ? `account:${target.accountId}` : `entity:${target.entityId}`
  }
}
