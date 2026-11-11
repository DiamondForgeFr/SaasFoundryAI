/**
 * Refactored unit tests for AccountService using the new testing infrastructure
 * This demonstrates how to use the base classes and utilities for cleaner, more maintainable tests
 */

import { BadRequestException, ForbiddenException, NotFoundException, Provider, UnauthorizedException } from '@nestjs/common'

/**
 * Dependencies
 */
import { AccountAccessService } from '@common/services/account-access/account-access.service'
import { ScopedPermissionChecker } from '@common/services/account-access/permission-checker'
import { Logger } from '@common/services/logger/logger.service'
import { PaginationService } from '@common/services/pagination/pagination.service'
import { PrismaService } from '@configs/prisma/services/prisma.service'
import { AccountService } from '@modules/accounts/services/account.service'

/**
 * Test infrastructure
 */
import { ServiceTestBase } from '@common/tests/unit/base/service-test-base'
import { TestDataFactory } from '@common/tests/unit/builders/test-data-builders'
import { fakePermissionChecker, mockAccountAccessService, mockLogger, mockPrismaService } from '@common/tests/unit/mocks/service-mocks'
import { MockManager, TestAssertions, TestScenario } from '@common/tests/unit/utils/advanced-test-utils'

/**
 * Interface for pagination DTO
 */
interface PaginationDto {
  limit?: number
  page?: number
}

/**
 * Test implementation using the new infrastructure
 */
class AccountServiceTest extends ServiceTestBase<AccountService> {
  protected mockManager = new MockManager()
  protected logger: jest.Mocked<Logger>
  protected prismaService: jest.Mocked<PrismaService>
  protected accountAccessService: jest.Mocked<AccountAccessService>
  protected paginationService: jest.Mocked<PaginationService>

  protected getServiceClass() {
    return AccountService
  }

  protected getProviders(): Provider[] {
    // Create mock for PaginationService with proper typing
    const mockPaginationService = {
      getOffset: this.mockManager.createMock('paginationGetOffset', () => 0),
      createPaginatedResponse: this.mockManager.createMock('paginationCreateResponse', (data: unknown[], dto: PaginationDto, total: number) => ({
        items: data,
        meta: {
          pagination: {
            page: 1,
            limit: dto.limit || 10,
            total
          },
          count: data.length
        }
      }))
    }

    return [
      { provide: PrismaService, useValue: mockPrismaService },
      { provide: Logger, useValue: mockLogger },
      { provide: AccountAccessService, useValue: mockAccountAccessService },
      { provide: PaginationService, useValue: mockPaginationService }
    ]
  }

  protected async customSetup(): Promise<void> {
    // Configure additional Prisma mocks with proper typing
    const prismaServiceAny = mockPrismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
    prismaServiceAny.user.count = jest.fn()
    prismaServiceAny.entity.findMany = jest.fn()
    prismaServiceAny.entity.count = jest.fn()
    prismaServiceAny.role.count = jest.fn()
    prismaServiceAny.account.findUniqueOrThrow = jest.fn()
    prismaServiceAny.userRoleAssignment.findFirst = jest.fn()
    prismaServiceAny.$transaction = jest.fn()
    prismaServiceAny.subModule = { findUnique: jest.fn(), update: jest.fn() }

    // Get service references
    this.logger = this.getService(Logger)
    this.prismaService = this.getService(PrismaService)
    this.accountAccessService = this.getService(AccountAccessService)
    this.paginationService = this.getService(PaginationService)
  }

  /**
   * Test fetchAccount functionality
   */
  testFetchAccount(): void {
    describe('fetchAccount', () => {
      const testUser = TestDataFactory.user().withId('user-1').build()
      const testAccount = TestDataFactory.account().withId('account-1').build()

      describe('when successful', () => {
        const successScenario = TestScenario.create('successful fetch', async () => {
          // Setup scenario-specific mocks
          const mockPeople = { id: '1', firstname: 'Bruce', lastname: 'Wayne' }
          const mockRole = TestDataFactory.role().build()
          const mockEntity = TestDataFactory.entity().build()

          const userWithCompleteStructure = {
            ...testUser,
            people: mockPeople,
            roleAssignments: [{ role: mockRole }],
            entitiesLinked: [{ entity: { ...mockEntity, organization: null } }],
            accountsLinked: [{ accountId: testAccount.id }],
            createdAt: new Date(),
            updatedAt: new Date()
          }

          const enhancedAccount = {
            ...testAccount,
            description: 'Test Account Description',
            createdAt: new Date(),
            updatedAt: new Date()
          }

          const userAccountLink = TestDataFactory.userAccountLink().withUserId(testUser.id).withAccountId(testAccount.id).build()

          this.accountAccessService.validateUserAccountAccess.mockResolvedValue({
            ...userAccountLink,
            account: enhancedAccount,
            indirectAccess: false
          })

          // Mock the 8 queries that the transaction performs in the exact order
          const mockTransactionResults = [
            [userWithCompleteStructure], // users query (findMany)
            1, // users count
            [{ ...mockEntity, organization: null }], // entities query (findMany)
            1, // entities count
            [mockRole], // roles query (findMany)
            1, // roles count
            2, // pendingInvitations count
            1 // pendingSignups count
          ]

          const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
          prismaServiceAny.$transaction.mockResolvedValue(mockTransactionResults)
        })

        it('should fetch account details with all related data', async () => {
          await successScenario.execute(async () => {
            // Act
            const result = await this.service.fetchAccount(testUser.id, testAccount.id)

            // Assert
            expect(result).toBeDefined()
            expect(this.accountAccessService.validateUserAccountAccess).toHaveBeenCalledWith(testUser.id, testAccount.id, 'getAccountDetails', { allowDisabled: true })

            const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
            expect(prismaServiceAny.$transaction).toHaveBeenCalled()
          })
        })

        it('should return structured account data', async () => {
          await successScenario.execute(async () => {
            // Act
            const result = await this.service.fetchAccount(testUser.id, testAccount.id)

            // Assert with advanced assertions - check the exact structure
            TestAssertions.assertObjectStructure(result, {
              id: 'string',
              name: 'string',
              description: 'string',
              isActive: 'boolean',
              createdAt: 'object', // Date
              updatedAt: 'object', // Date
              users: {
                count: 'number',
                values: 'object'
              },
              entities: {
                count: 'number',
                values: 'object'
              },
              roles: {
                count: 'number',
                values: 'object'
              }
            })

            // Check that we have the expected values
            expect(result.users.count).toBe(1)
            expect(result.entities.count).toBe(1)
            expect(result.roles.count).toBe(1)
            expect(result.pendingInvitations).toBe(2)
            expect(result.pendingSignups).toBe(1)
            expect(result.users.values).toHaveLength(1)
            expect(result.entities.values).toHaveLength(1)
            expect(result.roles.values).toHaveLength(1)
          })
        })
      })

      describe('when user has no access', () => {
        const unauthorizedScenario = TestScenario.create('unauthorized access', async () => {
          this.accountAccessService.validateUserAccountAccess.mockRejectedValue(new UnauthorizedException('Access denied'))
        })

        it('should throw UnauthorizedException', async () => {
          await unauthorizedScenario.execute(async () => {
            // Act & Assert
            await TestAssertions.assertThrows(() => this.service.fetchAccount(testUser.id, testAccount.id), UnauthorizedException, 'Access denied')
          })
        })
      })

      describe('when account not found', () => {
        const notFoundScenario = TestScenario.create('account not found', async () => {
          this.accountAccessService.validateUserAccountAccess.mockRejectedValue(new NotFoundException('Account not found'))
        })

        it('should throw NotFoundException', async () => {
          await notFoundScenario.execute(async () => {
            // Act & Assert
            await TestAssertions.assertThrows(() => this.service.fetchAccount(testUser.id, 'non-existent-account'), NotFoundException, 'Account not found')
          })
        })
      })

      describe('when database error occurs', () => {
        const databaseErrorScenario = TestScenario.create('database error', async () => {
          const userAccountLink = TestDataFactory.userAccountLink().withUserId(testUser.id).withAccountId(testAccount.id).build()

          this.accountAccessService.validateUserAccountAccess.mockResolvedValue({
            ...userAccountLink,
            account: testAccount,
            indirectAccess: false
          })

          const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
          prismaServiceAny.$transaction.mockRejectedValue(new Error('Database connection error'))
        })

        it('should throw BadRequestException', async () => {
          await databaseErrorScenario.execute(async () => {
            // Act & Assert
            await TestAssertions.assertThrows(() => this.service.fetchAccount(testUser.id, testAccount.id), BadRequestException, 'Failed to get account details')
          })
        })
      })
    })
  }

