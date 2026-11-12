/**
 * Resources
 */
import { UnauthorizedException } from '@nestjs/common'

/**
 * Dependencies
 */
import { Logger } from '@common/services/logger/logger.service'
import { EnvConfig } from '@configs/env/services/env.service'
import { PrismaService } from '@configs/prisma/services/prisma.service'
import { authenticatedUserInclude } from '@modules/auth/authenticated-user.include'
import { JwtStrategy } from '@modules/auth/strategies/jwt.strategy'

describe('JwtStrategy.validate (access token)', () => {
  const prisma = { user: { findUnique: jest.fn() } }
  const env = { get: jest.fn().mockReturnValue('auth-secret') }
  const logger = { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() }
  const payload = { sub: 'user-1', email: 'user@example.com' }

  const strategy = () => new JwtStrategy(env as unknown as EnvConfig, prisma as unknown as PrismaService, logger as unknown as Logger)

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns the active user with the shared authenticated include', async () => {
    const user = { id: 'user-1', isActive: true, roleAssignments: [] }
    prisma.user.findUnique.mockResolvedValue(user)

    await expect(strategy().validate(payload)).resolves.toBe(user)
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' }, include: authenticatedUserInclude })
  })

  it('refuses the access token of a deactivated user', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', isActive: false, roleAssignments: [] })

    await expect(strategy().validate(payload)).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('refuses the access token of a deleted user', async () => {
    prisma.user.findUnique.mockResolvedValue(null)

    await expect(strategy().validate(payload)).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
