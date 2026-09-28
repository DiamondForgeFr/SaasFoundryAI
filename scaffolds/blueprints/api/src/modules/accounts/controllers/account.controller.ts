/**
 * Resources
 */
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiExtraModels, ApiOperation, ApiParam, ApiResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger'

/**
 * Dependencies
 */
import { RequireAccess, RequirePermissions } from '@common/decorators/require-permissions.decorator'
import { AccountAccessService } from '@common/services/account-access/account-access.service'
import { AccountService } from '@modules/accounts/services/account.service'
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard'
import { PermissionsGuard } from '@modules/auth/guards/permissions.guard'

/**
 * DTO
 */
import { FetchAccountEntitiesDto } from '@modules/accounts/dto/requests/fetch-account-entities.dto'
import { FetchAccountRolesDto } from '@modules/accounts/dto/requests/fetch-account-roles.dto'
import { FetchAccountUsersDto } from '@modules/accounts/dto/requests/fetch-account-users.dto'
import { UpdateAccountStatusDto } from '@modules/accounts/dto/requests/update-account-status.dto'
import { UpdateAccountUsersDto } from '@modules/accounts/dto/requests/update-account-users.dto'

import { FetchAccountEntitiesResponseDto } from '@modules/accounts/dto/responses/fetch-account-entities.response.dto'
import { FetchAccountRolesResponseDto } from '@modules/accounts/dto/responses/fetch-account-roles.response.dto'
import { FetchAccountUsersResponseDto } from '@modules/accounts/dto/responses/fetch-account-users.response.dto'
import { AccountRoleDto, AccountUserDto, EntityWithOrganizationDto, FetchAccountDeepResponseDto } from '@modules/accounts/dto/responses/fetch_account.response.dto'
import { UpdateAccountStatusResponseDto } from '@modules/accounts/dto/responses/update-account-status.response.dto'
import { UpdateAccountUsersResponseDto } from '@modules/accounts/dto/responses/update-account-users.response.dto'

/**
 * Type
 */
import type { AuthenticatedRequest } from '@common/types/authenticated-request.type'

/**
 * Declaration
 */
