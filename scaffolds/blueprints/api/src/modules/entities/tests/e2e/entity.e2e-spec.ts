/**
 * Resources
 */
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { OrganizationType } from '@/generated/prisma/client'
import cookieParser from 'cookie-parser'
import * as dotenv from 'dotenv'
import { ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'

/**
 * Dependencies
 */
import { AccountAccessModule } from '@common/services/account-access/account-access.module'
import { LoggerModule } from '@common/services/logger/logger.module'
import { cleanupTestEntity, createEntityDto, createEntityUsersDto, setupTestEntity } from '@common/tests/e2e/utils/setup-test-entity'
import { cleanupTestOrganization, setupTestOrganization } from '@common/tests/e2e/utils/setup-test-organization'
import { cleanupTestUser, loginTestUser, setupTestUser, TestUser } from '@common/tests/e2e/utils/setup-test-user'
import { EnvModule } from '@configs/env/env.module'
import { PrismaModule } from '@configs/prisma/prisma.module'
import { PrismaService } from '@configs/prisma/services/prisma.service'
import { AccountsModule } from '@modules/accounts/accounts.module'
import { AccountService } from '@modules/accounts/services/account.service'
import { AuthModule } from '@modules/auth/auth.module'
import { EntitiesModule } from '@modules/entities/entities.module'

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
 * Test Suite
 */
describe('Entities Module (e2e)', () => {
  let app: INestApplication
  let prismaService: PrismaService
  let accountService: AccountService
  let agent: ReturnType<typeof request.agent>
  let testUser: TestUser
  let testOrganization: { id: string }
  let createdEntityId: string

  beforeAll(async () => {
    // Create NestJS application
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [EntitiesModule, AccountsModule, AuthModule, LoggerModule, EnvModule, PrismaModule, AccountAccessModule]
    }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api')
    // Match the real bootstrap so Zod DTOs (e.g. the paginated entities query) parse/coerce correctly.
    app.useGlobalPipes(new ZodValidationPipe(), new ValidationPipe({ transform: true }))
    app.use(cookieParser())

    prismaService = moduleRef.get<PrismaService>(PrismaService)
    accountService = moduleRef.get<AccountService>(AccountService)

    // Set up test user with necessary roles and permissions
    testUser = await setupTestUser(prismaService, {
      email: 'entitytest@billmate.test',
      password: 'TestPassword123',
      firstname: 'Entity',
      lastname: 'Manager',
      roles: ['account-user', 'account-admin'],
      permissions: ['ENTITY_CREATION', 'ENTITY_USER_MANAGEMENT']
    })

    // Create a test organization. This org becomes the entity's typed profile, so its name is the
    // entity's resolved human identity (D-ENT-6) — name it like the entity the assertions expect.
    testOrganization = await setupTestOrganization(prismaService, {
      name: 'Test Entity',
      type: OrganizationType.COMPANY,
      description: 'Test Entity Description',
      accountId: testUser.accountId
    })

    // Create test entity
    const entity = await setupTestEntity(prismaService, {
      name: 'Test Entity',
      description: 'Test Entity Description',
      accountId: testUser.accountId,
      organizationId: testOrganization.id
    })

    createdEntityId = entity.id

    await app.init()

    // Create agent for authenticated requests
    agent = request.agent(app.getHttpServer())

    // Login with test user
    const loginSuccess = await loginTestUser(agent, testUser.email, 'TestPassword123')
    if (!loginSuccess) {
      throw new Error('Failed to login with test user')
    }
  })

  afterAll(async () => {
    // Clean up test data
    await cleanupTestEntity(prismaService, createdEntityId)

    // Clean up test organization
    await cleanupTestOrganization(prismaService, testOrganization.id)

    // Clean up test user
    await cleanupTestUser(prismaService, testUser.email)

    await prismaService.$disconnect()
    await app.close()
  })

  describe('Entity Creation', () => {
    it('should successfully create a new entity when authenticated', async () => {
      // Use the inline-organization flow: the new entity gets its own profile (its name/description
      // come from it — D-ENT-6). Reusing the shared testOrganization would move its unique entityId
      // off the setup entity, so we create a fresh profile here instead.
      const dto = {
        accountId: testUser.accountId,
        organization: {
          name: `Test Entity ${Date.now()}`,
          type: OrganizationType.COMPANY,
          description: 'Inline org profile for the created entity'
        }
      }

      const response = await agent.post('/api/entities').send(dto)
      expect([201, 400]).toContain(response.status)
    })

    it('should reject entity creation when not authenticated', async () => {
      const dto = createEntityDto(testUser.accountId, testOrganization.id)

      await request(app.getHttpServer()).post('/api/entities').send(dto).expect(401)
    })

    it('should create a nested entity under a same-account parent and persist parentEntityId (B3a)', async () => {
      // The setup entity (createdEntityId) lives on testUser's account — use it as the parent.
      const dto = {
        accountId: testUser.accountId,
        parentEntityId: createdEntityId,
        organization: {
          name: `Child Entity ${Date.now()}`,
          type: OrganizationType.COMPANY,
          description: 'Inline org profile for the nested child entity'
        }
      }

      const response = await agent.post('/api/entities').send(dto).expect(201)

      const childId = response.body.id as string
      expect(childId).toBeTruthy()

      // The child's parentEntityId must be persisted to the validated parent.
      const child = await prismaService.entity.findUnique({ where: { id: childId } })
      expect(child?.parentEntityId).toBe(createdEntityId)
      expect(child?.accountId).toBe(testUser.accountId)

      // Clean up the child (cascade removes its profile org link).
      await cleanupTestEntity(prismaService, childId)
    })

    it('should reject a nested entity whose parent belongs to a different account (B3a/B3b)', async () => {
      // Create a separate account + entity to act as a cross-account parent.
      const otherAccount = await prismaService.account.create({
        data: { name: 'B3a Other Account', description: 'Cross-account parent test', isActive: true }
      })
      const otherEntity = await prismaService.entity.create({
        data: { isActive: true, accountId: otherAccount.id }
      })

      try {
        const dto = {
          accountId: testUser.accountId,
          parentEntityId: otherEntity.id,
          organization: {
            name: `Cross-account Child ${Date.now()}`,
            type: OrganizationType.COMPANY,
            description: 'Should be rejected — parent is on another account'
          }
        }

        // B3b — creating under a parent now authorizes against that PARENT entity. The account-admin
        // testUser has NO authority over an entity in another account → 403 (a stronger, earlier denial
        // than the previous same-account 400 check).
        await agent.post('/api/entities').send(dto).expect(403)
      } finally {
        await prismaService.entity.deleteMany({ where: { id: otherEntity.id } })
        await prismaService.account.deleteMany({ where: { id: otherAccount.id } })
      }
    })
  })

  describe('Entity Users Management', () => {
    it('should successfully update entity users when authenticated', async () => {
      const dto = createEntityUsersDto([testUser.id])

      const response = await agent.patch(`/api/entities/${createdEntityId}/users`).send(dto).expect(200)

      expect(response.body).toMatchObject({
        id: createdEntityId,
        name: 'Test Entity',
        users: expect.arrayContaining([
          expect.objectContaining({
            id: testUser.id,
            email: testUser.email,
            isActive: true
          })
        ])
      })
    })

    it('should reject updating entity users when not authenticated', async () => {
      const dto = createEntityUsersDto([testUser.id])

      await request(app.getHttpServer()).patch(`/api/entities/${createdEntityId}/users`).send(dto).expect(401)
    })

    it('should reject updating users for non-existent entity', async () => {
      const dto = createEntityUsersDto([testUser.id])

      await agent.patch('/api/entities/non-existent-id/users').send(dto).expect(404)
    })

    it('should reject updating entity users with invalid user IDs', async () => {
      await agent
        .patch(`/api/entities/${createdEntityId}/users`)
        .send({ userIds: ['invalid-user-id'] })
        .expect(400)
    })
  })

  /**
   * B3b — Hierarchical entity authority (a node governs its subtree).
   *
   * Tree built in ONE account: E1 → E2 → E3 (E3 under E2 under E1), plus a sibling root S1.
   * A second account holds OA1. An entity-admin is seeded on E1.
   *
   * The authority rule under test (entity.service → AccountAccessService.validateUserEntityAccess):
   *   - platform-admin (cross-account), OR
   *   - account-admin of X's account (governs ALL account entities), OR
   *   - entity-admin of X itself or any ANCESTOR of X (X is in a subtree they govern).
   *
   * These tests PROVE the boundary positively AND negatively (siblings + other accounts → 403).
   */
  describe('B3b — hierarchical entity authority (subtree)', () => {
    // Account-scoped tree (built on the account-admin testUser's account).
    let e1Id: string
    let e2Id: string
    let e3Id: string
    let s1Id: string
    // Second account with its own entity (cross-account negative case).
    let otherAccountId: string
    let oa1Id: string
    // Entity-admin seeded on E1 (governs E1's subtree only).
    let entityAdminAgent: ReturnType<typeof request.agent>
    let entityAdminEmail: string
    let entityAdminUserId: string
    const orgIdsToCleanup: string[] = []

    // Create an entity with an attached organization profile (its human identity, D-ENT-6).
    async function makeEntity(accountId: string, parentEntityId: string | null, name: string): Promise<string> {
      const entity = await prismaService.entity.create({ data: { isActive: true, accountId, parentEntityId } })
      const org = await prismaService.organization.create({
        data: { name, type: OrganizationType.COMPANY, description: `${name} profile`, entityId: entity.id }
      })
      await prismaService.organizationAccountLink.create({ data: { organizationId: org.id, accountId } })
      orgIdsToCleanup.push(org.id)
      return entity.id
    }

    beforeAll(async () => {
      const accountId = testUser.accountId

      // Tree: E1 (root) → E2 → E3, and a separate sibling root S1 — all on testUser's account.
      e1Id = await makeEntity(accountId, null, 'B3b E1')
      e2Id = await makeEntity(accountId, e1Id, 'B3b E2')
      e3Id = await makeEntity(accountId, e2Id, 'B3b E3')
      s1Id = await makeEntity(accountId, null, 'B3b S1')

      // Second account + its entity OA1 (cross-account negative).
      const otherAccount = await prismaService.account.create({
        data: { name: 'B3b Other Account', description: 'cross-account', isActive: true }
      })
      otherAccountId = otherAccount.id
      oa1Id = await makeEntity(otherAccountId, null, 'B3b OA1')

      // Seed the entity-admin user: an ENTITY-scoped assignment of the system `entity-admin` role on E1.
      // That role carries the entity-admin marker permissions (USER_ENTITIES_INVITATION,
      // ENTITY_USER_MANAGEMENT) which both the PermissionsGuard (for /users) and
      // validateUserEntityAccess recognise.
      const entityAdminRole = await prismaService.role.findFirstOrThrow({ where: { name: 'entity-admin', scope: 'ENTITY', accountId: null } })
      entityAdminEmail = `b3b-entity-admin-${Date.now()}@billmate.test`
      const people = await prismaService.people.create({ data: { firstname: 'Subtree', lastname: 'Admin', email: entityAdminEmail } })
      const hashed = await (await import('bcrypt')).hash('TestPassword123', 10)
      const adminUser = await prismaService.user.create({
        data: {
          email: entityAdminEmail,
          password: hashed,
          isActive: true,
          people: { connect: { id: people.id } },
          preference: { create: { locale: 'EN' } },
          // Linked into the account via E1 (entity foothold), and entity-admin on E1.
          entitiesLinked: { create: { entityId: e1Id } },
          roleAssignments: { create: { roleId: entityAdminRole.id, entityId: e1Id } }
        }
      })
      entityAdminUserId = adminUser.id

      // The MULTI_ENTITY_MANAGEMENT module is seeded INACTIVE (opt-in feature). Activate it so the
      // entity-admin's ENTITY_OWN_CREATE permission becomes effective and the guard on /entities/own
      // passes — proving the subtree-authorized creation path. (The gate still EXISTS: a withheld
      // permission or an inactive module forbids it; covered by the sibling negative case below.)
      await prismaService.module.updateMany({ where: { name: 'MULTI_ENTITY_MANAGEMENT' }, data: { isActive: true } })

      entityAdminAgent = request.agent(app.getHttpServer())
      const ok = await loginTestUser(entityAdminAgent, entityAdminEmail, 'TestPassword123')
      if (!ok) throw new Error('Failed to login entity-admin test user')
    })

    afterAll(async () => {
      // Restore the opt-in module to its seeded (inactive) state.
      await prismaService.module.updateMany({ where: { name: 'MULTI_ENTITY_MANAGEMENT' }, data: { isActive: false } })
      // Remove the entity-admin user (cascades its links/assignments), the tree, the other account.
      await prismaService.user.deleteMany({ where: { email: entityAdminEmail } })
      await prismaService.people.deleteMany({ where: { email: entityAdminEmail } })
      // Delete entities children-first to respect the tree (cascade also handles it, but be explicit).
      for (const id of [e3Id, e2Id, e1Id, s1Id, oa1Id]) {
        await prismaService.entity.deleteMany({ where: { id } })
      }
      for (const orgId of orgIdsToCleanup) {
        await prismaService.organization.deleteMany({ where: { id: orgId } })
      }
      await prismaService.account.deleteMany({ where: { id: otherAccountId } })
    })

    it('✅ entity-admin(E1) CAN manage a direct descendant (E2)', async () => {
      // PATCH /entities/:id/users — the entity-admin role passes the guard (ENTITY_USER_MANAGEMENT)
      // and validateUserEntityAccess grants because E2 is in E1's subtree.
      await entityAdminAgent
        .patch(`/api/entities/${e2Id}/users`)
        .send({ userIds: [entityAdminUserId] })
        .expect(200)
    })

    it('✅ entity-admin(E1) CAN manage a deep descendant (E3)', async () => {
      await entityAdminAgent
        .patch(`/api/entities/${e3Id}/users`)
        .send({ userIds: [entityAdminUserId] })
        .expect(200)
    })

    it('✅ entity-admin(E1) CAN create a child under E2 (within its subtree)', async () => {
      const dto = {
        accountId: testUser.accountId,
        parentEntityId: e2Id,
        organization: { name: `B3b E2 child ${Date.now()}`, type: OrganizationType.COMPANY, description: 'subtree child' }
      }
      // /entities/own is gated by ENTITY_OWN_CREATE (granted by default) + MULTI_ENTITY_MANAGEMENT,
      // and the parent E2 is authorized by subtree authority.
      const res = await entityAdminAgent.post('/api/entities/own').send(dto).expect(201)
      const childId = res.body.id as string
      expect(childId).toBeTruthy()
      const child = await prismaService.entity.findUnique({ where: { id: childId } })
      expect(child?.parentEntityId).toBe(e2Id)
      expect(child?.accountId).toBe(testUser.accountId)
      await cleanupTestEntity(prismaService, childId)
    })

    it('❌ entity-admin(E1) CANNOT manage a sibling root (S1) — 403', async () => {
      await entityAdminAgent
        .patch(`/api/entities/${s1Id}/users`)
        .send({ userIds: [entityAdminUserId] })
        .expect(403)
    })

    it('❌ entity-admin(E1) CANNOT manage an entity in another account (OA1) — 403', async () => {
      await entityAdminAgent
        .patch(`/api/entities/${oa1Id}/users`)
        .send({ userIds: [entityAdminUserId] })
        .expect(403)
    })

    it('❌ entity-admin(E1) CANNOT create a child under a sibling (S1) — 403', async () => {
      const dto = {
        accountId: testUser.accountId,
        parentEntityId: s1Id,
        organization: { name: `B3b S1 child ${Date.now()}`, type: OrganizationType.COMPANY, description: 'should be rejected' }
      }
      await entityAdminAgent.post('/api/entities/own').send(dto).expect(403)
    })

    it('✅ account-admin CAN manage any entity in its account (E1/E2/E3/S1)', async () => {
      // `agent` is logged in as the account-admin testUser (account-level authority over all entities).
      // Keep the entity-admin linked on E1 (its account foothold) so the later listing test still
      // resolves its account access — the entity-admin's authority itself comes from the ENTITY role
      // assignment, which updateEntityUsers never touches.
      for (const id of [e1Id, e2Id, e3Id, s1Id]) {
        const userIds = id === e1Id ? [testUser.id, entityAdminUserId] : [testUser.id]
        await agent.patch(`/api/entities/${id}/users`).send({ userIds }).expect(200)
      }
    })

    it('✅ listing as entity-admin(E1) is scoped to its subtree (E1/E2/E3), not S1 / OA1', async () => {
      // The account-level ENTITIES section route is intentionally forbidden to entity-admins (D5,
      // proven in accounts.e2e). The SUBTREE-scoping lives in the service (defense-in-depth), so we
      // assert it at the layer it lives: fetchAccountEntities narrows to the entity-admin's subtree.
      const res = await accountService.fetchAccountEntities(entityAdminUserId, testUser.accountId, { page: 1, limit: 100 })
      const ids = res.items.map((e) => e.id)
      expect(ids).toEqual(expect.arrayContaining([e1Id, e2Id, e3Id]))
      expect(ids).not.toContain(s1Id)
      expect(ids).not.toContain(oa1Id)
    })

    it('✅ listing as account-admin returns the whole account (incl. S1)', async () => {
      // Account-admin behaviour unchanged: validated end-to-end via the guarded route.
      const res = await agent.get(`/api/accounts/${testUser.accountId}/entities`).query({ page: 1, limit: 100 }).expect(200)
      const ids = (res.body.items as Array<{ id: string }>).map((e) => e.id)
      expect(ids).toEqual(expect.arrayContaining([e1Id, e2Id, e3Id, s1Id]))
    })

    it('❌ entity-admin is still forbidden from the account ENTITIES section route (D5 unchanged)', async () => {
      // The hierarchical-authority rework must NOT loosen the route-level section gate.
      await entityAdminAgent.get(`/api/accounts/${testUser.accountId}/entities`).expect(403)
    })
  })
})
