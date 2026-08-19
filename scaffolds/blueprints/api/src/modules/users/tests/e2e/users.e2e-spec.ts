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
import { AuthModule } from '@modules/auth/auth.module'
import { UsersModule } from '@modules/users/users.module'

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
describe('Users Module (e2e)', () => {
  let app: INestApplication
  let prismaService: PrismaService
  let agent: ReturnType<typeof request.agent>
  let testUser: TestUser

  const password = 'TestPassword123'

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [UsersModule, AuthModule, LoggerModule, EnvModule, PrismaModule, AccountAccessModule]
    }).compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api')
    app.use(cookieParser())
    app.useGlobalPipes(new ZodValidationPipe(), new ValidationPipe({ transform: true }))

    prismaService = moduleRef.get<PrismaService>(PrismaService)

    testUser = await setupTestUser(prismaService, {
      email: 'preferences@SaaSFoundryAI.test',
      password,
      firstname: 'Pref',
      lastname: 'User',
      roles: ['account-user']
    })

    await app.init()

    agent = request.agent(app.getHttpServer())
    const loginSuccess = await loginTestUser(agent, testUser.email, password)
    if (!loginSuccess) {
      throw new Error('Failed to login with test user')
    }
  })

  afterAll(async () => {
    await cleanupTestUser(prismaService, testUser.email)
    await prismaService.$disconnect()
    await app.close()
  })

  describe('GET /api/users/me/preferences', () => {
    it('returns the authenticated user preferences (seeded locale FR)', async () => {
      const response = await agent.get('/api/users/me/preferences').expect(200)

      expect(response.body).toEqual({
        locale: 'FR',
        avatarUrl: null
      })
    })

    it('rejects unauthenticated access with 401', async () => {
      await request(app.getHttpServer()).get('/api/users/me/preferences').expect(401)
    })
  })

  describe('PATCH /api/users/me/preferences', () => {
    it('partially updates the locale and persists it', async () => {
      const response = await agent.patch('/api/users/me/preferences').send({ locale: 'EN' }).expect(200)

      expect(response.body.locale).toBe('EN')

      // The change is durable: a follow-up read returns the updated locale.
      const reread = await agent.get('/api/users/me/preferences').expect(200)
      expect(reread.body.locale).toBe('EN')
    })

    it('rejects an invalid locale payload with 400', async () => {
      await agent.patch('/api/users/me/preferences').send({ locale: 'NOT_A_LOCALE' }).expect(400)
    })

    it('rejects unauthenticated updates with 401', async () => {
      await request(app.getHttpServer()).patch('/api/users/me/preferences').send({ locale: 'EN' }).expect(401)
    })
  })
})
