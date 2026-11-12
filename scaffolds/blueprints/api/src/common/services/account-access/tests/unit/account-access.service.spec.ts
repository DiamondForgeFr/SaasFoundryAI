/**
 * Resources
 */
import { ForbiddenException } from '@nestjs/common'

/**
 * Dependencies
 */
import { AccountAccessService } from '@common/services/account-access/account-access.service'
import { Logger } from '@common/services/logger/logger.service'
import { PrismaService } from '@configs/prisma/services/prisma.service'

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

const platformRow = (grants: Grants) => ({ accountId: null, entityId: null, entity: null, role: roleOf('PLATFORM', grants) })
const accountRow = (accountId: string, grants: Grants) => ({ accountId, entityId: null, entity: null, role: roleOf('ACCOUNT', grants) })
const entityRow = (entityId: string, entityAccountId: string, grants: Grants) => ({ accountId: null, entityId, entity: { id: entityId, accountId: entityAccountId }, role: roleOf('ENTITY', grants) })

describe('AccountAccessService (scope resolution)', () => {
  const prisma = {
    entity: { findMany: jest.fn() },
    userRoleAssignment: { findMany: jest.fn() },
    $queryRaw: jest.fn()
  }
  const logger = { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() }
  let service: AccountAccessService

  const givenAssignments = (...rows: unknown[]) => prisma.userRoleAssignment.findMany.mockResolvedValue(rows)
  // The tree: e1 -> e2 -> e3 and the sibling root s1 in account A; eb in account B.
  const ACCOUNTS: Record<string, string> = { e1: A, e2: A, e3: A, s1: A, eb: B }
  const PARENTS: Record<string, string | null> = { e1: null, e2: 'e1', e3: 'e2', s1: null, eb: null }
  const chainOf = (entityId: string): string[] => (PARENTS[entityId] ? [entityId, ...chainOf(PARENTS[entityId] as string)] : [entityId])
  const givenEntityTree = () => {
    prisma.entity.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((id) => ACCOUNTS[id]).map((id) => ({ id, accountId: ACCOUNTS[id] })))
    // The bulk walk returns (entity, ancestor) pairs; the service keeps the rows of each entity.
    prisma.$queryRaw.mockResolvedValue(Object.keys(PARENTS).flatMap((entityId) => chainOf(entityId).map((ancestorId) => ({ entity_id: entityId, ancestor_id: ancestorId }))))
  }
  /** The SQL text of the n-th raw query the service ran (a tagged template: its first argument is the list of text parts). */
  const sqlOfCall = (n: number): string => (prisma.$queryRaw.mock.calls[n][0] as string[]).join('?')

  beforeEach(() => {
    jest.clearAllMocks()
    service = new AccountAccessService(prisma as unknown as PrismaService, logger as unknown as Logger)
  })

  describe('resolveEntityTarget', () => {
    it('returns the entity account and its ancestor chain', async () => {
      givenEntityTree()

      await expect(service.resolveEntityTarget('e3')).resolves.toEqual({ kind: 'ENTITY', entityId: 'e3', accountId: A, ancestorEntityIds: ['e3', 'e2', 'e1'] })
    })

    it('returns a target with no account and no ancestors for an unknown entity', async () => {
      givenEntityTree()

      await expect(service.resolveEntityTarget('ghost')).resolves.toEqual({ kind: 'ENTITY', entityId: 'ghost', accountId: null, ancestorEntityIds: [] })
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
    })

    it('resolves any number of entities in two queries (bulk), unknown ones included', async () => {
      givenEntityTree()

      const targets = await service.resolveEntityTargets(['e3', 'eb', 's1', 'ghost', 'e3'])

      expect(prisma.entity.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
      expect([...targets.keys()].sort()).toEqual(['e3', 'eb', 'ghost', 's1'])
      expect(targets.get('e3')).toEqual({ kind: 'ENTITY', entityId: 'e3', accountId: A, ancestorEntityIds: ['e3', 'e2', 'e1'] })
      expect(targets.get('eb')).toEqual({ kind: 'ENTITY', entityId: 'eb', accountId: B, ancestorEntityIds: ['eb'] })
      expect(targets.get('ghost')).toEqual({ kind: 'ENTITY', entityId: 'ghost', accountId: null, ancestorEntityIds: [] })
    })

    it('runs no query at all for an empty list', async () => {
      await expect(service.resolveEntityTargets([])).resolves.toEqual(new Map())

      expect(prisma.entity.findMany).not.toHaveBeenCalled()
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
    })

    it('walks the ancestors with UNION, not UNION ALL, so a parent cycle ends the walk instead of looping', async () => {
      givenEntityTree()

      await service.resolveEntityTargets(['e3'])
      await service.getAncestorEntityIds('e3')
      await service.getSubtreeEntityIds(['e1'])

      for (const call of [0, 1, 2]) {
        expect(sqlOfCall(call)).toMatch(/\bUNION\b/)
        expect(sqlOfCall(call)).not.toMatch(/UNION\s+ALL/)
      }
    })
  })

  describe('getPermissionChecker', () => {
    it('reads the assignments once and answers any number of checks from memory', async () => {
      givenEntityTree()
      givenAssignments(accountRow(A, { permissions: ['USER_ACCOUNTS_INVITATION'] }), entityRow('e1', A, { permissions: ['USER_ENTITIES_INVITATION'] }))

      const checker = await service.getPermissionChecker('user-1', ['e3', 'e2', 's1'])

      expect(checker.has('USER_ACCOUNTS_INVITATION', { kind: 'ACCOUNT', accountId: A })).toBe(true)
      expect(checker.has('USER_ACCOUNTS_INVITATION', { kind: 'ACCOUNT', accountId: B })).toBe(false)
      expect(checker.has('USER_ENTITIES_INVITATION', { kind: 'ENTITY', entityId: 'e3' })).toBe(true)
      expect(checker.has('USER_ENTITIES_INVITATION', { kind: 'ENTITY', entityId: 'e2' })).toBe(true)
      expect(checker.has('USER_ENTITIES_INVITATION', { kind: 'ENTITY', entityId: 's1' })).toBe(false)
      expect(prisma.userRoleAssignment.findMany).toHaveBeenCalledTimes(1)
    })

    it('reads only what a permission check needs: the permission names, no modules or sections', async () => {
      givenAssignments()

      await service.getPermissionChecker('user-1')

      const { select } = prisma.userRoleAssignment.findMany.mock.calls[0][0]
      expect(Object.keys(select.role.select).sort()).toEqual(['permissionsLinked', 'scope'])
      expect(select.role.select.permissionsLinked).toEqual({ select: { permission: { select: { name: true } } } })
    })

    it('loads the active sections only when asked (withSubModules), and answers them per scope', async () => {
      givenEntityTree()
      const withSections = (row: ReturnType<typeof accountRow> | ReturnType<typeof entityRow>, subModuleIds: number[]) => ({
        ...row,
        role: { ...row.role, subModulesLinked: subModuleIds.map((subModuleId) => ({ subModuleId })) }
      })
      givenAssignments(withSections(accountRow(A, {}), [10]), withSections(entityRow('e1', A, {}), [11]))

      const checker = await service.getPermissionChecker('user-1', ['e3', 's1'], { withSubModules: true })

      const { select } = prisma.userRoleAssignment.findMany.mock.calls[0][0]
      expect(select.role.select.subModulesLinked).toEqual({ where: { subModule: { isActive: true } }, select: { subModuleId: true } })
      expect(checker.hasSubModule(10, { kind: 'ACCOUNT', accountId: A })).toBe(true)
      expect(checker.hasSubModule(10, { kind: 'ACCOUNT', accountId: B })).toBe(false)
      expect(checker.hasSubModule(11, { kind: 'ACCOUNT', accountId: A })).toBe(false)
      expect(checker.hasSubModule(11, { kind: 'ACCOUNT', accountId: A, includeEntityAssignments: true })).toBe(true)
      expect(checker.hasSubModule(11, { kind: 'ENTITY', entityId: 'e3' })).toBe(true)
      expect(checker.hasSubModule(11, { kind: 'ENTITY', entityId: 's1' })).toBe(false)
    })

    it('refuses to answer for sections it was not built with (a programming error, not a silent denial)', async () => {
      givenAssignments(accountRow(A, {}))
      const checker = await service.getPermissionChecker('user-1')

      expect(() => checker.hasSubModule(10, { kind: 'ACCOUNT', accountId: A })).toThrow('without the sections')
    })

    it('hasOnPlatform counts PLATFORM assignments only, whatever the user holds elsewhere', async () => {
      givenAssignments(platformRow({ subModules: ['PLATFORM_ACCOUNTS'] }), accountRow(A, { permissions: ['ROLE_CUSTOM_MANAGEMENT'] }), entityRow('e1', A, { permissions: ['ROLE_CUSTOM_MANAGEMENT'] }))
      const reader = await service.getPermissionChecker('user-1')

      expect(reader.hasOnPlatform('ROLE_CUSTOM_MANAGEMENT')).toBe(false)

      givenAssignments(platformRow({ permissions: ['ROLE_CUSTOM_MANAGEMENT'] }))
      const admin = await service.getPermissionChecker('user-1')

      expect(admin.hasOnPlatform('ROLE_CUSTOM_MANAGEMENT')).toBe(true)
    })

    it('asserts with a 403 and the given message', async () => {
      givenAssignments()
      const checker = await service.getPermissionChecker('user-1')

      expect(() => checker.assert('USER_ROLE_ALLOCATION', { kind: 'ACCOUNT', accountId: A }, 'Nope')).toThrow('Nope')
      expect(() => checker.assert('USER_ROLE_ALLOCATION', { kind: 'ACCOUNT', accountId: A })).toThrow(ForbiddenException)
    })

    it('refuses to answer for an entity it was not built with (a programming error, not a silent denial)', async () => {
      givenAssignments()
      const checker = await service.getPermissionChecker('user-1', ['e1'])

      expect(() => checker.has('USER_ROLE_ALLOCATION', { kind: 'ENTITY', entityId: 'e2' })).toThrow('was not resolved')
    })
  })

  describe('getScopedGrants', () => {
    it('reads the active assignments of the user', async () => {
      givenAssignments()

      await service.getScopedGrants('user-1', { kind: 'ACCOUNT', accountId: A })

      expect(prisma.userRoleAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1', role: { isActive: true } } }))
    })

    it('unions the grants of the assignments that apply to the account only', async () => {
      givenAssignments(
        platformRow({ modules: ['PLATFORM_ADMINISTRATION'], permissions: ['MODULE_MANAGEMENT'] }),
        accountRow(A, { modules: ['ACCOUNT_ADMINISTRATION'], subModules: ['USERS'], permissions: ['ACCOUNT_USER_MANAGEMENT'] }),
        accountRow(B, { permissions: ['ROLE_CUSTOM_MANAGEMENT'] }),
        entityRow('e1', A, { permissions: ['USER_ENTITIES_INVITATION'] })
      )

      const grants = await service.getScopedGrants('user-1', { kind: 'ACCOUNT', accountId: A })

      expect([...grants.permissions].sort()).toEqual(['ACCOUNT_USER_MANAGEMENT', 'MODULE_MANAGEMENT'])
      expect([...grants.modules].sort()).toEqual(['ACCOUNT_ADMINISTRATION', 'PLATFORM_ADMINISTRATION'])
      expect([...grants.subModules]).toEqual(['USERS'])
    })

    it('counts the ENTITY assignments of the account on opt-in', async () => {
      givenAssignments(
        accountRow(A, { permissions: ['ACCOUNT_USER_MANAGEMENT'] }),
        entityRow('e1', A, { permissions: ['USER_ENTITIES_INVITATION'] }),
        entityRow('eb', B, { permissions: ['ENTITY_CREATION'] })
      )

      const grants = await service.getScopedGrants('user-1', { kind: 'ACCOUNT', accountId: A, includeEntityAssignments: true })

      expect([...grants.permissions].sort()).toEqual(['ACCOUNT_USER_MANAGEMENT', 'USER_ENTITIES_INVITATION'])
    })

    it('applies the account and ancestor rules to an ENTITY scope', async () => {
      givenEntityTree()
      givenAssignments(
        accountRow(A, { permissions: ['ENTITY_CREATION'] }),
        accountRow(B, { permissions: ['ACCOUNT_UPDATE'] }),
        entityRow('e1', A, { permissions: ['ENTITY_USER_MANAGEMENT'] }),
        entityRow('s1', A, { permissions: ['USER_ENTITIES_INVITATION'] })
      )

      const grants = await service.getScopedGrants('user-1', { kind: 'ENTITY', entityId: 'e3' })

      expect([...grants.permissions].sort()).toEqual(['ENTITY_CREATION', 'ENTITY_USER_MANAGEMENT'])
    })
  })

  describe('hasPermissionInScope', () => {
    it('is true when the permission is held in the scope', async () => {
      givenAssignments(accountRow(A, { permissions: ['ACCOUNT_USER_MANAGEMENT'] }))

      await expect(service.hasPermissionInScope('user-1', 'ACCOUNT_USER_MANAGEMENT', { kind: 'ACCOUNT', accountId: A })).resolves.toBe(true)
    })

    it('is false when the permission is held on another account only', async () => {
      givenAssignments(accountRow(B, { permissions: ['ACCOUNT_USER_MANAGEMENT'] }))

      await expect(service.hasPermissionInScope('user-1', 'ACCOUNT_USER_MANAGEMENT', { kind: 'ACCOUNT', accountId: A })).resolves.toBe(false)
    })

    it('is false when the permission is held through an ENTITY assignment and the scope does not opt in', async () => {
      givenAssignments(entityRow('e1', A, { permissions: ['USER_ROLE_ALLOCATION'] }))

      await expect(service.hasPermissionInScope('user-1', 'USER_ROLE_ALLOCATION', { kind: 'ACCOUNT', accountId: A })).resolves.toBe(false)
      await expect(service.hasPermissionInScope('user-1', 'USER_ROLE_ALLOCATION', { kind: 'ACCOUNT', accountId: A, includeEntityAssignments: true })).resolves.toBe(true)
    })
  })

  describe('assertPermissionInScope', () => {
    it('resolves when the permission is held in the scope', async () => {
      givenAssignments(platformRow({ permissions: ['USER_ROLE_ALLOCATION'] }))

      await expect(service.assertPermissionInScope('user-1', 'USER_ROLE_ALLOCATION', { kind: 'ACCOUNT', accountId: A })).resolves.toBeUndefined()
    })

    it('throws a 403 with the given message when it is missing', async () => {
      givenAssignments(accountRow(B, { permissions: ['USER_ROLE_ALLOCATION'] }))

      const attempt = service.assertPermissionInScope('user-1', 'USER_ROLE_ALLOCATION', { kind: 'ACCOUNT', accountId: A }, 'No role allocation here')

      await expect(attempt).rejects.toBeInstanceOf(ForbiddenException)
      await expect(attempt).rejects.toThrow('No role allocation here')
    })
  })
})
