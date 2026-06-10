import { Locale } from '@/generated/prisma/client'

export const UserRoleNames = {
  GUEST: 'guest',
  USER: 'account-user',
  ADMIN: 'account-admin',
  ENTITY_ADMIN: 'entity-admin',
  ENTITY_USER: 'entity-user',
  PLATFORM_ADMIN: 'platform-admin',
  PLATFORM_USER: 'platform-user'
} as const

export const UserDefaults = {
  roles: {
    default: UserRoleNames.USER,
    admin: UserRoleNames.ADMIN,
    entityAdmin: UserRoleNames.ENTITY_ADMIN,
    entityUser: UserRoleNames.ENTITY_USER,
    platformAdmin: UserRoleNames.PLATFORM_ADMIN,
    platformUser: UserRoleNames.PLATFORM_USER
  },
  preferences: {
    locale: Locale.EN
  }
} as const
