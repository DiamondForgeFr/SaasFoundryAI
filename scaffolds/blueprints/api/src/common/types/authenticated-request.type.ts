import { User, Role, RoleModuleLink, Module, RolePermissionLink, ModulePermission, RoleSubModuleLink, SubModule, UserRoleAssignment } from '@/generated/prisma/client'
import { Request } from 'express'

export type AuthenticatedUser = User & {
  roleAssignments: (UserRoleAssignment & {
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
