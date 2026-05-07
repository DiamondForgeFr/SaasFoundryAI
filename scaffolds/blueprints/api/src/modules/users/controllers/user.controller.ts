/**
 * Resources
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Req, UseGuards } from '@nestjs/common'
import { ApiBadRequestResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger'

/**
 * Dependencies
 */
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard'
import { UserPreferencesService } from '@modules/users/services/user-preferences.service'

/**
 * DTO
 */
import { UpdateUserPreferencesDto } from '@modules/users/dto/requests/update-preferences.dto'
import { UserPreferencesDto } from '@modules/users/dto/responses/preferences.response.dto'

/**
 * Type
 */
import type { AuthenticatedRequest } from '@common/types/authenticated-request.type'

/**
 * Declaration
 */
@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userPreferencesService: UserPreferencesService) {}

  @Get('me/preferences')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get my preferences', description: 'Retrieve the authenticated user own preferences (locale, avatar URL).' })
  @ApiOkResponse({ type: UserPreferencesDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid or missing token.' })
  @ApiNotFoundResponse({ description: 'User not found.' })
  async getMyPreferences(@Req() req: AuthenticatedRequest): Promise<UserPreferencesDto> {
    return this.userPreferencesService.getPreferences(req.user.id)
  }

  @Patch('me/preferences')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update my preferences', description: 'Partial update of the authenticated user own preferences. Omitted fields are left untouched.' })
  @ApiOkResponse({ type: UserPreferencesDto })
  @ApiBadRequestResponse({ description: 'Invalid payload.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized - Invalid or missing token.' })
  @ApiNotFoundResponse({ description: 'User not found.' })
  async updateMyPreferences(@Req() req: AuthenticatedRequest, @Body() body: UpdateUserPreferencesDto): Promise<UserPreferencesDto> {
    return this.userPreferencesService.updatePreferences(req.user.id, body)
  }
}
