/**
 * Resources
 */
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import * as dotenv from 'dotenv'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'

/**
 * Dependencies
 */
import { AccountAccessModule } from '@common/services/account-access/account-access.module'
import { LoggerModule } from '@common/services/logger/logger.module'
import { cleanupTestUser, loginTestUser, setupTestUser, TEST_GRANTS_ROLE_NAME, TestUser } from '@common/tests/e2e/utils/setup-test-user'
import { EnvModule } from '@configs/env/env.module'
import { PrismaModule } from '@configs/prisma/prisma.module'
import { PrismaService } from '@configs/prisma/services/prisma.service'
import { AccountsModule } from '@modules/accounts/accounts.module'
import { AuthModule } from '@modules/auth/auth.module'

// Load test environment variables
dotenv.config({ path: '.env.test' })

/**
 * Mocks
 */
jest.mock('@common/services/logger/logger.service', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn()
  }))
}))

/**
 * The e2e database is shared by every spec of a run (#987). A permission granted to one test user through
 * `setupTestUser({ permissions })` must stay with that user: it is never added to the system roles it was
 * given, so a plain `account-user` created before or after it holds exactly the seeded grants.
 *
 * The probe is the symptom of the original bug: ROLE_CUSTOM_MANAGEMENT is not seeded on `account-user`, so a
 * plain account user creating a custom role in its own account must get 403, never 201.
 */
