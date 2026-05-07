/**
 * Resources
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'

/**
 * Dependencies
 */
import { Logger } from '@common/services/logger/logger.service'
import { PrismaService } from '@configs/prisma/services/prisma.service'
import { UserDefaults } from '@configs/db/user.config'

/**
 * DTO
 */
import { UpdateUserPreferencesDto } from '@modules/users/dto/requests/update-preferences.dto'
import { UserPreferencesDto } from '@modules/users/dto/responses/preferences.response.dto'

/**
 * Declaration
 */
@Injectable()
export class UserPreferencesService {
  constructor(
    private readonly logger: Logger,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Read the authenticated user's preferences.
   * Defensively creates a default row if it is missing (legacy users without
   * a UserPreference record after the table was introduced).
   */
  public async getPreferences(userId: string): Promise<UserPreferencesDto> {
    this.logger.debug(`Fetching preferences for user ${userId}`, 'UserPreferencesService.getPreferences')

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { preference: true }
      })

      if (!user) {
        this.logger.warn(`User not found: ${userId}`, 'UserPreferencesService.getPreferences')
        throw new NotFoundException('User not found')
      }

      if (user.preference) {
        return {
          locale: user.preference.locale,
          avatarUrl: user.preference.avatarUrl ?? null
        }
      }

      const created = await this.prisma.userPreference.create({
        data: { userId, locale: UserDefaults.preferences.locale }
      })
      return { locale: created.locale, avatarUrl: created.avatarUrl ?? null }
    } catch (error) {
      if (error instanceof NotFoundException) throw error
      this.logger.error(`Failed to fetch preferences for user ${userId}: ${error.message}`, 'UserPreferencesService.getPreferences')
      throw new BadRequestException('Failed to fetch user preferences')
    }
  }

  /**
   * Partial update of the authenticated user's preferences. Omitted fields
   * are left untouched. Uses upsert to be idempotent for legacy rows.
   */
  public async updatePreferences(userId: string, payload: UpdateUserPreferencesDto): Promise<UserPreferencesDto> {
    this.logger.debug(`Updating preferences for user ${userId}: ${JSON.stringify(payload)}`, 'UserPreferencesService.updatePreferences')

    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
      if (!user) {
        this.logger.warn(`User not found: ${userId}`, 'UserPreferencesService.updatePreferences')
        throw new NotFoundException('User not found')
      }

      const updated = await this.prisma.userPreference.upsert({
        where: { userId },
        update: {
          ...(payload.locale !== undefined ? { locale: payload.locale } : {}),
          ...(payload.avatarUrl !== undefined ? { avatarUrl: payload.avatarUrl } : {})
        },
        create: {
          userId,
          locale: payload.locale ?? UserDefaults.preferences.locale,
          avatarUrl: payload.avatarUrl ?? null
        }
      })

      return { locale: updated.locale, avatarUrl: updated.avatarUrl ?? null }
    } catch (error) {
      if (error instanceof NotFoundException) throw error
      this.logger.error(`Failed to update preferences for user ${userId}: ${error.message}`, 'UserPreferencesService.updatePreferences')
      throw new BadRequestException('Failed to update user preferences')
    }
  }
}
