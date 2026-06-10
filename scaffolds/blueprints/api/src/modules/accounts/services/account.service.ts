/**
 * Resources
 */
import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { Prisma } from '@/generated/prisma/client'

/**
 * Dependencies
 */
import { AccountAccessService } from '@common/services/account-access/account-access.service'
import { Logger } from '@common/services/logger/logger.service'
import { PaginationService } from '@common/services/pagination/pagination.service'
import { UserRoleNames } from '@configs/db/user.config'
import { PrismaService } from '@configs/prisma/services/prisma.service'

/**
 * DTO
 */
import { EntityOrderBy, FetchAccountEntitiesDto } from '@modules/accounts/dto/requests/fetch-account-entities.dto'
import { FetchAccountRolesDto, RoleOrderBy } from '@modules/accounts/dto/requests/fetch-account-roles.dto'
import { FetchAccountUsersDto, UserOrderBy } from '@modules/accounts/dto/requests/fetch-account-users.dto'
import { FetchAccountEntitiesResponseDto } from '@modules/accounts/dto/responses/fetch-account-entities.response.dto'
import { FetchAccountRolesResponseDto } from '@modules/accounts/dto/responses/fetch-account-roles.response.dto'
import { FetchAccountUsersResponseDto } from '@modules/accounts/dto/responses/fetch-account-users.response.dto'
import { FetchAccountDeepResponseDto } from '@modules/accounts/dto/responses/fetch_account.response.dto'
import { UpdateAccountStatusResponseDto } from '@modules/accounts/dto/responses/update-account-status.response.dto'
import { UpdateAccountUsersResponseDto } from '@modules/accounts/dto/responses/update-account-users.response.dto'