  /**
   * Test updateAccountStatus functionality
   */
  testUpdateAccountStatus(): void {
    describe('updateAccountStatus', () => {
      const testUser = TestDataFactory.user().build()
      const testAccount = TestDataFactory.account().build()

      it('should update account status successfully', async () => {
        // Arrange
        const updateDto = { isActive: false }
        const expectedResponse = {
          id: testAccount.id,
          name: testAccount.name,
          isActive: false
        }

        this.accountAccessService.validateUserAccountAccess.mockResolvedValue({
          userId: testUser.id,
          accountId: testAccount.id,
          account: testAccount,
          indirectAccess: false
        })

        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        // Account is currently active, so toggling to inactive is a real change (not a no-op)
        prismaServiceAny.account.findUniqueOrThrow.mockResolvedValue({ ...testAccount, isActive: true })
        // Acting user is not a platform admin -> deactivation provenance scope is ACCOUNT_OWNER
        prismaServiceAny.userRoleAssignment.findFirst.mockResolvedValue(null)
        prismaServiceAny.account.update.mockResolvedValue({
          id: testAccount.id,
          name: testAccount.name,
          isActive: false,
          // The service only uses id, name, and isActive from the result
          description: 'Test Description',
          createdAt: new Date(),
          updatedAt: new Date()
        })

        // Act
        const result = await this.service.updateAccountStatus(testUser.id, testAccount.id, updateDto.isActive)

        // Assert - Only check the fields that the service actually returns
        expect(result).toEqual(expectedResponse)
        expect(prismaServiceAny.account.update).toHaveBeenCalledWith({
          where: { id: testAccount.id },
          data: {
            isActive: false,
            deactivatedAt: expect.any(Date),
            deactivatedByUserId: testUser.id,
            deactivatedByScope: 'ACCOUNT_OWNER'
          }
        })
      })

      it('should not update if account is already in desired state', async () => {
        // Arrange
        this.accountAccessService.validateUserAccountAccess.mockResolvedValue({
          userId: testUser.id,
          accountId: testAccount.id,
          account: testAccount, // Already active by default in TestDataFactory
          indirectAccess: false
        })

        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        // Account already active -> requesting active is a no-op, update must not be called
        prismaServiceAny.account.findUniqueOrThrow.mockResolvedValue({ ...testAccount, isActive: true })

        // Act
        const result = await this.service.updateAccountStatus(testUser.id, testAccount.id, true) // Same as default

        // Assert
        expect(result).toEqual({
          id: testAccount.id,
          name: testAccount.name,
          isActive: true
        })

        // Verify update is not called since state hasn't changed
        expect(prismaServiceAny.account.update).not.toHaveBeenCalled()
      })

      it('should handle validation errors', async () => {
        // Arrange - Test with invalid user access
        this.accountAccessService.validateUserAccountAccess.mockRejectedValue(new UnauthorizedException('Access denied'))

        // Act & Assert
        await TestAssertions.assertThrows(() => this.service.updateAccountStatus(testUser.id, testAccount.id, false), UnauthorizedException, 'Access denied')
      })

      it('should handle database errors', async () => {
        // Arrange
        this.accountAccessService.validateUserAccountAccess.mockResolvedValue({
          userId: testUser.id,
          accountId: testAccount.id,
          account: testAccount,
          indirectAccess: false
        })

        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        prismaServiceAny.account.update.mockRejectedValue(new Error('Database error'))

        // Act & Assert
        await TestAssertions.assertThrows(() => this.service.updateAccountStatus(testUser.id, testAccount.id, false), BadRequestException, 'Failed to deactivate account')
      })
    })
  }

