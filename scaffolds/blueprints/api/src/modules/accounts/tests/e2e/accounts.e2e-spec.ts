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
})
