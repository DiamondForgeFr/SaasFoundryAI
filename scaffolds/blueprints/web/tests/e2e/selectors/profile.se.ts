/**
 * Testing Data
 */
const testData = {
  userId: '123e4567-e89b-12d3-a456-426614174000',
  email: 'bill.mate@diamondforge.fr',
  firstName: 'Bill',
  lastName: 'Mate',
  accountId: 'acc-123e4567-e89b-12d3-a456-426614174000',
  accountName: 'Main account',
  entityId: 'ent-123e4567-e89b-12d3-a456-426614174000',
  entityName: 'Test Entity',
  organizationName: 'Test Organization',
  // Fixed ISO date so the formatted "Member since" assertion is stable across runs
  createdAt: '2025-01-15T09:30:00.000Z'
}

const testApi = {
  /**
   * Standard authenticated user used to render the profile page.
   * Carries `preferences` (mandatory per useMe schema) and a deterministic createdAt.
   */
  meAdminWithPreferences: {
    URL: '**/api/auth/me',
    success: {
      status: 200,
      body: {
        userId: testData.userId,
        email: testData.email,
        people: {
          firstname: testData.firstName,
          lastname: testData.lastName
        },
        roleAssignments: [
          {
            id: 'ra-admin-account',
            roleId: 3,
            roleName: 'account-admin',
            scope: 'ACCOUNT',
            accountId: testData.accountId,
            entityId: null,
            modules: ['PROFILE_ADMINISTRATION', 'ACCOUNT_ADMINISTRATION', 'ORGANIZATION_ADMINISTRATION', 'USER_ACCOUNT_PASSWORD_RECOVERY'],
            subModules: ['OVERVIEW', 'USERS', 'ENTITIES', 'ROLES', 'SETTINGS'],
            permissions: ['PROFILE_UPDATE_OWN', 'PASSWORD_RECOVERY_LINK_REQUEST_OWN', 'PASSWORD_RECOVERY_RESET_OWN', 'ACCOUNT_UPDATE']
          }
        ],
        currentScope: { kind: 'ACCOUNT', id: testData.accountId },
        roles: ['account-admin'],
        modules: ['PROFILE_ADMINISTRATION', 'ACCOUNT_ADMINISTRATION', 'ORGANIZATION_ADMINISTRATION', 'USER_ACCOUNT_PASSWORD_RECOVERY'],
        subModules: ['OVERVIEW', 'USERS', 'ENTITIES', 'ROLES', 'SETTINGS'],
        permissions: ['PROFILE_UPDATE_OWN', 'PASSWORD_RECOVERY_LINK_REQUEST_OWN', 'PASSWORD_RECOVERY_RESET_OWN', 'ACCOUNT_UPDATE'],
        accounts: [
          {
            id: testData.accountId,
            name: testData.accountName,
            description: 'Default account for testing',
            isActive: true,
            deactivatedByScope: null
          }
        ],
        entities: [
          {
            id: testData.entityId,
            name: testData.entityName,
            isActive: true,
            accountId: testData.accountId,
            organization: {
              id: 'org-123e4567-e89b-12d3-a456-426614174000',
              name: testData.organizationName
            }
          }
        ],
        preferences: {
          locale: 'EN',
          avatarUrl: null
        },
        createdAt: testData.createdAt
      }
    }
  },
  updatePreferences: {
    URL: '**/api/users/me/preferences',
    success: {
      status: 200,
      body: {
        locale: 'FR',
        avatarUrl: null
      }
    }
  }
}

/**
 * Flow Object Selectors
 */
const selectors = {
  URL: '/profile',
  successURL: /.*\/profile/,
  header: {
    blockId: 'profile-header',
    role: { name: /^admin$/i }
  },
  profileInfo: {
    blockId: 'profile-info-section',
    title: /^Profile information$/i,
    fields: {
      firstName: /^First name$/i,
      lastName: /^Last name$/i,
      email: /^Email$/i,
      roles: /^Roles$/i,
      memberSince: /^Member since$/i
    }
  },
  memberships: {
    blockId: 'memberships-section',
    title: /^Memberships$/i,
    accounts: /^Accounts$/i,
    entities: /^Entities$/i
  },
  preferences: {
    blockId: 'preferences-section',
    title: /^Preferences$/i,
    theme: {
      blockId: 'theme-switch',
      light: /^Light$/i,
      dark: /^Dark$/i,
      system: /^System$/i
    },
    language: {
      blockId: 'language-switch',
      en: /^English$/i,
      fr: /^Français$/i
    }
  }
}

export { selectors, testApi, testData }
