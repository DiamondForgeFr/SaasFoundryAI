/**
 * Resources
 */
import { ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'

/**
 * Dependencies
 */
import { Logger } from '@common/services/logger/logger.service'
import { authenticatedUserInclude } from '@modules/auth/authenticated-user.include'
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard'
import { AuthService } from '@modules/auth/services/auth.service'

describe('authenticatedUserInclude', () => {
  it('loads what PermissionsGuard reads: modules, sections, permissions and the entity of each assignment', () => {
    const { roleAssignments } = authenticatedUserInclude

    expect(roleAssignments.where).toEqual({ role: { isActive: true } })
    expect(roleAssignments.include.entity).toEqual({ select: { id: true, accountId: true } })
    expect(Object.keys(roleAssignments.include.role.include)).toEqual(expect.arrayContaining(['modulesLinked', 'subModulesLinked', 'permissionsLinked']))
  })
})

describe('JwtAuthGuard (session refresh)', () => {
  const user = { id: 'user-1', roleAssignments: [] }
  const prisma = { user: { findUnique: jest.fn() } }
  const authService = {
    refreshTokens: jest.fn(),
    setAuthCookies: jest.fn(),
    decodeToken: jest.fn()
  }
  const moduleRef = { get: jest.fn((token: unknown) => (token === AuthService ? authService : prisma)) }
  const logger = { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() }

  const buildContext = (request: Record<string, unknown>): ExecutionContext => ({ switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }) }) as unknown as ExecutionContext

  const refresh = async (request: Record<string, unknown>) => {
    const guard = new JwtAuthGuard(moduleRef as unknown as ModuleRef, logger as unknown as Logger)
    await guard.onModuleInit()
    return (guard as unknown as { tryRefreshToken(context: ExecutionContext): Promise<boolean> }).tryRefreshToken(buildContext(request))
  }

  beforeEach(() => {
    jest.clearAllMocks()
    authService.refreshTokens.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' })
    authService.decodeToken.mockReturnValue({ sub: 'user-1' })
    prisma.user.findUnique.mockResolvedValue(user)
  })

  it('rebuilds request.user with the same include as a plain login, sections included', async () => {
    const request: Record<string, unknown> = { cookies: { refresh_token: 'token' }, ip: '127.0.0.1' }

    await expect(refresh(request)).resolves.toBe(true)

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' }, include: authenticatedUserInclude })
    expect(request.user).toBe(user)
  })

  it('refuses a refresh with no refresh token', async () => {
    await expect(refresh({ cookies: {}, ip: '127.0.0.1' })).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
