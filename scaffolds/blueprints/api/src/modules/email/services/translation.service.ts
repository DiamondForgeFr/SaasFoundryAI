/**
 * Resources
 */
import { Injectable } from '@nestjs/common'
import { Locale } from '@/generated/prisma/client'

/**
 * Dependencies
 */
import { EnvConfig } from '@configs/env/services/env.service'

/**
 * Locales
 */
import { en } from '@modules/email/locales/en'
import { fr } from '@modules/email/locales/fr'

/**
 * Type
 */
interface EmailTemplate {
  subject: string
  title: string
  greeting: string
  body: string
  button: string
  fallback: string
  ignore: string
  footer: string
}

interface PasswordResetTemplate extends EmailTemplate {
  expiration: string
}

interface InvitationTemplate {
  subject: string
  title: string
  greeting: string
  bodyWithName: string
  bodyWithoutName: string
  button: string
  fallback: string
  expiration: string
  ignore: string
  footer: string
}

/**
 * Declaration
 */
interface Translations {
  accountConfirmation: EmailTemplate
  passwordReset: PasswordResetTemplate
  invitation: InvitationTemplate
}

export type TranslationKey = keyof Translations

@Injectable()
export class TranslationService {
  private readonly translations: Record<Locale, Translations> = {
    [Locale.FR]: fr,
    [Locale.EN]: en
  }

  constructor(private readonly envConfig: EnvConfig) {}

  /** A template in `locale`, its `{appName}` replaced by the product name of `APP_NAME`. */
  getTranslation<K extends TranslationKey>(locale: Locale, key: K): Translations[K] {
    const template = this.translations[locale]?.[key] ?? this.translations[Locale.EN][key]
    if (!template) return template
    const appName = this.envConfig.get('APP_NAME')
    return Object.fromEntries(Object.entries(template).map(([field, text]) => [field, typeof text === 'string' ? text.replaceAll('{appName}', appName) : text])) as Translations[K]
  }
}
