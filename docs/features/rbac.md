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

A user holds several role assignments (a platform role, an account role, one role per entity). The guard counts only the ones that apply to the account or entity the request acts on, so a role held in
one place never authorises an action somewhere else. A route declares its target with `@ScopeFrom`:

```ts
@Patch(':id/status')
@RequirePermissions(['ACCOUNT_UPDATE'], 'ACCOUNT_ADMINISTRATION')
@ScopeFrom('id', 'ACCOUNT') // `:id` is an account id
updateStatus() {}
```

| Target                  | Assignments that count                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account A (`'ACCOUNT'`) | Platform roles; account roles held on A. Entity roles of an entity of A count only on the routes that opt in with `includeEntityAssignments`.           |
| Entity E (`'ENTITY'`)   | Platform roles; account roles held on E's account; entity roles held on E or on one of its ancestors. Never a descendant, a sibling or another account. |

The backend resolves the target in this order: the route's `@ScopeFrom`, then a legacy `:accountId` or `:entityId` route parameter, then the `X-Scope-Account-Id` / `X-Scope-Entity-Id` headers. The
headers are the weakest hint: they are read only when the route declares no scope, so they cannot redirect a check away from the account or entity named in the URL. The React application does not send
them; it receives the elected scope from the session and filters routes, tabs and actions through the same module, sub-module and permission vocabulary. UI hiding improves clarity; the backend guard
remains the authority.

Routes of the `PLATFORM_ADMINISTRATION` module count platform roles only, whatever the target, so a custom account or entity role that carries a platform section never gives platform reach. A URL that
names an account or entity that does not exist answers `404`; one that exists but where the user holds no role answers `403`.

The services check what the guard cannot see. `PATCH /accounts/:id/users/:userId` checks each change in the scope it acts on (`ACCOUNT_USER_MANAGEMENT` at account scope to change the active flag,
`USER_ROLE_ALLOCATION` at account scope for the account roles, `USER_ROLE_ALLOCATION` in that entity's scope for each entity slice), and `POST /invitations`, `POST /entities` and the role routes check
the permission in the scope of each target. An entity administrator therefore manages its own entity and its subtree, and nothing at the account level.

::: warning Scope-less endpoints

Endpoints without a scope use the union of the user's assignments, which is what lets a role held in one account act on another. Every route that takes an account or entity id must declare it with
`@ScopeFrom`; when the target is not in the URL (the body, or a role id), the service must check the permission in the scope of each target.

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