describe('setupTestUser grants stay with the user (e2e)', () => {
  const password = 'TestPassword123'
  const grantedPermission = 'ROLE_CUSTOM_MANAGEMENT'
  const emails: string[] = []
  let app: INestApplication
  let prismaService: PrismaService
  let systemGrantsBefore: Record<string, string[]>

  /** Permissions each system role grants, by role name. */
  const systemGrants = async (): Promise<Record<string, string[]>> => {
    const roles = await prismaService.role.findMany({
      where: { name: { in: ['account-user', 'account-admin'] }, isSystem: true, accountId: null },
      include: { permissionsLinked: { include: { permission: true } } }
    })
    return Object.fromEntries(roles.map((role) => [role.name, role.permissionsLinked.map((link) => link.permission.name).sort()]))
  }

  /** Permissions a user holds through its active role assignments, whatever their scope. */
  const heldPermissions = async (userId: string): Promise<string[]> => {
    const assignments = await prismaService.userRoleAssignment.findMany({
      where: { userId, role: { isActive: true } },
      include: { role: { include: { permissionsLinked: { include: { permission: true } } } } }
    })
    return [...new Set(assignments.flatMap((assignment) => assignment.role.permissionsLinked.map((link) => link.permission.name)))]
  }

  const createUser = async (label: string, permissions?: string[]): Promise<TestUser> => {
    const email = `isolation-${label}@saasfoundryai.test`
    emails.push(email)
    return setupTestUser(prismaService, { email, password, firstname: 'Isolation', lastname: label, roles: ['account-user'], permissions })
  }

  const loggedIn = async (user: TestUser): Promise<ReturnType<typeof request.agent>> => {
    const agent = request.agent(app.getHttpServer())
    if (!(await loginTestUser(agent, user.email, password))) throw new Error(`Failed to login ${user.email}`)
    return agent
  }

  /** The HTTP status a user gets when it creates a custom role in its own account. */
  const createRoleStatus = async (user: TestUser, name: string): Promise<number> => {
    const agent = await loggedIn(user)
    const res = await agent.post(`/api/accounts/${user.accountId}/roles`).send({ name, scope: 'ACCOUNT', permissionIds: [] })
    return res.status
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AccountsModule, AuthModule, LoggerModule, EnvModule, PrismaModule, AccountAccessModule]
    }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api')
    app.use(cookieParser())
    app.useGlobalPipes(new ZodValidationPipe(), new ValidationPipe({ transform: true }))

    prismaService = moduleRef.get<PrismaService>(PrismaService)
    await app.init()

    systemGrantsBefore = await systemGrants()
    // The probe only means something while the seed keeps ROLE_CUSTOM_MANAGEMENT off account-user.
    expect(systemGrantsBefore['account-user']).not.toContain(grantedPermission)
  })

  afterAll(async () => {
    const users = await prismaService.user.findMany({ where: { email: { in: emails } }, select: { id: true } })
    // Before the accounts go: a role whose account is deleted would stay behind as a global role.
    await prismaService.role.deleteMany({ where: { name: { startsWith: 'isolation-probe-' } } })
    for (const email of emails) await cleanupTestUser(prismaService, email)
    expect(await prismaService.user.count({ where: { id: { in: users.map((user) => user.id) } } })).toBe(0)

    await prismaService.$disconnect()
    await app.close()
  })

  describe('a grant made first does not reach a plain account-user created after it', () => {
    let granted: TestUser
    let plainAfter: TestUser

    beforeAll(async () => {
      granted = await createUser('granted-first', [grantedPermission])
      plainAfter = await createUser('plain-after')
    })

    it('the granted user holds the permission, through a custom role of its own account', async () => {
      expect(await heldPermissions(granted.id)).toContain(grantedPermission)
      const grantsRole = await prismaService.role.findFirstOrThrow({ where: { name: TEST_GRANTS_ROLE_NAME, accountId: granted.accountId } })
      expect(grantsRole).toMatchObject({ isSystem: false, scope: 'ACCOUNT', isActive: true })
      expect(await prismaService.userRoleAssignment.findMany({ where: { roleId: grantsRole.id }, select: { userId: true, accountId: true } })).toEqual([
        { userId: granted.id, accountId: granted.accountId }
      ])

      expect(await createRoleStatus(granted, 'isolation-probe-granted')).toBe(201)
    })

    it('the system roles keep their seeded grants', async () => {
      expect(await systemGrants()).toEqual(systemGrantsBefore)
    })

    it('the plain account-user created after it does not hold the permission (403)', async () => {
      expect(await heldPermissions(plainAfter.id)).not.toContain(grantedPermission)
      expect(await createRoleStatus(plainAfter, 'isolation-probe-after')).toBe(403)
    })
  })

  describe('a grant made later does not reach a plain account-user created before it', () => {
    let plainBefore: TestUser
    let heldBefore: string[]

    beforeAll(async () => {
      plainBefore = await createUser('plain-before')
      heldBefore = (await heldPermissions(plainBefore.id)).sort()
    })

    it('the plain account-user is refused before the grant (403)', async () => {
      expect(heldBefore).not.toContain(grantedPermission)
      expect(await createRoleStatus(plainBefore, 'isolation-probe-before-1')).toBe(403)
    })

    it('a user granted the permission afterwards changes nothing for it (still 403, same grants)', async () => {
      const grantedLater = await createUser('granted-later', [grantedPermission])
      expect(await heldPermissions(grantedLater.id)).toContain(grantedPermission)

      expect((await heldPermissions(plainBefore.id)).sort()).toEqual(heldBefore)
      expect(await createRoleStatus(plainBefore, 'isolation-probe-before-2')).toBe(403)
      expect(await systemGrants()).toEqual(systemGrantsBefore)
    })
  })

  describe('cleanupTestUser', () => {
    it('removes the grants role with the user, and never leaves it behind as a global role', async () => {
      const user = await createUser('cleanup', [grantedPermission])
      const grantsRole = await prismaService.role.findFirstOrThrow({ where: { name: TEST_GRANTS_ROLE_NAME, accountId: user.accountId } })

      await cleanupTestUser(prismaService, user.email)

      expect(await prismaService.role.count({ where: { id: grantsRole.id } })).toBe(0)
      expect(await prismaService.role.count({ where: { name: TEST_GRANTS_ROLE_NAME, accountId: null } })).toBe(0)
    })

    it('a user linked to another test account does not take that account grants away', async () => {
      const owner = await createUser('owner', [grantedPermission])
      const member = await createUser('member')
      await prismaService.userAccountLink.create({ data: { userId: member.id, accountId: owner.accountId } })

      await cleanupTestUser(prismaService, member.email)

      expect(await heldPermissions(owner.id)).toContain(grantedPermission)
    })

    it('refuses a permission the seed does not define, instead of adding it to the catalog', async () => {
      await expect(createUser('unknown', ['ISOLATION_UNKNOWN_PERMISSION'])).rejects.toThrow('ISOLATION_UNKNOWN_PERMISSION')
      expect(await prismaService.modulePermission.count({ where: { name: 'ISOLATION_UNKNOWN_PERMISSION' } })).toBe(0)
    })
  })
})
