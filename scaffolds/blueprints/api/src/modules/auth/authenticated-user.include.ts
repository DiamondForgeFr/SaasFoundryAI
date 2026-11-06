/**
 * Type
 */
import type { Prisma } from '@/generated/prisma/client'

/**
 * The relations an authenticated request carries on `request.user`, loaded once and shared.
 *
 * JwtStrategy (a valid access token) and JwtAuthGuard (a refreshed session) both build
 * `request.user`; they used to carry two copies of this include, and the refresh copy had drifted
 * (it lacked `subModulesLinked`, which PermissionsGuard reads on `@RequireAccess` routes). One
 * definition keeps both paths identical.
 *
 * `entity` gives PermissionsGuard the account an ENTITY-scoped assignment belongs to.
 */
export const authenticatedUserInclude = {
  roleAssignments: {
    where: {
      role: {
        isActive: true
      }
    },
    include: {
      entity: {
        select: { id: true, accountId: true }
      },
      role: {
        include: {
          modulesLinked: {
            where: {
              module: {
                isActive: true
              }
            },
            include: {
              module: true
            }
          },
          subModulesLinked: {
            where: {
              subModule: {
                isActive: true
              }
            },
            include: {
              subModule: true
            }
          },
          permissionsLinked: {
            include: {
              permission: true
            }
          }
        }
      }
    }
  }
} satisfies Prisma.UserInclude
