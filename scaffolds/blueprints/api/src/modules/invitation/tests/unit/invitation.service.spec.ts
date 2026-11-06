/**
 * Resources
 */
import { BadRequestException, ForbiddenException, NotFoundException, Provider, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Locale, TokenType } from '@/generated/prisma/client'

/**
 * Dependencies
 */
import { AccountAccessService } from '@common/services/account-access/account-access.service'
import { Logger } from '@common/services/logger/logger.service'
import { EnvConfig } from '@configs/env/services/env.service'
import { PrismaService } from '@configs/prisma/services/prisma.service'
import { AuthService } from '@modules/auth/services/auth.service'
import { EmailService } from '@modules/email/services/email.service'
import { InvitationService } from '@modules/invitation/services/invitation.service'

/**
 * Test infrastructure
 */
import { ServiceTestBase } from '@common/tests/unit/base/service-test-base'
import {
  fakePermissionChecker,
  mockAccountAccessService,
  mockAuthService,
  mockEmailService,
  mockEnvConfig,
  mockJwtService,
  mockLogger,
  mockPrismaService
} from '@common/tests/unit/mocks/service-mocks'
import { mockAccount, mockEntity, mockUser } from '@common/tests/unit/mocks/test-data'
import { MockManager, TestAssertions, TestScenario } from '@common/tests/unit/utils/advanced-test-utils'

/**
 * Test implementation using the new infrastructure
 */
class InvitationServiceTest extends ServiceTestBase<InvitationService> {
  private mockManager = new MockManager()
  private logger: jest.Mocked<Logger>
  private prismaService: jest.Mocked<PrismaService>
  private jwtService: jest.Mocked<JwtService>
  private envConfig: jest.Mocked<EnvConfig>
  private authService: jest.Mocked<AuthService>
  private accountAccessService: jest.Mocked<AccountAccessService>

  protected getServiceClass() {
    return InvitationService
  }

  protected getProviders(): Provider[] {
    return [
      { provide: PrismaService, useValue: mockPrismaService },
      { provide: JwtService, useValue: mockJwtService },
      { provide: Logger, useValue: mockLogger },
      { provide: EnvConfig, useValue: mockEnvConfig },
      { provide: EmailService, useValue: mockEmailService },
      { provide: AuthService, useValue: mockAuthService },
      { provide: AccountAccessService, useValue: mockAccountAccessService }
    ]
  }

  protected async customSetup(): Promise<void> {
    // Configure additional Prisma mocks with proper typing
    const prismaServiceAny = mockPrismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
    prismaServiceAny.userToken = {
      create: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn()
    }
    prismaServiceAny.invitation = {
      create: jest.fn().mockResolvedValue({ id: 'mock-invitation-id' }),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    }
    prismaServiceAny.invitationAccountLink = {
      createMany: jest.fn()
    }
    prismaServiceAny.invitationEntityLink = {
      createMany: jest.fn()
    }
    prismaServiceAny.invitationRoleLink = {
      createMany: jest.fn()
    }
    prismaServiceAny.user = {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    }
    prismaServiceAny.$transaction = jest.fn().mockImplementation(async (callback) => {
      if (typeof callback === 'function') {
        const tx = {
          ...mockPrismaService,
          invitation: {
            ...prismaServiceAny.invitation,
            updateMany: jest.fn().mockResolvedValue({ count: 1 })
          }
        }
        return await callback(tx)
      }
      return Promise.resolve(callback)
    })

    // Get service references
    this.logger = this.getService(Logger)
    this.prismaService = this.getService(PrismaService)
    this.jwtService = this.getService(JwtService)
    this.envConfig = this.getService(EnvConfig)
    this.authService = this.getService(AuthService)
    this.accountAccessService = this.getService(AccountAccessService)
  }

