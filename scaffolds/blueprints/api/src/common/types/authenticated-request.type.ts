import { User, Role, RoleModuleLink, Module, RolePermissionLink, ModulePermission, RoleSubModuleLink, SubModule, UserRoleAssignment, Entity } from '@/generated/prisma/client'
import { Request } from 'express'

export type AuthenticatedUser = User & {
  roleAssignments: (UserRoleAssignment & {
    /**
     * The entity an ENTITY-scoped assignment is held on (id and owning account), null for the other scopes.
     * Required on purpose: a `JwtStrategy` that does not load it (see `authenticatedUserInclude`) must fail
     * `tsc`, not silently lose every entity admin's rights on the account routes.
     */
    entity: Pick<Entity, 'id' | 'accountId'> | null
    role: Role & {
      modulesLinked: (RoleModuleLink & {
        module: Module
      })[]
      subModulesLinked: (RoleSubModuleLink & {
        subModule: SubModule
      })[]
      permissionsLinked: (RolePermissionLink & {
        permission: ModulePermission
      })[]
    }
  })[]
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser
}
