/**
 * Builder pattern for creating test data
 * Provides a fluent interface for creating mock objects with default values
 */

/**
 * Shape of a single scoped role assignment as returned by Prisma's
 * `user.findUnique` include in the RBAC model. Used to build mock user shapes
 * for the auth service unit tests.
 */
export interface RoleAssignmentSeed {
  id?: string
  accountId?: string | null
  entityId?: string | null
  role: {
    id?: number
    name: string
    scope?: 'PLATFORM' | 'ACCOUNT' | 'ENTITY'
    modulesLinked?: { module: { name: string; isActive: boolean } }[]
    subModulesLinked?: { subModule: { name: string; isActive?: boolean } }[]
    permissionsLinked?: { permission: { name: string; module: { isActive: boolean } | null; subModuleId?: number | null; subModule?: { isActive: boolean } | null } }[]
  }
}

export class UserBuilder {
  private user = {
    id: '1',
    email: 'test@example.com',
    password: 'hashedPassword',
    isActive: true,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    lastLoginAt: new Date('2024-01-01T00:00:00.000Z')
  }

  private roleAssignments: RoleAssignmentSeed[] | undefined

  withId(id: string): UserBuilder {
    this.user.id = id
    return this
  }

  withEmail(email: string): UserBuilder {
    this.user.email = email
    return this
  }

  withPassword(password: string): UserBuilder {
    this.user.password = password
    return this
  }

  withActiveStatus(isActive: boolean): UserBuilder {
    this.user.isActive = isActive
    return this
  }

  withCreatedAt(date: Date): UserBuilder {
    this.user.createdAt = date
    return this
  }

  withUpdatedAt(date: Date): UserBuilder {
    this.user.updatedAt = date
    return this
  }

  withLastLoginAt(date: Date): UserBuilder {
    this.user.lastLoginAt = date
    return this
  }

  /**
   * Attach scoped role assignments (RBAC model). Each seed is normalized to the
   * exact shape the auth service reads from Prisma (`roleAssignments[].role.{modulesLinked,permissionsLinked}`).
   */
  withRoleAssignments(assignments: RoleAssignmentSeed[]): UserBuilder {
    this.roleAssignments = assignments
    return this
  }

  build() {
    if (!this.roleAssignments) {
      return { ...this.user }
    }

    return {
      ...this.user,
      roleAssignments: this.roleAssignments.map((assignment, index) => ({
        id: assignment.id ?? `assignment-${index + 1}`,
        accountId: assignment.accountId ?? null,
        entityId: assignment.entityId ?? null,
        role: {
          id: assignment.role.id ?? index + 1,
          name: assignment.role.name,
          scope: assignment.role.scope ?? 'PLATFORM',
          modulesLinked: assignment.role.modulesLinked ?? [],
          subModulesLinked: assignment.role.subModulesLinked ?? [],
          permissionsLinked: assignment.role.permissionsLinked ?? []
        }
      }))
    }
  }

  static create(): UserBuilder {
    return new UserBuilder()
  }
}

export class AccountBuilder {
  private account = {
    id: '1',
    name: 'Test Account',
    description: 'Test Account Description',
    isActive: true,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z')
  }

  withId(id: string): AccountBuilder {
    this.account.id = id
    return this
  }

  withName(name: string): AccountBuilder {
    this.account.name = name
    return this
  }

  withDescription(description: string): AccountBuilder {
    this.account.description = description
    return this
  }

  withActiveStatus(isActive: boolean): AccountBuilder {
    this.account.isActive = isActive
    return this
  }

  withCreatedAt(date: Date): AccountBuilder {
    this.account.createdAt = date
    return this
  }

  withUpdatedAt(date: Date): AccountBuilder {
    this.account.updatedAt = date
    return this
  }

  build() {
    return { ...this.account }
  }

  static create(): AccountBuilder {
    return new AccountBuilder()
  }
}

export class OrganizationBuilder {
  private organization = {
    id: '1',
    name: 'Test Organization',
    type: 'COMPANY',
    description: 'Test Organization Description',
    website: 'https://test-org.com',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z')
  }

  withId(id: string): OrganizationBuilder {
    this.organization.id = id
    return this
  }

  withName(name: string): OrganizationBuilder {
    this.organization.name = name
    return this
  }

  withType(type: string): OrganizationBuilder {
    this.organization.type = type
    return this
  }

  withDescription(description: string): OrganizationBuilder {
    this.organization.description = description
    return this
  }

  withWebsite(website: string): OrganizationBuilder {
    this.organization.website = website
    return this
  }

  withCreatedAt(date: Date): OrganizationBuilder {
    this.organization.createdAt = date
    return this
  }

  withUpdatedAt(date: Date): OrganizationBuilder {
    this.organization.updatedAt = date
    return this
  }

  build() {
    return { ...this.organization }
  }

  static create(): OrganizationBuilder {
    return new OrganizationBuilder()
  }
}

export class EntityBuilder {
  private entity = {
    id: '1',
    name: 'Test Entity',
    description: 'Test Entity Description',
    isActive: true,
    accountId: '1',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z')
  }

  withId(id: string): EntityBuilder {
    this.entity.id = id
    return this
  }

  withName(name: string): EntityBuilder {
    this.entity.name = name
    return this
  }

  withDescription(description: string): EntityBuilder {
    this.entity.description = description
    return this
  }

  withActiveStatus(isActive: boolean): EntityBuilder {
    this.entity.isActive = isActive
    return this
  }

