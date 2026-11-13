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
import { cleanupTestUser, loginTestUser, setupTestUser, TestUser } from '@common/tests/e2e/utils/setup-test-user'
import { EnvModule } from '@configs/env/env.module'
import { PrismaModule } from '@configs/prisma/prisma.module'
import { PrismaService } from '@configs/prisma/services/prisma.service'
import { AccountsModule } from '@modules/accounts/accounts.module'
import { AuthModule } from '@modules/auth/auth.module'

/**
 * Note: Using common test utilities instead of module-specific ones
 */

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
 * Declaration
 */
describe('Accounts Module (e2e)', () => {
  let app: INestApplication
  let prismaService: PrismaService
  let agent: ReturnType<typeof request.agent>
  let readOnlyAgent: ReturnType<typeof request.agent>
  let entityAdminAgent: ReturnType<typeof request.agent>
  let testUser: TestUser
  let testUser2: TestUser
  let entityAdminUser: { id: string; email: string; accountId: string; entityId: string }
  let accountId: string
  let entityId: string

  beforeAll(async () => {
    // Create NestJS application
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AccountsModule, AuthModule, LoggerModule, EnvModule, PrismaModule, AccountAccessModule]
    }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api')
    app.use(cookieParser())
    app.useGlobalPipes(new ZodValidationPipe(), new ValidationPipe({ transform: true }))

    prismaService = moduleRef.get<PrismaService>(PrismaService)

    // Set up test user with necessary roles and permissions
    testUser = await setupTestUser(prismaService, {
      email: 'accounttest@SaaSFoundryAI.test',
      password: 'TestPassword123',
      firstname: 'Account',
      lastname: 'Manager',
      roles: ['account-user', 'account-admin'],
      // ROLE_CUSTOM_MANAGEMENT is opt-in (not granted to account-admin by default) — the custom-role
      // builder tests below need it. The helper grants it RBAC v2-correctly (module + ROLES sub-module first).
      permissions: ['ROLE_CUSTOM_MANAGEMENT']
    })

    // Set up second test user
    testUser2 = await setupTestUser(prismaService, {
      email: 'testuser@SaaSFoundryAI.test',
      password: 'TestPassword123',
      firstname: 'Test',
      lastname: 'User',
      roles: ['account-user']
    })

    // Store account ID
    accountId = testUser.accountId

    // Create a test entity for entity tests. The entity's human identity (name/description) is
    // resolved from its typed profile (D-ENT-6), so attach an Organization profile via the inverted FK.
    const entity = await prismaService.entity.create({
      data: {
        accountId,
        isActive: true
      }
    })
    entityId = entity.id

    const entityProfile = await prismaService.organization.create({
      data: {
        name: 'Test Entity',
        type: 'COMPANY',
        description: 'Test entity for e2e tests',
        entityId: entity.id
      }
    })
    await prismaService.organizationAccountLink.create({ data: { organizationId: entityProfile.id, accountId } })

    // Get a role for role tests (using an existing role)
    await prismaService.role.findFirst({
      where: {
        OR: [{ accountId }, { accountId: null }]
      }
    })

    await app.init()

    // Create agent for authenticated requests
    agent = request.agent(app.getHttpServer())

    // Login with test user
    const loginSuccess = await loginTestUser(agent, testUser.email, 'TestPassword123')
    if (!loginSuccess) {
      throw new Error('Failed to login with test user')
    }

    // RBAC v2: a read-only account-user can READ its own account screen but cannot manage it.
    readOnlyAgent = request.agent(app.getHttpServer())
    const readOnlyLogin = await loginTestUser(readOnlyAgent, testUser2.email, 'TestPassword123')
    if (!readOnlyLogin) {
      throw new Error('Failed to login with read-only test user')
    }

    // RBAC v2: an entity-admin holds OVERVIEW/USERS/ROLES but NOT the ENTITIES sub-module (D5).
    // setupTestUser does not support ENTITY scope, so wire the entity-admin assignment by hand.
    const entityAdminRole = await prismaService.role.findFirstOrThrow({ where: { name: 'entity-admin' } })
    const bcrypt = await import('bcrypt')
    const eaPeople = await prismaService.people.create({ data: { firstname: 'Entity', lastname: 'Admin', email: 'entityadmin@saasfoundry.test' } })
    const eaUser = await prismaService.user.create({
      data: {
        email: 'entityadmin@saasfoundry.test',
        password: await bcrypt.hash('TestPassword123', 10),
        isActive: true,
        people: { connect: { id: eaPeople.id } },
        preference: { create: { locale: 'FR' } },
        entitiesLinked: { create: { entityId } },
        roleAssignments: { create: { roleId: entityAdminRole.id, entityId } }
      }
    })
    entityAdminUser = { id: eaUser.id, email: eaUser.email, accountId, entityId }
    entityAdminAgent = request.agent(app.getHttpServer())
    const eaLogin = await loginTestUser(entityAdminAgent, entityAdminUser.email, 'TestPassword123')
    if (!eaLogin) {
      throw new Error('Failed to login with entity-admin test user')
    }
  })

  afterAll(async () => {
    // Clean up the hand-wired entity-admin user (linked via entity, not account).
    if (entityAdminUser?.id) {
      await prismaService.user.delete({ where: { id: entityAdminUser.id } }).catch(() => {})
    }

    // Clean up test entity
    if (entityId) {
      await prismaService.entity
        .delete({
          where: { id: entityId }
        })
        .catch(() => {
          // Ignore errors if entity was already deleted
        })
    }

    // Clean up test users (also cleans up accounts if no other users are linked)
    await cleanupTestUser(prismaService, testUser.email)
    await cleanupTestUser(prismaService, testUser2.email)

    await prismaService.$disconnect()
    await app.close()
  })

  describe('Account Management', () => {
    it('should toggle account status when authenticated', async () => {
      // Check initial account status
      let account = await prismaService.account.findUnique({
        where: { id: accountId }
      })
      const initialStatus = account?.isActive || false

      // Toggle account status
      const newState = !initialStatus
      const response = await agent.patch(`/api/accounts/${accountId}/status`).send({ isActive: newState }).expect(200)

      // Verify response
      expect(response.body.id).toBe(accountId)
      expect(response.body.isActive).toBe(newState)

      // Verify database update
      account = await prismaService.account.findUnique({
        where: { id: accountId }
      })
      expect(account?.isActive).toBe(newState)

      // Restore the account to its initial (active) state. The users/entities/roles routes below
      // reject disabled accounts (validateUserAccountAccess without allowDisabled), so leaving the
      // account deactivated here would surface as 401s in the subsequent authenticated requests.
      await prismaService.account.update({
        where: { id: accountId },
        data: { isActive: initialStatus, deactivatedAt: null, deactivatedByUserId: null, deactivatedByScope: null }
      })
    })

    it('should reject updates without authentication', async () => {
      // Get current account status
      const account = await prismaService.account.findUnique({
        where: { id: accountId }
      })
      const currentStatus = account?.isActive

      // Try to update without authentication (direct request, not using agent)
      await request(app.getHttpServer()).patch(`/api/accounts/${accountId}/status`).send({ isActive: !currentStatus }).expect(401)

      // Verify account was not modified
      const updatedAccount = await prismaService.account.findUnique({
        where: { id: accountId }
      })
      expect(updatedAccount?.isActive).toBe(currentStatus)
    })

    describe('Account Details', () => {
      it('should fetch account details when authenticated', async () => {
        const response = await agent.get(`/api/accounts/${accountId}`).expect(200)

        // First check the basic structure
        expect(response.body).toMatchObject({
          id: accountId,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
          users: expect.objectContaining({
            count: expect.any(Number),
            values: expect.arrayContaining([
              expect.objectContaining({
                id: expect.any(String),
                email: expect.any(String),
                isActive: true,
                people: expect.any(Object)
              })
            ])
          }),
          roles: expect.objectContaining({
            count: expect.any(Number),
            values: expect.arrayContaining([
              expect.objectContaining({
                id: expect.any(Number),
                name: expect.any(String),
                isActive: expect.any(Boolean)
              })
            ])
          }),
          entities: expect.objectContaining({
            count: expect.any(Number),
            values: expect.any(Array)
          })
        })

        // Check isActive state separately
        expect(response.body.isActive).toBeDefined()
        expect(typeof response.body.isActive).toBe('boolean')
      })

      it('should reject fetching account details without authentication', async () => {
        await request(app.getHttpServer()).get(`/api/accounts/${accountId}`).expect(401)
      })

      it('should reject fetching non-existent account', async () => {
        await agent.get('/api/accounts/non-existent-id').expect(404)
      })
    })

    describe('Account Users Management', () => {
      it('should update account users when authenticated', async () => {
        // Add second user to account
        const response = await agent
          .patch(`/api/accounts/${accountId}/users`)
          .send({ userIds: [testUser.id, testUser2.id] })
          .expect(200)

        expect(response.body).toEqual(
          expect.objectContaining({
            id: accountId,
            users: expect.arrayContaining([
              expect.objectContaining({
                id: expect.any(String),
                email: expect.any(String),
                isActive: expect.any(Boolean),
                people: expect.any(Object)
              })
            ])
          })
        )

        // Verify database update
        const updatedAccount = await prismaService.account.findUnique({
          where: { id: accountId },
          include: {
            usersLinked: {
              include: {
                user: true
              }
            }
          }
        })

        const updatedUserIds = updatedAccount?.usersLinked.map((link) => link.userId) || []
        expect(updatedUserIds).toContain(testUser.id)
        expect(updatedUserIds).toContain(testUser2.id)
      })

      it('should reject updating account users without authentication', async () => {
        await request(app.getHttpServer())
          .patch(`/api/accounts/${accountId}/users`)
          .send({ userIds: [testUser2.id] })
          .expect(401)
      })

      it('should reject updating non-existent account users', async () => {
        await agent
          .patch('/api/accounts/non-existent-id/users')
          .send({ userIds: [testUser2.id] })
          .expect(404)
      })

      it('should reject updating account users with invalid user IDs', async () => {
        await agent
          .patch(`/api/accounts/${accountId}/users`)
          .send({ userIds: ['invalid-user-id'] })
          .expect(400)
      })
    })

    describe('Account Users Fetch', () => {
      it('should fetch account users with pagination', async () => {
        // Fetch users with pagination
        const response = await agent.get(`/api/accounts/${accountId}/users`).query({ page: 1, limit: 10 }).expect(200)

        expect(response.body).toMatchObject({
          items: expect.arrayContaining([
            expect.objectContaining({
              id: expect.any(String),
              email: expect.any(String),
              isActive: true,
              people: expect.any(Object)
            })
          ]),
          meta: expect.objectContaining({
            pagination: expect.objectContaining({
              current: 1,
              limit: 10,
              total: expect.any(Number)
            }),
            count: expect.any(Number)
          })
        })
      })

      it('should filter account users by search term', async () => {
        // Get user data from database to use for search
        const user = await prismaService.user.findUnique({
          where: { id: testUser.id },
          include: { people: true }
        })

        const searchTerm = user?.people?.lastname || 'Manager' // Fallback to a value we set in the test user

        const response = await agent.get(`/api/accounts/${accountId}/users?search=${searchTerm}`).expect(200)

        // Verify that the response contains at least one user with matching name
        expect(response.body.items.length).toBeGreaterThan(0)
        const foundUser = response.body.items.find((u) => u.people && u.people.lastname === searchTerm)
        expect(foundUser).toBeDefined()
      })

      it('should reject fetching account users without authentication', async () => {
        await request(app.getHttpServer()).get(`/api/accounts/${accountId}/users`).expect(401)
      })
    })

    describe('Account Entities Fetch', () => {
      it('should fetch account entities with pagination', async () => {
        const response = await agent.get(`/api/accounts/${accountId}/entities`).query({ page: 1, limit: 10 }).expect(200)

        expect(response.body).toMatchObject({
          items: expect.arrayContaining([
            expect.objectContaining({
              id: expect.any(String),
              name: expect.any(String),
              isActive: true
            })
          ]),
          meta: expect.objectContaining({
            pagination: expect.objectContaining({
              current: 1,
              limit: 10,
              total: expect.any(Number)
            }),
            count: expect.any(Number)
          })
        })
      })

      it('should filter entities by active status', async () => {
        const response = await agent.get(`/api/accounts/${accountId}/entities`).query({ isActive: true }).expect(200)

        // Verify all returned entities are active
        response.body.items.forEach((entity) => {
          expect(entity.isActive).toBe(true)
        })
      })

      it('should reject fetching account entities without authentication', async () => {
        await request(app.getHttpServer()).get(`/api/accounts/${accountId}/entities`).expect(401)
      })
    })

    describe('Account Roles Fetch', () => {
      it('should fetch account roles with pagination', async () => {
        const response = await agent.get(`/api/accounts/${accountId}/roles`).query({ page: 1, limit: 10 }).expect(200)

        expect(response.body).toMatchObject({
          items: expect.arrayContaining([
            expect.objectContaining({
              id: expect.any(Number),
              name: expect.any(String),
              isActive: true
            })
          ]),
          meta: expect.objectContaining({
            pagination: expect.objectContaining({
              current: 1,
              limit: 10,
              total: expect.any(Number)
            }),
            count: expect.any(Number)
          })
        })
      })

      it('should filter roles by name using search', async () => {
        // First get a role name to search for
        const roleResponse = await agent.get(`/api/accounts/${accountId}/roles`).expect(200)

        if (roleResponse.body.items.length > 0) {
          const roleToSearch = roleResponse.body.items[0]
          const searchTerm = roleToSearch.name.substring(0, 3) // Take first 3 characters for partial match

          const response = await agent.get(`/api/accounts/${accountId}/roles?search=${searchTerm}`).expect(200)

          // Expect at least the role we searched for to be in results
          expect(response.body.items.some((role) => role.id === roleToSearch.id)).toBe(true)
        } else {
          // Skip test if no roles to search
          console.log('Skipping role search test as no roles were found')
        }
      })

      it('should reject fetching account roles without authentication', async () => {
        await request(app.getHttpServer()).get(`/api/accounts/${accountId}/roles`).expect(401)
      })
    })

    // RBAC v2: a custom role is built from sub-modules (read-only sections) + permissions (actions).
    // Granting a permission that belongs to a sub-module MUST auto-include that sub-module, otherwise
    // the check_role_grants integrity trigger rejects the permission link. These tests assert both the
    // managed-permission path and the pure read-only-section path.
    describe('Custom Role Creation (RBAC v2 sub-modules)', () => {
      const createdRoleIds: number[] = []

      afterAll(async () => {
        if (createdRoleIds.length > 0) {
          await prismaService.role.deleteMany({ where: { id: { in: createdRoleIds } } }).catch(() => {})
        }
      })

      it('creates an ACCOUNT role granting a managed permission and auto-includes its sub-module (trigger satisfied)', async () => {
        // ACCOUNT_USER_MANAGEMENT lives under the USERS sub-module of ACCOUNT_ADMINISTRATION.
        const perm = await prismaService.modulePermission.findFirstOrThrow({ where: { name: 'ACCOUNT_USER_MANAGEMENT' } })

        const created = await agent
          .post(`/api/accounts/${accountId}/roles`)
          .send({ name: 'rbac-v2-mgmt', description: 'managed perm role', scope: 'ACCOUNT', permissionIds: [perm.id] })
          .expect(201)
        createdRoleIds.push(created.body.id)

        expect(created.body).toMatchObject({ id: expect.any(Number), name: 'rbac-v2-mgmt', scope: 'ACCOUNT' })

        // The role comes back from the listing with the USERS sub-module + the permission.
        const list = await agent.get(`/api/accounts/${accountId}/roles?search=rbac-v2-mgmt`).expect(200)
        const role = list.body.items.find((r) => r.id === created.body.id)
        expect(role).toBeDefined()
        expect(role.subModules).toEqual(expect.arrayContaining(['USERS']))
        expect(role.permissions).toEqual(expect.arrayContaining(['ACCOUNT_USER_MANAGEMENT']))
        expect(role.modules).toEqual(expect.arrayContaining(['ACCOUNT_ADMINISTRATION']))
      })

      it('creates a read-only-section role (sub-module granted, no permission under it)', async () => {
        const subModule = await prismaService.subModule.findFirstOrThrow({
          where: { name: 'USERS', module: { name: 'ACCOUNT_ADMINISTRATION' } }
        })

        const created = await agent
          .post(`/api/accounts/${accountId}/roles`)
          .send({ name: 'rbac-v2-readonly', description: 'read-only section', scope: 'ACCOUNT', subModuleIds: [subModule.id], permissionIds: [] })
          .expect(201)
        createdRoleIds.push(created.body.id)

        const list = await agent.get(`/api/accounts/${accountId}/roles?search=rbac-v2-readonly`).expect(200)
        const role = list.body.items.find((r) => r.id === created.body.id)
        expect(role).toBeDefined()
        expect(role.subModules).toEqual(expect.arrayContaining(['USERS']))
        expect(role.permissions).toEqual([])
        expect(role.modules).toEqual(expect.arrayContaining(['ACCOUNT_ADMINISTRATION']))
      })

      it('updates a custom role to swap its grants (rewrites module/sub-module/permission in order)', async () => {
        const perm = await prismaService.modulePermission.findFirstOrThrow({ where: { name: 'ACCOUNT_USER_MANAGEMENT' } })
        const created = await agent
          .post(`/api/accounts/${accountId}/roles`)
          .send({ name: 'rbac-v2-update', scope: 'ACCOUNT', permissionIds: [perm.id] })
          .expect(201)
        createdRoleIds.push(created.body.id)

        // Rewrite to a read-only ROLES section (no permission).
        const rolesSubModule = await prismaService.subModule.findFirstOrThrow({ where: { name: 'ROLES', module: { name: 'ACCOUNT_ADMINISTRATION' } } })
        await agent
          .patch(`/api/accounts/roles/${created.body.id}`)
          .send({ subModuleIds: [rolesSubModule.id], permissionIds: [] })
          .expect(200)

        const list = await agent.get(`/api/accounts/${accountId}/roles?search=rbac-v2-update`).expect(200)
        const role = list.body.items.find((r) => r.id === created.body.id)
        expect(role.subModules).toEqual(['ROLES'])
        expect(role.permissions).toEqual([])
      })

      it('catalog groups sub-modules with their permissions and exposes standalone permissions', async () => {
        const res = await agent.get('/api/accounts/permissions/catalog').expect(200)
        const accountModule = res.body.find((m) => m.moduleName === 'ACCOUNT_ADMINISTRATION')
        expect(accountModule).toBeDefined()
        const usersSection = accountModule.subModules.find((sm) => sm.name === 'USERS')
        expect(usersSection).toBeDefined()
        expect(usersSection.permissions.map((p) => p.name)).toEqual(expect.arrayContaining(['ACCOUNT_USER_MANAGEMENT']))
        // A simple module (no sub-modules) carries its permissions as standalone.
        const profileModule = res.body.find((m) => m.moduleName === 'PROFILE_ADMINISTRATION')
        if (profileModule) {
          expect(profileModule.subModules).toEqual([])
          expect(profileModule.standalonePermissions.length).toBeGreaterThan(0)
        }
      })
    })

    // RBAC v2 behavioural semantics: module/sub-module grants READ; permission grants WRITE;
    // authenticated-but-unauthorised yields 403 (D7); unauthenticated yields 401.
    describe('RBAC v2 read-only & 403 semantics', () => {
      it('account-user can READ its own account sections (overview/users/roles)', async () => {
        const ownAccountId = testUser2.accountId
        await readOnlyAgent.get(`/api/accounts/${ownAccountId}`).expect(200)
        await readOnlyAgent.get(`/api/accounts/${ownAccountId}/users`).expect(200)
        await readOnlyAgent.get(`/api/accounts/${ownAccountId}/roles`).expect(200)
      })

      it('account-user is FORBIDDEN (403) from managing account users (no write permission)', async () => {
        await readOnlyAgent
          .patch(`/api/accounts/${testUser2.accountId}/users`)
          .send({ userIds: [testUser2.id] })
          .expect(403)
      })

      it('account-user is FORBIDDEN (403) from toggling account status (no ACCOUNT_UPDATE)', async () => {
        await readOnlyAgent.patch(`/api/accounts/${testUser2.accountId}/status`).send({ isActive: false }).expect(403)
      })

      it('entity-admin can READ the account users/roles sections', async () => {
        await entityAdminAgent.get(`/api/accounts/${accountId}/users`).expect(200)
        await entityAdminAgent.get(`/api/accounts/${accountId}/roles`).expect(200)
      })

      it('entity-admin is FORBIDDEN (403) from the ENTITIES section (no ENTITIES sub-module, per D5)', async () => {
        await entityAdminAgent.get(`/api/accounts/${accountId}/entities`).expect(403)
      })
    })
  })

  /**
   * RBAC scope isolation (#1072): a role is only worth what it grants in the account or entity the
   * request acts on. Roles held in another account, or on an entity, must not carry an account-level action.
   */
  describe('RBAC scope isolation', () => {
    const password = 'TestPassword123'
    const probeEmails: string[] = []
    const createdRoleIds: number[] = []
    let accountAdminRoleId: number
    let entityUserRoleId: number
    let siblingEntityId: string
    let otherAccountAdmin: TestUser
    let otherAccountAdminAgent: ReturnType<typeof request.agent>
    let strangerAdmin: TestUser
    let strangerAdminAgent: ReturnType<typeof request.agent>
    let mixedUser: TestUser
    let mixedAgent: ReturnType<typeof request.agent>
    let platformAdmin: TestUser
    let platformAdminAgent: ReturnType<typeof request.agent>
    let entityScopedRole: { id: number }

    /** A user holding exactly one role assignment, wired by hand (setupTestUser cannot do ENTITY scope). */
    const createProbeUser = async (email: string, assignment: { roleId: number; entityId?: string; accountId?: string }, link: { accountId?: string; entityId?: string }) => {
      probeEmails.push(email)
      const bcrypt = await import('bcrypt')
      const people = await prismaService.people.create({ data: { firstname: 'Scope', lastname: 'Probe', email } })
      const user = await prismaService.user.create({
        data: {
          email,
          password: await bcrypt.hash(password, 10),
          isActive: true,
          people: { connect: { id: people.id } },
          preference: { create: { locale: 'FR' } },
          accountsLinked: link.accountId ? { create: { accountId: link.accountId } } : undefined,
          entitiesLinked: link.entityId ? { create: { entityId: link.entityId } } : undefined,
          roleAssignments: { create: assignment }
        }
      })
      const probeAgent = request.agent(app.getHttpServer())
      if (!(await loginTestUser(probeAgent, email, password))) throw new Error(`Failed to login ${email}`)
      return { user, agent: probeAgent }
    }

    const createRoleAsAccountAdmin = async (body: { name: string; scope: 'ACCOUNT' | 'ENTITY'; subModuleIds?: number[]; permissionIds: number[] }) => {
      const res = await agent.post(`/api/accounts/${accountId}/roles`).send(body).expect(201)
      createdRoleIds.push(res.body.id)
      return res.body as { id: number; name: string; scope: string }
    }

    beforeAll(async () => {
      accountAdminRoleId = (await prismaService.role.findFirstOrThrow({ where: { name: 'account-admin', accountId: null } })).id
      entityUserRoleId = (await prismaService.role.findFirstOrThrow({ where: { name: 'entity-user', accountId: null } })).id
      siblingEntityId = (await prismaService.entity.create({ data: { accountId, isActive: true } })).id

      // An admin of ANOTHER account who is also a plain member of this one (linked, no role here).
      otherAccountAdmin = await setupTestUser(prismaService, { email: 'scope-b-admin@saasfoundryai.test', password, firstname: 'Other', lastname: 'Admin', roles: ['account-admin'] })
      await prismaService.userAccountLink.create({ data: { userId: otherAccountAdmin.id, accountId } })
      otherAccountAdminAgent = request.agent(app.getHttpServer())
      if (!(await loginTestUser(otherAccountAdminAgent, otherAccountAdmin.email, password))) throw new Error('Failed to login other-account admin')

      // An admin of yet another account that has NO link to this one.
      strangerAdmin = await setupTestUser(prismaService, { email: 'scope-stranger@saasfoundryai.test', password, firstname: 'Stranger', lastname: 'Admin', roles: ['account-admin'] })
      strangerAdminAgent = request.agent(app.getHttpServer())
      if (!(await loginTestUser(strangerAdminAgent, strangerAdmin.email, password))) throw new Error('Failed to login stranger admin')

      // Both at once: admin of its OWN account (ACCOUNT role on M) and entity-admin of an entity of THIS account (ENTITY role on A).
      mixedUser = await setupTestUser(prismaService, { email: 'scope-mixed@saasfoundryai.test', password, firstname: 'Mixed', lastname: 'Roles', roles: ['account-admin'] })
      const entityAdminRole = await prismaService.role.findFirstOrThrow({ where: { name: 'entity-admin', accountId: null } })
      await prismaService.userEntityLink.create({ data: { userId: mixedUser.id, entityId } })
      await prismaService.userRoleAssignment.create({ data: { userId: mixedUser.id, roleId: entityAdminRole.id, entityId } })
      mixedAgent = request.agent(app.getHttpServer())
      if (!(await loginTestUser(mixedAgent, mixedUser.email, password))) throw new Error('Failed to login mixed-role user')

      platformAdmin = await setupTestUser(prismaService, { email: 'scope-platform@saasfoundryai.test', password, firstname: 'Platform', lastname: 'Admin', roles: ['platform-admin'] })
      platformAdminAgent = request.agent(app.getHttpServer())
      if (!(await loginTestUser(platformAdminAgent, platformAdmin.email, password))) throw new Error('Failed to login platform admin')

      // A custom ENTITY role of this account that grants role allocation.
      const allocation = await prismaService.modulePermission.findFirstOrThrow({ where: { name: 'USER_ROLE_ALLOCATION' } })
      entityScopedRole = await createRoleAsAccountAdmin({ name: 'scope-probe-entity', scope: 'ENTITY', permissionIds: [allocation.id] })
    })

    afterAll(async () => {
      await prismaService.user.deleteMany({ where: { email: { in: probeEmails } } })
      await prismaService.people.deleteMany({ where: { email: { in: probeEmails } } })
      await prismaService.role.deleteMany({ where: { id: { in: createdRoleIds } } })
      await prismaService.entity.deleteMany({ where: { id: siblingEntityId } })
      await cleanupTestUser(prismaService, otherAccountAdmin.email)
      await cleanupTestUser(prismaService, strangerAdmin.email)
      await cleanupTestUser(prismaService, mixedUser.email)
      await cleanupTestUser(prismaService, platformAdmin.email)
    })

    describe('an ENTITY role does not reach the account level', () => {
      it('a seeded entity-admin cannot promote itself to account admin', async () => {
        await entityAdminAgent
          .patch(`/api/accounts/${accountId}/users/${entityAdminUser.id}`)
          .send({ accountRoleIds: [accountAdminRoleId] })
          .expect(403)

        expect(await prismaService.userRoleAssignment.count({ where: { userId: entityAdminUser.id, accountId } })).toBe(0)
      })

      it('a seeded entity-admin cannot change the active flag of an account user', async () => {
        await entityAdminAgent.patch(`/api/accounts/${accountId}/users/${testUser.id}`).send({ isActive: false }).expect(403)

        expect((await prismaService.user.findUniqueOrThrow({ where: { id: testUser.id } })).isActive).toBe(true)
      })

      it('a seeded entity-admin cannot allocate roles in an entity it does not administer', async () => {
        await entityAdminAgent
          .patch(`/api/accounts/${accountId}/users/${testUser.id}`)
          .send({ entityRoleIds: [{ entityId: siblingEntityId, roleIds: [entityUserRoleId] }] })
          .expect(403)

        expect(await prismaService.userRoleAssignment.count({ where: { userId: testUser.id, entityId: siblingEntityId } })).toBe(0)
      })

      it('a seeded entity-admin can still allocate roles in its own entity', async () => {
        await entityAdminAgent
          .patch(`/api/accounts/${accountId}/users/${testUser.id}`)
          .send({ entityRoleIds: [{ entityId, roleIds: [entityUserRoleId] }] })
          .expect(200)

        expect(await prismaService.userRoleAssignment.count({ where: { userId: testUser.id, entityId, roleId: entityUserRoleId } })).toBe(1)
        await prismaService.userRoleAssignment.deleteMany({ where: { userId: testUser.id, entityId } })
      })

      it('a seeded entity-admin may send the whole form back unchanged: 200, and not one assignment is rewritten', async () => {
        const assignmentsOf = () =>
          prismaService.userRoleAssignment.findMany({ where: { userId: testUser.id }, orderBy: { id: 'asc' }, select: { id: true, roleId: true, accountId: true, entityId: true } })
        const stored = await assignmentsOf()
        const accountRoleIds = stored.filter((a) => a.accountId === accountId).map((a) => a.roleId)
        expect(accountRoleIds.length).toBeGreaterThan(0)

        // Every field and every slice equals what is stored: the account roles (which this actor may NOT change), a
        // slice of its own entity and one of an entity it does not administer. The form is a no-op.
        await entityAdminAgent
          .patch(`/api/accounts/${accountId}/users/${testUser.id}`)
          .send({
            isActive: true,
            accountRoleIds,
            entityRoleIds: [
              { entityId, roleIds: [] },
              { entityId: siblingEntityId, roleIds: [] }
            ]
          })
          .expect(200)

        // Same rows, same ids: rewriting them from a stale form could restore a role revoked in the meantime.
        expect(await assignmentsOf()).toEqual(stored)
      })

      it('a changed slice is written, an unchanged slice sent with it is left alone (even one the actor cannot administer)', async () => {
        const holdingBefore = await prismaService.userRoleAssignment.create({ data: { userId: testUser.id, roleId: entityUserRoleId, entityId: siblingEntityId } })

        // Own entity: changed (authorized). Sibling entity: unchanged (the actor holds nothing there, and needs nothing).
        await entityAdminAgent
          .patch(`/api/accounts/${accountId}/users/${testUser.id}`)
          .send({
            entityRoleIds: [
              { entityId, roleIds: [entityUserRoleId] },
              { entityId: siblingEntityId, roleIds: [entityUserRoleId] }
            ]
          })
          .expect(200)

        expect(await prismaService.userRoleAssignment.count({ where: { userId: testUser.id, entityId, roleId: entityUserRoleId } })).toBe(1)
        const holdingAfter = await prismaService.userRoleAssignment.findFirstOrThrow({ where: { userId: testUser.id, entityId: siblingEntityId } })
        expect(holdingAfter.id).toBe(holdingBefore.id)
        await prismaService.userRoleAssignment.deleteMany({ where: { userId: testUser.id, entityId: { in: [entityId, siblingEntityId] } } })
      })

      it('a changed slice in an entity the actor does not administer is refused even when the rest of the form is a no-op', async () => {
        await entityAdminAgent
          .patch(`/api/accounts/${accountId}/users/${testUser.id}`)
          .send({
            isActive: true,
            entityRoleIds: [
              { entityId, roleIds: [] },
              { entityId: siblingEntityId, roleIds: [entityUserRoleId] }
            ]
          })
          .expect(403)

        expect(await prismaService.userRoleAssignment.count({ where: { userId: testUser.id, entityId: siblingEntityId } })).toBe(0)
      })

      it('a custom ENTITY role holding USER_ROLE_ALLOCATION gets 403 on accountRoleIds', async () => {
        const probe = await createProbeUser('scope-entity-probe@saasfoundryai.test', { roleId: entityScopedRole.id, entityId }, { entityId })

        await probe.agent
          .patch(`/api/accounts/${accountId}/users/${probe.user.id}`)
          .send({ accountRoleIds: [accountAdminRoleId] })
          .expect(403)

        expect(await prismaService.userRoleAssignment.count({ where: { userId: probe.user.id, accountId } })).toBe(0)
      })
    })

    describe('a user who is admin of its own account AND entity-admin here', () => {
      it('acts with the entity role on this account, never with the account role of its own account', async () => {
        const holds = (roleId: number) => prismaService.userRoleAssignment.count({ where: { userId: testUser.id, roleId, entityId } })

        // The ENTITY role held here counts: allocating a role inside its own entity is allowed.
        await mixedAgent
          .patch(`/api/accounts/${accountId}/users/${testUser.id}`)
          .send({ entityRoleIds: [{ entityId, roleIds: [entityUserRoleId] }] })
          .expect(200)
        expect(await holds(entityUserRoleId)).toBe(1)
        await prismaService.userRoleAssignment.deleteMany({ where: { userId: testUser.id, entityId } })

        // The ACCOUNT role held on ITS OWN account does not count here: no account-level change, whatever the field.
        await mixedAgent
          .patch(`/api/accounts/${accountId}/users/${testUser.id}`)
          .send({ accountRoleIds: [accountAdminRoleId] })
          .expect(403)
        await mixedAgent.patch(`/api/accounts/${accountId}/users/${testUser.id}`).send({ isActive: false }).expect(403)
        await mixedAgent.patch(`/api/accounts/${accountId}/status`).send({ isActive: false }).expect(403)
        expect((await prismaService.user.findUniqueOrThrow({ where: { id: testUser.id } })).isActive).toBe(true)
      })

      it('does not borrow the sections of its own account admin role (the ENTITIES section is not held on this account)', async () => {
        // Its own account-admin role carries ENTITIES; the entity-admin role held here does not (D5). Only the latter counts.
        await mixedAgent.get(`/api/accounts/${accountId}/entities`).expect(403)
        // The sections the entity role does hold stay readable.
        await mixedAgent.get(`/api/accounts/${accountId}/users`).expect(200)
        // And its own account is fully administrable with its account role.
        await mixedAgent.get(`/api/accounts/${mixedUser.accountId}/entities`).expect(200)
      })
    })

    describe('a role held in another account does not carry over', () => {
      it('an admin of account B who is only a member of account A cannot deactivate account A', async () => {
        await otherAccountAdminAgent.patch(`/api/accounts/${accountId}/status`).send({ isActive: false }).expect(403)
        await otherAccountAdminAgent.patch(`/api/accounts/${accountId}/status`).set('X-Scope-Account-Id', otherAccountAdmin.accountId).send({ isActive: false }).expect(403)

        expect((await prismaService.account.findUniqueOrThrow({ where: { id: accountId } })).isActive).toBe(true)
      })

      it('cannot read or change the users of account A, with or without a scope header', async () => {
        await otherAccountAdminAgent.get(`/api/accounts/${accountId}/users`).expect(403)
        await otherAccountAdminAgent.get(`/api/accounts/${accountId}/users`).set('X-Scope-Account-Id', otherAccountAdmin.accountId).expect(403)
        await otherAccountAdminAgent.patch(`/api/accounts/${accountId}/users/${testUser.id}`).send({ isActive: false }).expect(403)

        expect((await prismaService.user.findUniqueOrThrow({ where: { id: testUser.id } })).isActive).toBe(true)
      })

      it('cannot edit, delete or toggle a custom role of account A', async () => {
        await otherAccountAdminAgent.patch(`/api/accounts/roles/${entityScopedRole.id}`).send({ name: 'hijacked' }).expect(403)
        await otherAccountAdminAgent.patch(`/api/accounts/roles/${entityScopedRole.id}/status`).send({ isActive: false }).expect(403)
        await otherAccountAdminAgent.delete(`/api/accounts/roles/${entityScopedRole.id}`).expect(403)

        const role = await prismaService.role.findUniqueOrThrow({ where: { id: entityScopedRole.id } })
        expect(role.name).toBe('scope-probe-entity')
        expect(role.isActive).toBe(true)
      })

      it('keeps the membership answers: 401 for an account the user does not belong to, 404 for an unknown one', async () => {
        // strangerAdmin administers another account and has no link to this one.
        await strangerAdminAgent.get(`/api/accounts/${accountId}/entities`).expect(401)
        await strangerAdminAgent.patch(`/api/accounts/${accountId}/status`).send({ isActive: false }).expect(401)
        await agent.get('/api/accounts/non-existent-id/users').expect(404)
      })

      it('still administers its own account', async () => {
        await otherAccountAdminAgent.get(`/api/accounts/${otherAccountAdmin.accountId}/users`).expect(200)
      })
    })

    describe('legitimate access is unchanged', () => {
      it('the account admin still reads and manages its own account', async () => {
        await agent.get(`/api/accounts/${accountId}`).expect(200)
        await agent.get(`/api/accounts/${accountId}/users`).expect(200)
        await agent.get(`/api/accounts/${accountId}/entities`).expect(200)
        await agent.get(`/api/accounts/${accountId}/roles`).expect(200)
      })

      it('the account admin can allocate roles in any entity of its account', async () => {
        await agent
          .patch(`/api/accounts/${accountId}/users/${entityAdminUser.id}`)
          .send({ entityRoleIds: [{ entityId: siblingEntityId, roleIds: [entityUserRoleId] }] })
          .expect(200)

        expect(await prismaService.userRoleAssignment.count({ where: { userId: entityAdminUser.id, entityId: siblingEntityId, roleId: entityUserRoleId } })).toBe(1)
        await prismaService.userRoleAssignment.deleteMany({ where: { userId: entityAdminUser.id, entityId: siblingEntityId } })
      })

      it('a platform admin reaches every account and the platform console', async () => {
        await platformAdminAgent.get(`/api/accounts/${accountId}`).expect(200)
        await platformAdminAgent.get(`/api/accounts/${accountId}/users`).expect(200)
        await platformAdminAgent.patch(`/api/accounts/${accountId}/users/${testUser.id}`).send({ isActive: true }).expect(200)
        await platformAdminAgent.get('/api/accounts/platform/overview').expect(200)
      })
    })

    describe('PLATFORM_ADMINISTRATION is platform-only', () => {
      it('an ACCOUNT role carrying a platform section does not open the platform console', async () => {
        // The role API refuses such a role (#1129, below), so it is written straight to the database: the guard must hold on its own.
        const platformAccounts = await prismaService.subModule.findFirstOrThrow({ where: { name: 'PLATFORM_ACCOUNTS' } })
        const sectionRole = await prismaService.role.create({ data: { name: 'scope-probe-section', scope: 'ACCOUNT', isSystem: false, isActive: true, accountId } })
        createdRoleIds.push(sectionRole.id)
        await prismaService.roleModuleLink.create({ data: { roleId: sectionRole.id, moduleId: platformAccounts.moduleId } })
        await prismaService.roleSubModuleLink.create({ data: { roleId: sectionRole.id, subModuleId: platformAccounts.id } })
        const probe = await createProbeUser('scope-section-probe@saasfoundryai.test', { roleId: sectionRole.id, accountId }, { accountId })

        await probe.agent.get('/api/accounts/platform/overview').expect(403)
        await probe.agent.get('/api/accounts/platform/users').expect(403)
      })
    })

    /**
     * Role management (#1129): a system role belongs to the platform, a custom ENTITY role is managed only by who administers
     * every entity it is used in, no role of an account or an entity carries a platform section, and nobody grants a
     * permission or a section they do not hold where the role applies.
     */
    describe('role management stays within the actor authority', () => {
      const grantsOf = async (roleId: number) => {
        const role = await prismaService.role.findUniqueOrThrow({ where: { id: roleId }, include: { permissionsLinked: true, subModulesLinked: true } })
        return {
          name: role.name,
          isActive: role.isActive,
          permissionIds: role.permissionsLinked.map((link) => link.permissionId).sort((a, b) => a - b),
          subModuleIds: role.subModulesLinked.map((link) => link.subModuleId).sort((a, b) => a - b)
        }
      }
      const permissionIdOf = async (name: string) => (await prismaService.modulePermission.findFirstOrThrow({ where: { name } })).id
      const systemRole = () => prismaService.role.findFirstOrThrow({ where: { name: 'entity-user', accountId: null, isSystem: true } })

      it('a seeded entity-admin cannot rewrite, toggle or delete a system role (403, nothing changes)', async () => {
        const role = await systemRole()
        const before = await grantsOf(role.id)
        const roleManagement = await permissionIdOf('ROLE_CUSTOM_MANAGEMENT')

        await entityAdminAgent
          .patch(`/api/accounts/roles/${role.id}`)
          .send({ permissionIds: [...before.permissionIds, roleManagement], subModuleIds: before.subModuleIds })
          .expect(403)
        await entityAdminAgent.patch(`/api/accounts/roles/${role.id}/status`).send({ isActive: false }).expect(403)
        await entityAdminAgent.delete(`/api/accounts/roles/${role.id}`).expect(403)

        expect(await grantsOf(role.id)).toEqual(before)
      })

      it('an account admin cannot rewrite a system role either (403)', async () => {
        const role = await systemRole()
        const before = await grantsOf(role.id)

        await agent.patch(`/api/accounts/roles/${role.id}`).send({ permissionIds: [], subModuleIds: [] }).expect(403)

        expect(await grantsOf(role.id)).toEqual(before)
      })

      it('a platform admin still maintains the grants of a system role', async () => {
        const role = await systemRole()
        const before = await grantsOf(role.id)

        await platformAdminAgent.patch(`/api/accounts/roles/${role.id}`).send({ permissionIds: before.permissionIds, subModuleIds: before.subModuleIds }).expect(200)

        expect(await grantsOf(role.id)).toEqual(before)
      })

      it('no account or entity role carries a platform section, whoever asks (403, nothing written)', async () => {
        const platformAccounts = await prismaService.subModule.findFirstOrThrow({ where: { name: 'PLATFORM_ACCOUNTS' } })

        await entityAdminAgent
          .post(`/api/accounts/${accountId}/roles`)
          .send({ name: 'scope-probe-platform-section', scope: 'ENTITY', subModuleIds: [platformAccounts.id], permissionIds: [] })
          .expect(403)
        await agent
          .post(`/api/accounts/${accountId}/roles`)
          .send({ name: 'scope-probe-platform-section', scope: 'ACCOUNT', subModuleIds: [platformAccounts.id], permissionIds: [] })
          .expect(403)
        expect(await prismaService.role.count({ where: { name: 'scope-probe-platform-section' } })).toBe(0)

        // An existing custom role used only in the entity-admin's own entity: the section is refused there too.
        const ownRole = await createRoleAsAccountAdmin({ name: 'scope-probe-own-section', scope: 'ENTITY', permissionIds: [] })
        const before = await grantsOf(ownRole.id)
        await entityAdminAgent
          .patch(`/api/accounts/roles/${ownRole.id}`)
          .send({ subModuleIds: [platformAccounts.id], permissionIds: [] })
          .expect(403)
        expect(await grantsOf(ownRole.id)).toEqual(before)
      })

      it('a seeded entity-admin cannot edit, toggle or delete an ENTITY role used in a sibling entity (403)', async () => {
        const siblingRole = await createRoleAsAccountAdmin({ name: 'scope-probe-sibling', scope: 'ENTITY', permissionIds: [] })
        await createProbeUser('scope-sibling-holder@saasfoundryai.test', { roleId: siblingRole.id, entityId: siblingEntityId }, { entityId: siblingEntityId })

        await entityAdminAgent.patch(`/api/accounts/roles/${siblingRole.id}`).send({ name: 'hijacked' }).expect(403)
        await entityAdminAgent.patch(`/api/accounts/roles/${siblingRole.id}/status`).send({ isActive: false }).expect(403)
        await entityAdminAgent.delete(`/api/accounts/roles/${siblingRole.id}`).expect(403)

        expect(await grantsOf(siblingRole.id)).toMatchObject({ name: 'scope-probe-sibling', isActive: true })
      })

      it('nobody adds a permission it does not hold: the holder of a custom role cannot extend it, nor mint one (403)', async () => {
        const roleManagement = await permissionIdOf('ROLE_CUSTOM_MANAGEMENT')
        const entityCreation = await permissionIdOf('ENTITY_CREATION')
        const selfRole = await createRoleAsAccountAdmin({ name: 'scope-probe-self', scope: 'ENTITY', permissionIds: [roleManagement] })
        const holder = await createProbeUser('scope-self-holder@saasfoundryai.test', { roleId: selfRole.id, entityId }, { entityId })

        await holder.agent
          .patch(`/api/accounts/roles/${selfRole.id}`)
          .send({ permissionIds: [roleManagement, entityCreation] })
          .expect(403)
        expect((await grantsOf(selfRole.id)).permissionIds).toEqual([roleManagement])

        await holder.agent
          .post(`/api/accounts/${accountId}/roles`)
          .send({ name: 'scope-probe-minted', scope: 'ENTITY', permissionIds: [entityCreation] })
          .expect(403)
        expect(await prismaService.role.count({ where: { name: 'scope-probe-minted' } })).toBe(0)
      })

      it('a seeded entity-admin still manages an ENTITY role used only in its own entity, with what it holds', async () => {
        const ownRole = await createRoleAsAccountAdmin({ name: 'scope-probe-mine', scope: 'ENTITY', permissionIds: [] })
        await createProbeUser('scope-own-holder@saasfoundryai.test', { roleId: ownRole.id, entityId }, { entityId })
        const allocation = await permissionIdOf('USER_ROLE_ALLOCATION')

        await entityAdminAgent
          .patch(`/api/accounts/roles/${ownRole.id}`)
          .send({ name: 'scope-probe-mine-2', permissionIds: [allocation] })
          .expect(200)
        expect(await grantsOf(ownRole.id)).toMatchObject({ name: 'scope-probe-mine-2', permissionIds: [allocation] })
        await entityAdminAgent.patch(`/api/accounts/roles/${ownRole.id}/status`).send({ isActive: false }).expect(200)
        // A role still assigned cannot be deleted (the assignment's foreign key): detach the holder first.
        await prismaService.userRoleAssignment.deleteMany({ where: { roleId: ownRole.id } })
        await entityAdminAgent.delete(`/api/accounts/roles/${ownRole.id}`).expect(200)
        expect(await prismaService.role.count({ where: { id: ownRole.id } })).toBe(0)
      })

      it('the account admin still manages every custom role of its account, wherever it is used', async () => {
        const siblingRole = await createRoleAsAccountAdmin({ name: 'scope-probe-admin', scope: 'ENTITY', permissionIds: [] })
        await createProbeUser('scope-admin-holder@saasfoundryai.test', { roleId: siblingRole.id, entityId: siblingEntityId }, { entityId: siblingEntityId })
        const allocation = await permissionIdOf('USER_ROLE_ALLOCATION')

        await agent
          .patch(`/api/accounts/roles/${siblingRole.id}`)
          .send({ name: 'scope-probe-admin-2', permissionIds: [allocation] })
          .expect(200)
        await agent.patch(`/api/accounts/roles/${siblingRole.id}/status`).send({ isActive: false }).expect(200)
        await prismaService.userRoleAssignment.deleteMany({ where: { roleId: siblingRole.id } })
        await agent.delete(`/api/accounts/roles/${siblingRole.id}`).expect(200)
        expect(await prismaService.role.count({ where: { id: siblingRole.id } })).toBe(0)
      })
    })
  })

  /**
   * Entity-type roles (#1230): a project adds an entity type whose sections exist only on its entities (a project's
   * vision, its tickets), granted by a system role of that type (a `project-owner`). Nobody holds them on the account,
   * so the account administrator shapes an ENTITY role assigned nowhere yet against what the entity type allows,
   * never beyond it.
   */
  describe('entity-type roles are shaped against what the entity type allows', () => {
    const createdRoleIds: number[] = []
    let projectModuleId: number
    let projectOwnerRoleId: number
    let visionSectionId: number
    let secretSectionId: number
    let ticketEditPermissionId: number

    const grantsOf = async (roleId: number) => {
      const role = await prismaService.role.findUniqueOrThrow({ where: { id: roleId }, include: { permissionsLinked: true, subModulesLinked: true } })
      return { permissionIds: role.permissionsLinked.map((link) => link.permissionId), subModuleIds: role.subModulesLinked.map((link) => link.subModuleId).sort((a, b) => a - b) }
    }

    beforeAll(async () => {
      const moduleType = await prismaService.moduleType.findFirstOrThrow({ where: { name: 'ACCOUNT_MANAGEMENT' } })
      const projectModule = await prismaService.module.create({
        data: { name: 'E2E_PROJECT', version: '1.0.0', description: 'Entity-only project module (e2e #1230)', typeId: moduleType.id, isActive: true }
      })
      projectModuleId = projectModule.id
      const vision = await prismaService.subModule.create({ data: { moduleId: projectModule.id, name: 'E2E_PROJECT_VISION', description: 'Project vision section' } })
      const secret = await prismaService.subModule.create({ data: { moduleId: projectModule.id, name: 'E2E_PROJECT_SECRET', description: 'A section no system role grants' } })
      visionSectionId = vision.id
      secretSectionId = secret.id
      const ticketEdit = await prismaService.modulePermission.create({
        data: { moduleId: projectModule.id, subModuleId: vision.id, name: 'E2E_PROJECT_TICKET_EDIT', description: 'Edit the tickets of a project', applicableScopes: ['ENTITY'] }
      })
      ticketEditPermissionId = ticketEdit.id

      // The entity type's system role: module → section → permission, in the order the integrity trigger requires.
      const projectOwner = await prismaService.role.create({ data: { name: 'e2e-project-owner', scope: 'ENTITY', isSystem: true, isActive: true, accountId: null } })
      projectOwnerRoleId = projectOwner.id
      await prismaService.roleModuleLink.create({ data: { roleId: projectOwner.id, moduleId: projectModule.id } })
      await prismaService.roleSubModuleLink.create({ data: { roleId: projectOwner.id, subModuleId: vision.id } })
      await prismaService.rolePermissionLink.create({ data: { roleId: projectOwner.id, permissionId: ticketEdit.id } })
    })

    afterAll(async () => {
      await prismaService.role.deleteMany({ where: { id: { in: [...createdRoleIds, projectOwnerRoleId].filter((id) => id !== undefined) } } })
      if (projectModuleId) await prismaService.module.delete({ where: { id: projectModuleId } }).catch(() => {})
    })

    it('the account admin creates an ENTITY role granting the sections that exist only on the entity', async () => {
      const res = await agent
        .post(`/api/accounts/${accountId}/roles`)
        .send({ name: 'e2e-project-reviewer', scope: 'ENTITY', subModuleIds: [visionSectionId], permissionIds: [ticketEditPermissionId] })
        .expect(201)
      createdRoleIds.push(res.body.id)

      expect(await grantsOf(res.body.id)).toEqual({ permissionIds: [ticketEditPermissionId], subModuleIds: [visionSectionId] })
    })

    it('the account admin adds them to an ENTITY role assigned nowhere yet', async () => {
      const res = await agent.post(`/api/accounts/${accountId}/roles`).send({ name: 'e2e-project-empty', scope: 'ENTITY', permissionIds: [] }).expect(201)
      createdRoleIds.push(res.body.id)

      await agent
        .patch(`/api/accounts/roles/${res.body.id}`)
        .send({ subModuleIds: [visionSectionId], permissionIds: [ticketEditPermissionId] })
        .expect(200)
      expect(await grantsOf(res.body.id)).toEqual({ permissionIds: [ticketEditPermissionId], subModuleIds: [visionSectionId] })
    })

    it('nobody grants beyond what the entity type allows (403, nothing written)', async () => {
      await agent
        .post(`/api/accounts/${accountId}/roles`)
        .send({ name: 'e2e-project-secret', scope: 'ENTITY', subModuleIds: [visionSectionId, secretSectionId], permissionIds: [] })
        .expect(403)
      expect(await prismaService.role.count({ where: { name: 'e2e-project-secret' } })).toBe(0)
    })

    it('an ACCOUNT role does not borrow what the entity type allows (403)', async () => {
      await agent
        .post(`/api/accounts/${accountId}/roles`)
        .send({ name: 'e2e-project-account', scope: 'ACCOUNT', subModuleIds: [visionSectionId], permissionIds: [] })
        .expect(403)
      expect(await prismaService.role.count({ where: { name: 'e2e-project-account' } })).toBe(0)
    })

    it('an entity admin still grants only what it holds (403)', async () => {
      await entityAdminAgent
        .post(`/api/accounts/${accountId}/roles`)
        .send({ name: 'e2e-project-entity-admin', scope: 'ENTITY', subModuleIds: [visionSectionId], permissionIds: [] })
        .expect(403)
      expect(await prismaService.role.count({ where: { name: 'e2e-project-entity-admin' } })).toBe(0)
    })
  })
})
