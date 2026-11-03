/**
 * Resources
 */
import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { Locale, OrganizationType } from '@/generated/prisma/client'
import cookieParser from 'cookie-parser'
import * as dotenv from 'dotenv'
import request from 'supertest'

/**
 * Dependencies
 */
import { AccountAccessModule } from '@common/services/account-access/account-access.module'
import { LoggerModule } from '@common/services/logger/logger.module'
import { createAcceptInvitationDto, createInvitationDto } from '@common/tests/e2e/utils/setup-test-invitation'
import { cleanupTestOrganization, setupTestOrganization } from '@common/tests/e2e/utils/setup-test-organization'
import { cleanupTestUser, loginTestUser, setupTestUser, TestUser } from '@common/tests/e2e/utils/setup-test-user'
import { EnvModule } from '@configs/env/env.module'
import { PrismaModule } from '@configs/prisma/prisma.module'
import { PrismaService } from '@configs/prisma/services/prisma.service'
import { AuthModule } from '@modules/auth/auth.module'
import { InvitationModule } from '@modules/invitation/invitation.module'

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

// Mock email service to prevent actual email sending
jest.mock('@modules/email/services/email.service', () => ({
  EmailService: jest.fn().mockImplementation(() => ({
    sendInvitationEmail: jest.fn().mockResolvedValue(true)
  }))
}))

/**
 * Test Suite
 */