  /**
   * Test toggleSubModule functionality (per-sub-module activation + self-lockout guard)
   */
  testToggleSubModule(): void {
    describe('toggleSubModule', () => {
      it('toggles a sub-module activation successfully', async () => {
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        prismaServiceAny.subModule.findUnique.mockResolvedValue({ id: 2, moduleId: 4, name: 'USERS', isActive: true, module: { name: 'ACCOUNT_ADMINISTRATION' } })
        prismaServiceAny.subModule.update.mockResolvedValue({ id: 2, name: 'USERS', isActive: false })

        const result = await this.service.toggleSubModule(4, 2, false)

        expect(result).toEqual({ id: 2, name: 'USERS', isActive: false })
        expect(prismaServiceAny.subModule.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { isActive: false } })
      })

      it('throws NotFound when the sub-module does not belong to the given module', async () => {
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        prismaServiceAny.subModule.findUnique.mockResolvedValue({ id: 2, moduleId: 99, name: 'USERS', isActive: true, module: { name: 'ACCOUNT_ADMINISTRATION' } })

        await TestAssertions.assertThrows(() => this.service.toggleSubModule(4, 2, false), NotFoundException, 'Sub-module not found')
      })

      it('blocks deactivating a PLATFORM_ADMINISTRATION sub-module (self-lockout guard)', async () => {
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        prismaServiceAny.subModule.findUnique.mockResolvedValue({ id: 8, moduleId: 7, name: 'PLATFORM_MODULES', isActive: true, module: { name: 'PLATFORM_ADMINISTRATION' } })

        await TestAssertions.assertThrows(
          () => this.service.toggleSubModule(7, 8, false),
          BadRequestException,
          'PLATFORM_ADMINISTRATION sub-modules cannot be deactivated — it would lock platform-admins out of the platform console.'
        )
        expect(prismaServiceAny.subModule.update).not.toHaveBeenCalled()
      })
    })
  }

  /**
   * Test updateAccountUsers functionality
   */
  testUpdateAccountUsers(): void {
    describe('updateAccountUsers', () => {
      const testUser = TestDataFactory.user().build()
      const testAccount = TestDataFactory.account().build()

      const mockAccountWithUsers = {
        ...testAccount,
        usersLinked: [
          {
            userId: testUser.id,
            accountId: testAccount.id,
            user: {
              ...testUser,
              people: {
                firstname: 'Bruce',
                lastname: 'Wayne'
              }
            }
          }
        ],
        entities: [
          {
            ...TestDataFactory.entity().build(),
            users: [{ user: testUser }]
          }
        ]
      }

      const mockNewUsers = [
        {
          id: '2',
          email: 'user2@test.com',
          isActive: true,
          people: {
            firstname: 'Jane',
            lastname: 'Doe'
          }
        },
        {
          id: '3',
          email: 'user3@test.com',
          isActive: true,
          people: {
            firstname: 'John',
            lastname: 'Smith'
          }
        }
      ]

      beforeEach(() => {
        this.accountAccessService.validateUserAccountAccess.mockResolvedValue({
          userId: testUser.id,
          accountId: testAccount.id,
          account: testAccount,
          indirectAccess: false
        })
      })

      it('should update account users successfully', async () => {
        // Arrange
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        prismaServiceAny.account.findUnique.mockResolvedValue(mockAccountWithUsers)
        prismaServiceAny.$transaction.mockImplementation(
          async (
            callback: (tx: any) => Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any
          ) =>
            callback({
              userAccountLink: {
                deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
                createMany: jest.fn().mockResolvedValue({ count: 2 })
              }
            })
        )
        prismaServiceAny.userAccountLink.findMany.mockResolvedValue(mockNewUsers.map((user) => ({ user })))

        // Act
        const newUserIds = ['2', '3']
        const result = await this.service.updateAccountUsers(testUser.id, testAccount.id, newUserIds)

        // Assert
        expect(result).toEqual({
          id: testAccount.id,
          name: testAccount.name,
          users: expect.arrayContaining([
            expect.objectContaining({
              id: '2',
              email: 'user2@test.com',
              isActive: true,
              people: {
                firstname: 'Jane',
                lastname: 'Doe'
              }
            }),
            expect.objectContaining({
              id: '3',
              email: 'user3@test.com',
              isActive: true,
              people: {
                firstname: 'John',
                lastname: 'Smith'
              }
            })
          ])
        })
      })

      it('should handle partial update (add and remove users simultaneously)', async () => {
        // Arrange
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        prismaServiceAny.account.findUnique.mockResolvedValue(mockAccountWithUsers)
        prismaServiceAny.$transaction.mockImplementation(
          async (
            callback: (tx: any) => Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any
          ) =>
            callback({
              userAccountLink: {
                deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
                createMany: jest.fn().mockResolvedValue({ count: 1 })
              }
            })
        )
        prismaServiceAny.userAccountLink.findMany.mockResolvedValue([{ user: mockNewUsers[0] }])

        // Act
        const result = await this.service.updateAccountUsers(testUser.id, testAccount.id, ['2'])

        // Assert
        expect(result).toEqual({
          id: testAccount.id,
          name: testAccount.name,
          users: expect.arrayContaining([
            expect.objectContaining({
              id: '2',
              email: 'user2@test.com',
              isActive: true,
              people: {
                firstname: 'Jane',
                lastname: 'Doe'
              }
            })
          ])
        })
      })

      it('should handle users with inactive status', async () => {
        // Arrange
        const inactiveUser = { ...mockNewUsers[0], isActive: false }
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        prismaServiceAny.account.findUnique.mockResolvedValue(mockAccountWithUsers)
        prismaServiceAny.$transaction.mockImplementation(
          async (
            callback: (tx: any) => Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any
          ) =>
            callback({
              userAccountLink: {
                deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
                createMany: jest.fn().mockResolvedValue({ count: 1 })
              }
            })
        )
        prismaServiceAny.userAccountLink.findMany.mockResolvedValue([{ user: inactiveUser }])

        // Act
        const result = await this.service.updateAccountUsers(testUser.id, testAccount.id, ['2'])

        // Assert
        expect(result.users).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: '2',
              isActive: false
            })
          ])
        )
      })

      it('should throw UnauthorizedException if user does not have access', async () => {
        // Arrange
        this.accountAccessService.validateUserAccountAccess.mockRejectedValue(new UnauthorizedException())

        // Act & Assert
        await TestAssertions.assertThrows(() => this.service.updateAccountUsers(testUser.id, testAccount.id, ['2', '3']), UnauthorizedException)
      })

      it('should throw NotFoundException if account does not exist', async () => {
        // Arrange
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        prismaServiceAny.account.findUnique.mockResolvedValue(null)

        // Act & Assert
        await TestAssertions.assertThrows(() => this.service.updateAccountUsers(testUser.id, testAccount.id, ['2', '3']), NotFoundException, 'Account with ID 1 not found')
      })

      it('should throw BadRequestException if update would leave account without active users', async () => {
        // Arrange
        const emptyAccount = {
          ...mockAccountWithUsers,
          usersLinked: [], // No direct users
          entities: [] // No entities with users
        }
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        prismaServiceAny.account.findUnique.mockResolvedValue(emptyAccount)

        // Act & Assert
        await TestAssertions.assertThrows(
          () => this.service.updateAccountUsers(testUser.id, testAccount.id, []),
          BadRequestException,
          'Cannot update users as it would leave the account without any active users (directly or via active entities)'
        )
      })

      it('should handle case where some users do not exist', async () => {
        // Arrange
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        prismaServiceAny.account.findUnique.mockResolvedValue(mockAccountWithUsers)
        const foreignKeyError = new Error('Foreign key constraint failed')
        prismaServiceAny.$transaction.mockRejectedValue(foreignKeyError)

        // Act & Assert
        await TestAssertions.assertThrows(() => this.service.updateAccountUsers(testUser.id, testAccount.id, ['999']), BadRequestException)
      })
    })
  }

  /**
   * Test fetchAccountUsers functionality
   */
  testFetchAccountUsers(): void {
    describe('fetchAccountUsers', () => {
      const testUser = TestDataFactory.user().build()
      const testAccount = TestDataFactory.account().build()

      const mockUsersList = [
        {
          ...testUser,
          people: {
            id: '1',
            firstname: 'Bruce',
            lastname: 'Wayne'
          },
          roleAssignments: [{ role: TestDataFactory.role().build() }],
          entitiesLinked: [{ entity: { ...TestDataFactory.entity().build(), accountId: testAccount.id } }],
          accountsLinked: [{ accountId: testAccount.id }],
          receivedInvitations: []
        }
      ]

      beforeEach(() => {
        this.accountAccessService.validateUserAccountAccess.mockResolvedValue({
          userId: testUser.id,
          accountId: testAccount.id,
          account: testAccount,
          indirectAccess: false
        })

        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        prismaServiceAny.$transaction.mockResolvedValue([mockUsersList, 1])
      })

      it('should fetch account users with pagination', async () => {
        // Arrange
        const dto = { page: 1, limit: 10 }

        // Act
        const result = await this.service.fetchAccountUsers(testUser.id, testAccount.id, dto)

        // Assert
        expect(result).toBeDefined()
        expect(result.items).toBeDefined()
        expect(result.meta).toBeDefined()
        expect(this.accountAccessService.validateUserAccountAccess).toHaveBeenCalledWith(testUser.id, testAccount.id, 'fetchAccountUsers')
      })

      it('should derive pendingKind from active flag + pending received invitations', async () => {
        // Arrange — three users: active, inactive-invited (has pending invite), inactive-selfsignup (no invite)
        const activeUser = { ...mockUsersList[0], id: 'u-active', isActive: true, receivedInvitations: [] }
        const invitedUser = { ...mockUsersList[0], id: 'u-invited', isActive: false, receivedInvitations: [{ id: 'inv-1' }] }
        const selfSignupUser = { ...mockUsersList[0], id: 'u-selfsignup', isActive: false, receivedInvitations: [] }
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        prismaServiceAny.$transaction.mockResolvedValueOnce([[activeUser, invitedUser, selfSignupUser], 3])

        // Act
        const result = await this.service.fetchAccountUsers(testUser.id, testAccount.id, { page: 1, limit: 10 })

        // Assert
        const byId = Object.fromEntries(result.items.map((u) => [u.id, u.pendingKind]))
        expect(byId['u-active']).toBeNull()
        expect(byId['u-invited']).toBe('invited')
        expect(byId['u-selfsignup']).toBe('awaiting-confirmation')
      })

      it('should apply search filter when provided', async () => {
        // Arrange
        const dto = { search: 'Wayne', page: 1, limit: 10 }

        // Act
        await this.service.fetchAccountUsers(testUser.id, testAccount.id, dto)

        // Assert
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(prismaServiceAny.$transaction).toHaveBeenCalled()
      })

      it('should apply entity filter when provided', async () => {
        // Arrange
        const dto = { entityIds: ['entity-1'], page: 1, limit: 10 }

        // Act
        await this.service.fetchAccountUsers(testUser.id, testAccount.id, dto)

        // Assert
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(prismaServiceAny.$transaction).toHaveBeenCalled()
      })

      it('should apply role filter when provided', async () => {
        // Arrange
        const dto = { roleIds: [1], page: 1, limit: 10 }

        // Act
        await this.service.fetchAccountUsers(testUser.id, testAccount.id, dto)

        // Assert
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(prismaServiceAny.$transaction).toHaveBeenCalled()
      })

      it('should apply isActive filter when provided', async () => {
        // Arrange
        const dto = { isActive: true, page: 1, limit: 10 }

        // Act
        await this.service.fetchAccountUsers(testUser.id, testAccount.id, dto)

        // Assert
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(prismaServiceAny.$transaction).toHaveBeenCalled()
      })

      it('should apply correct order when orderBy is provided', async () => {
        // Arrange
        const dto = { orderBy: 'name' as any, page: 1, limit: 10 } // eslint-disable-line @typescript-eslint/no-explicit-any

        // Act
        await this.service.fetchAccountUsers(testUser.id, testAccount.id, dto)

        // Assert
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(prismaServiceAny.$transaction).toHaveBeenCalled()
      })

      it('should throw UnauthorizedException if user does not have access', async () => {
        // Arrange
        this.accountAccessService.validateUserAccountAccess.mockRejectedValue(new UnauthorizedException())
        const dto = { page: 1, limit: 10 }

        // Act & Assert
        await TestAssertions.assertThrows(() => this.service.fetchAccountUsers(testUser.id, testAccount.id, dto), UnauthorizedException)
      })

      it('should handle database errors gracefully', async () => {
        // Arrange
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        prismaServiceAny.$transaction.mockRejectedValue(new Error('Database error'))
        const dto = { page: 1, limit: 10 }

        // Act & Assert
        await TestAssertions.assertThrows(() => this.service.fetchAccountUsers(testUser.id, testAccount.id, dto), BadRequestException)
      })
    })
  }

  /**
   * Test fetchAccountEntities functionality
   */
  testFetchAccountEntities(): void {
    describe('fetchAccountEntities', () => {
      const testUser = TestDataFactory.user().build()
      const testAccount = TestDataFactory.account().build()

      const mockEntitiesList = [
        {
          ...TestDataFactory.entity().build(),
          organization: {
            id: '1',
            name: 'Wayne Enterprises'
          },
          _count: {
            users: 1
          }
        }
      ]

      beforeEach(() => {
        this.accountAccessService.validateUserAccountAccess.mockResolvedValue({
          userId: testUser.id,
          accountId: testAccount.id,
          account: testAccount,
          indirectAccess: false
        })
        // B3b — default to "no restriction" (account-admin / platform reach) so the listing returns all
        // account entities. The subtree-narrowing path is covered by the entity e2e adversarial tests.
        this.accountAccessService.resolveVisibleEntityIdsForAccount.mockResolvedValue(null)

        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        prismaServiceAny.$transaction.mockResolvedValue([mockEntitiesList, 1])
      })

      it('should fetch account entities with pagination', async () => {
        // Arrange
        const dto = { page: 1, limit: 10 }

        // Act
        const result = await this.service.fetchAccountEntities(testUser.id, testAccount.id, dto)

        // Assert
        expect(result).toBeDefined()
        expect(result.items).toBeDefined()
        expect(result.meta).toBeDefined()
        expect(this.accountAccessService.validateUserAccountAccess).toHaveBeenCalledWith(testUser.id, testAccount.id, 'fetchAccountEntities')
      })

      it('should apply search filter when provided', async () => {
        // Arrange
        const dto = { search: 'Wayne', page: 1, limit: 10 }

        // Act
        await this.service.fetchAccountEntities(testUser.id, testAccount.id, dto)

        // Assert
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(prismaServiceAny.$transaction).toHaveBeenCalled()
      })

      it('should apply user filter when provided', async () => {
        // Arrange
        const dto = { userIds: [testUser.id], page: 1, limit: 10 }

        // Act
        await this.service.fetchAccountEntities(testUser.id, testAccount.id, dto)

        // Assert
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(prismaServiceAny.$transaction).toHaveBeenCalled()
      })

      it('should apply isActive filter when provided', async () => {
        // Arrange
        const dto = { isActive: true, page: 1, limit: 10 }

        // Act
        await this.service.fetchAccountEntities(testUser.id, testAccount.id, dto)

        // Assert
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(prismaServiceAny.$transaction).toHaveBeenCalled()
      })

      it('should apply correct order when orderBy is provided', async () => {
        // Arrange
        const dto = { orderBy: 'name' as any, page: 1, limit: 10 } // eslint-disable-line @typescript-eslint/no-explicit-any

        // Act
        await this.service.fetchAccountEntities(testUser.id, testAccount.id, dto)

        // Assert
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(prismaServiceAny.$transaction).toHaveBeenCalled()
      })

      it('should throw UnauthorizedException if user does not have access', async () => {
        // Arrange
        this.accountAccessService.validateUserAccountAccess.mockRejectedValue(new UnauthorizedException())
        const dto = { page: 1, limit: 10 }

        // Act & Assert
        await TestAssertions.assertThrows(() => this.service.fetchAccountEntities(testUser.id, testAccount.id, dto), UnauthorizedException)
      })

      it('should handle database errors gracefully', async () => {
        // Arrange
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        prismaServiceAny.$transaction.mockRejectedValue(new Error('Database error'))
        const dto = { page: 1, limit: 10 }

        // Act & Assert
        await TestAssertions.assertThrows(() => this.service.fetchAccountEntities(testUser.id, testAccount.id, dto), BadRequestException)
      })
    })
  }

  /**
   * Test fetchAccountRoles functionality
   */
  testFetchAccountRoles(): void {
    describe('fetchAccountRoles', () => {
      const testUser = TestDataFactory.user().build()
      const testAccount = TestDataFactory.account().build()

      const mockRolesList = [
        {
          ...TestDataFactory.role().build(),
          accountId: testAccount.id,
          description: 'Account admin role'
        }
      ]

      beforeEach(() => {
        this.accountAccessService.validateUserAccountAccess.mockResolvedValue({
          userId: testUser.id,
          accountId: testAccount.id,
          account: testAccount,
          indirectAccess: false
        })

        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        prismaServiceAny.$transaction.mockResolvedValue([mockRolesList, 1])
      })

      it('should fetch account roles with pagination', async () => {
        // Arrange
        const dto = { page: 1, limit: 10 }

        // Act
        const result = await this.service.fetchAccountRoles(testUser.id, testAccount.id, dto)

        // Assert
        expect(result).toBeDefined()
        expect(result.items).toBeDefined()
        expect(result.meta).toBeDefined()
        expect(this.accountAccessService.validateUserAccountAccess).toHaveBeenCalledWith(testUser.id, testAccount.id, 'fetchAccountRoles')
      })

      it('should apply search filter when provided', async () => {
        // Arrange
        const dto = { search: 'Admin', page: 1, limit: 10 }

        // Act
        await this.service.fetchAccountRoles(testUser.id, testAccount.id, dto)

        // Assert
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(prismaServiceAny.$transaction).toHaveBeenCalled()
      })

      it('should apply isActive filter when provided', async () => {
        // Arrange
        const dto = { isActive: true, page: 1, limit: 10 }

        // Act
        await this.service.fetchAccountRoles(testUser.id, testAccount.id, dto)

        // Assert
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(prismaServiceAny.$transaction).toHaveBeenCalled()
      })

      it('should apply correct order when orderBy is provided', async () => {
        // Arrange
        const dto = { orderBy: 'name' as any, page: 1, limit: 10 } // eslint-disable-line @typescript-eslint/no-explicit-any

        // Act
        await this.service.fetchAccountRoles(testUser.id, testAccount.id, dto)

        // Assert
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        expect(prismaServiceAny.$transaction).toHaveBeenCalled()
      })

      it('should throw UnauthorizedException if user does not have access', async () => {
        // Arrange
        this.accountAccessService.validateUserAccountAccess.mockRejectedValue(new UnauthorizedException())
        const dto = { page: 1, limit: 10 }

        // Act & Assert
        await TestAssertions.assertThrows(() => this.service.fetchAccountRoles(testUser.id, testAccount.id, dto), UnauthorizedException)
      })

      it('should handle database errors gracefully', async () => {
        // Arrange
        const prismaServiceAny = this.prismaService as any // eslint-disable-line @typescript-eslint/no-explicit-any
        prismaServiceAny.$transaction.mockRejectedValue(new Error('Database error'))
        const dto = { page: 1, limit: 10 }

        // Act & Assert
        await TestAssertions.assertThrows(() => this.service.fetchAccountRoles(testUser.id, testAccount.id, dto), BadRequestException)
      })
    })
  }
}

