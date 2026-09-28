/**
 * RBAC v2 — per-archetype `/me` fixtures + shared endpoint mocks.
 *
 * Each fixture is a full `/me` body satisfying the `useMe` zod schema (roleAssignments with
 * id/roleId/roleName/scope/accountId/entityId/modules/subModules/permissions; currentScope; the
 * legacy flat roles/modules/subModules/permissions unions; accounts/entities/preferences/createdAt).
 *
 * The grants mirror `apps/api/docs/rbac-v2.md` §5 (role grants per archetype) and the resulting
 * access matrix in §10. Read-only archetypes (`*-user`) keep the SAME modules + sub-modules as their
 * admin counterpart but drop every action permission down to PROFILE_UPDATE_OWN + PASSWORD_*.
 */

/**
 * Shared ids
 */
const ids = {
  user: '123e4567-e89b-12d3-a456-426614174000',
  accountA: 'acc-123e4567-e89b-12d3-a456-426614174000',
  accountB: 'acc-123e4567-e89b-12d3-a456-426614174001',
  entityA: 'ent-123e4567-e89b-12d3-a456-426614174000',
  entityB: 'ent-123e4567-e89b-12d3-a456-426614174001',
  orgA: 'org-123e4567-e89b-12d3-a456-426614174000',
  orgB: 'org-123e4567-e89b-12d3-a456-426614174001'
}

/**
 * Permission groupings (from §4 catalog)
 */
const PASSWORD_PERMS = ['PASSWORD_RECOVERY_LINK_REQUEST_OWN', 'PASSWORD_RECOVERY_RESET_OWN']
const READ_ONLY_PERMS = ['PROFILE_UPDATE_OWN', ...PASSWORD_PERMS]

const ACCOUNT_ADMIN_PERMS = [
  'ACCOUNT_UPDATE',
  'ACCOUNT_USER_MANAGEMENT',
  'ACCOUNT_ENTITY_MANAGEMENT',
  'ENTITY_CREATION',
  'USER_ACCOUNTS_INVITATION',
  'USER_ENTITIES_INVITATION',
  'USER_ROLE_ALLOCATION',
  'ENTITY_USER_MANAGEMENT',
  'ROLE_CUSTOM_MANAGEMENT',
  'ORGANIZATION_CREATION',
  'ORGANIZATION_UPDATE',
  'ACCOUNT_OWN_CREATE',
  ...READ_ONLY_PERMS
]

// entity-admin: ENTITY_USER_MANAGEMENT + USER_ENTITIES_INVITATION drive `isEntityAdmin` + canInvite,
// USER_ROLE_ALLOCATION + ROLE_CUSTOM_MANAGEMENT drive the Roles tab "New role" CTA. NO entity/account
// creation, NO account update, NO account-level user invitation.
const ENTITY_ADMIN_PERMS = ['ENTITY_USER_MANAGEMENT', 'USER_ENTITIES_INVITATION', 'USER_ROLE_ALLOCATION', 'ROLE_CUSTOM_MANAGEMENT', 'ENTITY_OWN_CREATE', 'ORGANIZATION_UPDATE', ...READ_ONLY_PERMS]

const PLATFORM_ADMIN_PERMS = ['ACCOUNT_CREATE_ANY', 'ACCOUNT_INVITE_OWNER', 'MODULE_MANAGEMENT', 'ACCOUNT_REACTIVATION_REVIEW', ...ACCOUNT_ADMIN_PERMS, ...READ_ONLY_PERMS]

/**
 * Module / sub-module sets
 */
const ACCOUNT_SUBMODULES = ['OVERVIEW', 'USERS', 'ENTITIES', 'ROLES', 'SETTINGS']
const ENTITY_SUBMODULES = ['OVERVIEW', 'USERS', 'ROLES'] // §5 D5: no ENTITIES, no SETTINGS
const PLATFORM_SUBMODULES = ['PLATFORM_ACCOUNTS', 'PLATFORM_USERS', 'PLATFORM_MODULES', 'PLATFORM_REACTIVATION']

