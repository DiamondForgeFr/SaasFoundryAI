/**
 * Resources
 */
import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { InvitationStatus, Locale, TokenType } from '@/generated/prisma/client'
import * as bcrypt from 'bcrypt'
import crypto from 'node:crypto'

/**
 * Dependencies
 */
import { AccountAccessService } from '@common/services/account-access/account-access.service'
import { Logger } from '@common/services/logger/logger.service'
// TODO mailer-service-active: import { UserDefaults } from '@configs/db/user.config'
import { EnvConfig } from '@configs/env/services/env.service'
import { PrismaService } from '@configs/prisma/services/prisma.service'
import { AuthService } from '@modules/auth/services/auth.service'
import { EmailService } from '@modules/email/services/email.service'

/**
 * DTO
 */
import { AcceptInvitationDto } from '@modules/invitation/dto/requests/accept-invitation.dto'
import { CreateInvitationDto } from '@modules/invitation/dto/requests/create-invitation.dto'
import { InvitationResponseDto } from '@modules/invitation/dto/responses/invitation.response.dto'
import { ListInvitationsResponseDto } from '@modules/invitation/dto/responses/list-invitations.response.dto'

/**
 * Types
 */
import type { AuthTokens, TokenPayload } from '@modules/auth/services/auth.service'
import type { User } from '@/generated/prisma/client'

/**
 * Exports
 */
export interface InvitationTokenPayload extends TokenPayload {
  firstname?: string
  lastname?: string
  locale?: Locale
  /** Suggested account name (account-owner invitations) — pre-fills the form at acceptance. */
  accountName?: string
}

/**
 * Declaration
 */
