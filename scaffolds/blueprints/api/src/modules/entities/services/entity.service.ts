/**
 * Resources
 */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'

/**
 * Dependencies
 */
import { AccountAccessService } from '@common/services/account-access/account-access.service'
import { Logger } from '@common/services/logger/logger.service'
import { UserRoleNames } from '@configs/db/user.config'
import { PrismaService } from '@configs/prisma/services/prisma.service'

/**
 * DTO
 */
import { CreateEntityDto } from '@modules/entities/dto/requests/create-entity.dto'
import { CreateEntityResponseDto } from '@modules/entities/dto/responses/create-entity.response.dto'
import { EntityUserDto, UpdateEntityUsersResponseDto } from '@modules/entities/dto/responses/update-entity-users.response.dto'

/**
 * Declaration
 */
@Injectable()
export class EntityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
    private readonly accountAccessService: AccountAccessService
  ) {}

  /**
   * Create a new entity with an associated organization.
   * Supports both linking to an existing organization (organizationId) and
   * creating a new organization inline (organization) — all in one transaction.
   */
  async createEntity(userId: string, createEntityDto: CreateEntityDto): Promise<CreateEntityResponseDto> {
    try {
      // Validate that either organizationId or inline organization data is provided
      if (!createEntityDto.organizationId && !createEntityDto.organization) {
        throw new BadRequestException('Either organizationId or organization data must be provided')
      }

      // Optional nesting (B3a/B3b): when a parentEntityId is provided, the new entity is created as a
      // child of that parent. Omitting parentEntityId creates a root entity (direct child of the
      // account) — unchanged behaviour, account-level access check.
      let resolvedAccountId = createEntityDto.accountId
      if (createEntityDto.parentEntityId) {
        // B3b — subtree authority: authorize the caller against the PARENT entity. An account-admin
        // (or platform-admin) passes for any parent in their account; an entity-admin passes only when
        // the parent is in a subtree they govern → so children can only be created within that subtree.
        const parentAccess = await this.accountAccessService.validateUserEntityAccess(userId, createEntityDto.parentEntityId, 'createEntity')
        // The child's accountId is the parent's account (no cross-account parent by construction).
        resolvedAccountId = parentAccess.entity.accountId
        if (createEntityDto.accountId !== resolvedAccountId) throw new BadRequestException('Parent entity must belong to the same account')
      } else {
        // Root entity: account-level access check (account-admin / platform reach / entity link).
        await this.accountAccessService.validateUserAccountAccess(userId, createEntityDto.accountId, 'createEntity')
      }

      // Create everything in a single transaction
      const result = await this.prisma.$transaction(async (tx) => {
        let organization

        if (createEntityDto.organization) {
          organization = createEntityDto.organization
        } else {
          // Use existing organization
          organization = await tx.organization.findUnique({
            where: { id: createEntityDto.organizationId }
          })

          if (!organization) throw new NotFoundException(`Organization with ID ${createEntityDto.organizationId} not found`)
        }

        // Create the entity first — it holds only functional keys. Its human identity (name/description)
        // is sourced from the attached profile (Organization), so nothing is written here (D-ENT-6).
        const entity = await tx.entity.create({
          data: {
            isActive: true,
            // The child's account is the parent's (B3b) — or the requested account for a root entity.
            accountId: resolvedAccountId,
            // null = root entity; set = nested under the authorized same-account parent (B3a/B3b).
            parentEntityId: createEntityDto.parentEntityId ?? null
          }
        })

        if (createEntityDto.organization) {
          // Create the organization as this entity's profile and link it to the account pool.
          organization = await tx.organization.create({
            data: {
              name: createEntityDto.organization.name,
              type: createEntityDto.organization.type,
              description: createEntityDto.organization.description,
              website: createEntityDto.organization.website,
              entityId: entity.id
            }
          })

          await tx.organizationAccountLink.create({
            data: {
              organizationId: organization.id,
              accountId: resolvedAccountId
            }
          })
        } else {
          // Attach the existing organization to the new entity as its profile.
          organization = await tx.organization.update({
            where: { id: organization.id },
            data: { entityId: entity.id }
          })
        }

        return { entity, organization }
      })

      return {
        id: result.entity.id,
        // Human identity is the resolved profile's (the organization is this entity's profile).
        name: result.organization.name,
        isActive: result.entity.isActive,
        createdAt: result.entity.createdAt,
        updatedAt: result.entity.updatedAt,
        description: result.organization.description || '',
        organization: {
          id: result.organization.id,
          name: result.organization.name
        }
      }
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof UnauthorizedException || error instanceof BadRequestException || error instanceof ForbiddenException) throw error
      this.logger.error(`Failed to create entity: ${error.message}`, 'createEntity')
      throw new BadRequestException('Failed to create entity')
    }
  }

  /**
   * Multi-entity feature — let an entity-admin (with ENTITY_OWN_CREATE granted) spin up an additional
   * entity inside the same parent account they already manage. They become entity-admin on the new
   * entity (UserEntityLink + ENTITY-scoped role assignment).
   *
   * PermissionsGuard already validated the perm + module activation upstream; we just enforce that the
   * caller actually has an ENTITY-scoped foothold on the target account (so they can't self-spawn an
   * entity inside an account they don't belong to) and run the write transaction.
   */
  async createOwnEntity(userId: string, dto: CreateEntityDto): Promise<CreateEntityResponseDto> {
    this.logger.debug(`User ${userId} creating an additional own entity on account ${dto.accountId}`, 'createOwnEntity')
    try {
      if (!dto.organizationId && !dto.organization) {
        throw new BadRequestException('Either organizationId or organization data must be provided')
      }

      // B3b — when nesting under a parent, authorize the caller against that PARENT via the subtree
      // rule (entity-admin of the parent or an ancestor, account-admin of its account, or platform).
      // The child's account is then the parent's account. When no parent is given (a new ROOT own
      // entity), fall back to the existing "must already sit on the target account via an entity
      // link" guard — the marker for "I'm an entity-admin on this account".
      let resolvedAccountId = dto.accountId
      if (dto.parentEntityId) {
        const parentAccess = await this.accountAccessService.validateUserEntityAccess(userId, dto.parentEntityId, 'createOwnEntity')
        resolvedAccountId = parentAccess.entity.accountId
        if (dto.accountId !== resolvedAccountId) throw new BadRequestException('Parent entity must belong to the same account')
      } else {
        const existingLink = await this.prisma.userEntityLink.findFirst({
          where: { userId, entity: { accountId: dto.accountId } }
        })
        if (!existingLink) throw new UnauthorizedException('You do not have entity access to this account')
      }

      const entityAdminRole = await this.prisma.role.findFirst({
        where: { name: UserRoleNames.ENTITY_ADMIN, accountId: null, scope: 'ENTITY' }
      })
      if (!entityAdminRole) throw new BadRequestException('Entity admin role not found in the system roles catalog')

      const result = await this.prisma.$transaction(async (tx) => {
        let organization
        if (dto.organization) {
          organization = dto.organization
        } else {
          organization = await tx.organization.findUnique({ where: { id: dto.organizationId } })
          if (!organization) throw new NotFoundException(`Organization with ID ${dto.organizationId} not found`)
        }

        // Create the entity first — functional keys only; identity comes from the profile (D-ENT-6).
        const entity = await tx.entity.create({
          data: {
            isActive: true,
            // Child's account = parent's account (B3b); for a root own entity it's the requested one.
            accountId: resolvedAccountId,
            // null = root own entity; set = nested under the authorized parent's subtree (B3b).
            parentEntityId: dto.parentEntityId ?? null
          }
        })

        if (dto.organization) {
          organization = await tx.organization.create({
            data: {
              name: dto.organization.name,
              type: dto.organization.type,
              description: dto.organization.description,
              website: dto.organization.website,
              entityId: entity.id
            }
          })
          await tx.organizationAccountLink.create({
            data: { organizationId: organization.id, accountId: resolvedAccountId }
          })
        } else {
          organization = await tx.organization.update({
            where: { id: organization.id },
            data: { entityId: entity.id }
          })
        }

        // Bind the creator to the new entity as entity-admin so they immediately see / manage it.
        await tx.userEntityLink.create({ data: { userId, entityId: entity.id } })
        await tx.userRoleAssignment.create({ data: { userId, roleId: entityAdminRole.id, entityId: entity.id } })

        return { entity, organization }
      })

      return {
        id: result.entity.id,
        // Human identity is the resolved profile's (the organization is this entity's profile).
        name: result.organization.name,
        isActive: result.entity.isActive,
        createdAt: result.entity.createdAt,
        updatedAt: result.entity.updatedAt,
        description: result.organization.description || '',
        organization: { id: result.organization.id, name: result.organization.name }
      }
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof UnauthorizedException || error instanceof BadRequestException || error instanceof ForbiddenException) throw error
      this.logger.error(`Failed to create own entity: ${error.message}`, 'createOwnEntity')
      throw new BadRequestException('Failed to create entity')
    }
  }

  /**
   * Update an entity's identity (resolved from its typed profile) and its profile organization.
   *
   * The entity itself no longer carries a name/description (D-ENT-6) — those live on the profile.
   * So a top-level `name`/`description` edit is re-routed to the entity's Organization profile, and
   * the `organization.*` block edits the same profile. The entity row only owns functional state
   * (here: `isActive`). The response keeps the same shape, sourced from the profile.
   *
   * Account remains immutable (entities don't move accounts via this endpoint).
   */
  async updateEntity(
    userId: string,
    entityId: string,
    payload: {
      name?: string
      description?: string | null
      isActive?: boolean
      organization?: {
        name?: string
        type?: 'COMPANY' | 'ASSOCIATION' | 'COMMUNITY'
        description?: string | null
        website?: string | null
      }
    }
  ): Promise<{ id: string; name: string; description: string | null; isActive: boolean }> {
    this.logger.debug(`Updating entity ${entityId}`, 'updateEntity')
    try {
      const entity = await this.prisma.entity.findUnique({
        where: { id: entityId },
        include: { organization: true }
      })
      if (!entity) throw new NotFoundException('Entity not found')

      // B3b — hierarchical authority: platform-admin / account-admin of this account / entity-admin
      // of this entity or any ancestor (subtree authority). An entity-admin can manage entities in
      // its subtree but NOT siblings or entities in other accounts (→ 403).
      await this.accountAccessService.validateUserEntityAccess(userId, entityId, 'updateEntity')

      const updated = await this.prisma.$transaction(async (tx) => {
        let organization = entity.organization

        // Name/description edits — whether top-level or via the organization block — update the
        // entity's profile (the single source of human identity). Top-level values take precedence.
        if (organization && (payload.organization || payload.name !== undefined || payload.description !== undefined)) {
          organization = await tx.organization.update({
            where: { id: organization.id },
            data: {
              name: payload.name ?? payload.organization?.name ?? organization.name,
              type: payload.organization?.type ?? organization.type,
              description: payload.description !== undefined ? payload.description : payload.organization?.description !== undefined ? payload.organization.description : organization.description,
              website: payload.organization?.website !== undefined ? payload.organization.website : organization.website
            }
          })
        }

        const entityUpdated = await tx.entity.update({
          where: { id: entityId },
          data: {
            isActive: payload.isActive ?? entity.isActive
          }
        })

        return { entity: entityUpdated, organization }
      })

      return {
        id: updated.entity.id,
        name: updated.organization?.name ?? '',
        description: updated.organization?.description ?? null,
        isActive: updated.entity.isActive
      }
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof UnauthorizedException || error instanceof BadRequestException || error instanceof ForbiddenException) throw error
      this.logger.error(`Failed to update entity ${entityId}: ${error.message}`, 'updateEntity')
      throw new BadRequestException('Failed to update entity')
    }
  }

  /**
   * Update users linked to an entity
   */
  async updateEntityUsers(userId: string, entityId: string, userIds: string[]): Promise<UpdateEntityUsersResponseDto> {
    this.logger.debug(`Managing users for entity ${entityId}`, 'updateEntityUsers')

    try {
      // Get entity with its account and users
      const entity = await this.prisma.entity.findUnique({
        where: { id: entityId },
        include: {
          account: true,
          organization: true,
          users: {
            include: {
              user: {
                include: {
                  people: true
                }
              }
            }
          }
        }
      })

      if (!entity) {
        throw new NotFoundException(`Entity with ID ${entityId} not found`)
      }

      // B3b — hierarchical authority: the caller must govern THIS entity (platform-admin,
      // account-admin of its account, or entity-admin of it/an ancestor). Bounds an entity-admin to
      // its own subtree.
      await this.accountAccessService.validateUserEntityAccess(userId, entityId, 'updateEntityUsers')

      // Calculate users to add and remove
      const currentUserIds = entity.users.map((link) => link.userId)
      const usersToRemove = currentUserIds.filter((id) => !userIds.includes(id))
      const usersToAdd = userIds.filter((id) => !currentUserIds.includes(id))

      // Check if we're trying to remove all users
      if (usersToRemove.length === currentUserIds.length) {
        // Get all active users linked to the account (directly or via other entities)
        const accountUsers = await this.prisma.userAccountLink.findMany({
          where: {
            accountId: entity.accountId,
            user: { isActive: true }
          }
        })

        const otherEntitiesUsers = await this.prisma.userEntityLink.findMany({
          where: {
            entity: {
              accountId: entity.accountId,
              id: { not: entityId },
              isActive: true
            },
            user: { isActive: true }
          }
        })

        const activeUsersCount = new Set([...accountUsers.map((link) => link.userId), ...otherEntitiesUsers.map((link) => link.userId)]).size

        if (activeUsersCount === 0) {
          throw new BadRequestException('Cannot remove all users from the entity as there are no active users linked to the account or other entities')
        }
      }

      // Update users
      await this.prisma.$transaction(async (prisma) => {
        // Remove users
        if (usersToRemove.length > 0) {
          await prisma.userEntityLink.deleteMany({
            where: {
              userId: { in: usersToRemove },
              entityId
            }
          })
        }

        // Add users
        if (usersToAdd.length > 0) {
          await prisma.userEntityLink.createMany({
            data: usersToAdd.map((id) => ({
              userId: id,
              entityId
            }))
          })
        }
      })

      // Get updated users list
      const updatedUsers = await this.prisma.userEntityLink.findMany({
        where: { entityId },
        include: {
          user: {
            include: {
              people: true
            }
          }
        }
      })

      // Process users data
      const users: EntityUserDto[] = updatedUsers.map((link) => ({
        id: link.user.id,
        email: link.user.email,
        firstname: link.user.people?.firstname || null,
        lastname: link.user.people?.lastname || null,
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
        id: entity.id,
        name: entity.organization?.name ?? '',
        users
      }
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException || error instanceof UnauthorizedException || error instanceof ForbiddenException) throw error
      this.logger.error(`Failed to manage users for entity ${entityId}: ${error.message}`, 'updateEntityUsers')
      throw new BadRequestException('Failed to update entity users')
    }
  }
}
