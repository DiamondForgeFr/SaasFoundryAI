/**
 * Utility for setting up test users with specific roles for E2E tests
 */
import { PrismaService } from '@configs/prisma/services/prisma.service'
import * as bcrypt from 'bcrypt'
import request from 'supertest'

/**
 * Configuration for a test user
 */
export interface TestUserConfig {
  /** Email of the test user */
  email: string
  /** Password of the test user */
  password: string
  /** First name of the test user */
  firstname: string
  /** Last name of the test user */
  lastname: string
  /** Roles to assign to the user. They are assigned as they are: the helper never changes their grants. */
  roles: string[]
  /**
   * Extra permissions for this user only, held in its own test account. They are carried by a custom
   * role created for the user (see `TEST_GRANTS_ROLE_NAME`), never added to the roles listed in `roles`:
   * those are usually system roles shared by every user of the e2e run.
   */
  permissions?: string[]
}

/**
 * Name of the custom role that carries the extra `permissions` of a test user. One per test account
 * (role names are unique per account), so it never reaches another user of the run.
 */
export const TEST_GRANTS_ROLE_NAME = 'e2e-test-grants'

/**
 * Test user result
 */
export interface TestUser {
  /** User ID */
  id: string
  /** User email */
  email: string
  /** Account ID associated with the user */
  accountId: string
}

/**
 * Create a test user with specific roles and permissions.
 *
 * The e2e database is shared by every spec of a run, so the helper never changes what a role grants:
 * `roles` are assigned as seeded, and `permissions` are carried by a custom role of the user's own test
 * account, assigned to that user only. A later user of the same system role holds exactly the seeded
 * grants, whatever ran before it.
 * @param prisma The Prisma service
 * @param config The user configuration
 * @returns The created user data
 */
export async function setupTestUser(prisma: PrismaService, config: TestUserConfig): Promise<TestUser> {
  // Normalize email to lowercase (matches real app behavior where DTOs transform emails to lowercase)
  config.email = config.email.toLowerCase()

  // Check if the user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email: config.email },
    include: {
      accountsLinked: {
        include: {
          account: true
        }
      }
    }
  })

  if (existingUser) {
    return {
      id: existingUser.id,
      email: existingUser.email,
      accountId: existingUser.accountsLinked[0]?.accountId || ''
    }
  }

  // Find required roles
  const rolePromises = config.roles.map((roleName) => prisma.role.findFirst({ where: { name: roleName } }))

  const roles = await Promise.all(rolePromises)

  // Verify all roles were found
  if (roles.some((role) => !role)) {
    const missingRoles = config.roles.filter((role, index) => !roles[index])
    throw new Error(`Required roles not found: ${missingRoles.join(', ')}`)
  }

  // Create People record
  const people = await prisma.people.create({
    data: {
      firstname: config.firstname,
      lastname: config.lastname,
      email: config.email
    }
  })

  // Hash password
  const hashedPassword = await bcrypt.hash(config.password, 10)

  // Create the account first — ACCOUNT-scoped role assignments reference its id as their scope
  // target, so it must exist before the user's nested roleAssignments are created.
  const account = await prisma.account.create({
    data: {
      name: `Test Account for ${config.firstname} ${config.lastname}`,
      description: 'Test account created for E2E testing',
      isActive: true
    }
  })

  // Build scoped role-assignment rows. The `check_role_assignment_scope` trigger enforces:
  //   PLATFORM ⇒ no target · ACCOUNT ⇒ accountId set · ENTITY ⇒ entityId set.
  // This helper seeds PLATFORM/ACCOUNT roles only; ENTITY-scoped roles need an explicit entity
  // context and must be assigned by the dedicated entity test setup instead.
  const assignmentRows = roles.filter(Boolean).map((role) => {
    if (role!.scope === 'PLATFORM') return { roleId: role!.id }
    if (role!.scope === 'ACCOUNT') return { roleId: role!.id, accountId: account.id }
    throw new Error(`setupTestUser does not support ENTITY-scoped role "${role!.name}" — provide an entity context`)
  })

  // Create user with people + preference + account link + scoped role assignments
  const user = await prisma.user.create({
    data: {
      email: config.email,
      password: hashedPassword,
      isActive: true,
      people: { connect: { id: people.id } },
      preference: {
        create: {
          locale: 'FR'
        }
      },
      accountsLinked: {
        create: {
          accountId: account.id
        }
      },
      roleAssignments: {
        create: assignmentRows
      }
    }
  })

  // Extra permissions go to a custom role of the user's own account, never to the roles above (#987):
  // those are shared by every user of the run, so granting them there would leak to later specs.
  if (config.permissions?.length) {
    await grantTestPermissions(prisma, user.id, account.id, config.permissions)
  }

  return {
    id: user.id,
    email: user.email,
    accountId: account.id
  }
}