  withAccountId(accountId: string): EntityBuilder {
    this.entity.accountId = accountId
    return this
  }

  withCreatedAt(date: Date): EntityBuilder {
    this.entity.createdAt = date
    return this
  }

  withUpdatedAt(date: Date): EntityBuilder {
    this.entity.updatedAt = date
    return this
  }

  build() {
    return { ...this.entity }
  }

  static create(): EntityBuilder {
    return new EntityBuilder()
  }
}

export class RoleBuilder {
  private role = {
    id: 1,
    name: 'Admin',
    description: 'Admin role',
    scope: 'ACCOUNT' as 'PLATFORM' | 'ACCOUNT' | 'ENTITY',
    isSystem: true,
    isActive: true,
    accountId: '1' as string | null,
    modulesLinked: [{ module: { name: 'ACCOUNTS', isActive: true } }] as { module: { name: string; isActive: boolean } }[],
    subModulesLinked: [] as { subModule: { name: string; isActive?: boolean } }[],
    permissionsLinked: [{ permission: { name: 'ACCOUNT_USER_MANAGEMENT', module: { isActive: true } } }] as {
      permission: { name: string; module: { isActive: boolean } | null; subModuleId?: number | null; subModule?: { isActive: boolean } | null }
    }[],
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z')
  }

  withId(id: number): RoleBuilder {
    this.role.id = id
    return this
  }

  withName(name: string): RoleBuilder {
    this.role.name = name
    return this
  }

  withScope(scope: 'PLATFORM' | 'ACCOUNT' | 'ENTITY'): RoleBuilder {
    this.role.scope = scope
    return this
  }

  withIsSystem(isSystem: boolean): RoleBuilder {
    this.role.isSystem = isSystem
    return this
  }

  withModules(modulesLinked: { module: { name: string; isActive: boolean } }[]): RoleBuilder {
    this.role.modulesLinked = modulesLinked
    return this
  }

  withSubModules(subModulesLinked: { subModule: { name: string; isActive?: boolean } }[]): RoleBuilder {
    this.role.subModulesLinked = subModulesLinked
    return this
  }

  withPermissions(permissionsLinked: { permission: { name: string; module: { isActive: boolean } | null; subModuleId?: number | null; subModule?: { isActive: boolean } | null } }[]): RoleBuilder {
    this.role.permissionsLinked = permissionsLinked
    return this
  }

  withActiveStatus(isActive: boolean): RoleBuilder {
    this.role.isActive = isActive
    return this
  }

  withAccountId(accountId: string | null): RoleBuilder {
    this.role.accountId = accountId
    return this
  }

  withCreatedAt(date: Date): RoleBuilder {
    this.role.createdAt = date
    return this
  }

  withUpdatedAt(date: Date): RoleBuilder {
    this.role.updatedAt = date
    return this
  }

  build() {
    return { ...this.role }
  }

  static create(): RoleBuilder {
    return new RoleBuilder()
  }
}

export class TokenBuilder {
  private token = {
    id: '1',
    userId: '1',
    token: 'valid.refresh.token',
    type: 'SESSION_REFRESH',
    expiresAt: new Date(Date.now() + 3600000) // 1 hour from now
  }

  withId(id: string): TokenBuilder {
    this.token.id = id
    return this
  }

  withUserId(userId: string): TokenBuilder {
    this.token.userId = userId
    return this
  }

  withToken(token: string): TokenBuilder {
    this.token.token = token
    return this
  }

  withType(type: string): TokenBuilder {
    this.token.type = type
    return this
  }

  withExpiresAt(date: Date): TokenBuilder {
    this.token.expiresAt = date
    return this
  }

  withExpiredToken(): TokenBuilder {
    this.token.expiresAt = new Date(Date.now() - 3600000) // 1 hour ago
    return this
  }

  withValidToken(): TokenBuilder {
    this.token.expiresAt = new Date(Date.now() + 3600000) // 1 hour from now
    return this
  }

  build() {
    return { ...this.token }
  }

  static create(): TokenBuilder {
    return new TokenBuilder()
  }
}

export class UserAccountLinkBuilder {
  private link = {
    userId: '1',
    accountId: '1',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    indirectAccess: false
  }

  withUserId(userId: string): UserAccountLinkBuilder {
    this.link.userId = userId
    return this
  }

  withAccountId(accountId: string): UserAccountLinkBuilder {
    this.link.accountId = accountId
    return this
  }

  withIndirectAccess(indirectAccess: boolean): UserAccountLinkBuilder {
    this.link.indirectAccess = indirectAccess
    return this
  }

  withCreatedAt(date: Date): UserAccountLinkBuilder {
    this.link.createdAt = date
    return this
  }

  withUpdatedAt(date: Date): UserAccountLinkBuilder {
    this.link.updatedAt = date
    return this
  }

  build() {
    return { ...this.link }
  }

  static create(): UserAccountLinkBuilder {
    return new UserAccountLinkBuilder()
  }
}

/**
 * Convenient factory functions
 */
export const TestDataFactory = {
  user: () => UserBuilder.create(),
  account: () => AccountBuilder.create(),
  organization: () => OrganizationBuilder.create(),
  entity: () => EntityBuilder.create(),
  role: () => RoleBuilder.create(),
  token: () => TokenBuilder.create(),
  userAccountLink: () => UserAccountLinkBuilder.create()
}
