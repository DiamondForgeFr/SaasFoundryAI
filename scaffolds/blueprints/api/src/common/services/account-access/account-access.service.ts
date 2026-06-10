/**
 * Resources
 */
import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { Prisma } from '@/generated/prisma/client'

/**
 * Dependencies
 */
import { Logger } from '@common/services/logger/logger.service'
import { PrismaService } from '@configs/prisma/services/prisma.service'

/**
 * Type definitions
 */
export interface UserAccountAccess {
  account: {
    id: string
    name: string
    description: string | null
    isActive: boolean
    createdAt: Date
    updatedAt: Date
  }
  userId: string
  accountId: string
  indirectAccess: boolean
}

/**
 * Resolved context returned by `validateUserEntityAccess` once authority is proven.
 *
 * `via` documents WHICH branch of the authority rule granted access (useful for logging / future
 * audit): platform reach, account-admin of the entity's account, or entity-admin of the entity
 * itself or one of its ancestors.
 */
export interface UserEntityAccess {
  entity: { id: string; accountId: string; parentEntityId: string | null; isActive: boolean }
  userId: string
  via: 'platform' | 'account-admin' | 'entity-admin'
}

/**
 * The marker permissions that identify an "entity-admin of E": an ENTITY-scoped, active role
 * assignment on E whose role carries one of these (mirrors how account-admin is detected via
 * USER_ACCOUNTS_INVITATION). USER_ENTITIES_INVITATION + ENTITY_USER_MANAGEMENT are the entity-admin
 * markers seeded on the `entity-admin` role.
 */
const ENTITY_ADMIN_MARKER_PERMISSIONS = ['USER_ENTITIES_INVITATION', 'ENTITY_USER_MANAGEMENT'] as const

/**
 * Declaration
 */
