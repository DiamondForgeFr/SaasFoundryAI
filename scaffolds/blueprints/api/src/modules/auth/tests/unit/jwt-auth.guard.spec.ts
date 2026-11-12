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

/**
 * Type
 */
import type { AuthenticatedUser } from '@common/types/authenticated-request.type'

/**
 * Compile-time guard: `entity` is REQUIRED on an assignment of the authenticated user. If it were optional, a project
 * whose own `jwt.strategy.ts` does not load it would still compile and every entity admin would silently lose its
 * rights on the account routes until the next token refresh. Required, the stale strategy fails `tsc`. This line
 * stops compiling (so the suite fails) the day `entity` becomes optional again.
 */
type AssignmentOfAuthenticatedUser = AuthenticatedUser['roleAssignments'][number]
const entityIsRequired: Record<never, never> extends Pick<AssignmentOfAuthenticatedUser, 'entity'> ? never : true = true

describe('authenticatedUserInclude', () => {
  it('keeps `entity` required on the authenticated user (a stale strategy must fail tsc)', () => {
    expect(entityIsRequired).toBe(true)
  })

  it('loads what PermissionsGuard reads: modules, sections, permissions and the entity of each assignment', () => {
    const { roleAssignments } = authenticatedUserInclude

    expect(roleAssignments.where).toEqual({ role: { isActive: true } })
    expect(roleAssignments.include.entity).toEqual({ select: { id: true, accountId: true } })
    expect(Object.keys(roleAssignments.include.role.include)).toEqual(expect.arrayContaining(['modulesLinked', 'subModulesLinked', 'permissionsLinked']))
  })
})

describe('JwtAuthGuard (session refresh)', () => {
  const user = { id: 'user-1', isActive: true, roleAssignments: [] }
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

  it('refuses the session of a deactivated user when the refresh path refuses it', async () => {
    authService.refreshTokens.mockRejectedValue(new UnauthorizedException('User is inactive'))
    const request: Record<string, unknown> = { cookies: { refresh_token: 'token' }, ip: '127.0.0.1' }

    await expect(refresh(request)).rejects.toBeInstanceOf(UnauthorizedException)

    expect(authService.setAuthCookies).not.toHaveBeenCalled()
    expect(request.user).toBeUndefined()
  })

  it('refuses a user deactivated between the refresh and the read of request.user', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...user, isActive: false })
    const request: Record<string, unknown> = { cookies: { refresh_token: 'token' }, ip: '127.0.0.1' }

    await expect(refresh(request)).rejects.toBeInstanceOf(UnauthorizedException)

    expect(request.user).toBeUndefined()
  })

  it('refuses a refresh with no refresh token', async () => {
    await expect(refresh({ cookies: {}, ip: '127.0.0.1' })).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