/**
 * Give one test user extra permissions in its own account, through a custom ACCOUNT role created for
 * it: the role belongs to the user's test account, is assigned to that user only, and is removed by
 * `cleanupTestUser`. System roles are never written to.
 * @param prisma The Prisma service
 * @param userId The test user
 * @param accountId The test user's own account
 * @param permissionNames The seeded permissions to grant
 */
async function grantTestPermissions(prisma: PrismaService, userId: string, accountId: string, permissionNames: string[]): Promise<void> {
  const names = [...new Set(permissionNames)]
  const permissions = await prisma.modulePermission.findMany({ where: { name: { in: names } } })

  // A permission the seed does not define is a typo or a missing dataset row: fail loudly instead of
  // inventing one in the shared catalog.
  const missing = names.filter((name) => !permissions.some((permission) => permission.name === name))
  if (missing.length) throw new Error(`setupTestUser: permissions not found in the seeded catalog: ${missing.join(', ')}`)

  const role = await prisma.role.create({
    data: {
      name: TEST_GRANTS_ROLE_NAME,
      description: 'Extra e2e grants of one test user',
      scope: 'ACCOUNT',
      isSystem: false,
      isActive: true,
      accountId
    }
  })

  // The RBAC v2 integrity trigger wants the role to hold a permission's module, then its sub-module,
  // before the permission itself: insert them in that order.
  const moduleIds = [...new Set(permissions.map((permission) => permission.moduleId))]
  const subModuleIds = [...new Set(permissions.map((permission) => permission.subModuleId).filter((id): id is number => id !== null))]
  await prisma.roleModuleLink.createMany({ data: moduleIds.map((moduleId) => ({ roleId: role.id, moduleId })) })
  await prisma.roleSubModuleLink.createMany({ data: subModuleIds.map((subModuleId) => ({ roleId: role.id, subModuleId })) })
  await prisma.rolePermissionLink.createMany({ data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })) })

  await prisma.userRoleAssignment.create({ data: { userId, roleId: role.id, accountId } })
}

/**
 * Login as a test user
 * @param agent The supertest agent
 * @param email User email
 * @param password User password
 * @param baseUrl Base URL for API
 * @returns true if login was successful
 */
export async function loginTestUser(agent: ReturnType<typeof request.agent>, email: string, password: string, baseUrl: string = '/api'): Promise<boolean> {
  try {
    const response = await agent.post(`${baseUrl}/auth/signin`).send({
      email,
      password
    })

    return response.status === 200
  } catch (error) {
    console.error('Error during login:', error)
    return false
  }
}

/**
 * Clean up test user data
 * @param prisma The Prisma service
 * @param email User email to clean up
 */
export async function cleanupTestUser(prisma: PrismaService, email: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      accountsLinked: true
    }
  })

  if (user) {
    // The grants role created for this user goes with it (only the one it holds: a user linked to another
    // test account must not take that account's grants away). Deleting the account alone would not remove
    // it: the role's account reference is set to null, which would turn it into a global role of every account.
    const grantsRoles = await prisma.role.findMany({
      where: { name: TEST_GRANTS_ROLE_NAME, isSystem: false, assignments: { some: { userId: user.id } } },
      select: { id: true }
    })
    const grantsRoleIds = grantsRoles.map((role) => role.id)

    // Delete the user (should cascade delete most relationships)
    await prisma.user.delete({
      where: { id: user.id }
    })

    if (grantsRoleIds.length) {
      await prisma.userRoleAssignment.deleteMany({ where: { roleId: { in: grantsRoleIds } } })
      await prisma.role.deleteMany({ where: { id: { in: grantsRoleIds } } })
    }

    for (const link of user.accountsLinked) {
      // Clean up account if it exists and no other users are linked
      const otherUsers = await prisma.userAccountLink.findMany({
        where: {
          accountId: link.accountId,
          userId: { not: user.id }
        }
      })

      if (otherUsers.length === 0) {
        await prisma.account.delete({
          where: { id: link.accountId }
        })
      }
    }
  }
}
