import { ApiProperty } from '@nestjs/swagger'

import type { Collection, EntityWithOrgRef, OrganizationRef, OrganizationType } from '@shared-types/index'

export class OrganizationDto implements OrganizationRef {
  @ApiProperty({
    description: 'Organization ID',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  id: string

  @ApiProperty({
    description: 'Organization name',
    example: 'ACME Corporation'
  })
  name: string

  @ApiProperty({
    description: 'Organization type',
    enum: ['COMPANY', 'ASSOCIATION', 'COMMUNITY'],
    example: 'COMPANY',
    required: false
  })
  type?: OrganizationType

  @ApiProperty({
    description: 'Logo URL (publicly accessible) — null when no logo has been uploaded.',
    example: 'https://cdn.example.com/logos/acme.png',
    required: false,
    nullable: true
  })
  logoUrl?: string | null

  @ApiProperty({
    description: 'Organization description (markdown allowed). Null if no description was set.',
    example: 'Manufacturer of high-precision hardware.',
    required: false,
    nullable: true
  })
  description?: string | null

  @ApiProperty({
    description: 'Organization website URL. Null if no website was provided.',
    example: 'https://acme.example.com',
    required: false,
    nullable: true
  })
  website?: string | null
}

export class EntityWithOrganizationDto implements EntityWithOrgRef {
  @ApiProperty({
    description: 'Entity ID',
    example: 'cmagp5dy70001t84nzb9t39j8'
  })
  id: string

  @ApiProperty({
    description: 'Entity name',
    example: 'Main Office'
  })
  name: string

  @ApiProperty({
    description: 'Associated organization',
    type: OrganizationDto,
    required: false
  })
  organization: OrganizationDto | null
}

export class AccountEntityListItemDto {
  @ApiProperty({ description: 'Entity ID', example: 'cmagp5dy70001t84nzb9t39j8' })
  id: string

  @ApiProperty({ description: 'Entity name', example: 'Main Office' })
  name: string

  @ApiProperty({ description: 'Entity description', required: false, nullable: true })
  description: string | null

  @ApiProperty({ description: 'Whether the entity is active', example: true })
  isActive: boolean

  @ApiProperty({ description: 'Associated organization', type: OrganizationDto, required: false, nullable: true })
  organization: OrganizationDto | null

  @ApiProperty({ description: 'Number of active users directly linked to this entity', example: 4 })
  userCount: number

  @ApiProperty({ description: 'Creation date', example: '2024-01-01T00:00:00.000Z' })
  createdAt: Date

  @ApiProperty({ description: 'Last update date', example: '2024-01-01T00:00:00.000Z' })
  updatedAt: Date
}

export class AccountUserDto {
  @ApiProperty({
    description: 'User ID',
    example: 'cmagp5dy70001t84nzb9t39j6'
  })
  id: string

  @ApiProperty({
    description: 'User email',
    example: 'john.doe@example.com'
  })
  email: string

  @ApiProperty({
    description: 'User active status',
    example: true
  })
  isActive: boolean

  @ApiProperty({
    description: 'User profile information',
    required: false,
    example: {
      id: 'cmagp5dy70001t84nzb9t39j7',
      firstname: 'John',
      lastname: 'Doe'
    }
  })
  people: {
    id: string
    firstname: string | null
    lastname: string | null
  } | null

  @ApiProperty({
    description: 'User roles',
    example: [
      {
        id: 1,
        name: 'Admin'
      }
    ]
  })
  roles: {
    id: number
    name: string
  }[]

  @ApiProperty({
    description: 'Entities the user is linked to',
    type: [EntityWithOrganizationDto],
    example: [
      {
        id: 'cmagp5dy70001t84nzb9t39j8',
        name: 'Main Office',
        organization: {
          id: 'org123',
          name: 'Acme Corp'
        }
      }
    ]
  })
  entities: EntityWithOrganizationDto[]

  @ApiProperty({
    description: 'Whether the user is directly linked to the account',
    example: true
  })
  isDirectlyLinked: boolean

  @ApiProperty({
    description:
      'Pending state, derived from data: "invited" = inactive with a pending received invitation (awaiting signup); "awaiting-confirmation" = inactive self-signup with no invitation (awaiting email confirmation); null = active.',
    enum: ['invited', 'awaiting-confirmation'],
    nullable: true,
    required: false,
    example: 'invited'
  })
  pendingKind: 'invited' | 'awaiting-confirmation' | null

  @ApiProperty({
    description: 'Creation date',
    example: '2024-01-01T00:00:00.000Z'
  })
  createdAt: Date

  @ApiProperty({
    description: 'Last login date — null when the user has never logged in (e.g. just-invited).',
    example: '2024-01-01T00:00:00.000Z',
    required: false,
    nullable: true
  })
  lastLoginAt: Date | null

  @ApiProperty({
    description: 'Last update date',
    example: '2024-01-01T00:00:00.000Z'
  })
  updatedAt: Date
}

export class AccountRoleDto {
  @ApiProperty({
    description: 'Role ID',
    example: 1
  })
  id: number

  @ApiProperty({
    description: 'Role name',
    example: 'Admin'
  })
  name: string

  @ApiProperty({
    description: 'Role description',
    example: 'Administrator with full access',
    required: false
  })
  description: string | null

  @ApiProperty({
    description: 'Scope at which this role can be assigned',
    enum: ['PLATFORM', 'ACCOUNT', 'ENTITY'],
    example: 'ACCOUNT'
  })
  scope: 'PLATFORM' | 'ACCOUNT' | 'ENTITY'

  @ApiProperty({
    description: 'Whether the role is a system template (cannot be edited or deleted)',
    example: true
  })
  isSystem: boolean

  @ApiProperty({
    description: 'Role active status',
    example: true
  })
  isActive: boolean

  @ApiProperty({
    description: 'Whether the role is a global template (accountId NULL)',
    example: false
  })
  isGlobal: boolean

  @ApiProperty({
    description: 'Names of the modules this role grants access to',
    isArray: true,
    type: String,
    example: ['ACCOUNT_ADMINISTRATION']
  })
  modules: string[]

  @ApiProperty({
    description: 'Names of the sub-modules (read-visibility sections) this role grants',
    isArray: true,
    type: String,
    example: ['USERS', 'ROLES']
  })
  subModules: string[]

  @ApiProperty({
    description: 'Names of the permissions granted by this role',
    isArray: true,
    type: String,
    example: ['ACCOUNT_USER_MANAGEMENT']
  })
  permissions: string[]

  @ApiProperty({
    description: 'Creation date',
    example: '2024-01-01T00:00:00.000Z'
  })
  createdAt: Date

  @ApiProperty({
    description: 'Last update date',
    example: '2024-01-01T00:00:00.000Z'
  })
  updatedAt: Date
}

export class CollectionResponseDto<T> implements Collection<T> {
  @ApiProperty({
    description: 'Total number of items in the collection'
  })
  count: number

  @ApiProperty({
    description: 'Collection items',
    type: 'array',
    items: { type: 'object' }
  })
  values: T[]
}

export class FetchAccountDeepResponseDto {
  @ApiProperty({
    description: 'Account ID',
    example: 'cmagp5dy70001t84nzb9t39j6'
  })
  id: string

  @ApiProperty({
    description: 'Account name',
    example: 'Acme Corp'
  })
  name: string

  @ApiProperty({
    description: 'Account description',
    example: 'Main account for Acme Corporation',
    required: false
  })
  description: string | null

  @ApiProperty({
    description: 'Account active status',
    example: true
  })
  isActive: boolean

  @ApiProperty({
    description: 'Creation date',
    example: '2024-01-01T00:00:00.000Z'
  })
  createdAt: Date

  @ApiProperty({
    description: 'Last update date',
    example: '2024-01-01T00:00:00.000Z'
  })
  updatedAt: Date

  @ApiProperty({
    description: 'Count of pending invitations awaiting signup (SENT/EXPIRED invitations targeting this account or its entities).',
    example: 2
  })
  pendingInvitations: number

  @ApiProperty({
    description: 'Count of pending self-signups awaiting email confirmation (inactive users linked to this account with no pending received invitation).',
    example: 1
  })
  pendingSignups: number

  @ApiProperty({
    description: 'Account users',
    type: CollectionResponseDto<AccountUserDto>
  })
  users: CollectionResponseDto<AccountUserDto>

  @ApiProperty({
    description: 'Account entities',
    type: CollectionResponseDto<EntityWithOrganizationDto>
  })
  entities: CollectionResponseDto<EntityWithOrganizationDto>

  @ApiProperty({
    description: 'Account roles',
    type: CollectionResponseDto<AccountRoleDto>
  })
  roles: CollectionResponseDto<AccountRoleDto>
}
