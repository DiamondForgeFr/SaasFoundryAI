import type { LocaleValue } from './common'

export interface UserPreferences {
  locale: LocaleValue
  avatarUrl: string | null
}