const ACCOUNT_ADMIN_MODULES = ['ACCOUNT_ADMINISTRATION', 'MULTI_ACCOUNT_MANAGEMENT', 'ORGANIZATION_ADMINISTRATION', 'PROFILE_ADMINISTRATION', 'USER_ACCOUNT_PASSWORD_RECOVERY']
const ACCOUNT_USER_MODULES = ['ACCOUNT_ADMINISTRATION', 'PROFILE_ADMINISTRATION', 'USER_ACCOUNT_PASSWORD_RECOVERY']
const ENTITY_ADMIN_MODULES = ['ACCOUNT_ADMINISTRATION', 'MULTI_ENTITY_MANAGEMENT', 'ORGANIZATION_ADMINISTRATION', 'PROFILE_ADMINISTRATION', 'USER_ACCOUNT_PASSWORD_RECOVERY']
const ENTITY_USER_MODULES = ['ACCOUNT_ADMINISTRATION', 'PROFILE_ADMINISTRATION', 'USER_ACCOUNT_PASSWORD_RECOVERY']
const PLATFORM_MODULES = ['PLATFORM_ADMINISTRATION', 'ACCOUNT_ADMINISTRATION', 'ORGANIZATION_ADMINISTRATION', 'PROFILE_ADMINISTRATION', 'USER_ACCOUNT_PASSWORD_RECOVERY']

/**
 * Reusable account / entity records
 */
const accountRecord = (id: string, name: string) => ({
  id,
  name,
  description: 'Account for RBAC archetype testing',
  isActive: true,
  deactivatedByScope: null
})

const entityRecord = (id: string, name: string, accountId: string, orgId: string) => ({
  id,
  name,
  isActive: true,
  accountId,
  organization: { id: orgId, name: `${name} Org` }
})

/**
 * Build a `/me` body. The legacy flat unions are derived from the assignments so the fixture stays
 * internally consistent (mirrors what `auth.service.getMe()` produces server-side).
 */
type Assignment = {
  id: string
  roleId: number
  roleName: string
  scope: 'PLATFORM' | 'ACCOUNT' | 'ENTITY'
  accountId: string | null
  entityId: string | null
  modules: string[]
  subModules: string[]
  permissions: string[]
}

function buildMe({
  roleAssignments,
  currentScope,
  accounts = [],
  entities = []
}: {
  roleAssignments: Assignment[]
  currentScope: { kind: 'PLATFORM' | 'ACCOUNT' | 'ENTITY'; id: string | null }
  accounts?: ReturnType<typeof accountRecord>[]
  entities?: ReturnType<typeof entityRecord>[]
}) {
  const uniq = (arr: string[]) => Array.from(new Set(arr))
  return {
    URL: '**/api/auth/me',
    success: {
      status: 200,
      body: {
        userId: ids.user,
        email: 'bill.mate@diamondforge.fr',
        people: { firstname: 'Bill', lastname: 'Mate' },
        roleAssignments,
        currentScope,
        roles: uniq(roleAssignments.map((a) => a.roleName)),
        modules: uniq(roleAssignments.flatMap((a) => a.modules)),
        subModules: uniq(roleAssignments.flatMap((a) => a.subModules)),
        permissions: uniq(roleAssignments.flatMap((a) => a.permissions)),
        accounts,
        entities,
        preferences: { locale: 'EN', avatarUrl: null },
        createdAt: new Date().toISOString()
      }
    }
  }
}

/**
 * Per-archetype `/me` fixtures
 */