@ApiTags('Accounts')
@ApiExtraModels(AccountUserDto, EntityWithOrganizationDto, AccountRoleDto)
@Controller('accounts')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(
    private readonly accountService: AccountService,
    private readonly accountAccessService: AccountAccessService
  ) {}

  @Get('/')
  @RequireAccess({ module: 'PLATFORM_ADMINISTRATION', subModule: 'PLATFORM_ACCOUNTS' })
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({
    summary: 'List all accounts (platform reach)',
    description: 'Paginated, searchable list of every account on the platform. Restricted to users holding the PLATFORM_ACCOUNTS section.'
  })
  @ApiResponse({ status: 200, description: 'Paginated list of accounts' })
  @ApiResponse({ status: 403, description: 'User does not have the required platform section' })
  /** End -- Documentation */
  async fetchAllAccounts(
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
    @Query('withPendingReactivation') withPendingReactivation?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    return this.accountService.fetchAllAccounts({
      search: search || undefined,
      isActive: isActive === undefined ? undefined : isActive === 'true',
      withPendingReactivation: withPendingReactivation === 'true',
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined
    })
  }

  @Get('permissions/catalog')
  @RequirePermissions(['ROLE_CUSTOM_MANAGEMENT'], 'ACCOUNT_ADMINISTRATION', { requireAll: false })
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'List the permissions catalog grouped by module', description: 'Drives the role-builder UI: returns every module + its permissions with their applicable scopes.' })
  /** End -- Documentation */
  async fetchPermissionsCatalog() {
    return this.accountService.fetchPermissionsCatalog()
  }

  @Get('system/roles')
  @RequireAccess({ module: 'ACCOUNT_ADMINISTRATION', subModule: 'ROLES' })
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({
    summary: 'List platform-wide system roles',
    description: 'Returns roles whose accountId is NULL — the system templates available to every account. Used by the platform-admin browsing the Roles tab without a specific account selected.'
  })
  /** End -- Documentation */
  async fetchSystemRoles(@Query('search') search?: string, @Query('isActive') isActive?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.accountService.fetchSystemRoles({
      search: search || undefined,
      isActive: isActive === undefined ? undefined : isActive === 'true',
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined
    })
  }

  @Get('platform/overview')
  @RequireAccess({ module: 'PLATFORM_ADMINISTRATION', subModule: 'PLATFORM_ACCOUNTS' })
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'Platform-wide overview', description: 'Aggregated KPIs + recent users / entities across every account, plus the system roles catalog.' })
  /** End -- Documentation */
  async fetchPlatformOverview() {
    return this.accountService.fetchPlatformOverview()
  }

  @Get('platform/users')
  @RequireAccess({ module: 'PLATFORM_ADMINISTRATION', subModule: 'PLATFORM_USERS' })
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({
    summary: 'Platform-wide users (deduplicated)',
    description: 'Cross-account user listing — each user appears once with their aggregated account/entity attachments. Supports search, status filter and a multi-account-only flag.'
  })
  /** End -- Documentation */
  async fetchPlatformUsers(
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
    @Query('accountScope') accountScope?: string,
    @Query('roleIds') roleIds?: string | string[],
    @Query('accountIds') accountIds?: string | string[],
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const scope = accountScope === 'multi' || accountScope === 'mono' || accountScope === 'platform' ? accountScope : 'all'
    // Array query params arrive as a single string when one value is sent, or an array when many — normalize.
    const roleIdsArr = roleIds === undefined ? undefined : (Array.isArray(roleIds) ? roleIds : [roleIds]).map((v) => Number(v)).filter((n) => Number.isFinite(n))
    const accountIdsArr = accountIds === undefined ? undefined : Array.isArray(accountIds) ? accountIds : [accountIds]
    return this.accountService.fetchPlatformUsers({
      search: search || undefined,
      isActive: isActive === undefined ? undefined : isActive === 'true',
      accountScope: scope,
      roleIds: roleIdsArr && roleIdsArr.length > 0 ? roleIdsArr : undefined,
      accountIds: accountIdsArr && accountIdsArr.length > 0 ? accountIdsArr : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined
    })
  }

  @Get('platform/modules')
  @RequireAccess({ module: 'PLATFORM_ADMINISTRATION', subModule: 'PLATFORM_MODULES' })
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'List every platform module with its permissions and activation status' })
  /** End -- Documentation */
  async fetchPlatformModules() {
    return this.accountService.fetchPlatformModules()
  }

  @Get('platform/reactivation-requests')
  @RequireAccess({ module: 'PLATFORM_ADMINISTRATION', subModule: 'PLATFORM_REACTIVATION' })
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'List reactivation requests (platform-admin)', description: 'Defaults to PENDING. Use ?status=APPROVED|REJECTED to view archived requests.' })
  /** End -- Documentation */
  async fetchPlatformReactivationRequests(@Query('status') status?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    const allowed = status === 'APPROVED' || status === 'REJECTED' || status === 'PENDING' ? status : undefined
    return this.accountService.fetchPlatformReactivationRequests({
      status: allowed as 'PENDING' | 'APPROVED' | 'REJECTED' | undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined
    })
  }

  @Post('platform/reactivation-requests/:requestId/approve')
  @RequirePermissions(['ACCOUNT_REACTIVATION_REVIEW'], 'PLATFORM_ADMINISTRATION')
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'Approve a reactivation request', description: 'Re-enables the account in the same transaction and clears the deactivation provenance.' })
  /** End -- Documentation */
  async approveReactivationRequest(@Req() req: AuthenticatedRequest, @Param('requestId') requestId: string, @Body() body: { note?: string }) {
    return this.accountService.approveReactivationRequest(req.user.id, requestId, body?.note)
  }

  @Post('platform/reactivation-requests/:requestId/reject')
  @RequirePermissions(['ACCOUNT_REACTIVATION_REVIEW'], 'PLATFORM_ADMINISTRATION')
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'Reject a reactivation request', description: 'Account stays disabled. A note explaining the decision is required.' })
  /** End -- Documentation */
  async rejectReactivationRequest(@Req() req: AuthenticatedRequest, @Param('requestId') requestId: string, @Body() body: { note: string }) {
    return this.accountService.rejectReactivationRequest(req.user.id, requestId, body?.note)
  }

  @Patch('platform/modules/:moduleId')
  @RequirePermissions(['MODULE_MANAGEMENT'], 'PLATFORM_ADMINISTRATION')
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'Toggle a module activation status (platform-admin only)' })
  @ApiParam({ name: 'moduleId', description: 'Module ID' })
  /** End -- Documentation */
  async togglePlatformModule(@Param('moduleId', ParseIntPipe) moduleId: number, @Body() body: { isActive: boolean }) {
    return this.accountService.togglePlatformModule(moduleId, body.isActive)
  }

  @Patch('platform/modules/:moduleId/sub-modules/:subModuleId')
  @RequirePermissions(['MODULE_MANAGEMENT'], 'PLATFORM_ADMINISTRATION')
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'Toggle a sub-module activation status (platform-admin only)' })
  @ApiParam({ name: 'moduleId', description: 'Parent module ID' })
  @ApiParam({ name: 'subModuleId', description: 'Sub-module ID' })
  /** End -- Documentation */
  async toggleSubModule(@Param('moduleId', ParseIntPipe) moduleId: number, @Param('subModuleId', ParseIntPipe) subModuleId: number, @Body() body: { isActive: boolean }) {
    return this.accountService.toggleSubModule(moduleId, subModuleId, body.isActive)
  }

  @Post('own')
  @RequirePermissions(['ACCOUNT_OWN_CREATE'], 'MULTI_ACCOUNT_MANAGEMENT')
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({
    summary: 'Create an additional account owned by the current user',
    description: 'Multi-account feature — an account admin with ACCOUNT_OWN_CREATE creates a brand-new account they automatically become admin of. Independent account (no parent/child).'
  })
  /** End -- Documentation */
  async createOwnAccount(@Req() req: AuthenticatedRequest, @Body() body: { name: string; description?: string | null }) {
    return this.accountService.createOwnAccount(req.user.id, body)
  }

  @Get(':id')
  @RequireAccess({ module: 'ACCOUNT_ADMINISTRATION', subModule: 'OVERVIEW' })
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'Fetch account details', description: 'Fetch detailed account information including the 5 most recent users, entities, and roles with counts.' })
  @ApiParam({ name: 'id', description: 'Account ID' })
  @ApiResponse({ status: 200, description: 'Detailed account information', type: FetchAccountDeepResponseDto })
  @ApiResponse({ status: 404, description: 'Account not found' })
  @ApiResponse({ status: 400, description: 'Failed to get account details' })
  /** End -- Documentation */
  async fetchAccount(@Req() req: AuthenticatedRequest, @Param('id') accountId: string): Promise<FetchAccountDeepResponseDto> {
    return this.accountService.fetchAccount(req.user.id, accountId)
  }

  @Get(':id/users')
  @RequireAccess({ module: 'ACCOUNT_ADMINISTRATION', subModule: 'USERS' })
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'Fetch account users', description: 'Fetch users linked to an account with pagination and filtering options.' })
  @ApiParam({ name: 'id', description: 'Account ID' })
  @ApiResponse({ status: 200, description: 'Paginated list of users', type: FetchAccountUsersResponseDto })
  @ApiResponse({ status: 404, description: 'Account not found' })
  @ApiResponse({ status: 400, description: 'Failed to fetch account users' })
  /** End -- Documentation */
  async fetchAccountUsers(@Req() req: AuthenticatedRequest, @Param('id') accountId: string, @Query() queryParams: FetchAccountUsersDto): Promise<FetchAccountUsersResponseDto> {
    return this.accountService.fetchAccountUsers(req.user.id, accountId, queryParams)
  }

  @Get(':id/entities')
  @RequireAccess({ module: 'ACCOUNT_ADMINISTRATION', subModule: 'ENTITIES' })
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'Fetch account entities', description: 'Fetch entities linked to an account with pagination and filtering options.' })
  @ApiParam({ name: 'id', description: 'Account ID' })
  @ApiResponse({ status: 200, description: 'Paginated list of entities', type: FetchAccountEntitiesResponseDto })
  @ApiResponse({ status: 404, description: 'Account not found' })
  @ApiResponse({ status: 400, description: 'Failed to fetch account entities' })
  /** End -- Documentation */
  async fetchAccountEntities(@Req() req: AuthenticatedRequest, @Param('id') accountId: string, @Query() queryParams: FetchAccountEntitiesDto): Promise<FetchAccountEntitiesResponseDto> {
    return this.accountService.fetchAccountEntities(req.user.id, accountId, queryParams)
  }

  @Get(':id/roles')
  @RequireAccess({ module: 'ACCOUNT_ADMINISTRATION', subModule: 'ROLES' })
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'Fetch account roles', description: 'Fetch roles linked to an account with pagination and filtering options.' })
  @ApiParam({ name: 'id', description: 'Account ID' })
  @ApiResponse({ status: 200, description: 'Paginated list of roles', type: FetchAccountRolesResponseDto })
  @ApiResponse({ status: 404, description: 'Account not found' })
  @ApiResponse({ status: 400, description: 'Failed to fetch account roles' })
  /** End -- Documentation */
  async fetchAccountRoles(@Req() req: AuthenticatedRequest, @Param('id') accountId: string, @Query() queryParams: FetchAccountRolesDto): Promise<FetchAccountRolesResponseDto> {
    return this.accountService.fetchAccountRoles(req.user.id, accountId, queryParams)
  }

  @Post(':id/roles')
  @RequirePermissions(['ROLE_CUSTOM_MANAGEMENT'], 'ACCOUNT_ADMINISTRATION')
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'Create a custom role', description: 'Create a non-system role attached to the given account. Permissions must be compatible with the chosen scope.' })
  @ApiParam({ name: 'id', description: 'Account ID' })
  /** End -- Documentation */
  async createCustomRole(
    @Req() req: AuthenticatedRequest,
    @Param('id') accountId: string,
    @Body() body: { name: string; description?: string | null; scope: 'ACCOUNT' | 'ENTITY'; subModuleIds?: number[]; permissionIds: number[] }
  ) {
    return this.accountService.createCustomRole(req.user.id, accountId, body)
  }

  @Post('platform/roles')
  @RequirePermissions(['ROLE_CUSTOM_MANAGEMENT'], 'PLATFORM_ADMINISTRATION')
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({
    summary: 'Create a global template role (platform-admin only)',
    description:
      'Creates a non-system role visible to every account on the platform — alongside the seeded system templates. Body scope can be PLATFORM, ACCOUNT or ENTITY: the resulting role is a reusable template at that scope tier.'
  })
  /** End -- Documentation */
  async createPlatformCustomRole(
    @Req() req: AuthenticatedRequest,
    @Body() body: { name: string; description?: string | null; scope: 'PLATFORM' | 'ACCOUNT' | 'ENTITY'; subModuleIds?: number[]; permissionIds: number[] }
  ) {
    return this.accountService.createCustomRole(req.user.id, null, body)
  }

  @Patch('roles/:roleId')
  @RequirePermissions(['ROLE_CUSTOM_MANAGEMENT'], 'ACCOUNT_ADMINISTRATION')
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'Update a custom role' })
  @ApiParam({ name: 'roleId', description: 'Role ID' })
  /** End -- Documentation */
  async updateCustomRole(
    @Req() req: AuthenticatedRequest,
    @Param('roleId', ParseIntPipe) roleId: number,
    @Body() body: { name?: string; description?: string | null; subModuleIds?: number[]; permissionIds?: number[] }
  ) {
    return this.accountService.updateCustomRole(req.user.id, roleId, body)
  }

  @Delete('roles/:roleId')
  @RequirePermissions(['ROLE_CUSTOM_MANAGEMENT'], 'ACCOUNT_ADMINISTRATION')
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'Delete a custom role' })
  @ApiParam({ name: 'roleId', description: 'Role ID' })
  /** End -- Documentation */
  async deleteCustomRole(@Req() req: AuthenticatedRequest, @Param('roleId', ParseIntPipe) roleId: number) {
    return this.accountService.deleteCustomRole(req.user.id, roleId)
  }

  @Patch('roles/:roleId/status')
  @RequirePermissions(['ROLE_CUSTOM_MANAGEMENT'], 'ACCOUNT_ADMINISTRATION')
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({
    summary: 'Activate / deactivate a role',
    description: 'Service-layer enforces the matrix: platform-admin can toggle any role except platform-admin (self-lockout); account-admin can toggle only their own custom roles.'
  })
  @ApiParam({ name: 'roleId', description: 'Role ID' })
  /** End -- Documentation */
  async toggleRoleStatus(@Req() req: AuthenticatedRequest, @Param('roleId', ParseIntPipe) roleId: number, @Body() body: { isActive: boolean }) {
    return this.accountService.toggleRoleStatus(req.user.id, roleId, body.isActive)
  }

  @Patch(':id/status')
  @RequirePermissions(['ACCOUNT_UPDATE'], 'ACCOUNT_ADMINISTRATION')
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'Update account status', description: 'Activate or deactivate an account that the user has access to.' })
  @ApiParam({ name: 'id', description: 'Account ID', type: 'string' })
  @ApiResponse({ status: 200, description: 'Account status updated successfully', type: UpdateAccountStatusResponseDto })
  @ApiResponse({ status: 404, description: 'Account not found' })
  @ApiResponse({ status: 400, description: 'Failed to update account status' })
  @ApiUnauthorizedResponse({ description: 'User does not have permission to manage the account' })
  /** End -- Documentation */
  async updateAccountStatus(@Req() req: AuthenticatedRequest, @Param('id') accountId: string, @Body() updateAccountStatusDto: UpdateAccountStatusDto): Promise<UpdateAccountStatusResponseDto> {
    return this.accountService.updateAccountStatus(req.user.id, accountId, updateAccountStatusDto.isActive)
  }

  @Get(':id/reactivation-requests/latest')
  @RequirePermissions(['ACCOUNT_UPDATE'], 'ACCOUNT_ADMINISTRATION')
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'Latest reactivation request for this account', description: 'Returns the most recent request (any status), or null. Used by the disabled-account banner.' })
  @ApiParam({ name: 'id', description: 'Account ID' })
  /** End -- Documentation */
  async fetchLatestReactivationRequest(@Req() req: AuthenticatedRequest, @Param('id') accountId: string) {
    // Re-validate access here (with allowDisabled) so a non-platform actor outside this account
    // can't probe other accounts via this endpoint. Service-layer doesn't re-check.
    await this.accountAccessService.validateUserAccountAccess(req.user.id, accountId, 'fetchLatestReactivationRequest', { allowDisabled: true })
    const r = await this.accountService.fetchLatestReactivationRequestForAccount(accountId)
    if (!r) return null
    return {
      id: r.id,
      status: r.status,
      message: r.message,
      reviewNote: r.reviewNote,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
      requestedBy: { id: r.requestedBy.id, email: r.requestedBy.email, people: r.requestedBy.people ? { firstname: r.requestedBy.people.firstname, lastname: r.requestedBy.people.lastname } : null },
      reviewedBy: r.reviewedBy
        ? { id: r.reviewedBy.id, email: r.reviewedBy.email, people: r.reviewedBy.people ? { firstname: r.reviewedBy.people.firstname, lastname: r.reviewedBy.people.lastname } : null }
        : null
    }
  }

  @Post(':id/reactivation-requests')
  @RequirePermissions(['ACCOUNT_UPDATE'], 'ACCOUNT_ADMINISTRATION')
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({
    summary: 'Submit a reactivation request',
    description: 'Account-admin of a self-deactivated account asks a platform-admin to re-enable it. Body must include a justification message.'
  })
  @ApiParam({ name: 'id', description: 'Account ID' })
  /** End -- Documentation */
  async createReactivationRequest(@Req() req: AuthenticatedRequest, @Param('id') accountId: string, @Body() body: { message: string }) {
    return this.accountService.createReactivationRequest(req.user.id, accountId, body?.message ?? '')
  }

  @Patch(':id/users/:userId')
  @RequirePermissions(['ACCOUNT_USER_MANAGEMENT', 'USER_ROLE_ALLOCATION'], 'ACCOUNT_ADMINISTRATION', { requireAll: false })
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'Update account user', description: 'Update a user attached to this account: their isActive flag and/or their scoped role assignments.' })
  @ApiParam({ name: 'id', description: 'Account ID' })
  @ApiParam({ name: 'userId', description: 'Target user ID' })
  /** End -- Documentation */
  async updateAccountUser(
    @Req() req: AuthenticatedRequest,
    @Param('id') accountId: string,
    @Param('userId') targetUserId: string,
    @Body()
    body: {
      isActive?: boolean
      accountRoleIds?: number[]
      entityRoleIds?: { entityId: string; roleIds: number[] }[]
    }
  ) {
    return this.accountService.updateAccountUser(req.user.id, accountId, targetUserId, body)
  }

  @Patch(':id/users')
  @RequirePermissions(['ACCOUNT_USER_MANAGEMENT'], 'ACCOUNT_ADMINISTRATION')
  @UseGuards(PermissionsGuard)
  /** Start -- Documentation */
  @ApiOperation({ summary: 'Update account users', description: 'Update the users linked to an account.' })
  @ApiParam({ name: 'id', description: 'Account ID' })
  @ApiResponse({ status: 200, description: 'The users have been successfully updated for the account', type: UpdateAccountUsersResponseDto })
  @ApiResponse({ status: 404, description: 'Account not found' })
  @ApiResponse({ status: 400, description: 'Failed to update account users' })
  @ApiUnauthorizedResponse({ description: 'User does not have permission to manage the account' })
  /** End -- Documentation */
  async updateAccountUsers(@Req() req: AuthenticatedRequest, @Param('id') accountId: string, @Body() updateAccountUsersDto: UpdateAccountUsersDto): Promise<UpdateAccountUsersResponseDto> {
    return this.accountService.updateAccountUsers(req.user.id, accountId, updateAccountUsersDto.userIds)
  }
}