@Injectable()
export class InvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly logger: Logger,
    private readonly env: EnvConfig,
    private readonly emailService: EmailService,
    private readonly authService: AuthService,
    private readonly accountAccessService: AccountAccessService
  ) {}

  /**
   * Create an invitation for a new user
   */
  async createInvitation(inviterId: string, createInvitationDto: CreateInvitationDto): Promise<InvitationResponseDto> {
    const response: InvitationResponseDto = {
      message: 'Invitation sent successfully. The user will receive an email with instructions to join.'
    }

    const { email, roleIds, accountIds = [], entityIds = [], accountName } = createInvitationDto
    let { firstname, lastname, locale } = createInvitationDto

    this.logger.debug(`Creating invitation for ${email} by user ${inviterId}`, 'createInvitation')

    try {
      // Check if there is at least one account or entity ID — OR the inviter is creating an
      // invitation for someone to **own a brand-new account** (platform-admin flow). The latter
      // is detected later via the ACCOUNT_INVITE_OWNER permission check.
      const isAccountOwnerInvitation = accountIds.length === 0 && entityIds.length === 0

      // Get inviter with their roles, permissions, accounts and entities in a single query
      const inviter = await this.prisma.user.findUnique({
        where: { id: inviterId },
        include: {
          people: true,
          roleAssignments: {
            include: {
              role: {
                include: {
                  permissionsLinked: {
                    include: {
                      permission: true
                    }
                  },
                  subModulesLinked: {
                    include: {
                      subModule: true
                    }
                  }
                }
              }
            }
          },
          accountsLinked: {
            where: {
              account: {
                isActive: true
              }
            },
            include: {
              account: {
                include: {
                  entities: {
                    where: {
                      isActive: true
                    },
                    select: {
                      id: true,
                      accountId: true
                    }
                  }
                }
              }
            }
          },
          entitiesLinked: {
            where: {
              entity: {
                isActive: true
              }
            },
            include: {
              entity: {
                select: {
                  id: true,
                  accountId: true
                }
              }
            }
          }
        }
      })

      if (!inviter) throw new NotFoundException('Inviter user not found')

      // Extract user permissions
      const userPermissions = inviter.roleAssignments.flatMap((assignment) => assignment.role.permissionsLinked.map((permissionLink) => permissionLink.permission.name))

      // Remove duplicates
      const uniquePermissions = [...new Set(userPermissions)]

      // Check for required permissions based on invitation context
      const hasAccountInvitePermission = uniquePermissions.includes('USER_ACCOUNTS_INVITATION')
      const hasEntityInvitePermission = uniquePermissions.includes('USER_ENTITIES_INVITATION')
      const hasRoleAllocationPermission = uniquePermissions.includes('USER_ROLE_ALLOCATION')
      const hasAccountOwnerInvitePermission = uniquePermissions.includes('ACCOUNT_INVITE_OWNER')
      // Platform-reach actor identifier: holding the PLATFORM_ACCOUNTS sub-module (the all-accounts
      // list, granted to platform roles) is the canonical marker of platform reach. Used below to
      // (1) bypass the per-account/-entity accessibility check (a platform actor sees every account)
      // and (2) gate the assignment of PLATFORM-scoped roles to invitees (so a regular admin cannot
      // promote someone to platform admin).
      const uniqueSubModules = [...new Set(inviter.roleAssignments.flatMap((assignment) => assignment.role.subModulesLinked.map((subModuleLink) => subModuleLink.subModule.name)))]
      const isPlatformAdminActor = uniqueSubModules.includes('PLATFORM_ACCOUNTS')

      // Pre-resolve role scopes when roleIds are provided — needed to distinguish a "platform
      // admin" invitation (no account/entity targets but PLATFORM-scoped role) from the legacy
      // "account-owner" invitation (no targets, no roles, spins a fresh account on acceptance).
      const targetRoleIds = roleIds ?? []
      const targetRoles = targetRoleIds.length > 0 ? await this.prisma.role.findMany({ where: { id: { in: targetRoleIds } }, select: { id: true, name: true, scope: true } }) : []
      const hasPlatformScopedRole = targetRoles.some((r) => r.scope === 'PLATFORM')
      // A platform-admin invitation: no account/entity targets, but at least one PLATFORM-scoped
      // role provided. The invitee will become a platform admin (or carry that role) on acceptance.
      const isPlatformInvitation = accountIds.length === 0 && entityIds.length === 0 && hasPlatformScopedRole

      // "Account-owner invitation" mode: no account/entity targets AND no platform-scoped role —
      // the invitee will create their own account at acceptance time.
      const isOwnerOnlyInvitation = isAccountOwnerInvitation && !isPlatformInvitation
      if (isOwnerOnlyInvitation) {
        if (!hasAccountOwnerInvitePermission) {
          throw new BadRequestException('At least one account or entity ID must be provided')
        }
        if (roleIds && roleIds.length > 0) {
          throw new BadRequestException('Account-owner invitations cannot pre-assign roles — the new owner is auto-promoted to admin of their fresh account')
        }
      }

      // Extract all accessible account IDs
      const accessibleAccountIds = inviter.accountsLinked.map((link) => link.account.id)

      // Extract all accessible entity IDs (both from direct links and from accounts)
      const entitiesFromAccounts = inviter.accountsLinked.flatMap((link) => link.account.entities.map((entity) => entity.id))
      const directlyLinkedEntities = inviter.entitiesLinked.map((link) => link.entity.id)
      const accessibleEntityIds = [...new Set([...entitiesFromAccounts, ...directlyLinkedEntities])]

      // Create a map of entity ID to account ID for access validation
      const entityAccountMap = new Map<string, string>()
      inviter.accountsLinked.forEach((link) => link.account.entities.forEach((entity) => entityAccountMap.set(entity.id, entity.accountId)))
      inviter.entitiesLinked.forEach((link) => {
        if (link.entity.accountId) entityAccountMap.set(link.entity.id, link.entity.accountId)
      })

      // Validate account IDs
      if (accountIds.length > 0) {
        // Check if user has account invitation permission
        if (!hasAccountInvitePermission) throw new UnauthorizedException('You do not have permission to invite users to accounts')

        // Platform admins have ACCOUNT_LIST_ALL and may invite into ANY account; regular admins
        // are still restricted to the accounts they themselves belong to.
        if (!isPlatformAdminActor) {
          const invalidAccountIds = accountIds.filter((id) => !accessibleAccountIds.includes(id))
          if (invalidAccountIds.length > 0) throw new UnauthorizedException(`You do not have access to these accounts: ${invalidAccountIds.join(', ')}`)
        }
      }

      // Validate entity IDs
      if (entityIds.length > 0) {
        // Check if user has entity invitation permission
        if (!hasEntityInvitePermission) throw new UnauthorizedException('You do not have permission to invite users to entities')

        // Same platform-admin bypass as for accounts.
        if (!isPlatformAdminActor) {
          const invalidEntityIds = entityIds.filter((id) => !accessibleEntityIds.includes(id))
          if (invalidEntityIds.length > 0) throw new UnauthorizedException(`You do not have access to these entities: ${invalidEntityIds.join(', ')}`)
        }
      }

      // Check role assignment permission if roleIds are provided
      if (roleIds && roleIds.length > 0) {
        if (!hasRoleAllocationPermission) throw new UnauthorizedException('You do not have permission to assign roles')

        // Only platform admins can assign PLATFORM-scoped roles (e.g. platform-admin). Without this
        // gate any account admin with USER_ROLE_ALLOCATION could promote a user to platform admin.
        if (hasPlatformScopedRole && !isPlatformAdminActor) {
          throw new UnauthorizedException('Only platform admins can assign PLATFORM-scoped roles')
        }

        // Reject the technical `guest` role — it is reserved for the system anonymous user.
        if (targetRoles.some((r) => r.name === 'guest')) {
          throw new BadRequestException('The guest role cannot be assigned to users')
        }

        // Mixing PLATFORM and ACCOUNT/ENTITY scopes in a single invitation makes no sense per the
        // business rule "a user cannot be a platform admin AND linked to accounts at the same time".
        if (hasPlatformScopedRole && (accountIds.length > 0 || entityIds.length > 0)) {
          throw new BadRequestException('A platform-scoped role cannot be combined with account or entity targets')
        }
      }

      // Check if the email already exists
      const existingUser = await this.prisma.user.findUnique({ where: { email } })
      if (existingUser && existingUser.isActive) {
        // If the user is already active, don't create a new one, just return a success message
        this.logger.warn(`Invitation attempted for existing active user: ${email}`, 'createInvitation')
        return response
      }

      // Use existing user or create a new one if none exists
      let user: User
      let previousAccountIds: string[] = []
      let previousEntityIds: string[] = []
      let previousRoleIds: number[] = []

      if (existingUser) {
        // Re-using existing inactive user - just create a new invitation token
        this.logger.debug(`Re-inviting existing inactive user: ${email}`, 'createInvitation')
        user = existingUser

        // Récupérer l'invitation précédente avec ses liens
        const previousInvitation = await this.prisma.invitation.findFirst({
          where: {
            inviteeUserEmail: email,
            status: InvitationStatus.SENT
          },
          include: {
            accountsLinked: true,
            entitiesLinked: true,
            rolesLinked: true
          }
        })

        if (previousInvitation) {
          // Récupérer les IDs des liens précédents
          previousAccountIds = previousInvitation.accountsLinked.map((link) => link.accountId)
          previousEntityIds = previousInvitation.entitiesLinked.map((link) => link.entityId)
          previousRoleIds = previousInvitation.rolesLinked.map((link) => link.roleId)
        }

        // Récupérer le token précédent pour conserver les informations
        const previousToken = await this.prisma.userToken.findFirst({
          where: {
            userId: user.id,
            type: TokenType.INVITATION
          },
          orderBy: {
            createdAt: 'desc'
          }
        })

        if (previousToken) {
          try {
            const previousPayload = this.jwtService.verify(previousToken.token, {
              secret: this.env.get('JWT_SECRET_INVITATION')
            }) as InvitationTokenPayload

            // Utiliser les informations du token précédent si non fournies dans la nouvelle invitation
            firstname = firstname || previousPayload.firstname
            lastname = lastname || previousPayload.lastname
            locale = locale || previousPayload.locale
          } catch (error) {
            this.logger.warn(`Could not decode previous invitation token: ${error.message}`, 'createInvitation')
          }
        }
      } else {
        // Create a new inactive user
        user = await this.prisma.user.create({
          data: {
            email,
            password: await bcrypt.hash(crypto.randomUUID(), 10),
            isActive: false
          }
        })
      }

      // Generate the invitation token with only essential information.
      // For account-owner invitations, the suggested accountName flows through the token so it can
      // pre-fill the acceptance form even if the invitee never reads the inviter's email.
      const invitationPayload: InvitationTokenPayload = {
        email: user.email,
        sub: user.id,
        firstname,
        lastname,
        locale,
        accountName: isOwnerOnlyInvitation ? accountName?.trim() || undefined : undefined
      }

      const invitationToken = this.jwtService.sign(invitationPayload, {
        secret: this.env.get('JWT_SECRET_INVITATION'),
        expiresIn: this.env.get('JWT_INVITATION_EXPIRES_IN')
      })

      // Save the token in the database (will delete any existing tokens of the same type)
      await this.authService.createUniqueToken(user.id, invitationToken, TokenType.INVITATION, this.env.get('JWT_INVITATION_EXPIRES_IN'))

      // Return the token in development and test environments
      if (['development', 'test'].includes(this.env.get('NODE_ENV'))) {
        this.logger.debug(`Invitation token for ${email}: ${invitationToken}`, 'createInvitation')
        response.invitationToken = invitationToken
      }

      // Send the invitation email
      if (this.env.get('NODE_ENV') !== 'test') {
        // TODO mailer-service-active: const inviterName = inviter.people?.firstname ? `${inviter.people.firstname} ${inviter.people.lastname || ''}`.trim() : 'Un administrateur'
        // TODO mailer-service-active: await this.emailService.sendInvitationEmail(email, invitationToken, inviterName, firstname, locale || UserDefaults.preferences.locale)
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.invitation.updateMany({
          where: {
            inviteeUserEmail: email,
            status: InvitationStatus.SENT
          },
          data: {
            status: InvitationStatus.CANCELED
          }
        })

        // Create the invitation — bind `inviteeUserId` to the (just-created or pre-existing) inactive
        // user row so the `receivedInvitations` relation resolves. Without this, an invited user has
        // no linked invitation and gets miscounted as a self-signup (pendingSignups) and mislabeled
        // in the users list; the invitation row itself is also counted in pendingInvitations → double.
        const invitation = await tx.invitation.create({
          data: {
            inviterUserId: inviterId,
            inviteeUserId: user.id,
            inviteeUserEmail: email,
            status: InvitationStatus.SENT
          }
        })

        // Utiliser les nouveaux IDs s'ils sont fournis, sinon utiliser les précédents
        const finalAccountIds = accountIds.length > 0 ? accountIds : previousAccountIds
        const finalEntityIds = entityIds.length > 0 ? entityIds : previousEntityIds
        const finalRoleIds = roleIds && roleIds.length > 0 ? roleIds : previousRoleIds

        // Create the links with the accounts
        if (finalAccountIds.length > 0) {
          await tx.invitationAccountLink.createMany({
            data: finalAccountIds.map((accountId) => ({
              invitationId: invitation.id,
              accountId
            }))
          })
        }

        // Create the links with the entities
        if (finalEntityIds.length > 0) {
          await tx.invitationEntityLink.createMany({
            data: finalEntityIds.map((entityId) => ({
              invitationId: invitation.id,
              entityId
            }))
          })
        }

        // Create the links with the roles
        if (finalRoleIds.length > 0) {
          await tx.invitationRoleLink.createMany({
            data: finalRoleIds.map((roleId) => ({
              invitationId: invitation.id,
              roleId
            }))
          })
        }
      })

      return response
    } catch (error) {
      this.logger.error(`Failed to create invitation for ${email}: ${error.message}`, 'createInvitation')
      if (error instanceof UnauthorizedException || error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error
      }
      throw new BadRequestException(`Failed to create invitation: ${error.message}`)
    }
  }

  /**
   * Accept an invitation and complete the user setup
   */
  async acceptInvitation(acceptInvitationDto: AcceptInvitationDto): Promise<AuthTokens & { userId: string }> {
    const { invitationToken, password, firstname: userFirstname, lastname: userLastname, locale: userLocale } = acceptInvitationDto

    this.logger.debug('Accepting invitation', 'acceptInvitation')

    try {
      // Verify and decode the invitation token
      const payload = await this.verifyInvitationToken(invitationToken)

      // Find the token in the database
      const tokenRecord = await this.prisma.userToken.findFirst({
        where: {
          userId: payload.sub,
          token: invitationToken,
          type: TokenType.INVITATION
        },
        include: {
          user: true
        }
      })

      if (!tokenRecord) throw new NotFoundException('Invalid or expired invitation token')

      // Find the invitation record to get accountIds, entityIds, and roleIds
      const invitation = await this.prisma.invitation.findFirst({
        where: {
          inviteeUserEmail: tokenRecord.user.email,
          status: InvitationStatus.SENT
        },
        include: {
          accountsLinked: true,
          entitiesLinked: true,
          rolesLinked: true
        }
      })

      if (!invitation) throw new NotFoundException('Invitation not found or already used')

      // Extract data from the invitation
      const accountIds = invitation.accountsLinked.map((link) => link.accountId)
      const entityIds = invitation.entitiesLinked.map((link) => link.entityId)
      const roleIds = invitation.rolesLinked.map((link) => link.roleId)

      // Distinguish three invitation shapes by inspecting role scopes:
      //   - PLATFORM-scoped role(s) AND no targets → platform-admin invitation (no fresh account)
      //   - Zero targets AND no roles              → account-owner invitation (spin up new account)
      //   - Otherwise                              → regular targeted invitation
      const invitationRoleScopes = roleIds.length > 0 ? await this.prisma.role.findMany({ where: { id: { in: roleIds } }, select: { scope: true } }) : []
      const isPlatformInvitation = accountIds.length === 0 && entityIds.length === 0 && invitationRoleScopes.some((r) => r.scope === 'PLATFORM')
      const isAccountOwnerInvitation = accountIds.length === 0 && entityIds.length === 0 && !isPlatformInvitation

      // Hash the password
      const hashedPassword = await bcrypt.hash(password, 10)

      // Update the user password
      await this.prisma.user.update({
        where: { id: tokenRecord.user.id },
        data: { password: hashedPassword }
      })

      // Use user-provided values if available, otherwise fallback to token values
      const firstname = userFirstname || payload.firstname || ''
      const lastname = userLastname || payload.lastname || ''
      const locale = userLocale || payload.locale

      // Activate the user account with the information from the DTO, token, and database.
      // For account-owner invitations we let createAndActivateUserProfile spin up the new account itself,
      // using the inviter's suggested accountName (carried in the JWT) when present.
      await this.activateInvitedUserAccount(tokenRecord.user.id, tokenRecord.user.email, firstname, lastname, accountIds, entityIds, roleIds, locale, isAccountOwnerInvitation, payload.accountName)

      // Mark the invitation as accepted
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: {
          status: InvitationStatus.ACCEPTED,
          inviteeUserId: tokenRecord.user.id,
          acceptedAt: new Date()
        }
      })

      // Delete the used token
      await this.prisma.userToken.delete({
        where: { id: tokenRecord.id }
      })

      // Generate authentication tokens
      const authTokens = await this.authService.generateTokens({
        id: tokenRecord.user.id,
        email: tokenRecord.user.email
      })

      return {
        ...authTokens,
        userId: tokenRecord.user.id
      }
    } catch (error) {
      this.logger.error(`Failed to accept invitation: ${error.message}`, 'acceptInvitation')
      if (error instanceof UnauthorizedException || error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error
      }
      throw new BadRequestException(`Failed to accept invitation: ${error.message}`)
    }
  }

  /**
   * Cancel a pending invitation. Only the inviter can cancel their own invitation.
   * Already-accepted or already-canceled invitations are no-ops (idempotent).
   */
  async cancelInvitation(userId: string, invitationId: string): Promise<{ id: string; status: InvitationStatus }> {
    this.logger.debug(`Cancelling invitation ${invitationId} by user ${userId}`, 'cancelInvitation')
    try {
      const invitation = await this.prisma.invitation.findUnique({ where: { id: invitationId } })
      if (!invitation) throw new NotFoundException('Invitation not found')
      if (invitation.inviterUserId !== userId) {
        throw new UnauthorizedException('Only the inviter can cancel this invitation')
      }

      // Idempotent: already accepted or canceled — return the current status without erroring out.
      if (invitation.status === InvitationStatus.ACCEPTED || invitation.status === InvitationStatus.CANCELED) {
        return { id: invitation.id, status: invitation.status }
      }

      // Update status and revoke the underlying invitation token (if any) so the link stops working.
      const updated = await this.prisma.$transaction(async (tx) => {
        const next = await tx.invitation.update({
          where: { id: invitationId },
          data: { status: InvitationStatus.CANCELED }
        })
        await tx.userToken.deleteMany({ where: { userId: invitation.inviteeUserId ?? '__none__', type: TokenType.INVITATION } })
        // Best-effort by email too in case inviteeUserId was never bound
        if (invitation.inviteeUserEmail) {
          const stranded = await tx.user.findUnique({ where: { email: invitation.inviteeUserEmail } })
          if (stranded) await tx.userToken.deleteMany({ where: { userId: stranded.id, type: TokenType.INVITATION } })
        }
        return next
      })

      return { id: updated.id, status: updated.status }
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof UnauthorizedException) throw error
      this.logger.error(`Failed to cancel invitation: ${error.message}`, 'cancelInvitation')
      throw new BadRequestException('Failed to cancel invitation')
    }
  }

  /**
   * Get all invitations sent by a user
   */
  async getUserInvitations(userId: string): Promise<ListInvitationsResponseDto> {
    // Get all invitations sent by the user with related accounts, entities, and roles
    const invitations = await this.prisma.invitation.findMany({
      where: {
        inviterUserId: userId,
        status: {
          not: InvitationStatus.CANCELED
        }
      },
      include: {
        accountsLinked: {
          include: {
            account: true
          }
        },
        entitiesLinked: {
          include: {
            entity: { include: { organization: true } }
          }
        },
        rolesLinked: {
          include: {
            role: true
          }
        }
      },
      orderBy: {
        invitedAt: 'desc'
      }
    })

    // Format the response
    return {
      invitations: invitations.map((invitation) => ({
        id: invitation.id,
        inviterUserId: invitation.inviterUserId,
        inviteeUserId: invitation.inviteeUserId || undefined,
        inviteeUserEmail: invitation.inviteeUserEmail,
        status: invitation.status,
        invitedAt: invitation.invitedAt,
        acceptedAt: invitation.acceptedAt || undefined,
        accounts: invitation.accountsLinked.map((link) => ({
          id: link.account.id,
          name: link.account.name
        })),
        entities: invitation.entitiesLinked.map((link) => ({
          id: link.entity.id,
          name: link.entity.organization?.name ?? ''
        })),
        roles: invitation.rolesLinked.map((link) => ({
          id: link.role.id,
          name: link.role.name
        }))
      }))
    }
  }

  /**
   * Platform-admin: list every PENDING (SENT or EXPIRED) account-owner invitation across the
   * platform — those are invitations with zero account/entity targets, where acceptance triggers
   * a new account spin-up. Drives the "Pending account owner invitations" panel on the Accounts
   * tab so a platform-admin can see / resend / cancel them regardless of who originally sent them.
   *
   * Authorization is enforced at the controller (ACCOUNT_LIST_ALL).
   */
  async getPlatformAccountOwnerInvitations(): Promise<ListInvitationsResponseDto> {
    const invitations = await this.prisma.invitation.findMany({
      where: {
        status: { in: [InvitationStatus.SENT, InvitationStatus.EXPIRED] },
        accountsLinked: { none: {} },
        entitiesLinked: { none: {} }
      },
      include: {
        accountsLinked: { include: { account: true } },
        entitiesLinked: { include: { entity: { include: { organization: true } } } },
        rolesLinked: { include: { role: true } }
      },
      orderBy: { invitedAt: 'desc' }
    })

    return {
      invitations: invitations.map((invitation) => ({
        id: invitation.id,
        inviterUserId: invitation.inviterUserId,
        inviteeUserId: invitation.inviteeUserId || undefined,
        inviteeUserEmail: invitation.inviteeUserEmail,
        status: invitation.status,
        invitedAt: invitation.invitedAt,
        acceptedAt: invitation.acceptedAt || undefined,
        accounts: invitation.accountsLinked.map((link) => ({ id: link.account.id, name: link.account.name })),
        entities: invitation.entitiesLinked.map((link) => ({ id: link.entity.id, name: link.entity.organization?.name ?? '' })),
        roles: invitation.rolesLinked.map((link) => ({ id: link.role.id, name: link.role.name }))
      }))
    }
  }

  /**
   * Private methods
   */
  private async activateInvitedUserAccount(
    userId: string,
    email: string,
    firstname: string,
    lastname: string,
    accountIds: string[],
    entityIds: string[],
    roleIds: number[],
    locale?: Locale,
    createNewAccount = false,
    accountName?: string
  ): Promise<User> {
    try {
      this.logger.debug(`Activating account for invited user ${email}`, 'activateInvitedUserAccount')

      // Platform-admin invitations carry PLATFORM-scoped roles with no account/entity targets —
      // resolveRolesToAssign / buildAssignmentRows downstream create the PLATFORM assignment
      // (accountId NULL, entityId NULL), so we only refuse the *truly* empty case.
      const roleScopes = roleIds.length > 0 ? await this.prisma.role.findMany({ where: { id: { in: roleIds } }, select: { scope: true } }) : []
      const hasPlatformRole = roleScopes.some((r) => r.scope === 'PLATFORM')
      if (!createNewAccount && !hasPlatformRole && accountIds.length === 0 && entityIds.length === 0) {
        throw new BadRequestException('At least one account or entity ID must be provided')
      }

      return await this.authService.createAndActivateUserProfile(userId, email, firstname, lastname, {
        accountIds,
        entityIds,
        roleIds,
        locale,
        // Account-owner invitations: spin up a brand-new account and assign the invitee as its admin.
        createDefaultAccount: createNewAccount,
        accountName
      })
    } catch (error) {
      this.logger.error(`Failed to activate invited user account for ${email}: ${error.message}`, 'activateInvitedUserAccount')
      throw new BadRequestException(`Failed to activate user account: ${error.message}`)
    }
  }

  private async verifyInvitationToken(token: string): Promise<InvitationTokenPayload> {
    try {
      return this.jwtService.verify(token, {
        secret: this.env.get('JWT_SECRET_INVITATION')
      }) as InvitationTokenPayload
    } catch (error) {
      this.logger.warn(`Invalid invitation token: ${error.message}`, 'verifyInvitationToken')
      throw new UnauthorizedException('Invalid invitation token')
    }
  }
}