const me = {
  platformAdmin: buildMe({
    roleAssignments: [
      {
        id: 'ra-platform-admin',
        roleId: 6,
        roleName: 'platform-admin',
        scope: 'PLATFORM',
        accountId: null,
        entityId: null,
        modules: PLATFORM_MODULES,
        subModules: [...PLATFORM_SUBMODULES, ...ACCOUNT_SUBMODULES],
        permissions: PLATFORM_ADMIN_PERMS
      }
    ],
    currentScope: { kind: 'PLATFORM', id: null }
  }),

  platformUser: buildMe({
    roleAssignments: [
      {
        id: 'ra-platform-user',
        roleId: 7,
        roleName: 'platform-user',
        scope: 'PLATFORM',
        accountId: null,
        entityId: null,
        modules: PLATFORM_MODULES,
        subModules: [...PLATFORM_SUBMODULES, ...ACCOUNT_SUBMODULES],
        permissions: READ_ONLY_PERMS
      }
    ],
    currentScope: { kind: 'PLATFORM', id: null }
  }),

  accountAdmin: buildMe({
    roleAssignments: [
      {
        id: 'ra-account-admin',
        roleId: 3,
        roleName: 'account-admin',
        scope: 'ACCOUNT',
        accountId: ids.accountA,
        entityId: null,
        modules: ACCOUNT_ADMIN_MODULES,
        subModules: ACCOUNT_SUBMODULES,
        permissions: ACCOUNT_ADMIN_PERMS
      }
    ],
    currentScope: { kind: 'ACCOUNT', id: ids.accountA },
    accounts: [accountRecord(ids.accountA, 'Main account')],
    entities: [entityRecord(ids.entityA, 'Test Entity', ids.accountA, ids.orgA)]
  }),

  accountUser: buildMe({
    roleAssignments: [
      {
        id: 'ra-account-user',
        roleId: 2,
        roleName: 'account-user',
        scope: 'ACCOUNT',
        accountId: ids.accountA,
        entityId: null,
        modules: ACCOUNT_USER_MODULES,
        subModules: ACCOUNT_SUBMODULES,
        permissions: READ_ONLY_PERMS
      }
    ],
    currentScope: { kind: 'ACCOUNT', id: ids.accountA },
    accounts: [accountRecord(ids.accountA, 'Main account')],
    entities: [entityRecord(ids.entityA, 'Test Entity', ids.accountA, ids.orgA)]
  }),

  entityAdmin: buildMe({
    roleAssignments: [
      {
        id: 'ra-entity-admin',
        roleId: 5,
        roleName: 'entity-admin',
        scope: 'ENTITY',
        accountId: null,
        entityId: ids.entityA,
        modules: ENTITY_ADMIN_MODULES,
        subModules: ENTITY_SUBMODULES,
        permissions: ENTITY_ADMIN_PERMS
      }
    ],
    currentScope: { kind: 'ENTITY', id: ids.entityA },
    accounts: [],
    entities: [entityRecord(ids.entityA, 'Test Entity', ids.accountA, ids.orgA)]
  }),

  entityUser: buildMe({
    roleAssignments: [
      {
        id: 'ra-entity-user',
        roleId: 4,
        roleName: 'entity-user',
        scope: 'ENTITY',
        accountId: null,
        entityId: ids.entityA,
        modules: ENTITY_USER_MODULES,
        subModules: ENTITY_SUBMODULES,
        permissions: READ_ONLY_PERMS
      }
    ],
    currentScope: { kind: 'ENTITY', id: ids.entityA },
    accounts: [],
    entities: [entityRecord(ids.entityA, 'Test Entity', ids.accountA, ids.orgA)]
  }),

  // multi-account = account-admin linked to 2 accounts with 2 ACCOUNT assignments → scope switcher.
  multiAccount: buildMe({
    roleAssignments: [
      {
        id: 'ra-account-admin-a',
        roleId: 3,
        roleName: 'account-admin',
        scope: 'ACCOUNT',
        accountId: ids.accountA,
        entityId: null,
        modules: ACCOUNT_ADMIN_MODULES,
        subModules: ACCOUNT_SUBMODULES,
        permissions: ACCOUNT_ADMIN_PERMS
      },
      {
        id: 'ra-account-admin-b',
        roleId: 3,
        roleName: 'account-admin',
        scope: 'ACCOUNT',
        accountId: ids.accountB,
        entityId: null,
        modules: ACCOUNT_ADMIN_MODULES,
        subModules: ACCOUNT_SUBMODULES,
        permissions: ACCOUNT_ADMIN_PERMS
      }
    ],
    currentScope: { kind: 'ACCOUNT', id: ids.accountA },
    accounts: [accountRecord(ids.accountA, 'Main account'), accountRecord(ids.accountB, 'Second account')],
    entities: [entityRecord(ids.entityA, 'Test Entity', ids.accountA, ids.orgA)]
  }),

  // multi-entity = entity-admin managing 2 entities with 2 ENTITY assignments → entity switcher.
  multiEntity: buildMe({
    roleAssignments: [
      {
        id: 'ra-entity-admin-a',
        roleId: 5,
        roleName: 'entity-admin',
        scope: 'ENTITY',
        accountId: null,
        entityId: ids.entityA,
        modules: ENTITY_ADMIN_MODULES,
        subModules: ENTITY_SUBMODULES,
        permissions: ENTITY_ADMIN_PERMS
      },
      {
        id: 'ra-entity-admin-b',
        roleId: 5,
        roleName: 'entity-admin',
        scope: 'ENTITY',
        accountId: null,
        entityId: ids.entityB,
        modules: ENTITY_ADMIN_MODULES,
        subModules: ENTITY_SUBMODULES,
        permissions: ENTITY_ADMIN_PERMS
      }
    ],
    currentScope: { kind: 'ENTITY', id: ids.entityA },
    accounts: [],
    entities: [entityRecord(ids.entityA, 'First Entity', ids.accountA, ids.orgA), entityRecord(ids.entityB, 'Second Entity', ids.accountA, ids.orgB)]
  })
}