/**
 * Scope isolation: updateAccountUser and the role routes check each action in the scope it acts on
 */
class AccountServiceScopeTest extends AccountServiceTest {
  testUpdateAccountUserAuthority(): void {
    describe('updateAccountUser (scoped authority)', () => {
      const accountId = 'acc-1'
      const actorId = 'actor-1'
      const targetId = 'target-1'

      interface Given {
        targetIsActive?: boolean
        /** ACCOUNT roles the target currently holds on the account. */
        accountRoles?: number[]
        /** ENTITY roles the target currently holds, per entity. */
        entityRoles?: Record<string, number[]>
        /** The roles the payload references (the service reads them to validate scope and ownership). */
        roles?: { id: number; scope: string; accountId: string | null }[]
        entityIds?: string[]
        /** Permissions the actor does not hold. */
        denied?: string[]
      }

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const given = (options: Given = {}) => {
        const prisma = this.prismaService as any
        const checker = fakePermissionChecker({ denied: options.denied })
        this.accountAccessService.validateUserAccountAccess.mockResolvedValue({} as never)
        this.accountAccessService.getPermissionChecker.mockReset()
        this.accountAccessService.getPermissionChecker.mockResolvedValue(checker as never)
        prisma.user.findUnique.mockResolvedValue({ id: targetId, isActive: options.targetIsActive ?? true, accountsLinked: [{ accountId }], entitiesLinked: [] })
        prisma.entity.findMany.mockResolvedValue((options.entityIds ?? []).map((id) => ({ id, accountId })))
        prisma.role.findMany.mockResolvedValue(options.roles ?? [])
        // The target's stored assignments, as the service reads them: ONE query for the account slice and every entity slice.
        prisma.userRoleAssignment.findMany.mockReset()
        prisma.userRoleAssignment.findMany.mockResolvedValue([
          ...(options.accountRoles ?? []).map((roleId) => ({ roleId, accountId, entityId: null })),
          ...Object.entries(options.entityRoles ?? {}).flatMap(([entityId, roleIds]) => roleIds.map((roleId) => ({ roleId, accountId: null, entityId })))
        ])
        const tx = {
          user: { update: jest.fn(), findUniqueOrThrow: jest.fn().mockResolvedValue({ id: targetId, isActive: true }) },
          userRoleAssignment: { deleteMany: jest.fn(), createMany: jest.fn() },
          userToken: { deleteMany: jest.fn() }
        }
        prisma.$transaction.mockImplementation(async (callback: (client: unknown) => unknown) => callback(tx))
        return { prisma, tx, checker }
      }
      /* eslint-enable @typescript-eslint/no-explicit-any */

      it('requires ACCOUNT_USER_MANAGEMENT at ACCOUNT scope to change isActive, and writes nothing when refused', async () => {
        const { prisma, checker } = given({ targetIsActive: true, denied: ['ACCOUNT_USER_MANAGEMENT'] })

        await TestAssertions.assertThrows(() => this.service.updateAccountUser(actorId, accountId, targetId, { isActive: false }), ForbiddenException)

        expect(checker.assert).toHaveBeenCalledWith('ACCOUNT_USER_MANAGEMENT', { kind: 'ACCOUNT', accountId }, expect.any(String))
        expect(prisma.$transaction).not.toHaveBeenCalled()
      })

      it('lets a holder of ACCOUNT_USER_MANAGEMENT change isActive', async () => {
        const { tx } = given({ targetIsActive: true })

        await this.service.updateAccountUser(actorId, accountId, targetId, { isActive: false })

        expect(tx.user.update).toHaveBeenCalledWith({ where: { id: targetId }, data: { isActive: false } })
      })

      it('ends the sessions of a deactivated user: its refresh tokens are deleted in the same transaction', async () => {
        const { tx } = given({ targetIsActive: true })

        await this.service.updateAccountUser(actorId, accountId, targetId, { isActive: false })

        expect(tx.userToken.deleteMany).toHaveBeenCalledWith({ where: { userId: targetId, type: 'SESSION_REFRESH' } })
      })

      it('deletes no token on reactivation', async () => {
        const { tx } = given({ targetIsActive: false })

        await this.service.updateAccountUser(actorId, accountId, targetId, { isActive: true })

        expect(tx.user.update).toHaveBeenCalledWith({ where: { id: targetId }, data: { isActive: true } })
        expect(tx.userToken.deleteMany).not.toHaveBeenCalled()
      })

      it('treats an unchanged isActive as a no-op: no permission needed, nothing written', async () => {
        const { tx, checker } = given({ targetIsActive: true })

        await this.service.updateAccountUser(actorId, accountId, targetId, { isActive: true })

        expect(this.accountAccessService.getPermissionChecker).not.toHaveBeenCalled()
        expect(checker.assert).not.toHaveBeenCalled()
        expect(tx.user.update).not.toHaveBeenCalled()
      })

      it('requires USER_ROLE_ALLOCATION at ACCOUNT scope to change accountRoleIds, and writes nothing when refused', async () => {
        const { prisma, checker } = given({ accountRoles: [10], roles: [{ id: 11, scope: 'ACCOUNT', accountId: null }], denied: ['USER_ROLE_ALLOCATION'] })

        await TestAssertions.assertThrows(() => this.service.updateAccountUser(actorId, accountId, targetId, { accountRoleIds: [11] }), ForbiddenException)

        expect(checker.assert).toHaveBeenCalledWith('USER_ROLE_ALLOCATION', { kind: 'ACCOUNT', accountId }, expect.any(String))
        expect(prisma.$transaction).not.toHaveBeenCalled()
      })

      it('treats accountRoleIds equal to the stored assignments as a no-op: no permission needed and NOT rewritten', async () => {
        const { tx } = given({
          accountRoles: [10, 11],
          roles: [
            { id: 10, scope: 'ACCOUNT', accountId: null },
            { id: 11, scope: 'ACCOUNT', accountId }
          ]
        })

        await this.service.updateAccountUser(actorId, accountId, targetId, { accountRoleIds: [11, 10] })

        expect(this.accountAccessService.getPermissionChecker).not.toHaveBeenCalled()
        expect(tx.userRoleAssignment.deleteMany).not.toHaveBeenCalled()
        expect(tx.userRoleAssignment.createMany).not.toHaveBeenCalled()
      })

      it('checks each changed entity slice in the scope of that entity, and neither checks nor rewrites an unchanged one', async () => {
        const { tx, checker } = given({
          entityIds: ['ent-1', 'ent-2'],
          entityRoles: { 'ent-1': [20], 'ent-2': [20] },
          roles: [
            { id: 20, scope: 'ENTITY', accountId: null },
            { id: 21, scope: 'ENTITY', accountId: null }
          ]
        })

        await this.service.updateAccountUser(actorId, accountId, targetId, {
          entityRoleIds: [
            { entityId: 'ent-1', roleIds: [20, 21] },
            { entityId: 'ent-2', roleIds: [20] }
          ]
        })

        expect(checker.assert).toHaveBeenCalledTimes(1)
        expect(checker.assert).toHaveBeenCalledWith('USER_ROLE_ALLOCATION', { kind: 'ENTITY', entityId: 'ent-1' }, expect.any(String))
        // Only ent-1 is written; ent-2 (unchanged) is left alone, so a stale form cannot restore a revoked role there.
        expect(tx.userRoleAssignment.deleteMany).toHaveBeenCalledTimes(1)
        expect(tx.userRoleAssignment.deleteMany).toHaveBeenCalledWith({ where: { userId: targetId, entityId: 'ent-1', role: { scope: 'ENTITY' } } })
        expect(tx.userRoleAssignment.createMany).toHaveBeenCalledWith({
          data: [
            { userId: targetId, roleId: 20, entityId: 'ent-1' },
            { userId: targetId, roleId: 21, entityId: 'ent-1' }
          ]
        })
      })

      it('reads the target once and builds one checker whatever the number of slices (no per-slice queries)', async () => {
        const entityIds = Array.from({ length: 12 }, (_, index) => `ent-${index}`)
        const { prisma } = given({ entityIds, roles: [{ id: 21, scope: 'ENTITY', accountId: null }] })

        await this.service.updateAccountUser(actorId, accountId, targetId, { entityRoleIds: entityIds.map((entityId) => ({ entityId, roleIds: [21] })) })

        expect(prisma.userRoleAssignment.findMany).toHaveBeenCalledTimes(1)
        expect(this.accountAccessService.getPermissionChecker).toHaveBeenCalledTimes(1)
        expect(this.accountAccessService.getPermissionChecker).toHaveBeenCalledWith(actorId, entityIds)
        expect(this.accountAccessService.assertPermissionInScope).not.toHaveBeenCalled()
      })

      it('refuses an entity slice outside the actor authority with a 403 and writes nothing', async () => {
        const { prisma } = given({ entityIds: ['ent-1'], roles: [{ id: 21, scope: 'ENTITY', accountId: null }], denied: ['USER_ROLE_ALLOCATION'] })

        await TestAssertions.assertThrows(() => this.service.updateAccountUser(actorId, accountId, targetId, { entityRoleIds: [{ entityId: 'ent-1', roleIds: [21] }] }), ForbiddenException)

        expect(prisma.$transaction).not.toHaveBeenCalled()
      })

      it('refuses to grant a role owned by another account (403)', async () => {
        given({ roles: [{ id: 30, scope: 'ACCOUNT', accountId: 'acc-other' }] })

        await TestAssertions.assertThrows(
          () => this.service.updateAccountUser(actorId, accountId, targetId, { accountRoleIds: [30] }),
          ForbiddenException,
          'One or more roles do not belong to this account'
        )
      })

      it('accepts a role owned by the account and a global role', async () => {
        const { tx } = given({
          roles: [
            { id: 30, scope: 'ACCOUNT', accountId },
            { id: 31, scope: 'ACCOUNT', accountId: null }
          ]
        })

        await this.service.updateAccountUser(actorId, accountId, targetId, { accountRoleIds: [30, 31] })

        expect(tx.userRoleAssignment.createMany).toHaveBeenCalled()
      })
    })
  }