  /**
   * Test createInvitation functionality
   */
  testCreateInvitation(): void {
    describe('createInvitation', () => {
      const createInvitationDto = {
        email: 'invited@test.com',
        firstname: 'Invited',
        lastname: 'User',
        roleIds: [1],
        accountIds: [mockAccount.id],
        entityIds: [mockEntity.id],
        locale: Locale.FR
      }

      const mockInviter = {
        ...mockUser,
        people: {
          id: '1',
          firstname: 'Inviter',
          lastname: 'Admin'
        },
        roleAssignments: [
          {
            id: 'assignment-1',
            accountId: mockAccount.id,
            entityId: null,
            role: {
              id: 1,
              name: 'account-admin',
              scope: 'ACCOUNT',
              isSystem: true,
              permissionsLinked: [
                {
                  permission: { name: 'USER_ACCOUNTS_INVITATION' }
                },
                {
                  permission: { name: 'USER_ENTITIES_INVITATION' }
                },
                {
                  permission: { name: 'USER_ROLE_ALLOCATION' }
                }
              ],
              subModulesLinked: []
            }
          }
        ],
        accountsLinked: [
          {
            account: {
              id: mockAccount.id,
              isActive: true,
              entities: [
                {
                  id: mockEntity.id,
                  accountId: mockAccount.id,
                  isActive: true
                }
              ]
            }
          }
        ],
        entitiesLinked: []
      }

      const mockInvitationToken = 'mock.invitation.token'
      const mockUserTokenRecord = {
        id: '1',
        userId: '2',
        token: mockInvitationToken,
        type: TokenType.INVITATION,
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(),
        updatedAt: new Date()
      }

      describe('when successful', () => {
        const successScenario = TestScenario.create('successful creation', async () => {
          const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
          prismaServiceAny.user.findUnique
            .mockResolvedValueOnce(mockInviter) // For inviter
            .mockResolvedValueOnce(null) // For existing user check
          prismaServiceAny.user.create.mockResolvedValue({
            id: '2',
            email: createInvitationDto.email,
            isActive: false,
            password: ''
          })
          prismaServiceAny.userToken.create.mockResolvedValue(mockUserTokenRecord)
          prismaServiceAny.invitation.create.mockResolvedValue({ id: 'mock-invitation-id' })
          prismaServiceAny.invitationAccountLink.createMany.mockResolvedValue({ count: 1 })
          prismaServiceAny.invitationEntityLink.createMany.mockResolvedValue({ count: 1 })
          prismaServiceAny.invitationRoleLink.createMany.mockResolvedValue({ count: 1 })
          // Scoped-RBAC: roleIds are resolved to their scope/name for the platform-vs-account checks.
          prismaServiceAny.role.findMany.mockResolvedValue([{ id: 1, name: 'account-admin', scope: 'ACCOUNT' }])

          this.jwtService.sign.mockReturnValue(mockInvitationToken)
          this.envConfig.get.mockImplementation((key) => {
            const values = {
              JWT_SECRET_INVITATION: 'test-secret',
              JWT_INVITATION_EXPIRES_IN: '1d',
              NODE_ENV: 'test'
            }
            return values[key]
          })
          this.authService.createUniqueToken.mockResolvedValue(mockUserTokenRecord)
        })

        it('should create an invitation successfully', async () => {
          await successScenario.execute(async () => {
            // Act
            const result = await this.service.createInvitation(mockUser.id, createInvitationDto)

            // Assert
            expect(result).toEqual({
              message: expect.any(String),
              invitationToken: mockInvitationToken
            })

            // Verify
            const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
            expect(prismaServiceAny.user.findUnique).toHaveBeenCalledTimes(2)
            expect(this.jwtService.sign).toHaveBeenCalledWith(
              expect.objectContaining({
                email: createInvitationDto.email,
                sub: expect.any(String),
                firstname: createInvitationDto.firstname,
                lastname: createInvitationDto.lastname,
                locale: createInvitationDto.locale
              }),
              expect.any(Object)
            )
            expect(this.authService.createUniqueToken).toHaveBeenCalledWith(expect.any(String), mockInvitationToken, TokenType.INVITATION, '1d')

            // Verify that the invitation is created with the correct links
            expect(prismaServiceAny.invitation.create).toHaveBeenCalled()
            expect(prismaServiceAny.invitationAccountLink.createMany).toHaveBeenCalledWith({
              data: expect.arrayContaining([
                expect.objectContaining({
                  invitationId: 'mock-invitation-id',
                  accountId: mockAccount.id
                })
              ])
            })
            expect(prismaServiceAny.invitationEntityLink.createMany).toHaveBeenCalledWith({
              data: expect.arrayContaining([
                expect.objectContaining({
                  invitationId: 'mock-invitation-id',
                  entityId: mockEntity.id
                })
              ])
            })
            expect(prismaServiceAny.invitationRoleLink.createMany).toHaveBeenCalledWith({
              data: expect.arrayContaining([
                expect.objectContaining({
                  invitationId: 'mock-invitation-id',
                  roleId: 1
                })
              ])
            })
          })
        })

        it('should reuse existing inactive user', async () => {
          await successScenario.execute(async () => {
            // Arrange
            const existingInactiveUser = {
              id: '2',
              email: createInvitationDto.email,
              isActive: false,
              password: ''
            }
            const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
            prismaServiceAny.user.findUnique.mockReset()
            prismaServiceAny.user.findUnique
              .mockResolvedValueOnce(mockInviter) // For inviter
              .mockResolvedValueOnce(existingInactiveUser) // For existing user check

            // Act
            const result = await this.service.createInvitation(mockUser.id, createInvitationDto)

            // Assert
            expect(result).toEqual({
              message: expect.any(String),
              invitationToken: mockInvitationToken
            })

            // Verify - should not create a new user
            expect(prismaServiceAny.user.create).not.toHaveBeenCalled()
          })
        })

        it('should not create new user for existing active user', async () => {
          await successScenario.execute(async () => {
            // Arrange
            const existingActiveUser = {
              id: '2',
              email: createInvitationDto.email,
              isActive: true,
              password: 'hashed-password'
            }
            const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
            prismaServiceAny.user.findUnique.mockReset()
            prismaServiceAny.user.findUnique
              .mockResolvedValueOnce(mockInviter) // For inviter
              .mockResolvedValueOnce(existingActiveUser) // For existing user check

            // Act
            const result = await this.service.createInvitation(mockUser.id, createInvitationDto)

            // Assert
            expect(result).toEqual({
              message: expect.any(String)
            })

            // Verify - should not create a new user or token
            expect(prismaServiceAny.user.create).not.toHaveBeenCalled()
            expect(this.jwtService.sign).not.toHaveBeenCalled()
          })
        })
      })

      describe('when errors occur', () => {
        it('should throw BadRequestException if no account or entity IDs are provided', async () => {
          // Arrange — inviter resolves but the invitation has no targets and no platform-scoped role,
          // so it is treated as an account-owner invitation. With pre-assigned roles this is rejected.
          const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
          prismaServiceAny.user.findUnique.mockResolvedValueOnce(mockInviter)
          prismaServiceAny.role.findMany.mockResolvedValue([{ id: 1, name: 'account-admin', scope: 'ACCOUNT' }])

          // Act & Assert
          await TestAssertions.assertThrows(() => this.service.createInvitation(mockUser.id, { ...createInvitationDto, accountIds: [], entityIds: [] }), BadRequestException)
        })

        it('should throw NotFoundException if inviter is not found', async () => {
          // Arrange
          const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
          prismaServiceAny.user.findUnique.mockResolvedValueOnce(null) // Inviter not found

          // Act & Assert
          await TestAssertions.assertThrows(() => this.service.createInvitation(mockUser.id, createInvitationDto), NotFoundException)
        })

        it('should throw UnauthorizedException if user lacks required permissions', async () => {
          // Arrange
          const inviterWithoutPermissions = {
            ...mockInviter,
            roleAssignments: [
              {
                id: 'assignment-1',
                accountId: mockAccount.id,
                entityId: null,
                role: {
                  id: 1,
                  name: 'viewer',
                  scope: 'ACCOUNT',
                  isSystem: false,
                  permissionsLinked: [],
                  subModulesLinked: []
                }
              }
            ]
          }
          const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
          prismaServiceAny.user.findUnique.mockResolvedValueOnce(inviterWithoutPermissions)
          prismaServiceAny.role.findMany.mockResolvedValue([{ id: 1, name: 'account-admin', scope: 'ACCOUNT' }])

          // Act & Assert
          await TestAssertions.assertThrows(() => this.service.createInvitation(mockUser.id, createInvitationDto), UnauthorizedException)
        })

        it('should throw UnauthorizedException if user lacks access to specified accounts', async () => {
          // Arrange
          const inviterWithLimitedAccess = {
            ...mockInviter,
            accountsLinked: []
          }
          const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
          prismaServiceAny.user.findUnique.mockResolvedValueOnce(inviterWithLimitedAccess)
          prismaServiceAny.role.findMany.mockResolvedValue([{ id: 1, name: 'account-admin', scope: 'ACCOUNT' }])

          // Act & Assert
          await TestAssertions.assertThrows(() => this.service.createInvitation(mockUser.id, createInvitationDto), UnauthorizedException)
        })

        it('should handle database error gracefully', async () => {
          // Arrange
          const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
          prismaServiceAny.user.findUnique.mockResolvedValueOnce(mockInviter)
          prismaServiceAny.user.findUnique.mockRejectedValueOnce(new Error('Database error'))

          // Act & Assert
          await TestAssertions.assertThrows(() => this.service.createInvitation(mockUser.id, createInvitationDto), BadRequestException)

          // Verify
          expect(this.logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to create invitation'), 'createInvitation')
        })
      })

      describe('scoped authority (per target)', () => {
        const ACCOUNT_ROLE = { id: 1, name: 'account-admin', scope: 'ACCOUNT', accountId: null }
        const ENTITY_ROLE = { id: 3, name: 'entity-admin', scope: 'ENTITY', accountId: null }
        const PLATFORM_ROLE = { id: 9, name: 'platform-admin', scope: 'PLATFORM', accountId: null }
        const OTHER_ACCOUNT = 'another-account'
        const OTHER_ENTITY = 'another-entity'

        /** A member of two accounts (and of their entities): the membership check lets both through, only the scoped checks decide. */
        const memberOfBothAccounts = {
          ...mockInviter,
          accountsLinked: [
            { account: { id: mockAccount.id, isActive: true, entities: [{ id: mockEntity.id, accountId: mockAccount.id, isActive: true }] } },
            { account: { id: OTHER_ACCOUNT, isActive: true, entities: [{ id: OTHER_ENTITY, accountId: OTHER_ACCOUNT, isActive: true }] } }
          ]
        }

        interface Given {
          roles: { id: number; name: string; scope: string; accountId: string | null }[]
          /** Permissions the inviter does not hold in any scope (the checker refuses them). */
          denied?: string[]
          /** The account each entity belongs to. */
          entityAccounts?: Record<string, string>
          inviter?: object
          /** The pending (SENT) invitation of the address, when there is one. */
          pending?: { accountIds?: string[]; entityIds?: string[]; roleIds?: number[] }
        }

        /** Resolve the inviter, the roles, the pending invitation and the permission checker of one request. */
        const given = (options: Given) => {
          const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
          const checker = fakePermissionChecker({ denied: options.denied, entityAccounts: options.entityAccounts })
          prismaServiceAny.user.findUnique.mockResolvedValueOnce(options.inviter ?? mockInviter).mockResolvedValueOnce(null)
          prismaServiceAny.role.findMany.mockResolvedValue(options.roles)
          prismaServiceAny.invitation.findFirst.mockReset()
          prismaServiceAny.invitation.findFirst.mockResolvedValue(
            options.pending
              ? {
                  accountsLinked: (options.pending.accountIds ?? []).map((accountId) => ({ accountId })),
                  entitiesLinked: (options.pending.entityIds ?? []).map((entityId) => ({ entityId })),
                  rolesLinked: (options.pending.roleIds ?? []).map((roleId) => ({ roleId }))
                }
              : null
          )
          prismaServiceAny.invitationAccountLink.createMany.mockReset()
          prismaServiceAny.invitationEntityLink.createMany.mockReset()
          prismaServiceAny.invitationRoleLink.createMany.mockReset()
          prismaServiceAny.invitation.create.mockClear()
          this.accountAccessService.isPlatformAdmin.mockReset()
          this.accountAccessService.isPlatformAdmin.mockResolvedValue(false)
          this.accountAccessService.getPermissionChecker.mockReset()
          this.accountAccessService.getPermissionChecker.mockResolvedValue(checker as never)
          this.jwtService.sign.mockReturnValue(mockInvitationToken)
          this.envConfig.get.mockImplementation((key) => ({ JWT_SECRET_INVITATION: 'test-secret', JWT_INVITATION_EXPIRES_IN: '1d', NODE_ENV: 'test' })[key])
          prismaServiceAny.user.create.mockResolvedValue({ id: '2', email: createInvitationDto.email, isActive: false, password: '' })
          this.authService.createUniqueToken.mockResolvedValue(mockUserTokenRecord)
          return { prisma: prismaServiceAny, checker }
        }

        /** An inviter who holds every invitation right except role allocation. */
        const inviterWithoutAllocation = {
          ...mockInviter,
          roleAssignments: [
            {
              ...mockInviter.roleAssignments[0],
              role: {
                ...mockInviter.roleAssignments[0].role,
                permissionsLinked: mockInviter.roleAssignments[0].role.permissionsLinked.filter((link) => link.permission.name !== 'USER_ROLE_ALLOCATION')
              }
            }
          ]
        }

        it('checks USER_ACCOUNTS_INVITATION in the scope of every target account and answers 403 when it is missing', async () => {
          const { checker } = given({ roles: [ACCOUNT_ROLE], denied: ['USER_ACCOUNTS_INVITATION'] })

          await TestAssertions.assertThrows(() => this.service.createInvitation(mockUser.id, { ...createInvitationDto, entityIds: [] }), ForbiddenException)

          expect(checker.assert).toHaveBeenCalledWith('USER_ACCOUNTS_INVITATION', { kind: 'ACCOUNT', accountId: mockAccount.id }, expect.any(String))
        })

        it('checks USER_ENTITIES_INVITATION in the scope of every target entity and answers 403 when it is missing', async () => {
          const { checker } = given({ roles: [ENTITY_ROLE], denied: ['USER_ENTITIES_INVITATION'] })

          await TestAssertions.assertThrows(() => this.service.createInvitation(mockUser.id, { ...createInvitationDto, accountIds: [], roleIds: [3] }), ForbiddenException)

          expect(checker.assert).toHaveBeenCalledWith('USER_ENTITIES_INVITATION', { kind: 'ENTITY', entityId: mockEntity.id }, expect.any(String))
        })

        it('checks USER_ROLE_ALLOCATION on the target accounts for an ACCOUNT role and answers 403 when it is missing', async () => {
          const { checker } = given({ roles: [ACCOUNT_ROLE], denied: ['USER_ROLE_ALLOCATION'], entityAccounts: { [mockEntity.id]: mockAccount.id } })

          await TestAssertions.assertThrows(() => this.service.createInvitation(mockUser.id, { ...createInvitationDto, entityIds: [] }), ForbiddenException)

          expect(checker.assert).toHaveBeenCalledWith('USER_ROLE_ALLOCATION', { kind: 'ACCOUNT', accountId: mockAccount.id }, expect.any(String))
        })

        it('checks USER_ROLE_ALLOCATION in the target entities for an ENTITY role and answers 403 when it is missing', async () => {
          const { checker } = given({ roles: [ENTITY_ROLE], denied: ['USER_ROLE_ALLOCATION'], entityAccounts: { [mockEntity.id]: mockAccount.id } })

          await TestAssertions.assertThrows(() => this.service.createInvitation(mockUser.id, { ...createInvitationDto, accountIds: [], roleIds: [3] }), ForbiddenException)

          expect(checker.assert).toHaveBeenCalledWith('USER_ROLE_ALLOCATION', { kind: 'ENTITY', entityId: mockEntity.id }, expect.any(String))
        })

        it('keeps an entity-only inviter from granting an ACCOUNT role through an entity invitation', async () => {
          const { checker } = given({ roles: [ACCOUNT_ROLE], denied: ['USER_ROLE_ALLOCATION'], entityAccounts: { [mockEntity.id]: mockAccount.id } })

          await TestAssertions.assertThrows(() => this.service.createInvitation(mockUser.id, { ...createInvitationDto, accountIds: [] }), ForbiddenException)

          expect(checker.assert).toHaveBeenCalledWith('USER_ROLE_ALLOCATION', { kind: 'ACCOUNT', accountId: mockAccount.id }, expect.any(String))
        })

        it('lets an ENTITY-authority inviter grant an ENTITY role in its entity', async () => {
          given({ roles: [ENTITY_ROLE], entityAccounts: { [mockEntity.id]: mockAccount.id } })

          const result = await this.service.createInvitation(mockUser.id, { ...createInvitationDto, accountIds: [], roleIds: [3] })

          expect(result.message).toEqual(expect.any(String))
        })

        describe('role ownership (per role, per target it lands on)', () => {
          it('refuses an ACCOUNT role owned by another account (403)', async () => {
            given({ roles: [{ ...ACCOUNT_ROLE, accountId: OTHER_ACCOUNT }], entityAccounts: { [mockEntity.id]: mockAccount.id } })

            await TestAssertions.assertThrows(() => this.service.createInvitation(mockUser.id, { ...createInvitationDto, entityIds: [] }), ForbiddenException)
          })

          it('refuses an ACCOUNT role of account A when ONE of the target accounts is B (it would land on B too)', async () => {
            given({ roles: [{ ...ACCOUNT_ROLE, accountId: mockAccount.id }], inviter: memberOfBothAccounts })

            await TestAssertions.assertThrows(
              () => this.service.createInvitation(mockUser.id, { ...createInvitationDto, accountIds: [mockAccount.id, OTHER_ACCOUNT], entityIds: [] }),
              ForbiddenException
            )
          })

          it('refuses an ENTITY role of account A when ONE of the target entities belongs to B', async () => {
            given({ roles: [{ ...ENTITY_ROLE, accountId: mockAccount.id }], inviter: memberOfBothAccounts, entityAccounts: { [mockEntity.id]: mockAccount.id, [OTHER_ENTITY]: OTHER_ACCOUNT } })

            await TestAssertions.assertThrows(
              () => this.service.createInvitation(mockUser.id, { ...createInvitationDto, accountIds: [], entityIds: [mockEntity.id, OTHER_ENTITY], roleIds: [3] }),
              ForbiddenException
            )
          })

          it('accepts an ACCOUNT role owned by the only target account', async () => {
            given({ roles: [{ ...ACCOUNT_ROLE, accountId: mockAccount.id }], entityAccounts: { [mockEntity.id]: mockAccount.id } })

            const result = await this.service.createInvitation(mockUser.id, { ...createInvitationDto, entityIds: [] })

            expect(result.message).toEqual(expect.any(String))
          })

          it('accepts an ENTITY role owned by the account of every target entity', async () => {
            given({ roles: [{ ...ENTITY_ROLE, accountId: mockAccount.id }], entityAccounts: { [mockEntity.id]: mockAccount.id } })

            const result = await this.service.createInvitation(mockUser.id, { ...createInvitationDto, accountIds: [], roleIds: [3] })

            expect(result.message).toEqual(expect.any(String))
          })
        })

        describe('re-invitation (carried-over targets and roles)', () => {
          it('authorizes the roles carried over from a pending invitation: no role allocation right, no admin role (401)', async () => {
            const { prisma } = given({ roles: [ACCOUNT_ROLE], inviter: inviterWithoutAllocation, pending: { accountIds: [mockAccount.id], roleIds: [1] } })

            await TestAssertions.assertThrows(() => this.service.createInvitation(mockUser.id, { ...createInvitationDto, roleIds: [], entityIds: [] }), UnauthorizedException)

            expect(prisma.invitation.create).not.toHaveBeenCalled()
            expect(prisma.invitationRoleLink.createMany).not.toHaveBeenCalled()
          })

          it('authorizes the targets carried over from a pending invitation in their own scope (403)', async () => {
            // The inviter is a plain member of the entity (the membership check passes): only its scoped right is missing.
            const memberOfOtherEntity = {
              ...mockInviter,
              accountsLinked: [{ account: { id: mockAccount.id, isActive: true, entities: [{ id: OTHER_ENTITY, accountId: mockAccount.id, isActive: true }] } }]
            }
            const { prisma, checker } = given({
              roles: [ENTITY_ROLE],
              denied: ['USER_ENTITIES_INVITATION'],
              inviter: memberOfOtherEntity,
              pending: { entityIds: [OTHER_ENTITY], roleIds: [3] },
              entityAccounts: { [OTHER_ENTITY]: OTHER_ACCOUNT }
            })

            await TestAssertions.assertThrows(() => this.service.createInvitation(mockUser.id, { ...createInvitationDto, roleIds: [], entityIds: [] }), ForbiddenException)

            expect(checker.assert).toHaveBeenCalledWith('USER_ENTITIES_INVITATION', { kind: 'ENTITY', entityId: OTHER_ENTITY }, expect.any(String))
            expect(prisma.invitationEntityLink.createMany).not.toHaveBeenCalled()
          })

          it('creates the merged invitation when the inviter is authorized for every carried-over id', async () => {
            const { prisma } = given({ roles: [ACCOUNT_ROLE], pending: { accountIds: [mockAccount.id], roleIds: [1] } })

            await this.service.createInvitation(mockUser.id, { ...createInvitationDto, roleIds: [], entityIds: [], accountIds: [] })

            expect(prisma.invitationAccountLink.createMany).toHaveBeenCalledWith({ data: [{ invitationId: 'mock-invitation-id', accountId: mockAccount.id }] })
            expect(prisma.invitationRoleLink.createMany).toHaveBeenCalledWith({ data: [{ invitationId: 'mock-invitation-id', roleId: 1 }] })
          })

          it('does not look at a pending invitation when the request carries every list itself', async () => {
            const { prisma } = given({ roles: [ACCOUNT_ROLE], pending: { entityIds: [OTHER_ENTITY] } })

            await this.service.createInvitation(mockUser.id, createInvitationDto)

            expect(prisma.invitation.findFirst).not.toHaveBeenCalled()
            expect(prisma.invitationEntityLink.createMany).toHaveBeenCalledWith({ data: [{ invitationId: 'mock-invitation-id', entityId: mockEntity.id }] })
          })
        })

        describe('cost does not grow with the ids (deduplicated, one checker)', () => {
          it('treats a repeated id as one target: one check, one link', async () => {
            const { prisma, checker } = given({ roles: [ACCOUNT_ROLE], entityAccounts: { [mockEntity.id]: mockAccount.id } })

            await this.service.createInvitation(mockUser.id, {
              ...createInvitationDto,
              accountIds: [mockAccount.id, mockAccount.id, mockAccount.id],
              entityIds: [mockEntity.id, mockEntity.id],
              roleIds: [1, 1]
            })

            expect(checker.assert.mock.calls.filter(([permission]) => permission === 'USER_ACCOUNTS_INVITATION')).toHaveLength(1)
            expect(checker.assert.mock.calls.filter(([permission]) => permission === 'USER_ENTITIES_INVITATION')).toHaveLength(1)
            expect(prisma.invitationAccountLink.createMany).toHaveBeenCalledWith({ data: [{ invitationId: 'mock-invitation-id', accountId: mockAccount.id }] })
            expect(prisma.invitationEntityLink.createMany).toHaveBeenCalledWith({ data: [{ invitationId: 'mock-invitation-id', entityId: mockEntity.id }] })
            expect(prisma.invitationRoleLink.createMany).toHaveBeenCalledWith({ data: [{ invitationId: 'mock-invitation-id', roleId: 1 }] })
          })

          it('loads the inviter assignments and resolves the entities once, however many targets there are', async () => {
            const entityIds = Array.from({ length: 30 }, (_, index) => `entity-${index}`)
            const accountIds = Array.from({ length: 5 }, (_, index) => `account-${index}`)
            const inviter = {
              ...mockInviter,
              accountsLinked: accountIds.map((id) => ({ account: { id, isActive: true, entities: entityIds.map((entityId) => ({ id: entityId, accountId: id, isActive: true })) } }))
            }
            given({ roles: [ACCOUNT_ROLE], inviter })

            await this.service.createInvitation(mockUser.id, { ...createInvitationDto, accountIds, entityIds, roleIds: [] })

            expect(this.accountAccessService.getPermissionChecker).toHaveBeenCalledTimes(1)
            expect(this.accountAccessService.getPermissionChecker).toHaveBeenCalledWith(mockUser.id, entityIds)
            expect(this.accountAccessService.assertPermissionInScope).not.toHaveBeenCalled()
            expect(this.accountAccessService.hasPermissionInScope).not.toHaveBeenCalled()
          })
        })

        it('does not take a role that merely carries the platform section for a platform admin (stays 401)', async () => {
          const sectionHolder = {
            ...mockInviter,
            roleAssignments: [
              {
                ...mockInviter.roleAssignments[0],
                role: { ...mockInviter.roleAssignments[0].role, subModulesLinked: [{ subModule: { name: 'PLATFORM_ACCOUNTS' } }] }
              }
            ]
          }
          given({ roles: [PLATFORM_ROLE], inviter: sectionHolder })

          await TestAssertions.assertThrows(() => this.service.createInvitation(mockUser.id, { ...createInvitationDto, accountIds: [], entityIds: [], roleIds: [9] }), UnauthorizedException)

          expect(this.accountAccessService.isPlatformAdmin).toHaveBeenCalledWith(mockUser.id)
        })

        it('lets a real platform admin assign a PLATFORM role', async () => {
          const { prisma } = given({ roles: [PLATFORM_ROLE] })
          this.accountAccessService.isPlatformAdmin.mockResolvedValue(true)

          const result = await this.service.createInvitation(mockUser.id, { ...createInvitationDto, accountIds: [], entityIds: [], roleIds: [9] })

          expect(result.message).toEqual(expect.any(String))
          expect(prisma.invitation.create).toHaveBeenCalled()
        })
      })
    })
  }

  /**
   * Test acceptInvitation functionality
   */
  testAcceptInvitation(): void {
    describe('acceptInvitation', () => {
      const acceptInvitationDto = {
        invitationToken: 'mock.invitation.token',
        password: 'NewSecurePassword123',
        firstname: 'Invited',
        lastname: 'User',
        locale: Locale.FR
      }

      const mockTokenPayload = {
        email: 'invited@test.com',
        sub: '2',
        firstname: 'Invited',
        lastname: 'User',
        roleIds: [1],
        accountIds: [mockAccount.id],
        entityIds: [mockEntity.id],
        locale: Locale.FR
      }

      const mockInvitation = {
        id: 'invitation-1',
        inviterUserId: '1',
        inviteeUserEmail: 'invited@test.com',
        status: 'SENT',
        accountsLinked: [{ accountId: mockAccount.id }],
        entitiesLinked: [{ entityId: mockEntity.id }],
        rolesLinked: [{ roleId: 1 }]
      }

      const mockUserProfile = {
        id: '2',
        email: mockTokenPayload.email,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        peopleId: null,
        password: 'hashed-password',
        lastLoginAt: null
      }

      describe('when successful', () => {
        const successScenario = TestScenario.create('successful acceptance', async () => {
          this.jwtService.verify.mockReturnValue(mockTokenPayload)
          const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
          prismaServiceAny.userToken.findFirst.mockResolvedValue({
            id: '1',
            userId: '2',
            token: acceptInvitationDto.invitationToken,
            type: TokenType.INVITATION,
            expiresAt: new Date(Date.now() + 86400000),
            user: {
              id: '2',
              email: mockTokenPayload.email,
              isActive: false,
              password: ''
            }
          })
          prismaServiceAny.invitation.findFirst.mockResolvedValue(mockInvitation)
          // Scoped-RBAC: role scopes are resolved both in acceptInvitation and activateInvitedUserAccount.
          prismaServiceAny.role.findMany.mockResolvedValue([{ id: 1, scope: 'ACCOUNT' }])
          prismaServiceAny.user.findUnique.mockResolvedValue({
            id: '2',
            email: mockTokenPayload.email,
            isActive: false,
            password: ''
          })
          prismaServiceAny.user.update.mockResolvedValue({
            id: '2',
            email: mockTokenPayload.email,
            isActive: true,
            password: 'hashed-password'
          })
          prismaServiceAny.invitation.update.mockResolvedValue({
            ...mockInvitation,
            status: 'ACCEPTED',
            inviteeUserId: '2',
            acceptedAt: new Date()
          })
          prismaServiceAny.userToken.delete.mockResolvedValue({ id: '1' })

          this.authService.generateTokens.mockResolvedValue({
            accessToken: 'mock.access.token',
            refreshToken: 'mock.refresh.token'
          })
          this.authService.createAndActivateUserProfile.mockResolvedValue(mockUserProfile)
        })

        it('should accept invitation successfully', async () => {
          await successScenario.execute(async () => {
            // Act
            const result = await this.service.acceptInvitation(acceptInvitationDto)

            // Assert
            expect(result).toEqual({
              userId: '2',
              accessToken: 'mock.access.token',
              refreshToken: 'mock.refresh.token'
            })

            // Verify
            expect(this.jwtService.verify).toHaveBeenCalledWith(acceptInvitationDto.invitationToken, expect.any(Object))
            const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
            expect(prismaServiceAny.user.update).toHaveBeenCalled()
            expect(this.authService.generateTokens).toHaveBeenCalledWith(
              expect.objectContaining({
                id: '2',
                email: mockTokenPayload.email
              })
            )

            // Verify that the invitation is updated to ACCEPTED status
            expect(prismaServiceAny.invitation.update).toHaveBeenCalledWith({
              where: { id: mockInvitation.id },
              data: expect.objectContaining({
                status: 'ACCEPTED',
                inviteeUserId: '2',
                acceptedAt: expect.any(Date)
              })
            })

            // Verify that the token is deleted after use
            expect(prismaServiceAny.userToken.delete).toHaveBeenCalledWith({
              where: { id: '1' }
            })
          })
        })
      })

      describe('when errors occur', () => {
        it('should throw UnauthorizedException if token is invalid', async () => {
          // Arrange
          this.jwtService.verify.mockImplementation(() => {
            throw new Error('Invalid token')
          })

          // Act & Assert
          await TestAssertions.assertThrows(() => this.service.acceptInvitation(acceptInvitationDto), UnauthorizedException)
        })

        it('should throw NotFoundException if token is not found in database', async () => {
          // Arrange
          this.jwtService.verify.mockReturnValue(mockTokenPayload)
          const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
          prismaServiceAny.userToken.findFirst.mockResolvedValue(null)

          // Act & Assert
          await TestAssertions.assertThrows(() => this.service.acceptInvitation(acceptInvitationDto), NotFoundException)
        })

        it('should throw NotFoundException if invitation is not found', async () => {
          // Arrange
          this.jwtService.verify.mockReturnValue(mockTokenPayload)
          const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
          prismaServiceAny.userToken.findFirst.mockResolvedValue({
            id: '1',
            userId: '2',
            token: acceptInvitationDto.invitationToken,
            type: TokenType.INVITATION,
            expiresAt: new Date(Date.now() + 86400000),
            user: {
              id: '2',
              email: mockTokenPayload.email,
              isActive: false,
              password: ''
            }
          })
          prismaServiceAny.invitation.findFirst.mockResolvedValue(null)

          // Act & Assert
          await TestAssertions.assertThrows(() => this.service.acceptInvitation(acceptInvitationDto), NotFoundException)
        })

        it('should throw BadRequestException if user is not found', async () => {
          // Arrange
          this.jwtService.verify.mockReturnValue(mockTokenPayload)
          const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
          prismaServiceAny.userToken.findFirst.mockResolvedValue({
            id: '1',
            userId: '2',
            token: acceptInvitationDto.invitationToken,
            type: TokenType.INVITATION,
            expiresAt: new Date(Date.now() + 86400000),
            user: null
          })
          prismaServiceAny.invitation.findFirst.mockResolvedValue(mockInvitation)
          prismaServiceAny.user.findUnique.mockResolvedValue(null)

          // Act & Assert
          await TestAssertions.assertThrows(() => this.service.acceptInvitation(acceptInvitationDto), BadRequestException)
          expect(this.logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to accept invitation'), 'acceptInvitation')
        })

        it('should handle database error gracefully', async () => {
          // Arrange
          this.jwtService.verify.mockReturnValue(mockTokenPayload)
          const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
          prismaServiceAny.userToken.findFirst.mockResolvedValue({
            id: '1',
            userId: '2',
            token: acceptInvitationDto.invitationToken,
            type: TokenType.INVITATION,
            expiresAt: new Date(Date.now() + 86400000),
            user: {
              id: '2',
              email: mockTokenPayload.email,
              isActive: false,
              password: ''
            }
          })
          prismaServiceAny.invitation.findFirst.mockResolvedValue(mockInvitation)
          prismaServiceAny.user.findUnique.mockResolvedValue({
            id: '2',
            email: mockTokenPayload.email,
            isActive: false,
            password: ''
          })
          prismaServiceAny.user.update.mockRejectedValue(new Error('Database error'))

          // Act & Assert
          await TestAssertions.assertThrows(() => this.service.acceptInvitation(acceptInvitationDto), BadRequestException)

          // Verify
          expect(this.logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to accept invitation'), 'acceptInvitation')
        })
      })
    })
  }

  /**
   * Test getUserInvitations functionality
   */
  testGetUserInvitations(): void {
    describe('getUserInvitations', () => {
      const userId = mockUser.id
      const mockInvitations = [
        {
          id: '1',
          inviterUserId: userId,
          inviteeUserId: null,
          inviteeUserEmail: 'invited1@test.com',
          status: 'SENT',
          invitedAt: new Date(),
          acceptedAt: null,
          accountsLinked: [
            {
              account: {
                id: mockAccount.id,
                name: 'Test Account'
              }
            }
          ],
          entitiesLinked: [
            {
              entity: {
                id: mockEntity.id,
                name: 'Test Entity'
              }
            }
          ],
          rolesLinked: [
            {
              role: {
                id: 1,
                name: 'User'
              }
            }
          ]
        },
        {
          id: '2',
          inviterUserId: userId,
          inviteeUserId: 'user-2',
          inviteeUserEmail: 'invited2@test.com',
          status: 'ACCEPTED',
          invitedAt: new Date(Date.now() - 86400000), // 1 day ago
          acceptedAt: new Date(),
          accountsLinked: [
            {
              account: {
                id: mockAccount.id,
                name: 'Test Account'
              }
            }
          ],
          entitiesLinked: [],
          rolesLinked: [
            {
              role: {
                id: 1,
                name: 'User'
              }
            }
          ]
        }
      ]

      describe('when successful', () => {
        const successScenario = TestScenario.create('successful fetch', async () => {
          const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
          prismaServiceAny.invitation.findMany.mockResolvedValue(mockInvitations)
        })

        it('should return all invitations sent by a user', async () => {
          await successScenario.execute(async () => {
            // Act
            const result = await this.service.getUserInvitations(userId)

            // Assert
            expect(result).toEqual({
              invitations: expect.arrayContaining([
                expect.objectContaining({
                  id: '1',
                  inviterUserId: userId,
                  inviteeUserEmail: 'invited1@test.com',
                  status: 'SENT'
                }),
                expect.objectContaining({
                  id: '2',
                  inviterUserId: userId,
                  inviteeUserId: 'user-2',
                  inviteeUserEmail: 'invited2@test.com',
                  status: 'ACCEPTED'
                })
              ])
            })

            // Verify
            const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
            expect(prismaServiceAny.invitation.findMany).toHaveBeenCalledWith({
              where: {
                inviterUserId: userId,
                status: {
                  not: 'CANCELED'
                }
              },
              include: {
                accountsLinked: {
                  include: {
                    account: true
                  }
                },
                entitiesLinked: {
                  include: {
                    entity: { include: { organization: true } }
                  }
                },
                rolesLinked: {
                  include: {
                    role: true
                  }
                }
              },
              orderBy: { invitedAt: 'desc' }
            })
          })
        })
      })

      describe('when no invitations', () => {
        const noInvitationsScenario = TestScenario.create('no invitations', async () => {
          const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
          prismaServiceAny.invitation.findMany.mockResolvedValue([])
        })

        it('should return empty array when user has no invitations', async () => {
          await noInvitationsScenario.execute(async () => {
            // Act
            const result = await this.service.getUserInvitations(userId)

            // Assert
            expect(result).toEqual({ invitations: [] })
          })
        })
      })

      describe('when database error occurs', () => {
        const databaseErrorScenario = TestScenario.create('database error', async () => {
          const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
          prismaServiceAny.invitation.findMany.mockRejectedValue(new Error('Database error'))
        })

        it('should handle database error gracefully', async () => {
          await databaseErrorScenario.execute(async () => {
            // Act & Assert
            await TestAssertions.assertThrows(() => this.service.getUserInvitations(userId), Error)

            // Verify
            const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
            expect(prismaServiceAny.invitation.findMany).toHaveBeenCalledWith({
              where: {
                inviterUserId: userId,
                status: {
                  not: 'CANCELED'
                }
              },
              include: {
                accountsLinked: {
                  include: {
                    account: true
                  }
                },
                entitiesLinked: {
                  include: {
                    entity: { include: { organization: true } }
                  }
                },
                rolesLinked: {
                  include: {
                    role: true
                  }
                }
              },
              orderBy: { invitedAt: 'desc' }
            })
          })
        })
      })
    })
  }
}

// Execute the tests
describe('InvitationService (Refactored)', () => {
  const invitationServiceTest = new InvitationServiceTest()

  beforeEach(async () => {
    await invitationServiceTest.setupTest()
  })

  afterEach(async () => {
    await invitationServiceTest.cleanupTest()
  })

  // Run all test suites
  invitationServiceTest.testCreateInvitation()
  invitationServiceTest.testAcceptInvitation()
  invitationServiceTest.testGetUserInvitations()
})