/**
 * Shared endpoint mocks every account/platform screen pulls. Bodies are minimal but schema-valid.
 */
const testApi = {
  // Broad interceptor — block every /api/** call that isn't explicitly mocked, keeping tests hermetic.
  interceptorURL: '**/api/**',

  guest: {
    URL: '**/api/auth/guest',
    success: {
      status: 200,
      body: { roles: ['guest'], modules: ['USER_ACCOUNT_CREATION', 'USER_ACCOUNT_PASSWORD_RECOVERY'], permissions: ['USER_ACCOUNT_CREATE_OWN'], awaitsPlatformAdmin: false }
    }
  },

  me,

  // GET /api/accounts/{id} — account detail used by the scope header + overview/users/entities/roles.
  account: (accountId: string) => ({
    URL: `**/api/accounts/${accountId}`,
    success: {
      status: 200,
      body: {
        id: accountId,
        name: 'Main account',
        description: 'Default account for testing',
        isActive: true,
        createdAt: '2025-05-28T10:31:59.149Z',
        updatedAt: '2025-05-28T10:31:59.149Z',
        users: {
          count: 1,
          values: [
            {
              id: 'u-john',
              email: 'john.doe@example.com',
              isActive: true,
              people: { id: 'p-john', firstname: 'John', lastname: 'Doe' },
              roles: [{ id: 2, name: 'account-user' }],
              entities: [{ id: ids.entityA, name: 'Test Entity', organization: { id: ids.orgA, name: 'Test Entity Org' } }],
              isDirectlyLinked: false,
              lastLoginAt: null,
              createdAt: '2025-05-28T10:37:47.633Z',
              updatedAt: '2025-05-28T10:42:38.038Z'
            }
          ]
        },
        entities: {
          count: 1,
          values: [
            {
              id: ids.entityA,
              name: 'Test Entity',
              description: 'Promo 12/2024',
              isActive: true,
              organization: { id: ids.orgA, name: 'Test Entity Org', type: 'COMPANY' },
              createdAt: '2025-05-28T10:37:03.387Z',
              updatedAt: '2025-05-28T10:37:03.387Z'
            }
          ]
        },
        roles: {
          count: 2,
          values: [
            {
              id: 2,
              name: 'account-user',
              description: 'Basic user',
              scope: 'ACCOUNT',
              isSystem: true,
              isActive: true,
              isGlobal: true,
              modules: [],
              permissions: [],
              createdAt: '2025-05-28T10:29:45.435Z',
              updatedAt: '2025-05-28T10:29:45.435Z'
            },
            {
              id: 3,
              name: 'account-admin',
              description: 'Admin user',
              scope: 'ACCOUNT',
              isSystem: true,
              isActive: true,
              isGlobal: true,
              modules: [],
              permissions: [],
              createdAt: '2025-05-28T10:29:45.435Z',
              updatedAt: '2025-05-28T10:29:45.435Z'
            }
          ]
        }
      }
    }
  }),

  // GET /api/accounts/{id}/entities
  entities: (accountId: string) => ({
    URL: `**/api/accounts/${accountId}/entities*`,
    success: {
      status: 200,
      body: {
        items: [
          {
            id: ids.entityA,
            name: 'Test Entity',
            description: 'Test entity description',
            isActive: true,
            organization: { id: ids.orgA, name: 'Test Entity Org', type: 'COMPANY' },
            userCount: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ],
        meta: { pagination: { current: 1, limit: 10, total: 1 }, count: 1 }
      }
    }
  }),

  // GET /api/accounts/{id}/users
  users: (accountId: string) => ({
    URL: `**/api/accounts/${accountId}/users*`,
    success: {
      status: 200,
      body: {
        items: [
          {
            id: 'u-john',
            email: 'john.doe@example.com',
            isActive: true,
            people: { id: 'p-john', firstname: 'John', lastname: 'Doe' },
            roles: [{ id: 2, name: 'account-user' }],
            entities: [{ id: ids.entityA, name: 'Test Entity', organization: { id: ids.orgA, name: 'Test Entity Org' } }],
            isDirectlyLinked: false,
            lastLoginAt: null,
            createdAt: '2025-05-28T10:37:47.633Z',
            updatedAt: '2025-05-28T10:42:38.038Z'
          }
        ],
        meta: { pagination: { current: 1, limit: 10, total: 1 }, count: 1 }
      }
    }
  }),

  // GET /api/accounts/{id}/roles
  roles: (accountId: string) => ({
    URL: `**/api/accounts/${accountId}/roles*`,
    success: {
      status: 200,
      body: {
        items: [
          {
            id: 2,
            name: 'account-user',
            description: 'Basic user',
            scope: 'ACCOUNT',
            isSystem: true,
            isActive: true,
            isGlobal: true,
            modules: [],
            permissions: [],
            createdAt: '2025-05-28T10:29:45.435Z',
            updatedAt: '2025-05-28T10:29:45.435Z'
          },
          {
            id: 3,
            name: 'account-admin',
            description: 'Admin user',
            scope: 'ACCOUNT',
            isSystem: true,
            isActive: true,
            isGlobal: true,
            modules: [],
            permissions: [],
            createdAt: '2025-05-28T10:29:45.435Z',
            updatedAt: '2025-05-28T10:29:45.435Z'
          }
        ],
        meta: { pagination: { current: 1, limit: 10, total: 2 }, count: 2 }
      }
    }
  }),

  // GET /api/invitations
  invitations: {
    URL: '**/api/invitations',
    success: { status: 200, bodyEmpty: { invitations: [] } }
  },

  // GET /api/accounts/?<params> (useAllAccounts — platform-admin account list + switcher).
  // The interceptor's `**`→`.*` expansion leaves the rest unescaped, so `[?]` is a char class
  // matching the LITERAL `?` of the real URL (`/api/accounts/?limit=50`). Anchoring on
  // `accounts/[?]` keeps this distinct from `/api/accounts/{id}` and its `/users?limit=…` children.
  allAccounts: {
    URL: '**/api/accounts/[?]**',
    success: {
      status: 200,
      body: {
        items: [
          {
            id: ids.accountA,
            name: 'Main account',
            description: 'First account',
            isActive: true,
            deactivatedByScope: null,
            usersCount: 3,
            entitiesCount: 1,
            createdAt: '2025-05-28T10:31:59.149Z',
            updatedAt: '2025-05-28T10:31:59.149Z',
            pendingReactivation: null
          },
          {
            id: ids.accountB,
            name: 'Second account',
            description: 'Second account',
            isActive: true,
            deactivatedByScope: null,
            usersCount: 1,
            entitiesCount: 0,
            createdAt: '2025-05-28T10:31:59.149Z',
            updatedAt: '2025-05-28T10:31:59.149Z',
            pendingReactivation: null
          }
        ],
        meta: { pagination: { current: 1, limit: 50, total: 2 }, count: 2 },
        aggregates: { total: 2, active: 2, disabled: 0, pending: 0 }
      }
    }
  },

  // GET /api/accounts/platform/overview
  platformOverview: {
    URL: '**/api/accounts/platform/overview',
    success: {
      status: 200,
      body: {
        kpis: { usersCount: 4, entitiesCount: 1, accountsCount: 2, pendingReactivationCount: 0, pendingAccountOwnerInvitationsCount: 0 },
        recentUsers: [
          {
            id: 'u-john',
            email: 'john.doe@example.com',
            isActive: true,
            people: { id: 'p-john', firstname: 'John', lastname: 'Doe' },
            accounts: [{ id: ids.accountA, name: 'Main account' }],
            entities: [],
            roles: [{ id: 3, name: 'account-admin', scope: 'ACCOUNT' }],
            createdAt: '2025-05-28T10:37:47.633Z',
            updatedAt: '2025-05-28T10:42:38.038Z'
          }
        ],
        recentEntities: [],
        systemRoles: [
          { id: 6, name: 'platform-admin', description: 'Platform administrator', scope: 'PLATFORM', isSystem: true, isActive: true, modules: [], permissions: [] },
          { id: 3, name: 'account-admin', description: 'Account administrator', scope: 'ACCOUNT', isSystem: true, isActive: true, modules: [], permissions: [] }
        ]
      }
    }
  },

  // GET /api/accounts/platform/modules
  platformModules: {
    URL: '**/api/accounts/platform/modules',
    success: {
      status: 200,
      body: [
        {
          id: 1,
          name: 'PLATFORM_ADMINISTRATION',
          description: 'Platform-wide administration',
          version: '1.0.0',
          typeId: 1,
          typeName: 'PLATFORM_MANAGEMENT',
          isActive: true,
          createdAt: '2025-05-28T10:29:45.435Z',
          updatedAt: '2025-05-28T10:29:45.435Z',
          permissions: [{ id: 1, name: 'MODULE_MANAGEMENT', description: 'Toggle modules', subModuleId: null, applicableScopes: ['PLATFORM'] }],
          subModules: []
        },
        {
          id: 2,
          name: 'ACCOUNT_ADMINISTRATION',
          description: 'Account administration',
          version: '1.0.0',
          typeId: 2,
          typeName: 'ACCOUNT_MANAGEMENT',
          isActive: true,
          createdAt: '2025-05-28T10:29:45.435Z',
          updatedAt: '2025-05-28T10:29:45.435Z',
          permissions: [{ id: 2, name: 'ACCOUNT_UPDATE', description: 'Update account', subModuleId: null, applicableScopes: ['ACCOUNT'] }],
          subModules: []
        }
      ]
    }
  }
}

/**
 * Flow object selectors
 */
const selectors = {
  signInURL: '/signin',
  signInURLPattern: /.*\/signin/,
  dashboardURL: '/dashboard',
  dashboardURLPattern: /.*\/dashboard/,
  accountURL: '/account',
  accountOverviewURLPattern: /.*\/account\?tab=overview/,
  profileURL: '/profile',
  platformModulesURL: '/platform/modules',

  sectionTabs: {
    overview: { name: /^OVERVIEW$/i },
    users: { name: /^USERS$/i },
    entities: { name: /^ENTITIES$/i },
    roles: { name: /^ROLES$/i },
    accounts: { name: /^ACCOUNTS$/i }
  },

  cta: {
    inviteUser: { name: /^Invite user$/i },
    createEntity: { name: /^New entity$/i },
    createRole: { name: /^New role$/i }
  },

  // Account scope header — the switcher pill labels (i18n: account.yml scopeHeader.*)
  scopeHeader: {
    switchAccount: { name: /Switch account/i },
    switchEntity: { name: /Switch entity/i }
  }
}

export { ids, me, selectors, testApi }