  testRoleRoutesAreCheckedInTheRoleAccount(): void {
    describe('role routes (who may change a role, and what they may grant)', () => {
      const actorId = 'actor-1'
      const A = 'acc-1'
      const B = 'acc-2'
      // E1 is administered by the entity admin below, E1_CHILD lies in its subtree, E2 is a sibling.
      const E1 = 'ent-1'
      const E1_CHILD = 'ent-1-child'
      const E2 = 'ent-2'
      const ancestors: Record<string, string[]> = { [E1]: [E1], [E1_CHILD]: [E1_CHILD, E1], [E2]: [E2] }

      const USERS = { id: 10, name: 'USERS', module: { name: 'ACCOUNT_ADMINISTRATION' } }
      const ENTITIES = { id: 11, name: 'ENTITIES', module: { name: 'ACCOUNT_ADMINISTRATION' } }
      const PLATFORM_ACCOUNTS = { id: 90, name: 'PLATFORM_ACCOUNTS', module: { name: 'PLATFORM_ADMINISTRATION' } }
      const ALLOCATION = { id: 1, name: 'USER_ROLE_ALLOCATION', applicableScopes: ['PLATFORM', 'ACCOUNT', 'ENTITY'] }
      const ENTITY_CREATION = { id: 2, name: 'ENTITY_CREATION', applicableScopes: ['PLATFORM', 'ACCOUNT', 'ENTITY'] }
      const ACCOUNT_UPDATE = { id: 3, name: 'ACCOUNT_UPDATE', applicableScopes: ['PLATFORM', 'ACCOUNT'] }

      /** One role assignment of the actor: its scope, where it is held, and what its role grants. */
      interface Holding {
        scope: 'PLATFORM' | 'ACCOUNT' | 'ENTITY'
        on?: string
        permissions: string[]
        subModuleIds?: number[]
      }
      const entityAdminOfE1: Holding[] = [{ scope: 'ENTITY', on: E1, permissions: ['ROLE_CUSTOM_MANAGEMENT', 'USER_ROLE_ALLOCATION'], subModuleIds: [USERS.id] }]
      const accountAdminOfA: Holding[] = [
        { scope: 'ACCOUNT', on: A, permissions: ['ROLE_CUSTOM_MANAGEMENT', 'USER_ROLE_ALLOCATION', 'ENTITY_CREATION', 'ACCOUNT_UPDATE'], subModuleIds: [USERS.id, ENTITIES.id] }
      ]
      const platformAdmin: Holding[] = [{ scope: 'PLATFORM', permissions: ['ROLE_CUSTOM_MANAGEMENT'] }]
      // Reads the platform console without managing roles there, and administers E1: the union holds ROLE_CUSTOM_MANAGEMENT, the platform does not.
      const platformReaderAndEntityAdmin: Holding[] = [{ scope: 'PLATFORM', permissions: [], subModuleIds: [PLATFORM_ACCOUNTS.id] }, ...entityAdminOfE1]
      const accountAdminOfB: Holding[] = [{ scope: 'ACCOUNT', on: B, permissions: ['ROLE_CUSTOM_MANAGEMENT', 'USER_ROLE_ALLOCATION'], subModuleIds: [USERS.id] }]

      /** A real checker over the actor's holdings: the scope rule is the production one. */
      const checkerFor = (holdings: Holding[], entityIds: string[]) =>
        new ScopedPermissionChecker(
          holdings.map((holding) => ({
            accountId: holding.scope === 'ACCOUNT' ? (holding.on ?? null) : null,
            entityId: holding.scope === 'ENTITY' ? (holding.on ?? null) : null,
            entity: holding.scope === 'ENTITY' && holding.on ? { id: holding.on, accountId: A } : null,
            role: {
              scope: holding.scope,
              permissionsLinked: holding.permissions.map((name) => ({ permission: { name } })),
              subModulesLinked: (holding.subModuleIds ?? []).map((subModuleId) => ({ subModuleId }))
            }
          })),
          new Map(entityIds.map((entityId) => [entityId, { kind: 'ENTITY' as const, entityId, accountId: A, ancestorEntityIds: ancestors[entityId] ?? [entityId] }])),
          true
        )

      interface Given {
        actor: Holding[]
        role?: { id: number; scope: string; accountId: string | null; isSystem?: boolean; name?: string; permissionIds?: number[]; subModuleIds?: number[] }
        /** Entities the role is assigned in. */
        assignedIn?: string[]
      }

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const given = ({ actor, role = { id: 5, scope: 'ENTITY', accountId: A }, assignedIn = [] }: Given) => {
        const prisma = this.prismaService as any
        const permissionCatalog = [ALLOCATION, ENTITY_CREATION, ACCOUNT_UPDATE]
        const sectionCatalog = [USERS, ENTITIES, PLATFORM_ACCOUNTS]
        prisma.role.findUnique = jest.fn().mockResolvedValue({
          name: 'custom',
          description: null,
          isSystem: false,
          isActive: true,
          ...role,
          permissionsLinked: (role.permissionIds ?? []).map((permissionId) => ({ permissionId })),
          subModulesLinked: (role.subModuleIds ?? []).map((subModuleId) => ({ subModuleId }))
        })
        prisma.role.update = jest.fn().mockResolvedValue({ id: role.id, name: 'custom', isActive: false })
        prisma.role.delete = jest.fn().mockResolvedValue({})
        prisma.userRoleAssignment.findMany.mockReset()
        prisma.userRoleAssignment.findMany.mockResolvedValue(assignedIn.map((entityId) => ({ entityId })))
        const findPermissions = jest.fn(async ({ where }: any) => permissionCatalog.filter((permission) => where.id.in.includes(permission.id)))
        const findSections = jest.fn(async ({ where }: any) => sectionCatalog.filter((section) => where.id.in.includes(section.id)))
        prisma.modulePermission = { findMany: findPermissions }
        prisma.subModule = { ...prisma.subModule, findMany: findSections }
        const links = () => ({ createMany: jest.fn(), deleteMany: jest.fn() })
        const tx = {
          role: { create: jest.fn().mockResolvedValue({ id: 99, name: 'new-role', scope: role.scope }), update: jest.fn().mockResolvedValue({ id: role.id, name: 'renamed' }) },
          roleModuleLink: links(),
          roleSubModuleLink: links(),
          rolePermissionLink: links(),
          modulePermission: { findMany: findPermissions },
          subModule: { findMany: findSections }
        }
        prisma.$transaction.mockReset()
        prisma.$transaction.mockImplementation(async (callback: (client: unknown) => unknown) => callback(tx))
        this.accountAccessService.validateUserAccountAccess.mockReset()
        this.accountAccessService.validateUserAccountAccess.mockResolvedValue({} as never)
        this.accountAccessService.getPermissionChecker.mockReset()
        this.accountAccessService.getPermissionChecker.mockImplementation(async (_userId: string, entityIds: string[] = []) => checkerFor(actor, entityIds) as never)
        return { prisma, tx }
      }
      /* eslint-enable @typescript-eslint/no-explicit-any */

      /** A 403 whose message contains `containing` (the messages name what is missing). */
      const assertForbidden = async (call: () => Promise<unknown>, containing?: string) => {
        const error = await TestAssertions.assertThrows(call, ForbiddenException)
        if (containing) expect(error.message).toContain(containing)
      }
      const update = (payload: Parameters<AccountService['updateCustomRole']>[2]) => this.service.updateCustomRole(actorId, 5, payload)
      const routes: [string, (service: AccountService) => Promise<unknown>][] = [
        ['updateCustomRole', (service) => service.updateCustomRole(actorId, 5, { permissionIds: [] })],
        ['deleteCustomRole', (service) => service.deleteCustomRole(actorId, 5)],
        ['toggleRoleStatus', (service) => service.toggleRoleStatus(actorId, 5, false)]
      ]

      describe('system roles belong to the platform', () => {
        const systemRole = { id: 5, scope: 'ENTITY', accountId: null, isSystem: true, name: 'entity-user', permissionIds: [ALLOCATION.id] }

        it.each(routes)('%s on a system role answers 403 to an entity admin, and changes nothing', async (_name, call) => {
          const { prisma } = given({ actor: entityAdminOfE1, role: systemRole })

          await assertForbidden(() => call(this.service), 'Only a platform administrator')

          expect(prisma.$transaction).not.toHaveBeenCalled()
          expect(prisma.role.update).not.toHaveBeenCalled()
          expect(prisma.role.delete).not.toHaveBeenCalled()
        })

        it.each(routes)('%s on a system role answers 403 to an account admin', async (_name, call) => {
          given({ actor: accountAdminOfA, role: systemRole })

          await assertForbidden(() => call(this.service), 'Only a platform administrator')
        })

        it('a platform role that only reads the console is not platform authority, even with ROLE_CUSTOM_MANAGEMENT held in an entity', async () => {
          given({ actor: platformReaderAndEntityAdmin, role: systemRole })

          await assertForbidden(() => this.service.toggleRoleStatus(actorId, 5, false))
          await assertForbidden(() => update({ permissionIds: [ALLOCATION.id, ENTITY_CREATION.id] }))
        })

        it('ROLE_CUSTOM_MANAGEMENT through a PLATFORM role rewrites the grants of a system role, and grants what it does not hold itself', async () => {
          const { tx } = given({ actor: platformAdmin, role: systemRole })

          await update({ permissionIds: [ALLOCATION.id, ENTITY_CREATION.id], subModuleIds: [USERS.id] })

          expect(tx.rolePermissionLink.createMany).toHaveBeenCalledWith({ data: [ALLOCATION.id, ENTITY_CREATION.id].map((permissionId) => ({ roleId: 5, permissionId })) })
          expect(this.accountAccessService.validateUserAccountAccess).not.toHaveBeenCalled()
        })

        it('ROLE_CUSTOM_MANAGEMENT through a PLATFORM role toggles a system role', async () => {
          const { prisma } = given({ actor: platformAdmin, role: systemRole })

          await this.service.toggleRoleStatus(actorId, 5, false)

          expect(prisma.role.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { isActive: false } })
        })

        it('a system role still cannot be renamed or deleted, even by the platform', async () => {
          given({ actor: platformAdmin, role: systemRole })

          await TestAssertions.assertThrows(() => update({ name: 'renamed' }), UnauthorizedException)
          await TestAssertions.assertThrows(() => this.service.deleteCustomRole(actorId, 5), UnauthorizedException)
        })
      })

      describe('an account-owned role is managed where it applies', () => {
        it.each(routes)('%s answers 403 when ROLE_CUSTOM_MANAGEMENT is held in another account only', async (_name, call) => {
          given({ actor: accountAdminOfB })

          await assertForbidden(() => call(this.service), 'You are not allowed to manage the roles of this account')
        })

        it.each(routes)('%s answers 403 to an entity admin on an ENTITY role used in a sibling entity', async (_name, call) => {
          const { prisma } = given({ actor: entityAdminOfE1, assignedIn: [E1, E2] })

          await assertForbidden(() => call(this.service), 'This role is used in an entity you do not administer')

          expect(prisma.role.update).not.toHaveBeenCalled()
          expect(prisma.role.delete).not.toHaveBeenCalled()
        })

        it.each(routes)('%s lets an entity admin manage an ENTITY role used only in its subtree', async (_name, call) => {
          given({ actor: entityAdminOfE1, assignedIn: [E1, E1_CHILD] })

          await call(this.service)
        })

        it.each(routes)('%s lets an entity admin of the account manage an ENTITY role assigned nowhere yet', async (_name, call) => {
          given({ actor: entityAdminOfE1, assignedIn: [] })

          await call(this.service)
        })

        it.each(routes)('%s answers 403 to an entity admin on an ACCOUNT role', async (_name, call) => {
          given({ actor: entityAdminOfE1, role: { id: 5, scope: 'ACCOUNT', accountId: A } })

          await assertForbidden(() => call(this.service))
        })

        it.each(routes)('%s lets the account admin manage an ENTITY role wherever it is used in its account', async (_name, call) => {
          given({ actor: accountAdminOfA, assignedIn: [E1, E2] })

          await call(this.service)
        })

        it('reads the role assignments and the caller once: one checker, built with the entities the role is used in and the sections', async () => {
          const { prisma } = given({ actor: accountAdminOfA, assignedIn: [E1, E2] })

          await update({ permissionIds: [ALLOCATION.id] })

          expect(prisma.userRoleAssignment.findMany).toHaveBeenCalledTimes(1)
          expect(prisma.userRoleAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { roleId: 5, entityId: { not: null } } }))
          expect(this.accountAccessService.getPermissionChecker).toHaveBeenCalledTimes(1)
          expect(this.accountAccessService.getPermissionChecker).toHaveBeenCalledWith(actorId, [E1, E2], { withSubModules: true })
        })

        it('keeps the membership check first (its 404 / 401 answers)', async () => {
          given({ actor: entityAdminOfE1 })
          this.accountAccessService.validateUserAccountAccess.mockRejectedValueOnce(new UnauthorizedException('not a member'))

          await TestAssertions.assertThrows(() => this.service.deleteCustomRole(actorId, 5), UnauthorizedException)
          expect(this.accountAccessService.getPermissionChecker).not.toHaveBeenCalled()
        })
      })