/**
 * Declaration
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
    private readonly accountAccessService: AccountAccessService,
    private readonly paginationService: PaginationService
  ) {}

  /**
   * End points methods
   */
  public async fetchAccount(userId: string, accountId: string): Promise<FetchAccountDeepResponseDto> {
    this.logger.debug(`Getting information for account ${accountId}`, 'getAccountDetails')

    try {
      // Verify that the user has access to the account
      // Reading the account itself stays allowed even when disabled, so account-admins can
      // see the banner / request reactivation. Mutating endpoints below keep the default rejection.
      const userAccountLink = await this.accountAccessService.validateUserAccountAccess(userId, accountId, 'getAccountDetails', { allowDisabled: true })
      const account = userAccountLink.account

      // Account-scoped membership predicate reused by the pending-signups count below: a user
      // "belongs to" this account either directly (accountsLinked) or via an entity of the account.
      const accountMembershipOr: Prisma.UserWhereInput['OR'] = [{ accountsLinked: { some: { accountId } } }, { entitiesLinked: { some: { entity: { accountId, isActive: true } } } }]

      // Get all data in parallel using a single transaction
      const [users, usersCount, recentEntities, entitiesCount, recentRoles, rolesCount, pendingInvitations, pendingSignups] = await this.prisma.$transaction([
        // Get users
        this.prisma.user.findMany({
          where: {
            isActive: true,
            OR: [
              {
                accountsLinked: {
                  some: {
                    accountId
                  }
                }
              },
              {
                entitiesLinked: {
                  some: {
                    entity: {
                      accountId,
                      isActive: true
                    }
                  }
                }
              }
            ]
          },
          include: {
            people: true,
            roleAssignments: {
              include: {
                role: true
              }
            },
            entitiesLinked: {
              include: {
                entity: {
                  include: {
                    organization: true
                  }
                }
              }
            },
            accountsLinked: {
              where: {
                accountId
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 5
        }),
        // Count users
        this.prisma.user.count({
          where: {
            isActive: true,
            OR: [
              {
                accountsLinked: {
                  some: {
                    accountId
                  }
                }
              },
              {
                entitiesLinked: {
                  some: {
                    entity: {
                      accountId,
                      isActive: true
                    }
                  }
                }
              }
            ]
          }
        }),
        // Get entities
        this.prisma.entity.findMany({
          where: {
            accountId,
            isActive: true
          },
          include: {
            organization: true
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 5
        }),
        // Count entities
        this.prisma.entity.count({
          where: {
            accountId,
            isActive: true
          }
        }),
        // Get roles
        this.prisma.role.findMany({
          where: {
            OR: [{ accountId }, { accountId: null }],
            isActive: true
          },
          include: {
            modulesLinked: { include: { module: true } },
            subModulesLinked: { include: { subModule: true } },
            permissionsLinked: { include: { permission: true } }
          },
          orderBy: {
            createdAt: 'desc'
          },
          // Roles overview shows up to 6 (matches the 3-column responsive grid better than 5).
          take: 6
        }),
        // Count roles
        this.prisma.role.count({
          where: {
            OR: [{ accountId }, { accountId: null }],
            isActive: true
          }
        }),
        // Pending invitations awaiting signup — SENT/EXPIRED invitations targeting this account
        // (directly or via one of its entities).
        this.prisma.invitation.count({
          where: {
            status: { in: ['SENT', 'EXPIRED'] },
            OR: [{ accountsLinked: { some: { accountId } } }, { entitiesLinked: { some: { entity: { accountId } } } }]
          }
        }),
        // Pending self-signups awaiting confirmation — inactive users linked to this account with
        // NO still-pending received invitation (those are counted as pendingInvitations instead).
        this.prisma.user.count({
          where: {
            isActive: false,
            OR: accountMembershipOr,
            receivedInvitations: { none: { status: { in: ['SENT', 'EXPIRED'] } } }
          }
        })
      ])

      // Process users data
      const processedUsers = users.map((user) => {
        const userEntities = user.entitiesLinked
          .filter((entityLink) => entityLink.entity && entityLink.entity.accountId === accountId)
          .map((entityLink) => ({
            id: entityLink.entity.id,
            name: entityLink.entity.organization?.name ?? '',
            organization: entityLink.entity.organization
              ? {
                  id: entityLink.entity.organization.id,
                  name: entityLink.entity.organization.name,
                  type: entityLink.entity.organization.type
                }
              : null
          }))

        return {
          id: user.id,
          email: user.email,
          isActive: user.isActive,
          people: user.people
            ? {
                id: user.people.id,
                firstname: user.people.firstname,
                lastname: user.people.lastname
              }
            : null,
          roles: user.roleAssignments.map((assignment) => ({
            id: assignment.role.id,
            name: assignment.role.name
          })),
          entities: userEntities,
          isDirectlyLinked: user.accountsLinked.length > 0,
          // These deep-overview rows are pre-filtered to active users, so pendingKind is always null
          // here; kept for shape parity with the paginated list rows.
          pendingKind: null as 'invited' | 'awaiting-confirmation' | null,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
          updatedAt: user.updatedAt
        }
      })

      // Process entities data
      const entities = recentEntities.map((entity) => ({
        id: entity.id,
        name: entity.organization?.name ?? '',
        description: entity.organization?.description ?? null,
        isActive: entity.isActive,
        organization: entity.organization
          ? {
              id: entity.organization.id,
              name: entity.organization.name,
              type: entity.organization.type,
              logoUrl: entity.organization.logoUrl,
              description: entity.organization.description,
              website: entity.organization.website
            }
          : null,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt
      }))

      // Process roles data
      const roles = recentRoles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        scope: role.scope,
        isSystem: role.isSystem,
        isActive: role.isActive,
        isGlobal: role.accountId === null,
        modules: role.modulesLinked.map((link) => link.module.name),
        subModules: role.subModulesLinked.map((link) => link.subModule.name),
        permissions: role.permissionsLinked.map((link) => link.permission.name),
        createdAt: role.createdAt,
        updatedAt: role.updatedAt
      }))

      return {
        id: account.id,
        name: account.name,
        description: account.description,
        isActive: account.isActive,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
        pendingInvitations,
        pendingSignups,
        users: {
          count: usersCount,
          values: processedUsers
        },
        entities: {
          count: entitiesCount,
          values: entities
        },
        roles: {
          count: rolesCount,
          values: roles
        }
      }
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof UnauthorizedException) throw error
      this.logger.error(`Failed to get account details: ${error.message}`, 'getAccountDetails')
      throw new BadRequestException('Failed to get account details')
    }
  }

  /**
   * Toggle an account's active flag.
   *
   * Authorization rules — captured here rather than in a guard because the answer depends on
   * BOTH the actor's scope and the account's prior deactivation provenance:
   *
   *   - **Reactivation** (isActive = true)
   *     - PLATFORM-admin can always re-enable any account.
   *     - ACCOUNT-admin can re-enable only if their account was disabled by themselves
   *       (deactivatedByScope = ACCOUNT_OWNER) — but the product rule is that a self-disabled
   *       account can no longer be self-reactivated, so this branch is **forbidden**: the
   *       account-admin must file a reactivation request instead. We hard-block it here.
   *   - **Deactivation** (isActive = false)
   *     - Both PLATFORM-admin and ACCOUNT-admin can disable the account. We record who
   *       initiated it (`deactivatedByScope`) so the reactivation flow knows what's allowed.
   */
  public async updateAccountStatus(userId: string, accountId: string, isActive: boolean): Promise<UpdateAccountStatusResponseDto> {
    this.logger.debug(`Updating account ${accountId} status to ${isActive ? 'active' : 'inactive'} for user ${userId}`, 'updateAccountStatus')

    try {
      // Verify that the user has access to the account
      const userAccountLink = await this.accountAccessService.validateUserAccountAccess(userId, accountId, 'updateAccountStatus', { allowDisabled: true })
      const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId } })

      // No-op
      if (account.isActive === isActive) {
        return { id: account.id, name: account.name, isActive: account.isActive }
      }

      const isPlatformAdmin = await this.isPlatformAdmin(userId)

      if (isActive) {
        // Reactivation path — only platform-admin can flip the switch directly.
        // Account-admins must use the reactivation request workflow.
        if (!isPlatformAdmin) {
          throw new UnauthorizedException('Self-reactivation is not allowed; submit a reactivation request to a platform administrator')
        }
        const updated = await this.prisma.$transaction(async (tx) => {
          // Approve any PENDING request as a side effect of the manual toggle
          await tx.accountReactivationRequest.updateMany({
            where: { accountId, status: 'PENDING' },
            data: { status: 'APPROVED', reviewedById: userId, reviewedAt: new Date(), reviewNote: 'Auto-approved via direct platform reactivation' }
          })
          return tx.account.update({
            where: { id: accountId },
            data: { isActive: true, deactivatedAt: null, deactivatedByUserId: null, deactivatedByScope: null }
          })
        })
        return { id: updated.id, name: updated.name, isActive: updated.isActive }
      }

      // Deactivation path — record provenance.
      const updated = await this.prisma.account.update({
        where: { id: accountId },
        data: {
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedByUserId: userId,
          deactivatedByScope: isPlatformAdmin ? 'PLATFORM' : 'ACCOUNT_OWNER'
        }
      })
      // Silence unused param warning when the link path is the indirectAccess one.
      void userAccountLink
      return { id: updated.id, name: updated.name, isActive: updated.isActive }
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof NotFoundException) throw error
      this.logger.error(`Failed to update account ${accountId} status to ${isActive ? 'active' : 'inactive'} for user ${userId}: ${error.message}`, 'updateAccountStatus')
      throw new BadRequestException(`Failed to ${isActive ? 'activate' : 'deactivate'} account`)
    }
  }

  /**
   * Reactivation requests — created by an account-admin of a disabled account, regardless of
   * who triggered the deactivation (self or platform-admin). The platform-admin reviews the
   * request and decides whether to re-enable the account.
   *
   * Constraints (most enforced by the DB partial unique index `*_pending_uniq`, surfaced
   * here as friendlier exceptions):
   *   - account must currently be inactive
   *   - caller must have account access (already validated upstream by the controller's
   *     `validateUserAccountAccess` bypass branch for disabled accounts)
   *   - at most one PENDING request per account at a time — caller must cancel/replace
   */
  public async createReactivationRequest(userId: string, accountId: string, message: string): Promise<{ id: string; status: 'PENDING' }> {
    this.logger.debug(`Creating reactivation request for account ${accountId} by ${userId}`, 'createReactivationRequest')
    try {
      const account = await this.prisma.account.findUnique({ where: { id: accountId } })
      if (!account) throw new NotFoundException('Account not found')
      if (account.isActive) throw new BadRequestException('Account is already active')

      // Verify the actor still has access (link or assignment) to this account.
      const directLink = await this.prisma.userAccountLink.findUnique({
        where: { userId_accountId: { userId, accountId } }
      })
      if (!directLink) {
        // Fallback: must have an ACCOUNT-scoped role assignment on this account.
        const accountAssignment = await this.prisma.userRoleAssignment.findFirst({
          where: { userId, accountId, role: { scope: 'ACCOUNT' } }
        })
        if (!accountAssignment) throw new UnauthorizedException('Only an account-admin of this account can request reactivation')
      }

      const existing = await this.prisma.accountReactivationRequest.findFirst({ where: { accountId, status: 'PENDING' } })
      if (existing) {
        throw new BadRequestException('A reactivation request is already pending for this account')
      }

      const created = await this.prisma.accountReactivationRequest.create({
        data: { accountId, requestedById: userId, message: message.slice(0, 2000) }
      })
      return { id: created.id, status: 'PENDING' }
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof NotFoundException || error instanceof BadRequestException) throw error
      this.logger.error(`Failed to create reactivation request: ${error.message}`, 'createReactivationRequest')
      throw new BadRequestException('Failed to create reactivation request')
    }
  }

  /**
   * Returns the latest reactivation request for the given account (any status). Used by the
   * disabled-account banner to show "your request is pending since X" or the rejection reason.
   */
  public async fetchLatestReactivationRequestForAccount(accountId: string) {
    return this.prisma.accountReactivationRequest.findFirst({
      where: { accountId },
      include: {
        requestedBy: { include: { people: true } },
        reviewedBy: { include: { people: true } }
      },
      orderBy: { createdAt: 'desc' }
    })
  }

  /**
   * Platform-admin: list reactivation requests, defaulting to PENDING.
   */
  public async fetchPlatformReactivationRequests(dto: { status?: 'PENDING' | 'APPROVED' | 'REJECTED'; page?: number; limit?: number }) {
    const status = dto.status ?? 'PENDING'
    const limit = dto.limit ?? 20
    const [items, total] = await this.prisma.$transaction([
      this.prisma.accountReactivationRequest.findMany({
        where: { status },
        include: {
          account: true,
          requestedBy: { include: { people: true } },
          reviewedBy: { include: { people: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip: this.paginationService.getOffset(dto),
        take: limit
      }),
      this.prisma.accountReactivationRequest.count({ where: { status } })
    ])
    const data = items.map((r) => ({
      id: r.id,
      status: r.status,
      message: r.message,
      reviewNote: r.reviewNote,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
      account: { id: r.account.id, name: r.account.name, isActive: r.account.isActive },
      requestedBy: {
        id: r.requestedBy.id,
        email: r.requestedBy.email,
        people: r.requestedBy.people ? { firstname: r.requestedBy.people.firstname, lastname: r.requestedBy.people.lastname } : null
      },
      reviewedBy: r.reviewedBy
        ? { id: r.reviewedBy.id, email: r.reviewedBy.email, people: r.reviewedBy.people ? { firstname: r.reviewedBy.people.firstname, lastname: r.reviewedBy.people.lastname } : null }
        : null
    }))
    return this.paginationService.createPaginatedResponse(data, dto, total)
  }

  /**
   * Platform-admin: approve a PENDING reactivation request — flips the account back to active
   * and clears the deactivation provenance, all in one transaction.
   */
  public async approveReactivationRequest(reviewerId: string, requestId: string, note?: string) {
    const request = await this.prisma.accountReactivationRequest.findUnique({ where: { id: requestId } })
    if (!request) throw new NotFoundException('Reactivation request not found')
    if (request.status !== 'PENDING') throw new BadRequestException('Request is not pending')

    return this.prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: request.accountId },
        data: { isActive: true, deactivatedAt: null, deactivatedByUserId: null, deactivatedByScope: null }
      })
      const updated = await tx.accountReactivationRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', reviewedById: reviewerId, reviewedAt: new Date(), reviewNote: note ?? null }
      })
      return { id: updated.id, status: updated.status }
    })
  }

  /**
   * Platform-admin: reject a PENDING reactivation request. Account stays disabled.
   */
  public async rejectReactivationRequest(reviewerId: string, requestId: string, note: string) {
    if (!note || note.trim().length === 0) throw new BadRequestException('Rejection requires a note explaining the decision')
    const request = await this.prisma.accountReactivationRequest.findUnique({ where: { id: requestId } })
    if (!request) throw new NotFoundException('Reactivation request not found')
    if (request.status !== 'PENDING') throw new BadRequestException('Request is not pending')
    const updated = await this.prisma.accountReactivationRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', reviewedById: reviewerId, reviewedAt: new Date(), reviewNote: note.slice(0, 2000) }
    })
    return { id: updated.id, status: updated.status }
  }

  /**
   * Internal: does this user hold platform reach?
   * (PLATFORM-scoped assignment holding the PLATFORM_ACCOUNTS sub-module — the same shape used by
   * the access service's bypass since RBAC v2 dropped the ACCOUNT_LIST_ALL permission.)
   */
  private async isPlatformAdmin(userId: string): Promise<boolean> {
    const found = await this.prisma.userRoleAssignment.findFirst({
      where: {
        userId,
        accountId: null,
        entityId: null,
        role: { scope: 'PLATFORM', isActive: true, subModulesLinked: { some: { subModule: { name: 'PLATFORM_ACCOUNTS' } } } }
      }
    })
    return Boolean(found)
  }

  /**
   * Internal: does this user hold an ACCOUNT-scoped admin role on the given account?
   * The marker permission is USER_ACCOUNTS_INVITATION — same one the frontend uses to
   * distinguish account-admin from entity-admin.
   */
  private async isAccountAdminOn(userId: string, accountId: string): Promise<boolean> {
    const found = await this.prisma.userRoleAssignment.findFirst({
      where: {
        userId,
        accountId,
        entityId: null,
        role: { scope: 'ACCOUNT', isActive: true, permissionsLinked: { some: { permission: { name: 'USER_ACCOUNTS_INVITATION' } } } }
      }
    })
    return Boolean(found)
  }

  public async updateAccountUsers(userId: string, accountId: string, userIds: string[]): Promise<UpdateAccountUsersResponseDto> {
    this.logger.debug(`Managing users for account ${accountId}`, 'updateAccountUsers')

    try {
      // Verify access
      await this.accountAccessService.validateUserAccountAccess(userId, accountId, 'updateAccountUsers')

      // Get account with active users and entities
      const account = await this.prisma.account.findUnique({
        where: { id: accountId },
        include: {
          usersLinked: {
            include: {
              user: {
                include: {
                  people: true
                }
              }
            }
          },
          entities: {
            where: { isActive: true },
            include: {
              users: {
                where: { user: { isActive: true } },
                include: { user: true }
              }
            }
          }
        }
      })

      if (!account) throw new NotFoundException(`Account with ID ${accountId} not found`)

      // Calculate users to add and remove
      const currentUserIds = account.usersLinked.map((link) => link.userId)
      const usersToRemove = currentUserIds.filter((id) => !userIds.includes(id))
      const usersToAdd = userIds.filter((id) => !currentUserIds.includes(id))

      // Check if the account would have no active users after the update
      const remainingDirectUsers = currentUserIds.filter((id) => !usersToRemove.includes(id)).length
      const activeUsersInEntities = new Set()
      account.entities.forEach((entity) => {
        entity.users.forEach((userLink) => {
          activeUsersInEntities.add(userLink.user.id)
        })
      })

      if (remainingDirectUsers === 0 && activeUsersInEntities.size === 0) {
        throw new BadRequestException('Cannot update users as it would leave the account without any active users (directly or via active entities)')
      }

      // Update users
      await this.prisma.$transaction(async (prisma) => {
        // Remove users
        if (usersToRemove.length > 0) {
          await prisma.userAccountLink.deleteMany({
            where: {
              userId: { in: usersToRemove },
              accountId
            }
          })
        }

        // Add users
        if (usersToAdd.length > 0) {
          await prisma.userAccountLink.createMany({
            data: usersToAdd.map((userId) => ({
              userId,
              accountId
            }))
          })
        }
      })

      // Get updated users list
      const updatedUsers = await this.prisma.userAccountLink.findMany({
        where: { accountId },
        include: {
          user: {
            include: {
              people: true
            }
          }
        }
      })

      // Process users data
      const users = updatedUsers.map((link) => ({
        id: link.user.id,
        email: link.user.email,
        isActive: link.user.isActive,
        people: link.user.people
          ? {
              id: link.user.people.id,
              firstname: link.user.people.firstname,
              lastname: link.user.people.lastname
            }
          : null
      }))

      return {
        id: account.id,
        name: account.name,
        users
      }
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof UnauthorizedException) throw error
      this.logger.error(`Failed to manage users for account ${accountId}: ${error.message}`, 'manageAccountUsers')
      throw new BadRequestException('Failed to update account users')
    }
  }

  public async fetchAccountUsers(userId: string, accountId: string, filters: FetchAccountUsersDto): Promise<FetchAccountUsersResponseDto> {
    this.logger.debug(`Fetching users for account ${accountId} with filters ${JSON.stringify(filters)}`, 'fetchAccountUsers')

    try {
      // Verify that the user has access to the account
      await this.accountAccessService.validateUserAccountAccess(userId, accountId, 'fetchAccountUsers')

      // Build base query for filtering
      const accessConditions: Prisma.UserWhereInput[] = []

      // Include directly linked users if requested
      if (filters.includeDirectUsers !== false) {
        accessConditions.push({
          accountsLinked: {
            some: {
              accountId
            }
          }
        })
      }

      // Include users from entities
      accessConditions.push({
        entitiesLinked: {
          some: {
            entity: {
              accountId
            }
          }
        }
      })

      // Build search conditions if provided
      let searchConditions: Prisma.UserWhereInput | undefined
      if (filters.search) {
        const searchTerm = filters.search
        this.logger.debug(`Search term: ${searchTerm}`, 'fetchAccountUsers')
        searchConditions = {
          OR: [
            {
              email: {
                contains: searchTerm,
                mode: 'insensitive'
              }
            },
            {
              people: {
                OR: [
                  {
                    firstname: {
                      contains: searchTerm,
                      mode: 'insensitive'
                    }
                  },
                  {
                    lastname: {
                      contains: searchTerm,
                      mode: 'insensitive'
                    }
                  }
                ]
              }
            }
          ]
        }
        this.logger.debug(`Search conditions: ${JSON.stringify(searchConditions)}`, 'fetchAccountUsers')
      }

      // Build entity filter as a separate AND condition so it applies to all users (direct + entity-linked)
      let entityFilterCondition: Prisma.UserWhereInput | undefined
      if (filters.entityIds && filters.entityIds.length > 0) {
        entityFilterCondition = {
          entitiesLinked: {
            some: {
              entity: {
                accountId,
                id: {
                  in: filters.entityIds
                }
              }
            }
          }
        }
      }

      // Combine all conditions
      const baseWhereClause: Prisma.UserWhereInput = {
        AND: [{ OR: accessConditions }, ...(searchConditions ? [searchConditions] : []), ...(entityFilterCondition ? [entityFilterCondition] : [])]
      }

      this.logger.debug(`Final query: ${JSON.stringify(baseWhereClause)}`, 'fetchAccountUsers')

      // Apply role filter if provided
      if (filters.roleIds && filters.roleIds.length > 0) {
        baseWhereClause.roleAssignments = {
          some: {
            role: {
              id: {
                in: filters.roleIds
              }
            }
          }
        }
      }

      // Apply active status filter if provided
      if (filters.isActive !== undefined) {
        baseWhereClause.isActive = filters.isActive
      }

      // Get users and count in parallel
      const [users, total] = await this.prisma.$transaction([
        this.prisma.user.findMany({
          where: baseWhereClause,
          include: {
            people: true,
            roleAssignments: {
              include: {
                role: true
              }
            },
            entitiesLinked: {
              include: {
                entity: {
                  include: {
                    organization: true
                  }
                }
              }
            },
            accountsLinked: {
              where: {
                accountId
              }
            },
            // Pending discrimination (invited vs self-signup) — load only the still-pending
            // received invitations (SENT/EXPIRED). Presence ⇒ invited; absence on an inactive
            // user ⇒ self-signup awaiting email confirmation.
            receivedInvitations: {
              where: { status: { in: ['SENT', 'EXPIRED'] } },
              select: { id: true }
            }
          },
          orderBy: this.getUserOrderBy(filters.orderBy),
          skip: this.paginationService.getOffset(filters),
          take: filters.limit
        }),
        this.prisma.user.count({
          where: baseWhereClause
        })
      ])

      // Process users data
      const userData = users.map((user) => {
        const userEntities = user.entitiesLinked
          .filter((entityLink) => entityLink.entity && entityLink.entity.accountId === accountId)
          .map((entityLink) => ({
            id: entityLink.entity.id,
            name: entityLink.entity.organization?.name ?? '',
            organization: entityLink.entity.organization
              ? {
                  id: entityLink.entity.organization.id,
                  name: entityLink.entity.organization.name,
                  type: entityLink.entity.organization.type
                }
              : null
          }))

        return {
          id: user.id,
          email: user.email,
          isActive: user.isActive,
          people: user.people
            ? {
                id: user.people.id,
                firstname: user.people.firstname,
                lastname: user.people.lastname
              }
            : null,
          roles: user.roleAssignments.map((assignment) => ({
            id: assignment.role.id,
            name: assignment.role.name
          })),
          entities: userEntities,
          isDirectlyLinked: user.accountsLinked.length > 0,
          pendingKind: this.computePendingKind(user.isActive, user.receivedInvitations.length > 0),
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
          updatedAt: user.updatedAt
        }
      })

      return this.paginationService.createPaginatedResponse(userData, filters, total)
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof UnauthorizedException) throw error
      this.logger.error(`Failed to fetch users for account ${accountId}: ${error.message}`, 'fetchAccountUsers')
      throw new BadRequestException('Failed to fetch account users')
    }
  }

  public async fetchAccountEntities(userId: string, accountId: string, dto: FetchAccountEntitiesDto): Promise<FetchAccountEntitiesResponseDto> {
    this.logger.debug(`Fetching entities for account ${accountId} with filters`, 'fetchAccountEntities')

    try {
      // Verify that the user has access to the account
      await this.accountAccessService.validateUserAccountAccess(userId, accountId, 'fetchAccountEntities')

      // B3b — hierarchical scope (§4.1): an account-admin / platform-admin sees every account entity
      // (visibleEntityIds === null = no restriction); an entity-admin sees only its subtree(s) — the
      // entities it admins + all descendants (resolved via a recursive CTE). An empty array means the
      // caller has no entity-admin foothold here, so the listing is empty.
      const visibleEntityIds = await this.accountAccessService.resolveVisibleEntityIdsForAccount(userId, accountId)

      // Build where clause for filtering
      const whereClause: Prisma.EntityWhereInput = {
        accountId
      }
      if (visibleEntityIds !== null) {
        whereClause.id = { in: visibleEntityIds }
      }

      // Apply active status filter if provided
      if (dto.isActive !== undefined) {
        whereClause.isActive = dto.isActive
      }

      // Apply user filter if provided
      if (dto.userIds && dto.userIds.length > 0) {
        whereClause.users = {
          some: {
            userId: {
              in: dto.userIds
            }
          }
        }

        // Apply inactive users filter if requested
        if (dto.includeInactiveUsers !== true) {
          whereClause.users = {
            some: {
              user: {
                isActive: true,
                id: {
                  in: dto.userIds
                }
              }
            }
          }
        }
      }

      // Apply text search filter if provided
      if (dto.search) {
        const searchTerm = dto.search
        // Entity name/description live on the typed profile (D-ENT-6) — search the organization.
        whereClause.OR = [
          {
            organization: {
              name: {
                contains: searchTerm,
                mode: 'insensitive'
              }
            }
          },
          {
            organization: {
              description: {
                contains: searchTerm,
                mode: 'insensitive'
              }
            }
          }
        ]
      }

      // Get entities and count in parallel
      const [entities, total] = await this.prisma.$transaction([
        this.prisma.entity.findMany({
          where: whereClause,
          include: {
            organization: true,
            _count: {
              select: {
                users: { where: { user: { isActive: true } } }
              }
            }
          },
          orderBy: this.getEntityOrderBy(dto.orderBy),
          skip: this.paginationService.getOffset(dto),
          take: dto.limit
        }),
        this.prisma.entity.count({
          where: whereClause
        })
      ])

      // Process entities data
      const entitiesData = entities.map((entity) => ({
        id: entity.id,
        name: entity.organization?.name ?? '',
        description: entity.organization?.description ?? null,
        isActive: entity.isActive,
        organization: entity.organization
          ? {
              id: entity.organization.id,
              name: entity.organization.name,
              type: entity.organization.type,
              logoUrl: entity.organization.logoUrl,
              description: entity.organization.description,
              website: entity.organization.website
            }
          : null,
        userCount: entity._count.users,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt
      }))

      return this.paginationService.createPaginatedResponse(entitiesData, dto, total)
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof UnauthorizedException) throw error
      this.logger.error(`Failed to fetch entities for account ${accountId}: ${error.message}`, 'fetchAccountEntities')
      throw new BadRequestException('Failed to fetch account entities')
    }
  }

  public async fetchAccountRoles(userId: string, accountId: string, dto: FetchAccountRolesDto): Promise<FetchAccountRolesResponseDto> {
    this.logger.debug(`Fetching roles for account ${accountId} with filters`, 'fetchAccountRoles')

    try {
      // Verify that the user has access to the account
      await this.accountAccessService.validateUserAccountAccess(userId, accountId, 'fetchAccountRoles')

      // Build where clause for filtering
      const whereClause: Prisma.RoleWhereInput = {
        OR: [{ accountId }, { accountId: null }]
      }

      // Apply active status filter if provided
      if (dto.isActive !== undefined) {
        whereClause.isActive = dto.isActive
      }

      // Apply text search filter if provided
      if (dto.search) {
        const searchTerm = dto.search
        whereClause.AND = [
          {
            name: {
              contains: searchTerm,
              mode: 'insensitive'
            }
          }
        ]
      }

      // Get roles and count in parallel
      const [roles, total] = await this.prisma.$transaction([
        this.prisma.role.findMany({
          where: whereClause,
          include: {
            modulesLinked: { include: { module: true } },
            subModulesLinked: { include: { subModule: true } },
            permissionsLinked: { include: { permission: true } }
          },
          orderBy: this.getRoleOrderBy(dto.orderBy),
          skip: this.paginationService.getOffset(dto),
          take: dto.limit
        }),
        this.prisma.role.count({
          where: whereClause
        })
      ])

      // Process roles data
      const rolesData = roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        scope: role.scope,
        isSystem: role.isSystem,
        isActive: role.isActive,
        isGlobal: role.accountId === null,
        modules: role.modulesLinked.map((link) => link.module.name),
        subModules: role.subModulesLinked.map((link) => link.subModule.name),
        permissions: role.permissionsLinked.map((link) => link.permission.name),
        createdAt: role.createdAt,
        updatedAt: role.updatedAt
      }))

      return this.paginationService.createPaginatedResponse(rolesData, dto, total)
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof UnauthorizedException) throw error
      this.logger.error(`Failed to fetch roles for account ${accountId}: ${error.message}`, 'fetchAccountRoles')
      throw new BadRequestException('Failed to fetch account roles')
    }
  }

  /**
   * List the platform-wide system roles (those with accountId NULL).
   *
   * Used by the platform-admin browsing the Roles tab without a specific account selected.
   * Returns the same shape as fetchAccountRoles for UI uniformity (modules + permissions included).
   */
  public async fetchSystemRoles(dto: { search?: string; isActive?: boolean; page?: number; limit?: number; orderBy?: RoleOrderBy }) {
    this.logger.debug('Fetching system roles (platform-wide)', 'fetchSystemRoles')
    try {
      const where: Prisma.RoleWhereInput = { accountId: null }
      if (dto.isActive !== undefined) where.isActive = dto.isActive
      if (dto.search) where.name = { contains: dto.search, mode: 'insensitive' }

      const [roles, total] = await this.prisma.$transaction([
        this.prisma.role.findMany({
          where,
          include: {
            modulesLinked: { include: { module: true } },
            subModulesLinked: { include: { subModule: true } },
            permissionsLinked: { include: { permission: true } }
          },
          orderBy: this.getRoleOrderBy(dto.orderBy),
          skip: this.paginationService.getOffset(dto),
          take: dto.limit ?? 50
        }),
        this.prisma.role.count({ where })
      ])

      const data = roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        scope: role.scope,
        isSystem: role.isSystem,
        isActive: role.isActive,
        isGlobal: true,
        modules: role.modulesLinked.map((link) => link.module.name),
        subModules: role.subModulesLinked.map((link) => link.subModule.name),
        permissions: role.permissionsLinked.map((link) => link.permission.name),
        createdAt: role.createdAt,
        updatedAt: role.updatedAt
      }))

      return this.paginationService.createPaginatedResponse(data, dto, total)
    } catch (error) {
      this.logger.error(`Failed to fetch system roles: ${error.message}`, 'fetchSystemRoles')
      throw new BadRequestException('Failed to fetch system roles')
    }
  }

  /**
   * Platform-wide listing of every account on the platform (paginated, searchable, status-filterable).
   * Caller must hold the PLATFORM_ACCOUNTS section (platform reach) — enforced upstream by the controller.
   *
   * Returns:
   * - `items`     : the page slice (post-filter)
   * - `meta`      : pagination block (post-filter)
   * - `aggregates`: GLOBAL counters (active / disabled / pending), independent of the current
   *   filter — drives the clickable KPI cards which need stable values regardless of what's
   *   being filtered. Pending = accounts with at least one PENDING reactivation request.
   *
   * Each row carries `pendingReactivation` (the latest PENDING request, or null) so the row
   * itself can be rendered as a clickable cell that opens the approve/reject drawer.
   *
   * Filters:
   * - `isActive`              — narrow to active or disabled accounts
   * - `withPendingReactivation` — narrow to accounts that currently have a PENDING request
   * - `search`                — id / name / description, case-insensitive
   */
  public async fetchAllAccounts(dto: { search?: string; isActive?: boolean; withPendingReactivation?: boolean; page?: number; limit?: number }) {
    this.logger.debug('Fetching all accounts (platform-admin)', 'fetchAllAccounts')
    try {
      const where: Prisma.AccountWhereInput = {}
      if (dto.isActive !== undefined) where.isActive = dto.isActive
      if (dto.withPendingReactivation) {
        where.reactivationRequests = { some: { status: 'PENDING' } }
      }
      if (dto.search) {
        where.OR = [{ name: { contains: dto.search, mode: 'insensitive' } }, { description: { contains: dto.search, mode: 'insensitive' } }, { id: { contains: dto.search, mode: 'insensitive' } }]
      }

      // Global aggregates — stable across filter changes so the KPI cards don't jump around.
      const [items, total, totalAll, activeCount, disabledCount, pendingCount] = await this.prisma.$transaction([
        this.prisma.account.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: this.paginationService.getOffset(dto),
          take: dto.limit ?? 20,
          select: {
            id: true,
            name: true,
            description: true,
            isActive: true,
            deactivatedByScope: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { usersLinked: true, entities: true } },
            reactivationRequests: {
              where: { status: 'PENDING' },
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { requestedBy: { include: { people: true } } }
            }
          }
        }),
        this.prisma.account.count({ where }),
        this.prisma.account.count(),
        this.prisma.account.count({ where: { isActive: true } }),
        this.prisma.account.count({ where: { isActive: false } }),
        this.prisma.account.count({ where: { reactivationRequests: { some: { status: 'PENDING' } } } })
      ])

      const data = items.map((acc) => {
        const pending = acc.reactivationRequests[0]
        return {
          id: acc.id,
          name: acc.name,
          description: acc.description,
          isActive: acc.isActive,
          deactivatedByScope: acc.deactivatedByScope,
          usersCount: acc._count.usersLinked,
          entitiesCount: acc._count.entities,
          createdAt: acc.createdAt,
          updatedAt: acc.updatedAt,
          pendingReactivation: pending
            ? {
                id: pending.id,
                message: pending.message,
                createdAt: pending.createdAt,
                requestedBy: {
                  id: pending.requestedBy.id,
                  email: pending.requestedBy.email,
                  people: pending.requestedBy.people ? { firstname: pending.requestedBy.people.firstname, lastname: pending.requestedBy.people.lastname } : null
                }
              }
            : null
        }
      })

      const paginated = this.paginationService.createPaginatedResponse(data, dto, total)
      return {
        ...paginated,
        aggregates: { total: totalAll, active: activeCount, disabled: disabledCount, pending: pendingCount }
      }
    } catch (error) {
      this.logger.error(`Failed to fetch all accounts: ${error.message}`, 'fetchAllAccounts')
      throw new BadRequestException('Failed to fetch all accounts')
    }
  }

  /**
   * Create a custom role.
   *
   * Scope vs accountId — both axes are independent:
   *
   *   - `accountId = null` ⇒ GLOBAL TEMPLATE, visible to every account on the platform.
   *     Same shape as the seeded system roles (`admin`, `user`, `entity-admin`, …) but with
   *     `isSystem = false` so it remains editable/deletable. Reachable only via the
   *     `/accounts/platform/roles` route which is gated by ACCOUNT_LIST_ALL.
   *     The role's `scope` (PLATFORM / ACCOUNT / ENTITY) tells the runtime AT WHICH layer
   *     the assignment will materialize when consumed.
   *
   *   - `accountId = X` ⇒ TENANT-OWNED ROLE, visible only inside account X. Caller needs
   *     write access to that account. Scope must be ACCOUNT or ENTITY (PLATFORM-scoped
   *     tenant-owned roles make no sense — there is no platform-level audience inside a
   *     single account).
   *
   * Always created with isSystem=false.
   */
  public async createCustomRole(
    userId: string,
    accountId: string | null,
    payload: { name: string; description?: string | null; scope: 'PLATFORM' | 'ACCOUNT' | 'ENTITY'; subModuleIds?: number[]; permissionIds: number[] }
  ): Promise<{ id: number; name: string; scope: 'PLATFORM' | 'ACCOUNT' | 'ENTITY' }> {
    this.logger.debug(`Creating custom role '${payload.name}' (scope=${payload.scope}, account=${accountId ?? 'global-template'})`, 'createCustomRole')
    try {
      if (accountId === null) {
        // Global template path — platform-admin authorization already checked by route guard.
        // Any scope is allowed (PLATFORM template, ACCOUNT template, or ENTITY template).
      } else {
        if (payload.scope === 'PLATFORM') {
          throw new BadRequestException('PLATFORM-scoped roles cannot be attached to a single account')
        }
        await this.accountAccessService.validateUserAccountAccess(userId, accountId, 'createCustomRole')
        // Entity-admin actor (no PLATFORM bypass, no ACCOUNT-admin role on this account) can only
        // mint ENTITY-scoped roles — they have no authority over the broader ACCOUNT layer.
        const isPlatformAdmin = await this.isPlatformAdmin(userId)
        if (!isPlatformAdmin) {
          const isAccountAdmin = await this.isAccountAdminOn(userId, accountId)
          if (!isAccountAdmin && payload.scope !== 'ENTITY') {
            throw new UnauthorizedException('Entity-admins can only create ENTITY-scoped custom roles')
          }
        }
      }

      // Validate that every requested permission is compatible with the chosen scope
      const permissions = await this.prisma.modulePermission.findMany({
        where: { id: { in: payload.permissionIds } }
      })
      if (permissions.length !== payload.permissionIds.length) {
        throw new BadRequestException('One or more permissions could not be found')
      }
      const incompatible = permissions.filter((p) => !p.applicableScopes.includes(payload.scope))
      if (incompatible.length > 0) {
        throw new BadRequestException(`Permissions not applicable to scope ${payload.scope}: ${incompatible.map((p) => p.name).join(', ')}`)
      }

      // Validate the explicitly-requested sub-modules exist.
      const requestedSubModuleIds = payload.subModuleIds ?? []
      const subModules = requestedSubModuleIds.length > 0 ? await this.prisma.subModule.findMany({ where: { id: { in: requestedSubModuleIds } } }) : []
      if (subModules.length !== requestedSubModuleIds.length) {
        throw new BadRequestException('One or more sub-modules could not be found')
      }

      // Derive the grant set per RBAC v2 (insert order: module → sub-module → permission so the integrity trigger is satisfied):
      //   - sub-modules = explicit selection ∪ the sub-module implied by each permission carrying a subModuleId (auto-include);
      //   - modules     = (each granted sub-module's module) ∪ (each granted permission's module).
      const permissionSubModuleIds = permissions.map((p) => p.subModuleId).filter((id): id is number => id !== null)
      const effectiveSubModuleIds = Array.from(new Set([...requestedSubModuleIds, ...permissionSubModuleIds]))
      // Re-resolve every effective sub-module (the implied ones may not be in `subModules`) to get their parent modules.
      const effectiveSubModules = effectiveSubModuleIds.length > 0 ? await this.prisma.subModule.findMany({ where: { id: { in: effectiveSubModuleIds } } }) : []
      const moduleIds = Array.from(new Set([...permissions.map((p) => p.moduleId), ...effectiveSubModules.map((sm) => sm.moduleId)]))

      const created = await this.prisma.$transaction(async (tx) => {
        const role = await tx.role.create({
          data: {
            name: payload.name,
            description: payload.description ?? null,
            scope: payload.scope,
            isSystem: false,
            isActive: true,
            accountId
          }
        })
        if (moduleIds.length > 0) {
          await tx.roleModuleLink.createMany({ data: moduleIds.map((moduleId) => ({ roleId: role.id, moduleId })) })
        }
        if (effectiveSubModuleIds.length > 0) {
          await tx.roleSubModuleLink.createMany({ data: effectiveSubModuleIds.map((subModuleId) => ({ roleId: role.id, subModuleId })) })
        }
        if (payload.permissionIds.length > 0) {
          await tx.rolePermissionLink.createMany({ data: payload.permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })) })
        }
        return role
      })

      return { id: created.id, name: created.name, scope: created.scope as 'PLATFORM' | 'ACCOUNT' | 'ENTITY' }
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof UnauthorizedException || error instanceof BadRequestException) throw error
      this.logger.error(`Failed to create custom role: ${error.message}`, 'createCustomRole')
      throw new BadRequestException('Failed to create custom role')
    }
  }

  /**
   * Update a role's identity and/or permission set.
   *
   * Authorization rules:
   * - System roles (isSystem = true) only allow editing their permissionIds — their name,
   *   description, scope and existence are immutable so the platform identity remains stable.
   *   Caller must hold ROLE_CUSTOM_MANAGEMENT in the PLATFORM scope (enforced by the controller).
   * - Custom roles (isSystem = false) can edit name / description / permissionIds. Caller must
   *   have access to the role's owning account.
   */
  public async updateCustomRole(
    userId: string,
    roleId: number,
    payload: { name?: string; description?: string | null; subModuleIds?: number[]; permissionIds?: number[] }
  ): Promise<{ id: number; name: string }> {
    this.logger.debug(`Updating role ${roleId}`, 'updateCustomRole')
    try {
      const role = await this.prisma.role.findUnique({ where: { id: roleId } })
      if (!role) throw new NotFoundException('Role not found')

      if (role.isSystem) {
        // System role: only the grant set (sub-modules + permissions) is editable.
        if (payload.name !== undefined || payload.description !== undefined) {
          throw new UnauthorizedException('System roles cannot be renamed or have their description changed')
        }
        if (payload.permissionIds === undefined && payload.subModuleIds === undefined) {
          // Nothing to do
          return { id: role.id, name: role.name }
        }
      } else {
        // Custom role: caller needs access to the owning account.
        if (!role.accountId) throw new UnauthorizedException('Custom role is missing its owning account')
        await this.accountAccessService.validateUserAccountAccess(userId, role.accountId, 'updateCustomRole')
        // Entity-admins can only edit ENTITY-scoped custom roles on their account.
        const isPlatformAdmin = await this.isPlatformAdmin(userId)
        if (!isPlatformAdmin) {
          const isAccountAdmin = await this.isAccountAdminOn(userId, role.accountId)
          if (!isAccountAdmin && role.scope !== 'ENTITY') {
            throw new UnauthorizedException('Entity-admins can only edit ENTITY-scoped custom roles')
          }
        }
      }

      // A grant rewrite is triggered when EITHER the sub-modules or the permissions are supplied —
      // the two are written together so the derived module / sub-module / permission set stays coherent.
      const rewriteGrants = payload.permissionIds !== undefined || payload.subModuleIds !== undefined
      const nextPermissionIds = payload.permissionIds ?? []
      const nextSubModuleIds = payload.subModuleIds ?? []

      if (rewriteGrants) {
        const permissions = await this.prisma.modulePermission.findMany({ where: { id: { in: nextPermissionIds } } })
        if (permissions.length !== nextPermissionIds.length) {
          throw new BadRequestException('One or more permissions could not be found')
        }
        const incompatible = permissions.filter((p) => !p.applicableScopes.includes(role.scope))
        if (incompatible.length > 0) {
          throw new BadRequestException(`Permissions not applicable to scope ${role.scope}: ${incompatible.map((p) => p.name).join(', ')}`)
        }
        if (nextSubModuleIds.length > 0) {
          const subModules = await this.prisma.subModule.findMany({ where: { id: { in: nextSubModuleIds } } })
          if (subModules.length !== nextSubModuleIds.length) {
            throw new BadRequestException('One or more sub-modules could not be found')
          }
        }
      }

      const updated = await this.prisma.$transaction(async (tx) => {
        const next = role.isSystem
          ? role
          : await tx.role.update({
              where: { id: roleId },
              data: {
                name: payload.name ?? role.name,
                description: payload.description !== undefined ? payload.description : role.description
              }
            })
        if (rewriteGrants) {
          // Tear down in reverse-dependency order, then recreate module → sub-module → permission
          // so the integrity trigger (permission ⊆ sub-module ⊆ module) is satisfied at every step.
          await tx.rolePermissionLink.deleteMany({ where: { roleId } })
          await tx.roleSubModuleLink.deleteMany({ where: { roleId } })
          await tx.roleModuleLink.deleteMany({ where: { roleId } })

          const permissions = await tx.modulePermission.findMany({ where: { id: { in: nextPermissionIds } } })
          const permissionSubModuleIds = permissions.map((p) => p.subModuleId).filter((id): id is number => id !== null)
          const effectiveSubModuleIds = Array.from(new Set([...nextSubModuleIds, ...permissionSubModuleIds]))
          const effectiveSubModules = effectiveSubModuleIds.length > 0 ? await tx.subModule.findMany({ where: { id: { in: effectiveSubModuleIds } } }) : []
          const moduleIds = Array.from(new Set([...permissions.map((p) => p.moduleId), ...effectiveSubModules.map((sm) => sm.moduleId)]))

          if (moduleIds.length > 0) {
            await tx.roleModuleLink.createMany({ data: moduleIds.map((moduleId) => ({ roleId, moduleId })) })
          }
          if (effectiveSubModuleIds.length > 0) {
            await tx.roleSubModuleLink.createMany({ data: effectiveSubModuleIds.map((subModuleId) => ({ roleId, subModuleId })) })
          }
          if (nextPermissionIds.length > 0) {
            await tx.rolePermissionLink.createMany({ data: nextPermissionIds.map((permissionId) => ({ roleId, permissionId })) })
          }
        }
        return next
      })

      return { id: updated.id, name: updated.name }
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof UnauthorizedException || error instanceof BadRequestException) throw error
      this.logger.error(`Failed to update role: ${error.message}`, 'updateCustomRole')
      throw new BadRequestException('Failed to update role')
    }
  }

  /**
   * Delete a custom role. System roles cannot be deleted. Active assignments to this role are removed via cascade.
   */
  public async deleteCustomRole(userId: string, roleId: number): Promise<{ id: number }> {
    this.logger.debug(`Deleting custom role ${roleId}`, 'deleteCustomRole')
    try {
      const role = await this.prisma.role.findUnique({ where: { id: roleId } })
      if (!role) throw new NotFoundException('Role not found')
      if (role.isSystem) throw new UnauthorizedException('System roles cannot be deleted')
      if (!role.accountId) throw new UnauthorizedException('Cannot delete a global role from this endpoint')

      await this.accountAccessService.validateUserAccountAccess(userId, role.accountId, 'deleteCustomRole')

      // Entity-admins can only delete ENTITY-scoped custom roles.
      const isPlatformAdmin = await this.isPlatformAdmin(userId)
      if (!isPlatformAdmin) {
        const isAccountAdmin = await this.isAccountAdminOn(userId, role.accountId)
        if (!isAccountAdmin && role.scope !== 'ENTITY') {
          throw new UnauthorizedException('Entity-admins can only delete ENTITY-scoped custom roles')
        }
      }

      await this.prisma.role.delete({ where: { id: roleId } })
      return { id: roleId }
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof UnauthorizedException) throw error
      this.logger.error(`Failed to delete custom role: ${error.message}`, 'deleteCustomRole')
      throw new BadRequestException('Failed to delete custom role')
    }
  }

  /**
   * Toggle a role's `isActive` flag.
   *
   * Authorization rules:
   *   - The seeded `platform-admin` role can NEVER be disabled — self-lockout protection
   *     (deactivating it strips a platform-admin of their own platform privileges, with no
   *     in-app recovery path).
   *   - PLATFORM-admin (`ACCOUNT_LIST_ALL`) can toggle any other role: system templates AND
   *     account-owned custom roles.
   *   - Account-admin (with `ROLE_CUSTOM_MANAGEMENT`) can toggle only their account's own
   *     custom roles (`accountId = X`, `isSystem = false`). They CANNOT toggle system templates
   *     even within their account scope.
   */
  public async toggleRoleStatus(userId: string, roleId: number, isActive: boolean): Promise<{ id: number; isActive: boolean }> {
    this.logger.debug(`Toggling role ${roleId} → isActive=${isActive}`, 'toggleRoleStatus')
    try {
      const role = await this.prisma.role.findUnique({ where: { id: roleId } })
      if (!role) throw new NotFoundException('Role not found')

      // Self-lockout guard
      if (role.name === 'platform-admin' && !isActive) {
        throw new BadRequestException('platform-admin role cannot be deactivated')
      }

      const isPlatformAdmin = await this.isPlatformAdmin(userId)

      if (!isPlatformAdmin) {
        // Account-admin path — only their own custom roles
        if (role.isSystem) throw new UnauthorizedException('Only platform-admin can toggle system roles')
        if (!role.accountId) throw new UnauthorizedException('Only platform-admin can toggle global templates')
        await this.accountAccessService.validateUserAccountAccess(userId, role.accountId, 'toggleRoleStatus')
        // Caller also needs ROLE_CUSTOM_MANAGEMENT — enforced at the route via @RequirePermissions.
        // Entity-admins can only toggle ENTITY-scoped custom roles.
        const isAccountAdmin = await this.isAccountAdminOn(userId, role.accountId)
        if (!isAccountAdmin && role.scope !== 'ENTITY') {
          throw new UnauthorizedException('Entity-admins can only toggle ENTITY-scoped custom roles')
        }
      }

      const updated = await this.prisma.role.update({ where: { id: roleId }, data: { isActive } })
      return { id: updated.id, isActive: updated.isActive }
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof UnauthorizedException || error instanceof BadRequestException) throw error
      this.logger.error(`Failed to toggle role status: ${error.message}`, 'toggleRoleStatus')
      throw new BadRequestException('Failed to toggle role status')
    }
  }

  /**
   * List every active module + its permission catalog with applicable scopes, RBAC v2-grouped.
   *
   * Each module exposes:
   *   - `subModules`            : the sections (read-visibility toggles) with the permissions attached to them;
   *   - `standalonePermissions` : the permissions attached directly to the module (no sub-module — simple modules);
   *   - `permissions`           : BACKWARD-COMPATIBLE flat union of every permission in the module (sub-module
   *                               or not), kept for callers that still consume the flat list.
   *
   * Used by the role-builder UI to render sections-as-visibility-toggles plus the actions within each section.
   */
  public async fetchPermissionsCatalog(): Promise<
    {
      moduleId: number
      moduleName: string
      moduleDescription: string
      permissions: { id: number; name: string; description: string; applicableScopes: ('PLATFORM' | 'ACCOUNT' | 'ENTITY')[] }[]
      standalonePermissions: { id: number; name: string; description: string; applicableScopes: ('PLATFORM' | 'ACCOUNT' | 'ENTITY')[] }[]
      subModules: { id: number; name: string; description: string; permissions: { id: number; name: string; description: string; applicableScopes: ('PLATFORM' | 'ACCOUNT' | 'ENTITY')[] }[] }[]
    }[]
  > {
    const modules = await this.prisma.module.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      include: {
        permissions: { orderBy: { name: 'asc' } },
        subModules: { orderBy: { name: 'asc' } }
      }
    })

    const mapPermission = (p: { id: number; name: string; description: string; applicableScopes: unknown }) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      applicableScopes: p.applicableScopes as ('PLATFORM' | 'ACCOUNT' | 'ENTITY')[]
    })

    return modules.map((m) => ({
      moduleId: m.id,
      moduleName: m.name,
      moduleDescription: m.description,
      permissions: m.permissions.map(mapPermission),
      standalonePermissions: m.permissions.filter((p) => p.subModuleId === null).map(mapPermission),
      subModules: m.subModules.map((sm) => ({
        id: sm.id,
        name: sm.name,
        description: sm.description,
        permissions: m.permissions.filter((p) => p.subModuleId === sm.id).map(mapPermission)
      }))
    }))
  }

  /**
   * List every module on the platform (active and inactive), with their permissions and the
   * type they belong to. Drives the Platform → Modules administration page where a platform-admin
   * can flip the `isActive` switch.
   */
  public async fetchPlatformModules() {
    const modules = await this.prisma.module.findMany({
      orderBy: [{ type: { name: 'asc' } }, { name: 'asc' }],
      include: {
        type: true,
        permissions: { orderBy: { name: 'asc' } },
        subModules: {
          orderBy: { id: 'asc' },
          include: { permissions: { orderBy: { name: 'asc' } } }
        }
      }
    })

    const mapPermission = (p: { id: number; name: string; description: string; subModuleId: number | null; applicableScopes: unknown[] }) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      subModuleId: p.subModuleId,
      applicableScopes: p.applicableScopes as ('PLATFORM' | 'ACCOUNT' | 'ENTITY')[]
    })

    return modules.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      version: m.version,
      typeId: m.typeId,
      typeName: m.type.name,
      isActive: m.isActive,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      // Module-level permissions only (those with no sub-module). Sub-module permissions are nested below.
      permissions: m.permissions.filter((p) => p.subModuleId === null).map(mapPermission),
      subModules: m.subModules.map((sm) => ({
        id: sm.id,
        name: sm.name,
        description: sm.description,
        isActive: sm.isActive,
        permissions: sm.permissions.map(mapPermission)
      }))
    }))
  }

  /**
   * Platform-wide users listing — deduplicated by user id, with their account / entity attachments
   * aggregated. Drives the PLATFORM_ALL "Users" tab.
   *
   * `accountScope` narrows the result and is wired to the clickable KPI cards on the frontend:
   *   - 'all'       : non-platform users only (default)
   *   - 'multi'     : non-platform users sitting on more than one account
   *   - 'mono'      : non-platform users sitting on exactly one account
   *   - 'platform'  : users carrying at least one PLATFORM-scoped role assignment
   *
   * `aggregates` are computed independently of the filter so the KPI counts stay stable as
   * the user clicks between cards. We compute them in-memory off the search-filtered set —
   * this scales fine for the witness POC (up to a few thousand users); a real platform with
   * 10k+ users would push these aggregates into a Prisma raw query.
   */
  public async fetchPlatformUsers(dto: {
    search?: string
    isActive?: boolean
    accountScope?: 'all' | 'multi' | 'mono' | 'platform'
    roleIds?: number[]
    accountIds?: string[]
    page?: number
    limit?: number
  }) {
    const guestUserId = 'clsystem00000000guest000000'

    const where: Prisma.UserWhereInput = { id: { not: guestUserId } }
    if (dto.isActive !== undefined) where.isActive = dto.isActive
    if (dto.search) {
      where.OR = [
        { email: { contains: dto.search, mode: 'insensitive' } },
        { people: { OR: [{ firstname: { contains: dto.search, mode: 'insensitive' } }, { lastname: { contains: dto.search, mode: 'insensitive' } }] } }
      ]
    }
    if (dto.roleIds && dto.roleIds.length > 0) {
      where.roleAssignments = { some: { role: { id: { in: dto.roleIds } } } }
    }
    if (dto.accountIds && dto.accountIds.length > 0) {
      // A user "belongs to" an account either directly (accountsLinked) or transitively via an
      // entity link whose entity belongs to that account — mirror the same union used downstream.
      const accountFilter: Prisma.UserWhereInput = {
        OR: [{ accountsLinked: { some: { accountId: { in: dto.accountIds } } } }, { entitiesLinked: { some: { entity: { accountId: { in: dto.accountIds } } } } }]
      }
      where.AND = where.AND ? [...(Array.isArray(where.AND) ? where.AND : [where.AND]), accountFilter] : [accountFilter]
    }

    // Load every matching user with relations — needed to compute accountCount + isPlatformUser.
    const users = await this.prisma.user.findMany({
      where,
      include: {
        people: true,
        accountsLinked: { include: { account: true } },
        entitiesLinked: { include: { entity: { include: { account: true, organization: true } } } },
        roleAssignments: { include: { role: true } },
        receivedInvitations: { where: { status: { in: ['SENT', 'EXPIRED'] } }, select: { id: true } }
      },
      orderBy: { createdAt: 'desc' }
    })

    const enriched = users.map((u) => {
      // Aggregate every account the user touches — directly via accountsLinked OR transitively
      // via an entityLink that belongs to an account. Dedup by account.id.
      const accountMap = new Map<string, { id: string; name: string; isDirect: boolean }>()
      for (const link of u.accountsLinked) {
        accountMap.set(link.account.id, { id: link.account.id, name: link.account.name, isDirect: true })
      }
      for (const link of u.entitiesLinked) {
        const acc = link.entity.account
        if (!accountMap.has(acc.id)) {
          accountMap.set(acc.id, { id: acc.id, name: acc.name, isDirect: false })
        }
      }
      const accounts = Array.from(accountMap.values())
      const isPlatformUser = u.roleAssignments.some((a) => a.role.scope === 'PLATFORM')

      return {
        id: u.id,
        email: u.email,
        isActive: u.isActive,
        people: u.people ? { id: u.people.id, firstname: u.people.firstname, lastname: u.people.lastname } : null,
        accounts,
        accountCount: accounts.length,
        isPlatformUser,
        pendingKind: this.computePendingKind(u.isActive, u.receivedInvitations.length > 0),
        entities: u.entitiesLinked.map((link) => ({ id: link.entity.id, name: link.entity.organization?.name ?? '', accountId: link.entity.accountId })),
        roles: u.roleAssignments.map((a) => ({ id: a.role.id, name: a.role.name, scope: a.role.scope as 'PLATFORM' | 'ACCOUNT' | 'ENTITY' })),
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        updatedAt: u.updatedAt
      }
    })

    // Aggregates — segment the universe into platform / non-platform first, then count accounts.
    const nonPlatform = enriched.filter((u) => !u.isPlatformUser)
    const aggregates = {
      total: nonPlatform.length,
      multi: nonPlatform.filter((u) => u.accountCount > 1).length,
      mono: nonPlatform.filter((u) => u.accountCount === 1).length,
      platform: enriched.filter((u) => u.isPlatformUser).length
    }

    // Apply scope filter
    const scope = dto.accountScope ?? 'all'
    let filtered: typeof enriched
    if (scope === 'platform') filtered = enriched.filter((u) => u.isPlatformUser)
    else if (scope === 'multi') filtered = nonPlatform.filter((u) => u.accountCount > 1)
    else if (scope === 'mono') filtered = nonPlatform.filter((u) => u.accountCount === 1)
    else filtered = nonPlatform

    const total = filtered.length
    const offset = this.paginationService.getOffset(dto)
    const limit = dto.limit ?? 20
    const paginated = this.paginationService.createPaginatedResponse(filtered.slice(offset, offset + limit), dto, total)
    return { ...paginated, aggregates }
  }

  /**
   * Platform-wide overview: aggregated KPIs + recent users / entities across every account, plus
   * the system roles catalog. Used by the platform-admin "All accounts" view to mirror the layout
   * of a single-account overview, with figures rolled up.
   *
   * Excludes the technical `guest` user (the seed-only anonymous identity).
   */
  public async fetchPlatformOverview() {
    const guestUserId = 'clsystem00000000guest000000'

    const [usersCount, entitiesCount, accountsCount, pendingReactivationCount, pendingAccountOwnerInvitationsCount, pendingInvitations, pendingSignups, recentUsers, recentEntities, systemRoles] =
      await this.prisma.$transaction([
        this.prisma.user.count({ where: { isActive: true, id: { not: guestUserId } } }),
        this.prisma.entity.count({ where: { isActive: true } }),
        this.prisma.account.count({ where: { isActive: true } }),
        // Reactivation requests waiting for platform-admin review — actionable signal here
        // (a platform-admin lands on /overview and immediately sees if there's something to triage).
        this.prisma.accountReactivationRequest.count({ where: { status: 'PENDING' } }),
        // Account-owner invitations awaiting acceptance — invitations with zero account/entity targets
        // are the "create your own account" flow (see invitation.service.ts:434 isAccountOwnerInvitation).
        // Per-account user invitations are a per-tenant concern and don't surface at the platform level.
        this.prisma.invitation.count({
          where: {
            status: 'SENT',
            accountsLinked: { none: {} },
            entitiesLinked: { none: {} }
          }
        }),
        // Platform-wide "Pending invitations / sign-ups" block:
        //  - pendingInvitations: every SENT/EXPIRED invitation across the platform (invited users awaiting signup)
        //  - pendingSignups:     inactive users (excluding the guest) with NO still-pending received invitation
        //                        (self-signups awaiting email confirmation). Users are unique rows, so this is
        //                        already deduped cross-account.
        this.prisma.invitation.count({ where: { status: { in: ['SENT', 'EXPIRED'] } } }),
        this.prisma.user.count({
          where: {
            isActive: false,
            id: { not: guestUserId },
            receivedInvitations: { none: { status: { in: ['SENT', 'EXPIRED'] } } }
          }
        }),
        this.prisma.user.findMany({
          where: { isActive: true, id: { not: guestUserId } },
          include: {
            people: true,
            accountsLinked: { include: { account: true } },
            entitiesLinked: { include: { entity: { include: { organization: true } } } },
            roleAssignments: { include: { role: true } }
          },
          orderBy: { createdAt: 'desc' },
          take: 5
        }),
        this.prisma.entity.findMany({
          include: { organization: true, account: true },
          orderBy: { createdAt: 'desc' },
          take: 5
        }),
        this.prisma.role.findMany({
          where: { accountId: null, isActive: true },
          include: {
            modulesLinked: { include: { module: true } },
            subModulesLinked: { include: { subModule: true } },
            permissionsLinked: { include: { permission: true } }
          },
          orderBy: { createdAt: 'desc' }
        })
      ])

    return {
      kpis: {
        usersCount,
        entitiesCount,
        accountsCount,
        pendingReactivationCount,
        pendingAccountOwnerInvitationsCount,
        pendingInvitations,
        pendingSignups
      },
      recentUsers: recentUsers.map((u) => ({
        id: u.id,
        email: u.email,
        isActive: u.isActive,
        people: u.people ? { id: u.people.id, firstname: u.people.firstname, lastname: u.people.lastname } : null,
        accounts: u.accountsLinked.map((link) => ({ id: link.account.id, name: link.account.name })),
        entities: u.entitiesLinked.map((link) => ({
          id: link.entity.id,
          name: link.entity.organization?.name ?? '',
          accountId: link.entity.accountId,
          organization: link.entity.organization ? { id: link.entity.organization.id, name: link.entity.organization.name, type: link.entity.organization.type } : null
        })),
        roles: u.roleAssignments.map((a) => ({ id: a.role.id, name: a.role.name, scope: a.role.scope })),
        createdAt: u.createdAt,
        updatedAt: u.updatedAt
      })),
      recentEntities: recentEntities.map((e) => ({
        id: e.id,
        name: e.organization?.name ?? '',
        description: e.organization?.description ?? null,
        isActive: e.isActive,
        accountId: e.accountId,
        accountName: e.account.name,
        organization: e.organization ? { id: e.organization.id, name: e.organization.name, type: e.organization.type } : null,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt
      })),
      systemRoles: systemRoles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        scope: role.scope,
        isSystem: role.isSystem,
        isActive: role.isActive,
        modules: role.modulesLinked.map((link) => link.module.name),
        subModules: role.subModulesLinked.map((link) => link.subModule.name),
        permissions: role.permissionsLinked.map((link) => link.permission.name)
      }))
    }
  }

  /**
   * Edit a user's identity and/or role assignments scoped to the given account.
   *
   * Body shape (every field optional — only provided fields mutate):
   *   - isActive          : flip the user's active flag
   *   - accountRoleIds    : *replace* every ACCOUNT-scoped assignment on (user, account) by these role IDs
   *   - entityRoleIds     : per (entityId, roleIds) tuple, *replace* every ENTITY-scoped assignment on (user, entity)
   *
   * Authorization:
   *   - `ACCOUNT_USER_MANAGEMENT` is required for isActive
   *   - `USER_ROLE_ALLOCATION`    is required for assignment changes
   *   - decorator-level guard checks at least one of them is held; per-action checks happen here
   */
  public async updateAccountUser(
    actorUserId: string,
    accountId: string,
    targetUserId: string,
    payload: {
      isActive?: boolean
      accountRoleIds?: number[]
      entityRoleIds?: { entityId: string; roleIds: number[] }[]
    }
  ): Promise<{ id: string; isActive: boolean }> {
    this.logger.debug(`Updating user ${targetUserId} on account ${accountId}`, 'updateAccountUser')
    try {
      await this.accountAccessService.validateUserAccountAccess(actorUserId, accountId, 'updateAccountUser')

      // Verify the target user is linked to this account (directly or via an entity).
      const targetUser = await this.prisma.user.findUnique({
        where: { id: targetUserId },
        include: {
          accountsLinked: { where: { accountId } },
          entitiesLinked: { include: { entity: true } }
        }
      })
      if (!targetUser) throw new NotFoundException('User not found')

      const linkedToThisAccount = targetUser.accountsLinked.length > 0 || targetUser.entitiesLinked.some((link) => link.entity.accountId === accountId)
      if (!linkedToThisAccount) throw new UnauthorizedException('User is not linked to this account')

      // Validate the entity targets belong to this account
      const entityIds = (payload.entityRoleIds ?? []).map((e) => e.entityId)
      if (entityIds.length > 0) {
        const entities = await this.prisma.entity.findMany({ where: { id: { in: entityIds }, accountId } })
        if (entities.length !== entityIds.length) {
          throw new BadRequestException('One or more entity IDs do not belong to this account')
        }
      }

      // Validate role scopes
      const allRoleIds = Array.from(new Set([...(payload.accountRoleIds ?? []), ...(payload.entityRoleIds ?? []).flatMap((e) => e.roleIds)]))
      if (allRoleIds.length > 0) {
        const roles = await this.prisma.role.findMany({ where: { id: { in: allRoleIds } } })
        if (roles.length !== allRoleIds.length) throw new BadRequestException('One or more role IDs could not be found')
        const accountRoles = (payload.accountRoleIds ?? []).map((id) => roles.find((r) => r.id === id)!)
        const entityRoles = (payload.entityRoleIds ?? []).flatMap((e) => e.roleIds).map((id) => roles.find((r) => r.id === id)!)
        if (accountRoles.some((r) => r.scope !== 'ACCOUNT')) throw new BadRequestException('accountRoleIds must reference ACCOUNT-scoped roles only')
        if (entityRoles.some((r) => r.scope !== 'ENTITY')) throw new BadRequestException('entityRoleIds must reference ENTITY-scoped roles only')
      }

      // Last-admin guard — refuse a deactivation that would leave any account, or the platform
      // itself, with no remaining active admin. The user must deactivate the whole account
      // instead in the admin case (front-end prompts a confirmation switch to /reactivation flow).
      if (payload.isActive === false && targetUser.isActive) {
        const targetAssignments = await this.prisma.userRoleAssignment.findMany({
          where: { userId: targetUserId },
          include: { role: true }
        })
        const isPlatformAdmin = targetAssignments.some((a) => a.role.name === UserRoleNames.PLATFORM_ADMIN)
        if (isPlatformAdmin) {
          const otherPlatformAdmins = await this.prisma.user.count({
            where: {
              isActive: true,
              id: { not: targetUserId },
              roleAssignments: { some: { role: { name: UserRoleNames.PLATFORM_ADMIN } } }
            }
          })
          if (otherPlatformAdmins === 0) {
            throw new BadRequestException('LAST_PLATFORM_ADMIN: cannot deactivate the last active platform administrator')
          }
        }
        const adminAccountIds = Array.from(new Set(targetAssignments.filter((a) => a.role.name === UserRoleNames.ADMIN && a.accountId !== null).map((a) => a.accountId as string)))
        for (const adminAccountId of adminAccountIds) {
          const otherAdmins = await this.prisma.user.count({
            where: {
              isActive: true,
              id: { not: targetUserId },
              roleAssignments: { some: { role: { name: UserRoleNames.ADMIN }, accountId: adminAccountId } }
            }
          })
          if (otherAdmins === 0) {
            throw new BadRequestException(`LAST_ACCOUNT_ADMIN:${adminAccountId}`)
          }
        }
      }

      const updated = await this.prisma.$transaction(async (tx) => {
        if (payload.isActive !== undefined) {
          await tx.user.update({ where: { id: targetUserId }, data: { isActive: payload.isActive } })
        }

        if (payload.accountRoleIds !== undefined) {
          await tx.userRoleAssignment.deleteMany({ where: { userId: targetUserId, accountId, role: { scope: 'ACCOUNT' } } })
          if (payload.accountRoleIds.length > 0) {
            await tx.userRoleAssignment.createMany({
              data: payload.accountRoleIds.map((roleId) => ({ userId: targetUserId, roleId, accountId }))
            })
          }
        }

        if (payload.entityRoleIds !== undefined) {
          for (const { entityId, roleIds } of payload.entityRoleIds) {
            await tx.userRoleAssignment.deleteMany({ where: { userId: targetUserId, entityId, role: { scope: 'ENTITY' } } })
            if (roleIds.length > 0) {
              await tx.userRoleAssignment.createMany({
                data: roleIds.map((roleId) => ({ userId: targetUserId, roleId, entityId }))
              })
            }
          }
        }

        return tx.user.findUniqueOrThrow({ where: { id: targetUserId } })
      })

      return { id: updated.id, isActive: updated.isActive }
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof UnauthorizedException || error instanceof BadRequestException) throw error
      this.logger.error(`Failed to update account user ${targetUserId}: ${error.message}`, 'updateAccountUser')
      throw new BadRequestException('Failed to update user')
    }
  }

  /**
   * Toggle a module's activation status. Inactive modules are excluded from /me payloads,
   * permission catalogs and role-builder UIs — effectively kill-switching the feature globally.
   *
   * Self-lockout guard: PLATFORM_ADMINISTRATION cannot be deactivated. It is the module that
   * carries the MODULE_MANAGEMENT permission, so disabling it would lock every platform-admin
   * out of the toggle UI itself with no in-app recovery path.
   */
  public async togglePlatformModule(moduleId: number, isActive: boolean): Promise<{ id: number; name: string; isActive: boolean }> {
    const module = await this.prisma.module.findUnique({ where: { id: moduleId } })
    if (!module) throw new NotFoundException('Module not found')
    if (module.name === 'PLATFORM_ADMINISTRATION' && !isActive) {
      throw new BadRequestException('PLATFORM_ADMINISTRATION cannot be deactivated — it would lock platform-admins out of this page.')
    }
    const updated = await this.prisma.module.update({ where: { id: moduleId }, data: { isActive } })
    return { id: updated.id, name: updated.name, isActive: updated.isActive }
  }

  /**
   * Toggle a single sub-module's activation. Deactivating a sub-module hides it (and all permissions
   * carrying its sub_module_id) from every user's effective set — same gating as a module, one level
   * finer (see getMe / jwt.strategy). Module-level permissions of the parent module are untouched.
   *
   * Self-lockout guard: no sub-module of PLATFORM_ADMINISTRATION can be deactivated — they gate the
   * platform console (PLATFORM_MODULES carries this very toggle UI), so cutting one would strand the
   * platform-admin with no in-app recovery path.
   */
  public async toggleSubModule(moduleId: number, subModuleId: number, isActive: boolean): Promise<{ id: number; name: string; isActive: boolean }> {
    const subModule = await this.prisma.subModule.findUnique({ where: { id: subModuleId }, include: { module: true } })
    if (!subModule || subModule.moduleId !== moduleId) throw new NotFoundException('Sub-module not found')
    if (subModule.module.name === 'PLATFORM_ADMINISTRATION' && !isActive) {
      throw new BadRequestException('PLATFORM_ADMINISTRATION sub-modules cannot be deactivated — it would lock platform-admins out of the platform console.')
    }
    const updated = await this.prisma.subModule.update({ where: { id: subModuleId }, data: { isActive } })
    return { id: updated.id, name: updated.name, isActive: updated.isActive }
  }

  /**
   * Multi-account feature — let an account admin (with ACCOUNT_OWN_CREATE granted) spin up a brand-new
   * account they automatically become admin of. The new account is independent (no parent/child link
   * with the source account). PermissionsGuard already validated the perm + module activation; we just
   * run the write transaction here.
   */
  public async createOwnAccount(
    userId: string,
    body: { name: string; description?: string | null }
  ): Promise<{ id: string; name: string; description: string | null; isActive: boolean; createdAt: Date }> {
    const trimmedName = body.name?.trim()
    if (!trimmedName) throw new BadRequestException('Account name is required')
    if (trimmedName.length > 100) throw new BadRequestException('Account name must not exceed 100 characters')
    const trimmedDescription = body.description?.trim() || null

    this.logger.debug(`User ${userId} creating an additional own account "${trimmedName}"`, 'createOwnAccount')

    try {
      const adminRole = await this.prisma.role.findFirst({
        where: { name: UserRoleNames.ADMIN, accountId: null, scope: 'ACCOUNT' }
      })
      if (!adminRole) throw new BadRequestException('Account admin role not found in the system roles catalog')

      const created = await this.prisma.$transaction(async (tx) => {
        const account = await tx.account.create({
          data: {
            name: trimmedName,
            description: trimmedDescription
          }
        })
        await tx.userAccountLink.create({ data: { userId, accountId: account.id } })
        await tx.userRoleAssignment.create({ data: { userId, roleId: adminRole.id, accountId: account.id } })
        return account
      })

      return { id: created.id, name: created.name, description: created.description, isActive: created.isActive, createdAt: created.createdAt }
    } catch (error) {
      if (error instanceof BadRequestException) throw error
      this.logger.error(`Failed to create own account for user ${userId}: ${error.message}`, 'createOwnAccount')
      throw new BadRequestException('Failed to create account')
    }
  }

  /**
   * Privates methods
   */
  /**
   * Discriminate a user's pending state purely from data (no heuristic on link counts):
   *   - active user                              → null (not pending)
   *   - inactive + has a pending received invite → 'invited' (awaiting signup)
   *   - inactive + no pending received invite    → 'awaiting-confirmation' (self-signup, awaiting email confirmation)
   *
   * `hasPendingReceivedInvitation` must already be scoped to SENT/EXPIRED invitations.
   */
  private computePendingKind(isActive: boolean, hasPendingReceivedInvitation: boolean): 'invited' | 'awaiting-confirmation' | null {
    if (isActive) return null
    return hasPendingReceivedInvitation ? 'invited' : 'awaiting-confirmation'
  }

  private getUserOrderBy(orderBy?: UserOrderBy): Prisma.UserOrderByWithRelationInput {
    switch (orderBy) {
      case UserOrderBy.NAME:
        return { people: { firstname: 'asc' } }
      case UserOrderBy.LASTNAME:
        return { people: { lastname: 'asc' } }
      case UserOrderBy.UPDATED_AT:
        return { updatedAt: 'desc' }
      case UserOrderBy.CREATED_AT:
      default:
        return { createdAt: 'desc' }
    }
  }

  private getEntityOrderBy(orderBy?: EntityOrderBy): Prisma.EntityOrderByWithRelationInput {
    switch (orderBy) {
      // Entity name is the resolved profile's name (D-ENT-6) — order by the organization.
      case EntityOrderBy.NAME:
      case EntityOrderBy.ORGANIZATION_NAME:
        return { organization: { name: 'asc' } }
      case EntityOrderBy.UPDATED_AT:
        return { updatedAt: 'desc' }
      case EntityOrderBy.CREATED_AT:
      default:
        return { createdAt: 'desc' }
    }
  }

  private getRoleOrderBy(orderBy?: RoleOrderBy): Prisma.RoleOrderByWithRelationInput {
    switch (orderBy) {
      case RoleOrderBy.NAME:
        return { name: 'asc' }
      case RoleOrderBy.CREATED_AT:
      default:
        return { createdAt: 'desc' }
    }
  }
}
