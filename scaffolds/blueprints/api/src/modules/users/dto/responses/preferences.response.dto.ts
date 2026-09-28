import { ApiProperty } from '@nestjs/swagger'

import type { LocaleValue, UserPreferences } from '@shared-types/index'

export class UserPreferencesDto implements UserPreferences {
  @ApiProperty({
    description: 'User preferred locale (matches the Prisma Locale enum)',
    enum: ['EN', 'FR'],
    example: 'EN'
  })
  locale: LocaleValue

  @ApiProperty({
    description: 'Avatar URL pointing to the storage bucket; null when the user has no custom avatar',
    nullable: true,
    example: 'https://cdn.example.com/avatars/123.png'
  })
  avatarUrl: string | null
}