      describe('nobody grants what they do not hold where the role applies', () => {
        it('an entity admin cannot add a permission it does not hold to a role used in its entity (it could hold that role itself)', async () => {
          const { prisma } = given({ actor: entityAdminOfE1, assignedIn: [E1], role: { id: 5, scope: 'ENTITY', accountId: A, permissionIds: [ALLOCATION.id] } })

          await assertForbidden(() => update({ permissionIds: [ALLOCATION.id, ENTITY_CREATION.id] }), 'ENTITY_CREATION')

          expect(prisma.$transaction).not.toHaveBeenCalled()
        })

        it('an entity admin cannot add a section it does not hold', async () => {
          given({ actor: entityAdminOfE1, assignedIn: [E1], role: { id: 5, scope: 'ENTITY', accountId: A, subModuleIds: [USERS.id] } })

          await assertForbidden(() => update({ permissionIds: [], subModuleIds: [USERS.id, ENTITIES.id] }), 'ENTITIES')
        })

        it('what the role already holds needs nothing: sending it back, or removing from it, is allowed', async () => {
          const { tx } = given({
            actor: entityAdminOfE1,
            assignedIn: [E1],
            role: { id: 5, scope: 'ENTITY', accountId: A, permissionIds: [ALLOCATION.id, ENTITY_CREATION.id], subModuleIds: [USERS.id, ENTITIES.id] }
          })

          await update({ permissionIds: [ALLOCATION.id, ENTITY_CREATION.id], subModuleIds: [USERS.id, ENTITIES.id] })
          await update({ permissionIds: [ALLOCATION.id], subModuleIds: [USERS.id] })

          expect(tx.rolePermissionLink.createMany).toHaveBeenCalledTimes(2)
        })

        it('an entity admin cannot mint a role carrying a permission it does not hold, nor an ACCOUNT role', async () => {
          given({ actor: entityAdminOfE1 })

          await assertForbidden(() => this.service.createCustomRole(actorId, A, { name: 'minted', scope: 'ENTITY', permissionIds: [ENTITY_CREATION.id] }), 'ENTITY_CREATION')
          await assertForbidden(() => this.service.createCustomRole(actorId, A, { name: 'minted', scope: 'ACCOUNT', permissionIds: [] }), 'You are not allowed to manage the roles of this account')
        })

        it('an entity admin creates an ENTITY role with what it holds', async () => {
          const { tx } = given({ actor: entityAdminOfE1 })

          await this.service.createCustomRole(actorId, A, { name: 'mine', scope: 'ENTITY', subModuleIds: [USERS.id], permissionIds: [ALLOCATION.id] })

          expect(tx.role.create).toHaveBeenCalled()
          expect(this.accountAccessService.getPermissionChecker).toHaveBeenCalledWith(actorId, [], { withSubModules: true })
        })

        it('the account admin creates an ACCOUNT role with what it holds', async () => {
          const { tx } = given({ actor: accountAdminOfA })

          await this.service.createCustomRole(actorId, A, { name: 'mine', scope: 'ACCOUNT', subModuleIds: [ENTITIES.id], permissionIds: [ACCOUNT_UPDATE.id] })

          expect(tx.role.create).toHaveBeenCalled()
        })

        it('a global template needs platform authority', async () => {
          given({ actor: accountAdminOfA })

          await assertForbidden(() => this.service.createCustomRole(actorId, null, { name: 'template', scope: 'ENTITY', permissionIds: [] }))
        })
      })

