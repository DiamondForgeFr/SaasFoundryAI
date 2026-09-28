/**
 * Utility for setting up test entity data for E2E tests
 */
import { PrismaService } from '@configs/prisma/services/prisma.service'

/**
 * Entity test data configuration
 */
export interface EntityTestConfig {
  /** Entity name */
  name: string
  /** Entity description */
  description?: string
  /** Account ID to link the entity to */
  accountId: string
  /** Organization ID to link the entity to (optional) */
  organizationId?: string
  /** Whether the entity is active */
  isActive?: boolean
}

/**
 * Entity test data result
 */
export interface EntityTestData {
  /** Entity ID */
  id: string
  /** Entity name */
  name: string
  /** Entity description */
  description: string | null
  /** Whether the entity is active */
  isActive: boolean
  /** Account ID */
  accountId: string
  /** Organization ID */
  organizationId: string | null
}

/**
 * Set up a test entity
 * @param prisma The Prisma service
 * @param config The entity configuration
 * @returns The created entity data
 */
export async function setupTestEntity(prisma: PrismaService, config: EntityTestConfig): Promise<EntityTestData> {
  // Create the entity — functional keys only. The entity carries NO name/description (D-ENT-6);
  // its human identity is resolved from the attached typed profile (Organization).
  const entity = await prisma.entity.create({
    data: {
      isActive: config.isActive ?? true,
      accountId: config.accountId
    }
  })

  // Attach the organization profile to the entity via the inverted FK. The resolved name/description
  // come from that profile.
  let profile: { name: string; description: string | null } | null = null
  if (config.organizationId) {
    const org = await prisma.organization.update({
      where: { id: config.organizationId },
      data: { entityId: entity.id }
    })
    profile = { name: org.name, description: org.description }
  }

  return {
    id: entity.id,
    name: profile?.name ?? config.name,
    description: profile?.description ?? config.description ?? null,
    isActive: entity.isActive,
    accountId: entity.accountId,
    organizationId: config.organizationId || null
  }
}

/**
 * Clean up a test entity
 * @param prisma The Prisma service
 * @param entityId Entity ID to clean up
 */
export async function cleanupTestEntity(prisma: PrismaService, entityId: string): Promise<void> {
  // Delete the entity (should cascade delete links)
  await prisma.entity.deleteMany({
    where: { id: entityId }
  })
}

/**
 * Create an entity DTO for API requests. An entity carries no name/description of its own (D-ENT-6) —
 * those live on the linked organization profile, so the create payload only references the org.
 * @param accountId The account ID to link to
 * @param organizationId The organization ID to link to (optional)
 * @param _name Deprecated — kept for call-site compatibility; the entity name comes from its profile.
 * @returns Entity creation DTO
 */
export function createEntityDto(
  accountId: string,
  organizationId?: string,
  _name?: string
): {
  accountId: string
  organizationId?: string
} {
  return {
    accountId,
    organizationId
  }
}

/**
 * Create an entity update users DTO
 * @param userIds The user IDs to assign to the entity
 * @returns Entity update users DTO
 */
export function createEntityUsersDto(userIds: string[]): {
  userIds: string[]
} {
  return {
    userIds
  }
}
