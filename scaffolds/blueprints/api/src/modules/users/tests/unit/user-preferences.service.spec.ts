/**
 * Resources
 */
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

/**
 * Dependencies
 */
import { Logger } from '@common/services/logger/logger.service'
import { PrismaService } from '@configs/prisma/services/prisma.service'
import { UserPreferencesService } from '@modules/users/services/user-preferences.service'

/**
 * Declaration
 */
describe('UserPreferencesService', () => {
  let service: UserPreferencesService
  let logger: jest.Mocked<Logger>
  let prisma: {
    user: { findUnique: jest.Mock }
    userPreference: { create: jest.Mock; upsert: jest.Mock }
  }

  const userId = 'user-1'

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      userPreference: { create: jest.fn(), upsert: jest.fn() }
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [UserPreferencesService, { provide: PrismaService, useValue: prisma }, { provide: Logger, useValue: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } }]
    }).compile()

    service = module.get<UserPreferencesService>(UserPreferencesService)
    logger = module.get(Logger)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('getPreferences', () => {
    it('returns the existing preference when the user has one', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: userId, preference: { locale: 'FR', avatarUrl: 'https://cdn/x.png' } })

      const result = await service.getPreferences(userId)

      expect(result).toEqual({ locale: 'FR', avatarUrl: 'https://cdn/x.png' })
      expect(prisma.userPreference.create).not.toHaveBeenCalled()
    })

    it('normalises a missing avatarUrl to null', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: userId, preference: { locale: 'EN', avatarUrl: undefined } })

      const result = await service.getPreferences(userId)

      expect(result).toEqual({ locale: 'EN', avatarUrl: null })
    })

    it('defensively creates a default preference row for legacy users without one', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: userId, preference: null })
      prisma.userPreference.create.mockResolvedValue({ locale: 'EN', avatarUrl: null })

      const result = await service.getPreferences(userId)

      expect(prisma.userPreference.create).toHaveBeenCalledWith({ data: { userId, locale: 'EN' } })
      expect(result).toEqual({ locale: 'EN', avatarUrl: null })
    })

    it('throws NotFoundException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(service.getPreferences(userId)).rejects.toBeInstanceOf(NotFoundException)
      expect(logger.warn).toHaveBeenCalled()
    })

    it('wraps unexpected database errors in BadRequestException', async () => {
      prisma.user.findUnique.mockRejectedValue(new Error('db down'))

      await expect(service.getPreferences(userId)).rejects.toBeInstanceOf(BadRequestException)
      expect(logger.error).toHaveBeenCalled()
    })
  })

  describe('updatePreferences', () => {
    it('upserts only the provided fields (partial update)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: userId })
      prisma.userPreference.upsert.mockResolvedValue({ locale: 'FR', avatarUrl: null })

      const result = await service.updatePreferences(userId, { locale: 'FR' })

      expect(prisma.userPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
          update: { locale: 'FR' }
        })
      )
      expect(result).toEqual({ locale: 'FR', avatarUrl: null })
    })

    it('passes avatarUrl through update and create branches', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: userId })
      prisma.userPreference.upsert.mockResolvedValue({ locale: 'EN', avatarUrl: 'https://cdn/a.png' })

      await service.updatePreferences(userId, { avatarUrl: 'https://cdn/a.png' })

      expect(prisma.userPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { avatarUrl: 'https://cdn/a.png' },
          create: expect.objectContaining({ userId, avatarUrl: 'https://cdn/a.png' })
        })
      )
    })

    it('throws NotFoundException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(service.updatePreferences(userId, { locale: 'EN' })).rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.userPreference.upsert).not.toHaveBeenCalled()
    })

    it('wraps unexpected database errors in BadRequestException', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: userId })
      prisma.userPreference.upsert.mockRejectedValue(new Error('db down'))

      await expect(service.updatePreferences(userId, { locale: 'EN' })).rejects.toBeInstanceOf(BadRequestException)
      expect(logger.error).toHaveBeenCalled()
    })
  })
})
