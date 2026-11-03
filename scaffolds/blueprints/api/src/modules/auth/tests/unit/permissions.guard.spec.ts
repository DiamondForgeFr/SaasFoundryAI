/**
 * Resources
 */
import { ExecutionContext, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

/**
 * Dependencies
 */
import { FULL_ACCESS, MODULE_KEY, PERMISSIONS_KEY, REQUIRE_ALL_KEY, SCOPE_FROM_KEY, SUB_MODULE_KEY } from '@common/decorators/require-permissions.decorator'
import { AccountAccessService } from '@common/services/account-access/account-access.service'
import { Logger } from '@common/services/logger/logger.service'
import { PermissionsGuard } from '@modules/auth/guards/permissions.guard'

/**
 * Type
 */
import type { ScopeFromMetadata } from '@common/decorators/require-permissions.decorator'
import type { EntityScopeTarget } from '@common/services/account-access/scope-filter'
import type { AuthenticatedUser } from '@common/types/authenticated-request.type'

/**
 * Fixtures: accounts A and B; in A the tree E1 -> E2 -> E3 plus the sibling root S1; in B the entity EB.
 */
const A = 'account-a'
const B = 'account-b'

interface Grants {
  modules?: string[]
  subModules?: string[]
  permissions?: string[]
}

const roleOf = (scope: 'PLATFORM' | 'ACCOUNT' | 'ENTITY', grants: Grants) => ({
  scope,
  modulesLinked: (grants.modules ?? []).map((name) => ({ module: { name } })),
  subModulesLinked: (grants.subModules ?? []).map((name) => ({ subModule: { name } })),
  permissionsLinked: (grants.permissions ?? []).map((name) => ({ permission: { name } }))
})

const platformAssignment = (grants: Grants) => ({ accountId: null, entityId: null, entity: null, role: roleOf('PLATFORM', grants) })
const accountAssignment = (accountId: string, grants: Grants) => ({ accountId, entityId: null, entity: null, role: roleOf('ACCOUNT', grants) })
const entityAssignment = (entityId: string, entityAccountId: string, grants: Grants) => ({
  accountId: null,
  entityId,
  entity: { id: entityId, accountId: entityAccountId },
  role: roleOf('ENTITY', grants)
})

const userWith = (...roleAssignments: unknown[]) => ({ id: 'user-1', roleAssignments }) as unknown as AuthenticatedUser

const ADMIN = { modules: ['ACCOUNT_ADMINISTRATION'], subModules: ['USERS'], permissions: ['ACCOUNT_USER_MANAGEMENT', 'USER_ROLE_ALLOCATION'] }

/** Entity E3 sits under E2 under E1 (account A); S1 is a sibling root; EB belongs to account B. */
const ENTITY_TREE: Record<string, EntityScopeTarget> = {
  e3: { kind: 'ENTITY', entityId: 'e3', accountId: A, ancestorEntityIds: ['e3', 'e2', 'e1'] },
  e1: { kind: 'ENTITY', entityId: 'e1', accountId: A, ancestorEntityIds: ['e1'] },
  s1: { kind: 'ENTITY', entityId: 's1', accountId: A, ancestorEntityIds: ['s1'] },
  eb: { kind: 'ENTITY', entityId: 'eb', accountId: B, ancestorEntityIds: ['eb'] }
}

interface RouteOptions {
  module?: string
  subModule?: string
  permissions?: string[]
  requireAll?: boolean
  scope?: ScopeFromMetadata
}

interface RequestOptions {
  user?: AuthenticatedUser
  params?: Record<string, string>
  headers?: Record<string, string>
}

describe('PermissionsGuard', () => {
  const logger = { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() } as unknown as Logger
  const accountAccessService = { resolveEntityTarget: jest.fn(), accountExists: jest.fn() } as unknown as jest.Mocked<AccountAccessService>

  const buildGuard = (route: RouteOptions) => {
    const metadata: Record<string, unknown> = {
      [MODULE_KEY]: route.module,
      [SUB_MODULE_KEY]: route.subModule,
      [PERMISSIONS_KEY]: route.permissions ?? [],
      [REQUIRE_ALL_KEY]: route.requireAll,
      [SCOPE_FROM_KEY]: route.scope
    }
    const reflector = { getAllAndOverride: jest.fn((key: string) => metadata[key]) } as unknown as Reflector
    return new PermissionsGuard(reflector, logger, accountAccessService)
  }

  const contextFor = (request: RequestOptions): ExecutionContext =>
    ({
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user: request.user, params: request.params ?? {}, headers: request.headers ?? {} }) })
    }) as unknown as ExecutionContext

  const run = (route: RouteOptions, request: RequestOptions) => buildGuard(route).canActivate(contextFor(request))

  beforeEach(() => {
    jest.clearAllMocks()
    accountAccessService.resolveEntityTarget.mockImplementation(async (entityId: string) => ENTITY_TREE[entityId] ?? { kind: 'ENTITY', entityId, accountId: null, ancestorEntityIds: [] })
    accountAccessService.accountExists.mockImplementation(async (accountId: string) => accountId !== 'ghost-account')
  })

  describe('request without a required module', () => {
    it('lets the request through', async () => {
      await expect(run({}, { user: userWith() })).resolves.toBe(true)
    })
  })

  describe('unauthenticated request', () => {
    it('answers 401', async () => {
      await expect(run({ module: 'ACCOUNT_ADMINISTRATION' }, {})).rejects.toBeInstanceOf(UnauthorizedException)
    })
  })

  describe('route without a declared scope (permissive union)', () => {
    it('keeps counting every assignment the user holds', async () => {
      const user = userWith(accountAssignment(A, { modules: ['ACCOUNT_ADMINISTRATION'] }), accountAssignment(B, ADMIN))

      await expect(run({ module: 'ACCOUNT_ADMINISTRATION', permissions: ['ACCOUNT_USER_MANAGEMENT'] }, { user, params: { id: A } })).resolves.toBe(true)
    })
  })

  describe('@ScopeFrom(id, ACCOUNT)', () => {
    const scope: ScopeFromMetadata = { param: 'id', kind: 'ACCOUNT', includeEntityAssignments: false }
    const route: RouteOptions = { module: 'ACCOUNT_ADMINISTRATION', permissions: ['ACCOUNT_USER_MANAGEMENT'], scope }

    it('passes when the permission is held on the target account', async () => {
      const user = userWith(accountAssignment(A, ADMIN))

      await expect(run(route, { user, params: { id: A } })).resolves.toBe(true)
    })

    it('answers 403 when the permission is held on another account only', async () => {
      const user = userWith(accountAssignment(A, { modules: ['ACCOUNT_ADMINISTRATION'] }), accountAssignment(B, ADMIN))

      await expect(run(route, { user, params: { id: A } })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('answers 403 when the module is held on another account only', async () => {
      const user = userWith(accountAssignment(B, ADMIN))

      await expect(run(route, { user, params: { id: A } })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('does not count an ENTITY assignment of the account unless the route opts in', async () => {
      const user = userWith(entityAssignment('e1', A, ADMIN))

      await expect(run(route, { user, params: { id: A } })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('counts an ENTITY assignment of the account when the route opts in', async () => {
      const user = userWith(entityAssignment('e1', A, ADMIN))

      await expect(run({ ...route, scope: { ...scope, includeEntityAssignments: true } }, { user, params: { id: A } })).resolves.toBe(true)
    })

    it('does not count an ENTITY assignment of another account, even on opt-in', async () => {
      const user = userWith(entityAssignment('eb', B, ADMIN))

      await expect(run({ ...route, scope: { ...scope, includeEntityAssignments: true } }, { user, params: { id: A } })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('counts a PLATFORM assignment on every account', async () => {
      const user = userWith(platformAssignment(ADMIN))

      await expect(run(route, { user, params: { id: A } })).resolves.toBe(true)
    })

    it('ignores the scope headers: they cannot redirect the check to another account', async () => {
      const user = userWith(accountAssignment(A, { modules: ['ACCOUNT_ADMINISTRATION'] }), accountAssignment(B, ADMIN))

      await expect(run(route, { user, params: { id: A }, headers: { 'x-scope-account-id': B } })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('answers 404 (not 403) when the URL names an account that does not exist', async () => {
      const user = userWith(accountAssignment(A, ADMIN))

      await expect(run(route, { user, params: { id: 'ghost-account' } })).rejects.toBeInstanceOf(NotFoundException)
    })

    it('answers 403, not 404, for a scope header naming an unknown account', async () => {
      const user = userWith(accountAssignment(A, ADMIN))
      const permissive: RouteOptions = { module: 'ACCOUNT_ADMINISTRATION', permissions: ['ACCOUNT_USER_MANAGEMENT'] }

      await expect(run(permissive, { user, headers: { 'x-scope-account-id': 'ghost-account' } })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('fails closed (403) when the declared parameter is missing from the request', async () => {
      const user = userWith(platformAssignment(ADMIN))

      await expect(run(route, { user, params: {} })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('checks the section the same way: a sub-module held on another account does not count', async () => {
      const user = userWith(accountAssignment(A, { modules: ['ACCOUNT_ADMINISTRATION'] }), accountAssignment(B, ADMIN))

      await expect(run({ module: 'ACCOUNT_ADMINISTRATION', subModule: 'USERS', scope }, { user, params: { id: A } })).rejects.toBeInstanceOf(ForbiddenException)
      await expect(run({ module: 'ACCOUNT_ADMINISTRATION', subModule: 'USERS', scope }, { user, params: { id: B } })).resolves.toBe(true)
    })
  })

  describe('@ScopeFrom(id, ENTITY)', () => {
    const scope: ScopeFromMetadata = { param: 'id', kind: 'ENTITY', includeEntityAssignments: false }
    const route: RouteOptions = { module: 'ACCOUNT_ADMINISTRATION', permissions: ['ACCOUNT_USER_MANAGEMENT'], scope }

    it('counts an ENTITY assignment on the entity itself', async () => {
      const user = userWith(entityAssignment('e3', A, ADMIN))

      await expect(run(route, { user, params: { id: 'e3' } })).resolves.toBe(true)
    })

    it('counts an ENTITY assignment on an ancestor', async () => {
      const user = userWith(entityAssignment('e1', A, ADMIN))

      await expect(run(route, { user, params: { id: 'e3' } })).resolves.toBe(true)
    })

    it('does not count an ENTITY assignment on a descendant', async () => {
      const user = userWith(entityAssignment('e3', A, ADMIN))

      await expect(run(route, { user, params: { id: 'e1' } })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('does not count an ENTITY assignment on a sibling root', async () => {
      const user = userWith(entityAssignment('e1', A, ADMIN))

      await expect(run(route, { user, params: { id: 's1' } })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('counts an ACCOUNT assignment on the account the entity belongs to', async () => {
      const user = userWith(accountAssignment(A, ADMIN))

      await expect(run(route, { user, params: { id: 'e3' } })).resolves.toBe(true)
    })

    it('does not count an ACCOUNT assignment on another account', async () => {
      const user = userWith(accountAssignment(A, ADMIN))

      await expect(run(route, { user, params: { id: 'eb' } })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('only counts PLATFORM for an entity that does not exist, and answers 404 (not 403) to anyone else', async () => {
      const accountAdmin = userWith(accountAssignment(A, ADMIN))
      const platformAdmin = userWith(platformAssignment(ADMIN))

      await expect(run(route, { user: accountAdmin, params: { id: 'ghost' } })).rejects.toBeInstanceOf(NotFoundException)
      await expect(run(route, { user: platformAdmin, params: { id: 'ghost' } })).resolves.toBe(true)
    })

    it('answers 403 for an entity that exists but where the user holds no role', async () => {
      const user = userWith(accountAssignment(B, ADMIN))

      await expect(run(route, { user, params: { id: 'e3' } })).rejects.toBeInstanceOf(ForbiddenException)
    })
  })

  describe('legacy path parameters', () => {
    const route: RouteOptions = { module: 'ACCOUNT_ADMINISTRATION', permissions: ['ACCOUNT_USER_MANAGEMENT'] }

    it(':accountId scopes the check to that account and ignores the headers', async () => {
      const user = userWith(accountAssignment(A, { modules: ['ACCOUNT_ADMINISTRATION'] }), accountAssignment(B, ADMIN))

      await expect(run(route, { user, params: { accountId: A }, headers: { 'x-scope-account-id': B } })).rejects.toBeInstanceOf(ForbiddenException)
      await expect(run(route, { user, params: { accountId: B } })).resolves.toBe(true)
    })

    it(':accountId does not count ENTITY assignments', async () => {
      const user = userWith(entityAssignment('e1', A, ADMIN))

      await expect(run(route, { user, params: { accountId: A } })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it(':entityId applies the account and ancestor rules', async () => {
      const ancestorAdmin = userWith(entityAssignment('e1', A, ADMIN))
      const descendantAdmin = userWith(entityAssignment('e3', A, ADMIN))
      const accountAdmin = userWith(accountAssignment(A, ADMIN))

      await expect(run(route, { user: ancestorAdmin, params: { entityId: 'e3' } })).resolves.toBe(true)
      await expect(run(route, { user: accountAdmin, params: { entityId: 'e3' } })).resolves.toBe(true)
      await expect(run(route, { user: descendantAdmin, params: { entityId: 'e1' } })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('a declared scope wins over a legacy parameter', async () => {
      const user = userWith(accountAssignment(A, ADMIN))
      const scope: ScopeFromMetadata = { param: 'id', kind: 'ACCOUNT', includeEntityAssignments: false }

      await expect(run({ ...route, scope }, { user, params: { id: B, accountId: A } })).rejects.toBeInstanceOf(ForbiddenException)
    })
  })

  describe('scope headers (route with no declared scope and no legacy parameter)', () => {
    const route: RouteOptions = { module: 'ACCOUNT_ADMINISTRATION', permissions: ['ACCOUNT_USER_MANAGEMENT'] }

    it('X-Scope-Account-Id narrows the check to that account', async () => {
      const user = userWith(accountAssignment(A, { modules: ['ACCOUNT_ADMINISTRATION'] }), accountAssignment(B, ADMIN))

      await expect(run(route, { user, headers: { 'x-scope-account-id': A } })).rejects.toBeInstanceOf(ForbiddenException)
      await expect(run(route, { user, headers: { 'x-scope-account-id': B } })).resolves.toBe(true)
    })

    it('X-Scope-Entity-Id applies the entity rule', async () => {
      const user = userWith(entityAssignment('e1', A, ADMIN))

      await expect(run(route, { user, headers: { 'x-scope-entity-id': 'e3' } })).resolves.toBe(true)
      await expect(run(route, { user, headers: { 'x-scope-entity-id': 's1' } })).rejects.toBeInstanceOf(ForbiddenException)
    })
  })

  describe('PLATFORM_ADMINISTRATION routes', () => {
    const route: RouteOptions = { module: 'PLATFORM_ADMINISTRATION', permissions: ['MODULE_MANAGEMENT'] }
    const platformGrants = { modules: ['PLATFORM_ADMINISTRATION'], permissions: ['MODULE_MANAGEMENT'] }

    it('counts a PLATFORM assignment', async () => {
      await expect(run(route, { user: userWith(platformAssignment(platformGrants)) })).resolves.toBe(true)
    })

    it('does not count an ACCOUNT or ENTITY assignment that carries the module (permissive mode)', async () => {
      const accountCustomRole = userWith(accountAssignment(A, platformGrants))
      const entityCustomRole = userWith(entityAssignment('e1', A, platformGrants))

      await expect(run(route, { user: accountCustomRole })).rejects.toBeInstanceOf(ForbiddenException)
      await expect(run(route, { user: entityCustomRole })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('does not count them under a scope either', async () => {
      const user = userWith(accountAssignment(A, platformGrants))
      const scope: ScopeFromMetadata = { param: 'id', kind: 'ACCOUNT', includeEntityAssignments: true }

      await expect(run({ ...route, scope }, { user, params: { id: A } })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('applies to the section gate too', async () => {
      const user = userWith(accountAssignment(A, { modules: ['PLATFORM_ADMINISTRATION'], subModules: ['PLATFORM_ACCOUNTS'] }))

      await expect(run({ module: 'PLATFORM_ADMINISTRATION', subModule: 'PLATFORM_ACCOUNTS' }, { user })).rejects.toBeInstanceOf(ForbiddenException)
    })
  })

  describe('permissions', () => {
    it('requireAll (default) needs every permission', async () => {
      const user = userWith(accountAssignment(A, { modules: ['ACCOUNT_ADMINISTRATION'], permissions: ['ACCOUNT_USER_MANAGEMENT'] }))
      const route: RouteOptions = {
        module: 'ACCOUNT_ADMINISTRATION',
        permissions: ['ACCOUNT_USER_MANAGEMENT', 'USER_ROLE_ALLOCATION'],
        scope: { param: 'id', kind: 'ACCOUNT', includeEntityAssignments: false }
      }

      await expect(run(route, { user, params: { id: A } })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('requireAll=false needs one of them', async () => {
      const user = userWith(accountAssignment(A, { modules: ['ACCOUNT_ADMINISTRATION'], permissions: ['ACCOUNT_USER_MANAGEMENT'] }))
      const route: RouteOptions = {
        module: 'ACCOUNT_ADMINISTRATION',
        permissions: ['ACCOUNT_USER_MANAGEMENT', 'USER_ROLE_ALLOCATION'],
        requireAll: false,
        scope: { param: 'id', kind: 'ACCOUNT', includeEntityAssignments: false }
      }

      await expect(run(route, { user, params: { id: A } })).resolves.toBe(true)
    })

    it('a read-access route (no permission) needs the module in the scoped assignments only', async () => {
      const user = userWith(accountAssignment(A, { modules: ['ACCOUNT_ADMINISTRATION'] }))
      const scope: ScopeFromMetadata = { param: 'id', kind: 'ACCOUNT', includeEntityAssignments: false }

      await expect(run({ module: 'ACCOUNT_ADMINISTRATION', scope }, { user, params: { id: A } })).resolves.toBe(true)
      await expect(run({ module: 'ACCOUNT_ADMINISTRATION', scope }, { user, params: { id: B } })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('FULL_ACCESS still requires the module in scope', async () => {
      const user = userWith(accountAssignment(A, { modules: ['ACCOUNT_ADMINISTRATION'] }))
      const scope: ScopeFromMetadata = { param: 'id', kind: 'ACCOUNT', includeEntityAssignments: false }

      await expect(run({ module: 'ACCOUNT_ADMINISTRATION', permissions: [FULL_ACCESS], scope }, { user, params: { id: A } })).resolves.toBe(true)
      await expect(run({ module: 'ACCOUNT_ADMINISTRATION', permissions: [FULL_ACCESS], scope }, { user, params: { id: B } })).rejects.toBeInstanceOf(ForbiddenException)
    })
  })
})
