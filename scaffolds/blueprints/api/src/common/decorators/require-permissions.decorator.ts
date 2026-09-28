import { SetMetadata } from '@nestjs/common'

export const PERMISSIONS_KEY = 'permissions'
export const MODULE_KEY = 'required_module'
export const SUB_MODULE_KEY = 'required_sub_module'
export const REQUIRE_ALL_KEY = 'require_all_permissions'

// Special permission to indicate full access without specific permissions
export const FULL_ACCESS = '$_FULL_ACCESS'

export interface PermissionRequirement {
  module: string
  permissions: string[]
  requireAll?: boolean
}

export interface PermissionOptions {
  requireAll?: boolean
}

export const RequirePermissions = (permissions: string[], module: string, options?: PermissionOptions) => {
  const requireAll = options?.requireAll !== undefined ? options.requireAll : true

  return (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    SetMetadata(PERMISSIONS_KEY, permissions)(target, key!, descriptor!)
    SetMetadata(MODULE_KEY, module)(target, key!, descriptor!)
    SetMetadata(REQUIRE_ALL_KEY, requireAll)(target, key!, descriptor!)
    return descriptor
  }
}

export interface AccessRequirement {
  /** Module that must be reachable (READ visibility of the screen). */
  module: string
  /** Sub-module (section) that must be visible. When omitted, only the module is required (simple modules). */
  subModule?: string
}

/**
 * Read-access gate (RBAC v2). Authorises a read endpoint when the actor holds the module and,
 * when set, the matching sub-module (section visibility). No action permission is required —
 * a read-only role granted the section can READ. Writes keep using @RequirePermissions.
 */
export const RequireAccess = ({ module, subModule }: AccessRequirement) => {
  return (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    SetMetadata(MODULE_KEY, module)(target, key!, descriptor!)
    if (subModule) SetMetadata(SUB_MODULE_KEY, subModule)(target, key!, descriptor!)
    SetMetadata(PERMISSIONS_KEY, [])(target, key!, descriptor!)
    return descriptor
  }
}
