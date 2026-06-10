/**
 * Testing Data
 */
const testData = {
  accountId: 'acc-123e4567-e89b-12d3-a456-426614174000',
  entityId: 'ent-123e4567-e89b-12d3-a456-426614174000',
  entityId2: 'ent-123e4567-e89b-12d3-a456-426614174001',
  userId: '123e4567-e89b-12d3-a456-426614174000',
  userEmail: 'john.doe@example.com',
  userFirstName: 'John',
  userLastName: 'Doe',
  entityName: 'Test Entity',
  entityDescription: 'Test entity description',
  entityName2: 'Test Entity 2',
  entityDescription2: 'Test entity description 2',
  organizationName: 'Test Organization',
  organizationName2: 'Test Organization 2',
  organizationDescription2: 'Test organization description 2',
  organizationType: 'COMPANY',
  roleName: 'Admin',
  roleId: 1
}

const testApi = {
  interceptorURL: `**/api/accounts/${testData.accountId}`,
  account: {
    URL: `**/api/accounts/${testData.accountId}`,
    success: {
      status: 200,
      body: {
        id: testData.accountId,
        name: 'Main account',
        description: 'Default account for testing',
        isActive: true,
        createdAt: '2025-05-28T10:31:59.149Z',
        updatedAt: '2025-05-28T10:31:59.149Z',
        pendingInvitations: 0,
        pendingSignups: 0,
        users: {
          count: 2,
          values: [
            {
              id: 'cmb7taa5t000at8d3i0qb02yk',
              email: 'john.doe@example.com',
              isActive: true,
              people: {
                id: 'cmb7tgi78000ft8d3t37q372n',
                firstname: 'John',
                lastname: 'Doe'
              },
              roles: [
                {
                  id: 2,
                  name: 'account-user'
                }
              ],
              entities: [
                {
                  id: 'cmb7t9c0r0009t8d34rv4aglj',
                  name: 'Couv-Gachet',
                  organization: {
                    id: 'cmb7t9bkc0007t8d32c6kaohe',
                    name: 'Diamondforge'
                  }
                }
              ],
              isDirectlyLinked: false,
              lastLoginAt: null,
              createdAt: '2025-05-28T10:37:47.633Z',
              updatedAt: '2025-05-28T10:42:38.038Z'
            },
            {
              id: 'cmb7t0stt0000t8d38o1h89l4',
              email: 'bill.mate@diamondforge.fr',
              isActive: true,
              people: {
                id: 'cmb7t2t8k0003t8d33vzj1rj2',
                firstname: 'Bill',
                lastname: 'Mate'
              },
              roles: [
                {
                  id: 3,
                  name: 'account-admin'
                }
              ],
              entities: [],
              isDirectlyLinked: true,
              lastLoginAt: null,
              createdAt: '2025-05-28T10:30:25.266Z',
              updatedAt: '2025-05-30T17:06:29.351Z'
            }
          ]
        },
        entities: {
          count: 1,
          values: [
            {
              id: 'cmb7t9c0r0009t8d34rv4aglj',
              name: 'Couv-Gachet',
              description: 'Promo 12/2024',
              isActive: true,
              organization: {
                id: 'cmb7t9bkc0007t8d32c6kaohe',
                name: 'Diamondforge',
                type: 'COMPANY'
              },
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
              description: 'Basic authenticated user',
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
              description: 'Administrator user',
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
  },
  createOrganization: {
    URL: `**/api/organizations`,
    success: {
      status: 200,
      body: {
        id: 'org-456',
        name: testData.organizationName2,
        type: testData.organizationType,
        description: testData.organizationDescription2,
        website: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }
  },
  createEntity: {
    URL: `**/api/entities`,
    success: {
      status: 200,
      body: {
        id: testData.entityId2,
        name: testData.entityName2,
        isActive: true,
        description: testData.entityDescription2,
        organization: {
          id: 'org-456',
          name: testData.organizationName2,
          type: testData.organizationType
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }
  },
  entities: {
    URL: `**/api/accounts/${testData.accountId}/entities`,
    success: {
      status: 200,
      body: {
        items: [
          {
            id: testData.entityId,
            name: testData.entityName,
            description: testData.entityDescription,
            isActive: true,
            organization: {
              id: 'org-123',
              name: testData.organizationName,
              type: 'COMPANY'
            },
            userCount: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ],
        meta: {
          pagination: {
            current: 1,
            limit: 10,
            total: 1
          },
          count: 1
        }
      },
      body2: {
        items: [
          {
            id: testData.entityId,
            name: testData.entityName,
            description: testData.entityDescription,
            isActive: true,
            organization: {
              id: 'org-123',
              name: testData.organizationName,
              type: 'COMPANY'
            },
            userCount: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          {
            id: testData.entityId2,
            name: testData.entityName2,
            description: testData.entityDescription2,
            isActive: true,
            organization: {
              id: 'org-456',
              name: testData.organizationName2,
              type: 'COMPANY'
            },
            userCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ],
        meta: {
          pagination: {
            current: 1,
            limit: 10,
            total: 2
          },
          count: 2
        }
      }
    }
  },
  users: {
    URL: `**/api/accounts/${testData.accountId}/users`,
    success: {
      status: 200,
      body: {
        items: [
          {
            id: 'cmb7taa5t000at8d3i0qb02yk',
            email: 'john.doe@example.com',
            isActive: true,
            people: {
              id: 'cmb7tgi78000ft8d3t37q372n',
              firstname: 'John',
              lastname: 'Doe'
            },
            roles: [
              {
                id: 2,
                name: 'account-user'
              }
            ],
            entities: [
              {
                id: 'cmb7t9c0r0009t8d34rv4aglj',
                name: 'Couv-Gachet',
                organization: {
                  id: 'cmb7t9bkc0007t8d32c6kaohe',
                  name: 'Diamondforge'
                }
              }
            ],
            isDirectlyLinked: false,
            lastLoginAt: null,
            createdAt: '2025-05-28T10:37:47.633Z',
            updatedAt: '2025-05-28T10:42:38.038Z'
          },
          {
            id: 'cmb7t0stt0000t8d38o1h89l4',
            email: 'bill.mate@diamondforge.fr',
            isActive: true,
            people: {
              id: 'cmb7t2t8k0003t8d33vzj1rj2',
              firstname: 'Bill',
              lastname: 'Mate'
            },
            roles: [
              {
                id: 3,
                name: 'account-admin'
              }
            ],
            entities: [],
            isDirectlyLinked: true,
            lastLoginAt: null,
            createdAt: '2025-05-28T10:30:25.266Z',
            updatedAt: '2025-05-30T17:06:29.351Z'
          }
        ],
        meta: {
          pagination: {
            current: 1,
            limit: 10,
            total: 2
          },
          count: 2
        }
      }
    }
  },
  roles: {
    URL: `**/api/accounts/${testData.accountId}/roles`,
    success: {
      status: 200,
      body: {
        items: [
          {
            id: 1,
            name: 'guest',
            description: 'Non-authenticated user',
            scope: 'PLATFORM',
            isSystem: true,
            isActive: true,
            isGlobal: true,
            modules: [],
            permissions: [],
            createdAt: '2025-05-28T10:29:45.435Z',
            updatedAt: '2025-05-28T10:29:45.435Z'
          },
          {
            id: 2,
            name: 'account-user',
            description: 'Basic authenticated user',
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
            description: 'Administrator user',
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
        meta: {
          pagination: {
            current: 1,
            limit: 10,
            total: 3
          },
          count: 3
        }
      }
    }
  },
  invitations: {
    URL: '**/api/invitations',
    method: 'GET',
    success: {
      status: 200,
      bodyEmpty: {
        invitations: []
      },
      body: {
        invitations: [
          {
            id: 'cmb7taak1000et8d3ymbkop9v',
            inviterUserId: 'cmb7t0stt0000t8d38o1h89l4',
            inviteeUserId: 'cmb7taa5t000at8d3i0qb02yk',
            inviteeUserEmail: 'bruce.wayne@example.com',
            status: 'SENT',
            invitedAt: '2025-05-28T10:37:48.146Z',
            acceptedAt: null,
            accounts: [],
            entities: [
              {
                id: 'cmb7t9c0r0009t8d34rv4aglj',
                name: 'Couv-Gachet'
              }
            ],
            roles: [
              {
                id: 2,
                name: 'account-user'
              }
            ]
          }
        ]
      }
    }
  },
  inviteUser: {
    URL: `**/api/invitations`,
    method: 'POST',
    success: {
      status: 200,
      body: { message: 'User invitation sent successfully' }
    },
    error: {
      status: 400,
      body: { message: 'User already exists or invalid data' }
    }
  }
}

/**
 * Flow Object Selectors — aligned with the reworked UI
 */
const selectors = {
  URL: '/account',
  sectionTabs: {
    overview: { name: /^OVERVIEW$/i },
    entities: { name: /^ENTITIES$/i },
    users: { name: /^USERS$/i }
  },
  accountOverview: {
    successURL: /.*\/account\?tab=overview/,
    kpis: {
      blockId: 'overview-kpis',
      users: { blockId: 'kpi-users', label: /^Users$/i },
      entities: { blockId: 'kpi-entities', label: /^Entities$/i },
      pending: { blockId: 'kpi-pending', label: /Pending invitations \/ sign-ups/i }
    },
    recentUsers: {
      blockId: 'recent-users-section',
      rowId: 'recent-user-row',
      title: /^Recent Users$/i,
      cta: {
        invite: { name: /^Invite user$/i },
        viewAll: { name: /View all users/i }
      }
    },
    recentEntities: {
      blockId: 'recent-entities-section',
      rowId: 'recent-entity-row',
      title: /^Recent Entities$/i,
      cta: {
        create: { name: /^New entity$/i },
        viewAll: { name: /View all entities/i }
      }
    },
    roles: {
      blockId: 'roles-section',
      cardId: 'role-card',
      title: /^Roles$/i
    }
  },
  accountEntities: {
    successURL: /.*\/account\?tab=entities/,
    table: { blockId: 'entities-table', rowId: 'entity-row' },
    cta: {
      createEntity: { name: /^New entity$/i }
    },
    newEntityDialog: {
      title: { name: /^New entity$/i },
      subtitle: { name: /^Create a new entity with its organization$/i },
      organization: {
        blockId: 'organization-details',
        types: {
          // Buttons combine label ("Company") and sub-label ("Commercial") in their accessible name
          company: { name: /Company/i },
          association: { name: /Association/i },
          community: { name: /Community/i }
        }
      },
      cta: {
        create: { name: /^Create$/i }
      }
    }
  },
  accountUsers: {
    successURL: /.*\/account\?tab=users/,
    table: { rowId: 'user-row' },
    cta: {
      inviteUser: { name: /^Invite user$/i }
    },
    inviteUserDialog: {
      title: { name: /^Invite user$/i },
      sections: {
        who: /A — Who\?/i,
        accessScope: /B — Access scope/i,
        roles: /C — Roles/i
      },
      accessScope: {
        listBlockId: 'invite-access-scope',
        accountAccessId: 'invite-account-access',
        entitiesListId: 'invite-entities-list',
        entityTileId: 'invite-entity-tile'
      },
      roles: {
        blockId: 'roles-filter',
        tileId: 'invite-role-tile'
      },
      cta: {
        invite: { name: /^Invite user$/i }
      }
    }
  }
}

export { selectors, testApi, testData }
