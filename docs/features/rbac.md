# RBAC that understands your SaaS hierarchy

SaaSFoundryAI does not stop at “admin” and “user”. The generated application ships a complete authorization model for a platform, its customer accounts and the entities inside each account.

Authentication proves identity. RBAC answers the harder question: **what may this user see or change, here?**

## Three scopes, one permission model

| Scope      | Assignment target        | Typical role     | Reach                                                      |
| ---------- | ------------------------ | ---------------- | ---------------------------------------------------------- |
| `PLATFORM` | No account or entity     | `platform-admin` | Cross-account administration and platform operations       |
| `ACCOUNT`  | One customer account     | `account-admin`  | That account and, for administrative actions, its entities |
| `ENTITY`   | One entity in an account | `entity-admin`   | That entity and the descendant entities it governs         |

A role defines capabilities. A `UserRoleAssignment` binds that role to the correct target. Database constraints reject incoherent combinations: a platform assignment has no target, an account
assignment has an `accountId`, and an entity assignment has an `entityId`.

```text
User
 ├─ PLATFORM role ───────────────────────────► every account
 ├─ ACCOUNT role + accountId ────────────────► one account
 └─ ENTITY role + entityId ──────────────────► one entity subtree
```

Platform reach does not require fake membership in every account. Account and entity access remain explicit, which keeps tenant boundaries inspectable.

## Modules, sections and actions

Authorization has three layers instead of one flat list:

1. **Module** — can the user enter a product area such as `ACCOUNT_ADMINISTRATION`?
2. **Sub-module** — can the user read a section such as `USERS`, `ENTITIES`, `ROLES` or `SETTINGS`?
3. **Permission** — can the user perform an action such as `ACCOUNT_USER_MANAGEMENT` or `ROLE_CUSTOM_MANAGEMENT`?

This separation makes read-only roles natural. A role can see the `USERS` section without receiving a mutation permission. Selecting an action in the generated role editor automatically includes its
section; removing the section also removes the actions below it. PostgreSQL triggers enforce the same invariant behind the UI.

```ts
@RequireAccess({
  module: 'ACCOUNT_ADMINISTRATION',
  subModule: 'USERS'
})
findUsers() {
  // Read access: module + visible section
}

@RequirePermissions(
  ['ACCOUNT_USER_MANAGEMENT'],
  'ACCOUNT_ADMINISTRATION'
)
updateUser() {
  // Write access: module + required action
}
```

The NestJS guard returns `401` when no authenticated user exists and `403` when an authenticated user lacks the scoped capability.

## Scope follows the request

The backend resolves the active authorization context from explicit scope headers or route parameters:

1. `X-Scope-Account-Id`
2. `X-Scope-Entity-Id`
3. `:accountId`
4. `:entityId`

The React application receives the elected scope from the session, sends it with API requests and filters routes, tabs and actions through the same module, sub-module and permission vocabulary. UI
hiding improves clarity; the backend guard remains the authority.

::: warning Scope-less endpoints

Endpoints without a scope hint use the union of the user's assignments for backward compatibility. New tenant-sensitive endpoints should carry an account or entity scope so the guard can enforce the
narrowest context.

:::

## Roles included in a generated project

| System role      | Scope    | Intended use                                                      |
| ---------------- | -------- | ----------------------------------------------------------------- |
| `guest`          | Platform | Technical anonymous baseline; it cannot be assigned to a user     |
| `platform-user`  | Platform | Authenticated profile and password operations without admin reach |
| `platform-admin` | Platform | Cross-account platform administration                             |
| `account-user`   | Account  | Account member with read access                                   |
| `account-admin`  | Account  | Account-wide user, entity, role and settings administration       |
| `entity-user`    | Entity   | Member restricted to an entity                                    |
| `entity-admin`   | Entity   | Administration of an entity and its governed subtree              |

These are protected system templates, not hard-coded conditionals. Administrators can maintain their grants through the supported role API, and database updates preserve those choices. Account-owned
custom roles can be created from the generated role editor; their permissions are filtered by `applicableScopes` so an entity role cannot receive a platform-only action.

## Invitations preserve the same boundary

Invitations carry their account, entity and role targets. Before issuing one, the API verifies that the inviter:

- may invite into every requested account or entity;
- may allocate roles;
- cannot assign a platform role unless they already have platform reach;
- cannot mix a platform role with account or entity targets;
- cannot assign the technical `guest` role.

Acceptance creates the user links and scoped role assignments together. Expired invitations are handled by the generated scheduler, and the English/French email flow is already wired to the invitation
module.

## Defense in depth

The generated contract is enforced at several levels:

| Layer      | What it protects                                                                  |
| ---------- | --------------------------------------------------------------------------------- |
| React      | Routes, tabs and actions follow the current scope                                 |
| NestJS     | Decorators and `PermissionsGuard` enforce module, section and action              |
| Services   | Account/entity authority and descendant visibility are checked against the data   |
| PostgreSQL | Role scope, module/section/permission consistency and unique bindings are guarded |
| Tests      | Live journeys exercise account, entity and role isolation through the real stack  |

The result is an extensible starting point, not a promise that every future business rule is automatic. When you add a domain capability, extend the permission catalog, protect the endpoint, expose it
through the current scope and add the corresponding isolation tests.

## Where to inspect it

- `apps/api/prisma/schema/users.prisma` — roles and scoped assignments
- `apps/api/prisma/schema/modules.prisma` — modules, sections and permissions
- `apps/api/src/modules/auth/guards/permissions.guard.ts` — request-time enforcement
- `apps/web/src/hooks/auth/useModuleAccess.ts` — frontend capability checks
- `apps/web/src/components/dialogs/create-role-dialog.tsx` — custom-role editor

Paths above describe a generated monorepo. In multirepo mode, the same API and web files live at the roots of their respective repositories.

## Continue

- [Project topology](/guide/monorepo-vs-multirepo)
- [Module system](/guide/module-system)
- [Ship your first ticket](/getting-started/shipping-first-ticket)
