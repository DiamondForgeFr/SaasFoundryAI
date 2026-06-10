/**
 * Resources
 */
import { Body, Controller, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'

/**
 * Dependencies
 */
import { RequirePermissions } from '@common/decorators/require-permissions.decorator'
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard'
import { PermissionsGuard } from '@modules/auth/guards/permissions.guard'
import { EntityService } from '@modules/entities/services/entity.service'

/**
 * DTO
 */
import { CreateEntityDto } from '@modules/entities/dto/requests/create-entity.dto'
import { UpdateEntityUsersDto } from '@modules/entities/dto/requests/update-entity-users.dto'

import { CreateEntityResponseDto } from '@modules/entities/dto/responses/create-entity.response.dto'
import { UpdateEntityUsersResponseDto } from '@modules/entities/dto/responses/update-entity-users.response.dto'

/**
 * Type
 */
import type { AuthenticatedRequest } from '@common/types/authenticated-request.type'

/**
 * Declaration
 */
@ApiTags('Entities')
@Controller('entities')
@UseGuards(JwtAuthGuard)
export class EntitiesController {
  constructor(private readonly entityService: EntityService) {}

  @Post()
  @RequirePermissions(['ENTITY_CREATION'], 'ACCOUNT_ADMINISTRATION')
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'Create entity', description: 'Create a new entity and link it to an account and organization.' })
  @ApiResponse({ status: 201, description: 'The entity has been successfully created', type: CreateEntityResponseDto })
  @ApiResponse({ status: 400, description: 'Failed to create entity' })
  @ApiResponse({ status: 401, description: 'User does not have permission to create entities' })
  /** End -- Documentation */
  async createEntity(@Req() req: AuthenticatedRequest, @Body() createEntityDto: CreateEntityDto): Promise<CreateEntityResponseDto> {
    return this.entityService.createEntity(req.user.id, createEntityDto)
  }

  @Post('own')
  @RequirePermissions(['ENTITY_OWN_CREATE'], 'MULTI_ENTITY_MANAGEMENT')
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({
    summary: 'Create an additional entity owned by the current user',
    description: 'Multi-entity feature — an entity-admin with ENTITY_OWN_CREATE creates a brand-new entity inside the same parent account, becoming entity-admin of it.'
  })
  @ApiResponse({ status: 201, description: 'The entity has been successfully created', type: CreateEntityResponseDto })
  /** End -- Documentation */
  async createOwnEntity(@Req() req: AuthenticatedRequest, @Body() createEntityDto: CreateEntityDto): Promise<CreateEntityResponseDto> {
    return this.entityService.createOwnEntity(req.user.id, createEntityDto)
  }

  @Patch(':id')
  @RequirePermissions(['ACCOUNT_ENTITY_MANAGEMENT'], 'ACCOUNT_ADMINISTRATION')
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'Update entity', description: 'Update an entity name/description/isActive and its profile organization fields.' })
  @ApiParam({ name: 'id', description: 'Entity ID' })
  /** End -- Documentation */
  async updateEntity(
    @Req() req: AuthenticatedRequest,
    @Param('id') entityId: string,
    @Body()
    body: {
      name?: string
      description?: string | null
      isActive?: boolean
      organization?: {
        name?: string
        type?: 'COMPANY' | 'ASSOCIATION' | 'COMMUNITY'
        description?: string | null
        website?: string | null
      }
    }
  ) {
    return this.entityService.updateEntity(req.user.id, entityId, body)
  }

  @Patch(':id/users')
  @RequirePermissions(['ENTITY_USER_MANAGEMENT'], 'ACCOUNT_ADMINISTRATION')
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'Update entity users', description: 'Update the users linked to an entity.' })
  @ApiParam({ name: 'id', description: 'Entity ID' })
  @ApiResponse({ status: 200, description: 'The users have been successfully updated for the entity', type: UpdateEntityUsersResponseDto })
  @ApiResponse({ status: 400, description: 'Failed to update entity users' })
  @ApiResponse({ status: 401, description: 'User does not have permission to manage entity users' })
  /** End -- Documentation */
  async updateEntityUsers(@Req() req: AuthenticatedRequest, @Param('id') entityId: string, @Body() updateEntityUsersDto: UpdateEntityUsersDto): Promise<UpdateEntityUsersResponseDto> {
    return this.entityService.updateEntityUsers(req.user.id, entityId, updateEntityUsersDto.userIds)
  }
}
