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
names an account or entity that does not exist answers `404`, and an account the user does not belong to answers `401`, as before; a target the user belongs to but holds no applicable role on answers
`403`.

The services check what the guard cannot see. `PATCH /accounts/:id/users/:userId` checks each change in the scope it acts on (`ACCOUNT_USER_MANAGEMENT` at account scope to change the active flag,
`USER_ROLE_ALLOCATION` at account scope for the account roles, `USER_ROLE_ALLOCATION` in that entity's scope for each entity slice), and `POST /invitations`, `POST /entities` and the role routes check
the permission in the scope of each target. An entity administrator therefore reads the users and roles of its account, invites users and allocates roles inside its own entity and that entity's
subtree, and manages the custom roles of `ENTITY` scope that are used only inside that subtree (see below). It changes nothing else at the account level: no account role, no user status, no account
setting.

### Who may change a role

The role routes (`POST /accounts/:id/roles`, `POST /accounts/platform/roles`, `PATCH` and `DELETE /accounts/roles/:roleId`, `PATCH /accounts/roles/:roleId/status`) carry a role id, so the service
decides, and answers `403`:

| Role                                        | Who may create, edit, toggle or delete it                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| System role or global template              | Only a holder of `ROLE_CUSTOM_MANAGEMENT` through a **platform** role. A platform role that merely reads the console does not count.          |
| Custom `ACCOUNT` role of account A          | `ROLE_CUSTOM_MANAGEMENT` on A (an account role on A, or a platform role). An entity role never counts.                                        |
| Custom `ENTITY` role of account A           | `ROLE_CUSTOM_MANAGEMENT` in **every entity the role is assigned in**: the account administrator, or an entity administrator of their subtree. |
| Custom `ENTITY` role of A, assigned nowhere | `ROLE_CUSTOM_MANAGEMENT` on A or on one of its entities.                                                                                      |

Two more rules hold for everyone below the platform:

- **Nobody grants what they do not hold.** Each permission or section a request adds to a role must be held by the caller where the role applies; sending back what the role already has, or removing
  from it, needs nothing more. A user who holds a custom role cannot extend it to climb above its editor.
- **An `ENTITY` role assigned nowhere is shaped for its entity type.** Sections that exist only on an entity (a project's vision, its tickets) are never held on the account, so the account
  administrator may also grant such a role what the entity type allows: what the active `ENTITY` system roles grant (`entity-admin`, `entity-user`, and the ones a project adds for its own types, such
  as a `project-owner`). That administrator may already allocate those system roles in any entity of the account, so nobody climbs above their editor. Nothing beyond them is granted, an entity
  administrator still grants only what it holds, and once the role is assigned, each change is checked in every entity it is used in again. The template's roles carry no entity type, so every `ENTITY`
  system role counts; a project that types its entity roles narrows `loadEntityTypeGrants` in `account.service.ts` to the system roles of the role's type.
- **No account or entity role carries a platform section.** A `PLATFORM_ADMINISTRATION` section is refused on an `ACCOUNT` or `ENTITY` role, whoever asks, the platform included.

System roles stay renamable by nobody and deletable by nobody; a platform administrator maintains their grants.

::: warning Scope-less endpoints

Endpoints without a scope use the union of the user's assignments, which is what lets a role held in one account act on another. Every route that takes an account or entity id must declare it with
`@ScopeFrom`; when the target is not in the URL (the body, or a role id), the service must check the permission in the scope of each target.

:::

::: tip Updating a project generated before 1.1.1

Versions before 1.1.1 checked an account or entity route against the union of every role the user holds: an entity role, or the admin role of another account the user is only a member of, could pass
account-admin checks (a seeded `entity-admin` could promote itself to account admin). The fix lives in blueprint files that no installer owns, so `sf update` applies it with the three-way merge: a
file you did not edit is updated in place, and a file you edited gets a `.saasfoundry.new` sidecar to merge by hand. The files involved are `permissions.guard.ts`, `require-permissions.decorator.ts`,
`authenticated-request.type.ts`, `jwt.strategy.ts`, `jwt-auth.guard.ts`, `account-access.service.ts`, `account.controller.ts`, `account.service.ts`, `entity.controller.ts`, `entity.service.ts`,
`invitation.service.ts` and `shared-validation/invitation.ts`, plus the new `scope-filter.ts`, `permission-checker.ts` and `authenticated-user.include.ts`.

If you edited `jwt.strategy.ts`, merge it first: it must load each assignment's `entity` (take `authenticatedUserInclude`). `AuthenticatedUser` now requires `entity`, so a stale strategy fails `tsc`
instead of quietly taking the account-route rights of every entity administrator away until the next token refresh.

Three things change for code you wrote:

- `PermissionsGuard` takes `AccountAccessService` as a constructor dependency. The module is global; add `AccountAccessModule` to the testing modules of your own e2e specs.
- A route that takes an account or entity id must declare it with `@ScopeFrom`, or it keeps the union of every role.
- The per-target checks answer `403`; the existing `401` checks keep their status.

An invitation to an address that already has a pending one now carries over its targets and roles only if you are allowed to grant them: the merged invitation is authorized as if you had submitted it.
The `accountIds`, `entityIds` and `roleIds` lists are deduplicated and capped (100, 100 and 20).

Before 1.1.1 the role routes also let any holder of `ROLE_CUSTOM_MANAGEMENT` (the seeded `entity-admin` among them) rewrite the grants of a system role for the whole platform, put a platform section
on an account or entity role, and edit the `ENTITY` roles of a sibling entity or extend a role it holds itself. 1.1.1 applies the rules of "Who may change a role" above. The fix lives in
`account.service.ts`, `account-access.service.ts`, `permission-checker.ts` and the web page `account-roles.tsx` (plus the test mock `service-mocks.ts`), merged by `sf update` in the same way; no
module migration is needed, because no file is renamed, split or added. If you call `getPermissionChecker` or `ScopedPermissionChecker` yourself, the new third argument is optional. A non-platform
caller that touches a system role, or an entity administrator that creates an `ACCOUNT` role, now gets `403` where it used to get `401`.

:::

::: tip Updating a project generated with 1.2.0

In 1.2.0 the rule "nobody grants what they do not hold" checked an `ENTITY` role assigned nowhere against the account. An account administrator could no longer create, or extend, an entity-type role
granting sections that exist only on the entity: `403 You cannot grant what you do not hold where this role applies`. 1.2.1 checks such a role against what the entity type allows (see "Who may change
a role" above). The fix lives in `account.service.ts`, merged by `sf update` like the 1.1.1 fix; no module migration is needed.

Role-authoring flows that change behaviour:

- **Creating an `ENTITY` role** (`POST /accounts/:id/roles`) as the account administrator: the sections and permissions granted by the `ENTITY` system roles are accepted (`403` before).
- **Editing an `ENTITY` role assigned nowhere** (`PATCH /accounts/roles/:roleId`) as the account administrator: the same grants may be added.

Unchanged: `ACCOUNT` roles, `ENTITY` roles already assigned in an entity, entity administrators, and the platform. A grant that no `ENTITY` system role carries, and that the author does not hold, is
still refused. If your project types its entity roles, narrow `loadEntityTypeGrants` to the system roles of the role's type when you merge.

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

These are protected system templates, not hard-coded conditionals. Platform administrators can maintain their grants through the supported role API, and database updates preserve those choices.
Account-owned custom roles can be created from the generated role editor; their permissions are filtered by `applicableScopes` so an entity role cannot receive a platform-only action, and their editor
can only grant what it holds itself.

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