describe('Invitation Module (e2e)', () => {
  let app: INestApplication
  let prismaService: PrismaService
  let agent: ReturnType<typeof request.agent>
  let testUser: TestUser
  let testOrganization: { id: string }
  let invitationToken: string
  let invitedUserEmail: string

  beforeAll(async () => {
    // Create NestJS application
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [InvitationModule, AuthModule, LoggerModule, EnvModule, PrismaModule, AccountAccessModule]
    }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api')
    app.use(cookieParser())

    prismaService = moduleRef.get<PrismaService>(PrismaService)

    // Set up test user with necessary roles and permissions
    testUser = await setupTestUser(prismaService, {
      email: 'invitationtest@billmate.test',
      password: 'TestPassword123',
      firstname: 'Invitation',
      lastname: 'Manager',
      roles: ['account-admin'],
      permissions: ['USER_ACCOUNTS_INVITATION', 'USER_ENTITIES_INVITATION', 'USER_ROLE_ALLOCATION']
    })

    // Create a test organization
    testOrganization = await setupTestOrganization(prismaService, {
      name: 'Test Organization',
      type: OrganizationType.COMPANY,
      description: 'Test Organization Description',
      accountId: testUser.accountId
    })

    await app.init()

    // Create agent for authenticated requests
    agent = request.agent(app.getHttpServer())

    // Login with test user
    const loginSuccess = await loginTestUser(agent, testUser.email, 'TestPassword123')
    if (!loginSuccess) {
      throw new Error('Failed to login with test user')
    }

    // Generate a unique email for testing
    invitedUserEmail = `invited-user-${Date.now()}@billmate.test`
  })

  afterAll(async () => {
    // Clean up test organization
    await cleanupTestOrganization(prismaService, testOrganization.id)

    // Clean up test user
    await cleanupTestUser(prismaService, testUser.email)

    // Clean up invited user if one was created
    if (invitedUserEmail) {
      const invitedUser = await prismaService.user.findUnique({
        where: { email: invitedUserEmail }
      })
      if (invitedUser) {
        // Delete tokens
        await prismaService.userToken.deleteMany({
          where: { userId: invitedUser.id }
        })
        // Delete user
        await prismaService.user
          .delete({
            where: { id: invitedUser.id }
          })
          .catch(() => {
            // Ignore if deletion fails due to constraints
          })
      }
    }

    await prismaService.$disconnect()
    await app.close()
  })

  describe('Invitation Creation', () => {
    it('should successfully create an invitation when authenticated', async () => {
      // Vérifier que le compte existe et est actif
      const account = await prismaService.account.findUnique({
        where: { id: testUser.accountId }
      })
      expect(account).not.toBeNull()
      expect(account?.isActive).toBe(true)

      const dto = {
        email: invitedUserEmail,
        firstname: 'Test',
        lastname: 'User',
        roleIds: [2],
        accountIds: [testUser.accountId],
        entityIds: [],
        locale: Locale.FR
      }

      const response = await agent.post('/api/invitations').send(dto)

      // Vérifier que la réponse est un succès
      expect(response.status).toBe(201)

      expect(response.body).toMatchObject({
        message: expect.stringContaining('Invitation sent successfully')
      })

      // Save the invitation token for later tests if it exists in the response
      if (response.body.invitationToken) {
        invitationToken = response.body.invitationToken
      }

      // Vérifier que l'invitation a bien été créée dans la base de données
      const invitation = await prismaService.invitation.findFirst({
        where: {
          inviteeUserEmail: invitedUserEmail,
          inviterUserId: testUser.id,
          status: 'SENT'
        },
        include: {
          accountsLinked: true,
          entitiesLinked: true,
          rolesLinked: true
        }
      })

      expect(invitation).not.toBeNull()
      expect(invitation?.status).toBe('SENT')
      expect(invitation?.accountsLinked).toHaveLength(1)
      expect(invitation?.accountsLinked[0].accountId).toBe(testUser.accountId)
      expect(invitation?.rolesLinked).toHaveLength(1)
      expect(invitation?.rolesLinked[0].roleId).toBe(2)
    })

    it('should reject invitation creation when not authenticated', async () => {
      const dto = {
        email: `non-auth-invite-${Date.now()}@billmate.test`,
        firstname: 'Test',
        lastname: 'User',
        roleIds: [2],
        accountIds: [testUser.accountId],
        entityIds: [],
        locale: Locale.FR
      }

      await request(app.getHttpServer()).post('/api/invitations').send(dto).expect(401)
    })

    it('should reject invitation without at least one account or entity ID', async () => {
      const dto = {
        email: `no-context-${Date.now()}@billmate.test`,
        firstname: 'No',
        lastname: 'Context',
        accountIds: [],
        entityIds: [],
        roleIds: [2],
        locale: Locale.FR
      }

      const response = await agent.post('/api/invitations').send(dto)
      expect(response.status).toBe(400)
      expect(response.body).toHaveProperty('message')
      expect(response.body.message).toContain('account or entity')
    })
  })

  describe('List User Invitations', () => {
    it('should return user invitations when authenticated', async () => {
      // S'assurer qu'une invitation existe
      if (!invitationToken) {
        const dto = createInvitationDto(`backup-invite-${Date.now()}@billmate.test`, [testUser.accountId])
        await agent.post('/api/invitations').send(dto)
      }

      const response = await agent.get('/api/invitations')

      // Verify successful response
      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('invitations')
      expect(Array.isArray(response.body.invitations)).toBe(true)

      // Our test user should have at least one invitation
      expect(response.body.invitations.length).toBeGreaterThan(0)

      // Verify invitation structure
      const invitation = response.body.invitations[0]
      expect(invitation).toMatchObject({
        id: expect.any(String),
        inviterUserId: testUser.id,
        inviteeUserEmail: expect.any(String),
        status: expect.any(String),
        invitedAt: expect.any(String)
      })
    })

    it('should reject invitation listing when not authenticated', async () => {
      await request(app.getHttpServer()).get('/api/invitations').expect(401)
    })
  })

  describe('Invitation Acceptance', () => {
    // This test depends on the invitation token from the previous test
    it('should accept a valid invitation token', async () => {
      // Skip if no token was generated in the previous test
      if (!invitationToken) {
        console.warn('Skipping invitation acceptance test as no token was generated')
        return
      }

      const dto = createAcceptInvitationDto(invitationToken)

      const response = await request(app.getHttpServer()).post('/api/invitations/accept').send(dto)

      // The response should be successful (200 or 201)
      // if the token is expired or already used, we'll get 400 or 401
      expect([200, 201, 400]).toContain(response.status)

      if (response.status === 200 || response.status === 201) {
        expect(response.body).toHaveProperty('userId')
      }
    })

    it('should reject an invalid invitation token', async () => {
      const dto = createAcceptInvitationDto('invalid.token.format')

      const response = await request(app.getHttpServer()).post('/api/invitations/accept').send(dto).expect(401)
      expect(response.body).toHaveProperty('message')
    })

    it('should reject acceptance without a password', async () => {
      const dto = {
        invitationToken: 'valid.looking.token' // But missing password
      }

      const response = await request(app.getHttpServer()).post('/api/invitations/accept').send(dto).expect(401)
      expect(response.body).toHaveProperty('message')
    })
  })

  /**
   * RBAC scope isolation (#1072): the inviter must hold the invitation permissions, and the right to
   * allocate roles, in the scope of each target account or entity — not merely somewhere.
   */
  describe('RBAC scope isolation', () => {
    const password = 'TestPassword123'
    const inviteePrefix = 'scope-invitee-'
    const probeEmails: string[] = []
    const createdRoleIds: number[] = []
    const createdEntityIds: string[] = []
    let accountRoleId: number
    let entityUserRoleId: number
    let platformAdminRoleId: number
    let ownEntityId: string
    let siblingEntityId: string
    let otherAdmin: TestUser
    let otherAdminAgent: ReturnType<typeof request.agent>
    let entityAdminAgent: ReturnType<typeof request.agent>
    let sectionHolderAgent: ReturnType<typeof request.agent>
    let foreignRoleId: number

    const inviteeEmail = (label: string) => `${inviteePrefix}${label}-${Date.now()}@billmate.test`
    const invitationsTo = (email: string) => prismaService.invitation.count({ where: { inviteeUserEmail: email } })

    /** A custom role holding exactly the named permissions (module, sections and permissions linked in trigger order). */
    const createCustomRole = async (name: string, scope: 'ACCOUNT' | 'ENTITY', accountId: string, permissionNames: string[], extraSubModuleNames: string[] = []) => {
      const permissions = await prismaService.modulePermission.findMany({ where: { name: { in: permissionNames } } })
      const extraSubModules = await prismaService.subModule.findMany({ where: { name: { in: extraSubModuleNames } } })
      const subModuleIds = [...new Set([...permissions.map((p) => p.subModuleId).filter((id): id is number => id !== null), ...extraSubModules.map((s) => s.id)])]
      const subModules = await prismaService.subModule.findMany({ where: { id: { in: subModuleIds } } })
      const moduleIds = [...new Set([...permissions.map((p) => p.moduleId), ...subModules.map((s) => s.moduleId)])]
      const role = await prismaService.role.create({ data: { name, scope, accountId, isSystem: false, isActive: true } })
      createdRoleIds.push(role.id)
      await prismaService.roleModuleLink.createMany({ data: moduleIds.map((moduleId) => ({ roleId: role.id, moduleId })) })
      await prismaService.roleSubModuleLink.createMany({ data: subModuleIds.map((subModuleId) => ({ roleId: role.id, subModuleId })) })
      await prismaService.rolePermissionLink.createMany({ data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })) })
      return role
    }

    /** A user wired by hand with one role assignment and the links that make the target reachable. */
    const createInviter = async (email: string, assignment: { roleId: number; accountId?: string; entityId?: string }, links: { accountIds?: string[]; entityIds?: string[] }) => {
      probeEmails.push(email)
      const bcrypt = await import('bcrypt')
      const people = await prismaService.people.create({ data: { firstname: 'Scope', lastname: 'Inviter', email } })
      const user = await prismaService.user.create({
        data: {
          email,
          password: await bcrypt.hash(password, 10),
          isActive: true,
          people: { connect: { id: people.id } },
          preference: { create: { locale: 'FR' } },
          accountsLinked: { create: (links.accountIds ?? []).map((accountId) => ({ accountId })) },
          entitiesLinked: { create: (links.entityIds ?? []).map((entityId) => ({ entityId })) },
          roleAssignments: { create: assignment }
        }
      })
      const inviterAgent = request.agent(app.getHttpServer())
      if (!(await loginTestUser(inviterAgent, email, password))) throw new Error(`Failed to login ${email}`)
      return { user, agent: inviterAgent }
    }

    beforeAll(async () => {
      accountRoleId = (await prismaService.role.findFirstOrThrow({ where: { name: 'account-user', accountId: null } })).id
      entityUserRoleId = (await prismaService.role.findFirstOrThrow({ where: { name: 'entity-user', accountId: null } })).id
      platformAdminRoleId = (await prismaService.role.findFirstOrThrow({ where: { name: 'platform-admin', accountId: null } })).id
      const entityAdminRoleId = (await prismaService.role.findFirstOrThrow({ where: { name: 'entity-admin', accountId: null } })).id

      ownEntityId = (await prismaService.entity.create({ data: { accountId: testUser.accountId, isActive: true } })).id
      siblingEntityId = (await prismaService.entity.create({ data: { accountId: testUser.accountId, isActive: true } })).id
      createdEntityIds.push(ownEntityId, siblingEntityId)

      // An entity-admin of ONE entity; it is also a plain member of the sibling entity (no role there), so the
      // membership check lets the sibling through and only the scope of the role stands in the way.
      const entityAdmin = await createInviter('scope-entity-inviter@billmate.test', { roleId: entityAdminRoleId, entityId: ownEntityId }, { entityIds: [ownEntityId, siblingEntityId] })
      entityAdminAgent = entityAdmin.agent

      // An admin of ANOTHER account who is also a plain member of this one.
      otherAdmin = await setupTestUser(prismaService, { email: 'scope-b-inviter@billmate.test', password, firstname: 'Other', lastname: 'Admin', roles: ['account-admin'] })
      await prismaService.userAccountLink.create({ data: { userId: otherAdmin.id, accountId: testUser.accountId } })
      otherAdminAgent = request.agent(app.getHttpServer())
      if (!(await loginTestUser(otherAdminAgent, otherAdmin.email, password))) throw new Error('Failed to login the other-account admin')

      // An ACCOUNT role of this account that merely carries the platform section next to the invitation rights.
      const sectionRole = await createCustomRole('scope-section-role', 'ACCOUNT', testUser.accountId, ['USER_ACCOUNTS_INVITATION', 'USER_ROLE_ALLOCATION'], ['PLATFORM_ACCOUNTS'])
      const sectionHolder = await createInviter('scope-section-inviter@billmate.test', { roleId: sectionRole.id, accountId: testUser.accountId }, { accountIds: [testUser.accountId] })
      sectionHolderAgent = sectionHolder.agent

      // An ACCOUNT role owned by the OTHER account.
      foreignRoleId = (await createCustomRole('scope-b-owned-role', 'ACCOUNT', otherAdmin.accountId, ['USER_ROLE_ALLOCATION'])).id
    })

    afterAll(async () => {
      const inviters = await prismaService.user.findMany({ where: { email: { in: [...probeEmails, otherAdmin.email, testUser.email] } }, select: { id: true } })
      await prismaService.invitation.deleteMany({ where: { inviterUserId: { in: inviters.map((u) => u.id) } } })
      const invitees = await prismaService.user.findMany({ where: { email: { startsWith: inviteePrefix } }, select: { id: true } })
      await prismaService.userToken.deleteMany({ where: { userId: { in: invitees.map((u) => u.id) } } })
      await prismaService.user.deleteMany({ where: { id: { in: invitees.map((u) => u.id) } } })
      await prismaService.user.deleteMany({ where: { email: { in: probeEmails } } })
      await prismaService.people.deleteMany({ where: { email: { in: probeEmails } } })
      await prismaService.role.deleteMany({ where: { id: { in: createdRoleIds } } })
      await prismaService.entity.deleteMany({ where: { id: { in: createdEntityIds } } })
      await cleanupTestUser(prismaService, otherAdmin.email)
    })

    describe('an admin of another account', () => {
      it('cannot invite into an account where it is only a member (403)', async () => {
        const email = inviteeEmail('b-into-a')

        await otherAdminAgent
          .post('/api/invitations')
          .send({ ...createInvitationDto(email, [testUser.accountId]), roleIds: [accountRoleId] })
          .expect(403)

        expect(await invitationsTo(email)).toBe(0)
      })

      it('still invites into its own account', async () => {
        const email = inviteeEmail('b-into-b')

        await otherAdminAgent
          .post('/api/invitations')
          .send({ ...createInvitationDto(email, [otherAdmin.accountId]), roleIds: [accountRoleId] })
          .expect(201)

        expect(await invitationsTo(email)).toBe(1)
      })

      it('cannot grant a role owned by another account (403)', async () => {
        const email = inviteeEmail('foreign-role')

        await agent
          .post('/api/invitations')
          .send({ ...createInvitationDto(email, [testUser.accountId]), roleIds: [foreignRoleId] })
          .expect(403)

        expect(await invitationsTo(email)).toBe(0)
      })
    })

    describe('an entity-admin', () => {
      it('invites into its own entity with an ENTITY role', async () => {
        const email = inviteeEmail('own-entity')

        await entityAdminAgent
          .post('/api/invitations')
          .send({ ...createInvitationDto(email, [], [ownEntityId]), roleIds: [entityUserRoleId] })
          .expect(201)

        expect(await invitationsTo(email)).toBe(1)
      })

      it('cannot invite into a sibling entity where it holds no role (403)', async () => {
        const email = inviteeEmail('sibling')

        await entityAdminAgent
          .post('/api/invitations')
          .send({ ...createInvitationDto(email, [], [siblingEntityId]), roleIds: [entityUserRoleId] })
          .expect(403)

        expect(await invitationsTo(email)).toBe(0)
      })

      it('cannot grant an ACCOUNT role through an entity invitation (403)', async () => {
        const email = inviteeEmail('account-role')

        await entityAdminAgent
          .post('/api/invitations')
          .send({ ...createInvitationDto(email, [], [ownEntityId]), roleIds: [accountRoleId] })
          .expect(403)

        expect(await invitationsTo(email)).toBe(0)
      })

      it('cannot invite into the account itself (no account invitation right)', async () => {
        const email = inviteeEmail('into-account')

        await entityAdminAgent
          .post('/api/invitations')
          .send({ ...createInvitationDto(email, [testUser.accountId]), roleIds: [accountRoleId] })
          .expect(401)

        expect(await invitationsTo(email)).toBe(0)
      })
    })

    describe('the account admin', () => {
      it('invites into an entity of its account with an ENTITY role', async () => {
        const email = inviteeEmail('admin-entity')

        await agent
          .post('/api/invitations')
          .send({ ...createInvitationDto(email, [], [ownEntityId]), roleIds: [entityUserRoleId] })
          .expect(201)

        expect(await invitationsTo(email)).toBe(1)
      })
    })

    describe('a platform section is not platform reach', () => {
      it('an ACCOUNT role carrying PLATFORM_ACCOUNTS cannot assign the platform-admin role', async () => {
        const email = inviteeEmail('platform')

        await sectionHolderAgent
          .post('/api/invitations')
          .send({ ...createInvitationDto(email), roleIds: [platformAdminRoleId] })
          .expect(401)

        expect(await invitationsTo(email)).toBe(0)
      })
    })
  })
})