@Injectable()
export class AccountAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: Logger
  ) {}

  /**
   * Check if a user has access to a specific account
   * @param userId User ID
   * @param accountId Account ID
   * @param methodName Name of the calling method (for logging)
   * @returns The user-account access information if successful
   * @throws UnauthorizedException if the user doesn't have access to the account
   * @throws NotFoundException if the account doesn't exist
   */
  /**
   * Validates that `userId` can act on `accountId`.
   *
   * Pass `options.allowDisabled = true` for routes that must remain reachable even when the
   * account has been deactivated (e.g. fetching `/me`, the disabled-account banner, the
   * reactivation-request endpoint). Default behaviour rejects calls on disabled accounts
   * unless the caller is a platform-admin (who can manage the account either way).
   */
  async validateUserAccountAccess(userId: string, accountId: string, methodName: string, options: { allowDisabled?: boolean } = {}): Promise<UserAccountAccess> {
    this.logger.debug(`Validating access for user ${userId} to account ${accountId}`, methodName)

    // First check if the account exists
    const account = await this.prisma.account.findUnique({
      where: { id: accountId }
    })

    if (!account) throw new NotFoundException(`Account with ID ${accountId} not found`)

    // Platform-reach bypass: a user with a PLATFORM-scoped role assignment that holds the
    // PLATFORM_ACCOUNTS sub-module (the all-accounts list) is allowed to view/manage any account
    // on the platform — they have no direct UserAccountLink (by design) but the platform reach is
    // sufficient. Such actors are also authorized on disabled accounts regardless of the
    // `allowDisabled` flag. (RBAC v2 replaced the ACCOUNT_LIST_ALL permission marker — see D1.)
    const platformOverride = await this.prisma.userRoleAssignment.findFirst({
      where: {
        userId,
        accountId: null,
        entityId: null,
        role: {
          isActive: true,
          scope: 'PLATFORM',
          subModulesLinked: { some: { subModule: { name: 'PLATFORM_ACCOUNTS' } } }
        }
      }
    })

    if (platformOverride) {
      return { account, userId, accountId, indirectAccess: true }
    }

    // Non-platform actors: reject early on disabled accounts unless explicitly allowed.
    if (!account.isActive && !options.allowDisabled) {
      this.logger.warn(`User ${userId} tried to act on disabled account ${accountId}`, methodName)
      throw new UnauthorizedException('This account is disabled')
    }

    // Check for direct link between user and account
    const userAccountLink = await this.prisma.userAccountLink.findUnique({
      where: {
        userId_accountId: {
          userId,
          accountId
        }
      }
    })

    if (userAccountLink) {
      return {
        account,
        userId,
        accountId,
        indirectAccess: false
      }
    }

    // If no direct link, check if the user is linked via an entity associated with the account
    const userEntityLink = await this.prisma.userEntityLink.findFirst({
      where: {
        userId,
        entity: {
          accountId
        }
      }
    })

    if (userEntityLink) {
      return {
        account,
        userId,
        accountId,
        indirectAccess: true
      }
    }

    // If no access found, log and throw an exception
    this.logger.warn(`User ${userId} tried to access unauthorized account ${accountId}`, methodName)
    throw new UnauthorizedException('You do not have access to this account')
  }

  /**
   * Does this user hold platform reach? (PLATFORM-scoped assignment carrying the PLATFORM_ACCOUNTS
   * sub-module — the cross-account authority marker, same shape used by the account-access bypass.)
   */
  async isPlatformAdmin(userId: string): Promise<boolean> {
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
   * Does this user hold an ACCOUNT-scoped admin role on the given account? The marker permission is
   * USER_ACCOUNTS_INVITATION — an account-admin governs ALL entities of that account.
   */
  async isAccountAdminOn(userId: string, accountId: string): Promise<boolean> {
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

  /**
   * Return the set of entity ids on which the user is an "entity-admin" — i.e. holds an ENTITY-scoped,
   * active role assignment carrying one of the entity-admin marker permissions. These are the roots
   * of the subtrees the user governs (B3b — hierarchical entity authority).
   */
  private async getAdminEntityIds(userId: string): Promise<string[]> {
    const assignments = await this.prisma.userRoleAssignment.findMany({
      where: {
        userId,
        entityId: { not: null },
        role: { scope: 'ENTITY', isActive: true, permissionsLinked: { some: { permission: { name: { in: [...ENTITY_ADMIN_MARKER_PERMISSIONS] } } } } }
      },
      select: { entityId: true }
    })
    return assignments.map((a) => a.entityId).filter((id): id is string => id !== null)
  }

  /**
   * Resolve the full ancestor chain of `entityId` (the node itself + every ancestor up to the root)
   * via a recursive CTE walking `parent_entity_id`. Used to test whether the user entity-admins any
   * ancestor of the target — i.e. whether the target sits in a subtree they govern.
   */
  private async getAncestorEntityIds(entityId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_entity_id FROM "entities" WHERE id = ${entityId}
        UNION ALL
        SELECT e.id, e.parent_entity_id
        FROM "entities" e
        JOIN ancestors a ON e.id = a.parent_entity_id
      )
      SELECT id FROM ancestors
    `
    return rows.map((r) => r.id)
  }

  /**
   * Resolve every descendant of the given entity ids (the nodes themselves + all transitive children)
   * via a recursive CTE walking `parent_entity_id` downward. Used to compute the subtree an
   * entity-admin sees when listing entities (B3b — §4.1 hierarchical scope).
   */
  async getSubtreeEntityIds(rootEntityIds: string[]): Promise<string[]> {
    if (rootEntityIds.length === 0) return []
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE subtree AS (
        SELECT id FROM "entities" WHERE id IN (${Prisma.join(rootEntityIds)})
        UNION ALL
        SELECT e.id
        FROM "entities" e
        JOIN subtree s ON e.parent_entity_id = s.id
      )
      SELECT DISTINCT id FROM subtree
    `
    return rows.map((r) => r.id)
  }

  /**
   * Resolve the set of entity ids a user is allowed to see/manage WITHIN a given account (B3b).
   *
   * - platform-admin / account-admin → `null` (no restriction: they govern the whole account).
   * - entity-admin → the union of the subtrees rooted at every entity they entity-admin *within this
   *   account* (the entities they admin + all descendants). Returns `[]` when they admin nothing here.
   *
   * Listing callers use this to narrow their query: `null` = list all account entities, an array =
   * restrict to those ids.
   */
  async resolveVisibleEntityIdsForAccount(userId: string, accountId: string): Promise<string[] | null> {
    if (await this.isPlatformAdmin(userId)) return null
    if (await this.isAccountAdminOn(userId, accountId)) return null

    const adminEntityIds = await this.getAdminEntityIds(userId)
    if (adminEntityIds.length === 0) return []

    // Keep only the admin roots that actually belong to the target account, then expand to subtrees.
    const rootsInAccount = await this.prisma.entity.findMany({
      where: { id: { in: adminEntityIds }, accountId },
      select: { id: true }
    })
    if (rootsInAccount.length === 0) return []

    return this.getSubtreeEntityIds(rootsInAccount.map((e) => e.id))
  }

  /**
   * Authorize `userId` to manage/see entity `entityId` under the B3b hierarchical-authority rule:
   *
   *   A user may act on entity X iff ANY of:
   *     1. they are a platform-admin (cross-account authority), OR
   *     2. they are an account-admin of X's account (governs ALL entities of that account), OR
   *     3. they are an entity-admin of X itself OR of any ancestor of X (X is in a subtree they govern).
   *
   * Throws 404 when the entity does not exist, and 403 (authenticated-but-unauthorised) when none of
   * the branches hold. Returns the resolved entity context (incl. which branch granted access).
   *
   * SECURITY: an entity-admin's authority is bounded to its own subtree — a sibling or an entity in
   * another account never matches branch 3 (the ancestor walk stays inside the tree) nor branch 2
   * (the marker permission is checked against THIS account only).
   */
  async validateUserEntityAccess(userId: string, entityId: string, methodName: string): Promise<UserEntityAccess> {
    this.logger.debug(`Validating entity access for user ${userId} to entity ${entityId}`, methodName)

    const entity = await this.prisma.entity.findUnique({
      where: { id: entityId },
      select: { id: true, accountId: true, parentEntityId: true, isActive: true }
    })
    if (!entity) throw new NotFoundException(`Entity with ID ${entityId} not found`)

    // 1. Platform reach — cross-account authority.
    if (await this.isPlatformAdmin(userId)) {
      return { entity, userId, via: 'platform' }
    }

    // 2. Account-admin of the entity's account — governs every entity of that account.
    if (await this.isAccountAdminOn(userId, entity.accountId)) {
      return { entity, userId, via: 'account-admin' }
    }

    // 3. Entity-admin of X or of any ancestor of X — X sits in a subtree they govern.
    const adminEntityIds = await this.getAdminEntityIds(userId)
    if (adminEntityIds.length > 0) {
      const ancestorIds = await this.getAncestorEntityIds(entityId)
      const ancestorSet = new Set(ancestorIds)
      if (adminEntityIds.some((id) => ancestorSet.has(id))) {
        return { entity, userId, via: 'entity-admin' }
      }
    }

    this.logger.warn(`User ${userId} tried to act on entity ${entityId} outside their authority`, methodName)
    throw new ForbiddenException('You do not have authority over this entity')
  }
}
