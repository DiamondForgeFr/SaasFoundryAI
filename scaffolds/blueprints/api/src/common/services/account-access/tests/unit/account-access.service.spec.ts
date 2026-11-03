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
    account: { findUnique: jest.fn() },
    entity: { findUnique: jest.fn() },
    userRoleAssignment: { findMany: jest.fn() },
    $queryRaw: jest.fn()
  }
  const logger = { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() }
  let service: AccountAccessService

  const givenAssignments = (...rows: unknown[]) => prisma.userRoleAssignment.findMany.mockResolvedValue(rows)
  const givenEntityTree = () => {
    prisma.entity.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const accounts: Record<string, string> = { e1: A, e2: A, e3: A, s1: A, eb: B }
      return accounts[where.id] ? { id: where.id, accountId: accounts[where.id] } : null
    })
    prisma.$queryRaw.mockResolvedValue([{ id: 'e3' }, { id: 'e2' }, { id: 'e1' }])
  }

  beforeEach(() => {
    jest.clearAllMocks()
    service = new AccountAccessService(prisma as unknown as PrismaService, logger as unknown as Logger)
  })

  describe('accountExists', () => {
    it('is true for a known account and false for an unknown one', async () => {
      prisma.account.findUnique.mockResolvedValueOnce({ id: A }).mockResolvedValueOnce(null)

      await expect(service.accountExists(A)).resolves.toBe(true)
      await expect(service.accountExists('ghost')).resolves.toBe(false)
    })
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