      describe('no account or entity role carries a platform section', () => {
        it.each([
          ['an entity admin', 'ENTITY', entityAdminOfE1],
          ['the account admin', 'ACCOUNT', accountAdminOfA],
          ['the platform', 'ACCOUNT', platformAdmin]
        ] as const)('%s cannot create a %s role with one (403, nothing written)', async (_who, scope, actor) => {
          const { tx } = given({ actor })

          await assertForbidden(() => this.service.createCustomRole(actorId, A, { name: 'probe', scope, subModuleIds: [PLATFORM_ACCOUNTS.id], permissionIds: [] }), 'PLATFORM_ACCOUNTS')
          expect(tx.role.create).not.toHaveBeenCalled()
        })

        it('nor add one to an existing role, even a system role edited by the platform', async () => {
          given({ actor: entityAdminOfE1, assignedIn: [E1] })
          await assertForbidden(() => update({ permissionIds: [], subModuleIds: [PLATFORM_ACCOUNTS.id] }), 'PLATFORM_ACCOUNTS')

          given({ actor: platformAdmin, role: { id: 5, scope: 'ENTITY', accountId: null, isSystem: true } })
          await assertForbidden(() => update({ permissionIds: [], subModuleIds: [PLATFORM_ACCOUNTS.id] }), 'PLATFORM_ACCOUNTS')
        })

        it('a PLATFORM global template may carry one', async () => {
          const { tx } = given({ actor: platformAdmin })

          await this.service.createCustomRole(actorId, null, { name: 'console', scope: 'PLATFORM', subModuleIds: [PLATFORM_ACCOUNTS.id], permissionIds: [] })

          expect(tx.role.create).toHaveBeenCalled()
        })
      })
    })
  }
}

// Execute the tests
describe('AccountService (Refactored)', () => {
  const accountServiceTest = new AccountServiceScopeTest()

  beforeEach(async () => {
    await accountServiceTest.setupTest()
  })

  afterEach(async () => {
    await accountServiceTest.cleanupTest()
  })

  // Run all test suites
  accountServiceTest.testFetchAccount()
  accountServiceTest.testUpdateAccountStatus()
  accountServiceTest.testToggleSubModule()
  accountServiceTest.testUpdateAccountUsers()
  accountServiceTest.testFetchAccountUsers()
  accountServiceTest.testFetchAccountEntities()
  accountServiceTest.testFetchAccountRoles()
  accountServiceTest.testUpdateAccountUserAuthority()
  accountServiceTest.testRoleRoutesAreCheckedInTheRoleAccount()
})
