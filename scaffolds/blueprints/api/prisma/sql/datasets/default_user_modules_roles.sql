BEGIN;

-- Serialize supported RBAC writers for the whole snapshot/bootstrap/restore
-- transaction so a concurrent administrator change can never be overwritten
-- by a stale snapshot.
LOCK TABLE
  public.roles,
  public.roles_modules_links,
  public.roles_sub_modules_links,
  public.roles_permissions_links
IN SHARE ROW EXCLUSIVE MODE;

------
-- The 1.0.0-beta schema had a global `guest` role before `is_system` existed.
-- Prisma adds the new flag with FALSE, so adopt that exact legacy role when
-- the beta migration staging table proves this is an upgrade. This preserves
-- its identity for the post-schema user-link migration instead of creating a
-- second global guest role.
------
DO $$
BEGIN
  IF to_regclass('saasfoundry_migration.beta_user_role_links') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.roles
       WHERE name = 'guest' AND account_id IS NULL AND is_system = TRUE
    ) THEN
    UPDATE public.roles
    SET scope = 'PLATFORM', is_system = TRUE, updated_at = NOW()
    WHERE id = (
      SELECT id FROM public.roles
      WHERE name = 'guest' AND account_id IS NULL
      ORDER BY id
      LIMIT 1
    );
  END IF;
END $$;

------
-- Preserve administrator-managed RBAC state across forward database updates.
--
-- This dataset also bootstraps newly introduced system roles. Existing system
-- roles, however, are mutable through the supported administration API: their
-- active flag and grants must survive every subsequent `db:update:dev` run.
-- The snapshots are transaction-local, so a failed dataset never exposes the
-- temporary bootstrap state.
------
CREATE TEMP TABLE sf_existing_system_roles ON COMMIT DROP AS
SELECT id
FROM public.roles
WHERE account_id IS NULL AND is_system = TRUE;

CREATE TEMP TABLE sf_existing_role_modules ON COMMIT DROP AS
SELECT link.*
FROM public.roles_modules_links link
JOIN sf_existing_system_roles role ON role.id = link.role_id;

CREATE TEMP TABLE sf_existing_role_sub_modules ON COMMIT DROP AS
SELECT link.*
FROM public.roles_sub_modules_links link
JOIN sf_existing_system_roles role ON role.id = link.role_id;

CREATE TEMP TABLE sf_existing_role_permissions ON COMMIT DROP AS
SELECT link.*
FROM public.roles_permissions_links link
JOIN sf_existing_system_roles role ON role.id = link.role_id;

------
-- A custom account role may legitimately use the same name as a system role.
-- Temporarily move such names out of the bootstrap lookup namespace; they are
-- restored before commit and are never visible outside this transaction.
------
CREATE TEMP TABLE sf_colliding_custom_roles ON COMMIT DROP AS
SELECT id, name, account_id
FROM public.roles
WHERE NOT (account_id IS NULL AND is_system = TRUE)
  AND name IN ('guest', 'account-user', 'account-admin', 'entity-admin', 'entity-user', 'platform-admin', 'platform-user');

DO $$
DECLARE
  collision RECORD;
  candidate TEXT;
BEGIN
  FOR collision IN SELECT * FROM sf_colliding_custom_roles ORDER BY id LOOP
    LOOP
      candidate := LEFT('__sf_' || md5(collision.id::TEXT || ':' || clock_timestamp()::TEXT || ':' || random()::TEXT), 30);
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.roles
        WHERE name = candidate
          AND account_id IS NOT DISTINCT FROM collision.account_id
      );
    END LOOP;

    UPDATE public.roles SET name = candidate WHERE id = collision.id;
  END LOOP;
END $$;

------
-- 1. Default user roles (system templates, isSystem = TRUE)
--
--   guest          — anonymous user (PLATFORM, technical)
--   user           — basic authenticated user (ACCOUNT — also assignable at ENTITY scope by an admin)
--   admin          — account-wide administrator (ACCOUNT)
--   entity-admin   — administrator scoped to a single entity (ENTITY)
--   entity-user    — basic authenticated user scoped to a single entity (ENTITY)
--   platform-admin — platform-wide administrator (PLATFORM)
------
DO $$
DECLARE
  system_role RECORD;
BEGIN
  FOR system_role IN
    SELECT * FROM (VALUES
      ('guest',          'Non-authenticated user',                  'PLATFORM'::role_scope, TRUE),
      ('account-user',   'Basic authenticated user',                'ACCOUNT'::role_scope,  TRUE),
      ('account-admin',  'Account administrator',                   'ACCOUNT'::role_scope,  TRUE),
      ('entity-admin',   'Entity administrator',                    'ENTITY'::role_scope,   TRUE),
      ('entity-user',    'Basic authenticated user of an entity',   'ENTITY'::role_scope,   TRUE),
      ('platform-admin', 'Platform-wide administrator (superuser)', 'PLATFORM'::role_scope, TRUE),
      ('platform-user',  'Platform user (read-only is out of scope; profile + password only)', 'PLATFORM'::role_scope, TRUE)
    ) AS seed(name, description, scope, is_active)
  LOOP
    UPDATE public.roles
    SET description = system_role.description,
        scope = system_role.scope,
        is_system = TRUE,
        updated_at = NOW()
    WHERE name = system_role.name AND account_id IS NULL AND is_system = TRUE;

    IF NOT FOUND THEN
      INSERT INTO public.roles (name, description, scope, is_system, is_active, updated_at)
      VALUES (system_role.name, system_role.description, system_role.scope, TRUE, system_role.is_active, NOW());
    END IF;
  END LOOP;
END $$;

------
-- 2. Default module types
------
INSERT INTO public.module_types (name, description, updated_at)
VALUES
  ('USER_MANAGEMENT',         'User management-related modules',         NOW()),
  ('PROFILE_MANAGEMENT',      'Profile management-related modules',      NOW()),
  ('ACCOUNT_MANAGEMENT',      'Account management-related modules',      NOW()),
  ('PLATFORM_MANAGEMENT',     'Platform management-related modules',     NOW()),
  ('ORGANIZATION_MANAGEMENT', 'Organization management-related modules', NOW())
ON CONFLICT (name) DO NOTHING;

------
-- 2b. Default entity types (registry of profile tables eligible to be an entity type)
------
INSERT INTO public.entity_types (name, table_name, label, is_active, updated_at)
VALUES
  ('ORGANIZATION', 'organizations', 'Organization', TRUE, NOW())
ON CONFLICT (name) DO NOTHING;

------
-- 3. Default modules
------
INSERT INTO public.modules (name, type_id, version, description, is_active, updated_at)
VALUES
  ('USER_ACCOUNT_CREATION',          (SELECT id FROM public.module_types WHERE name = 'USER_MANAGEMENT'),         '1.0.0', 'User account creation module',           TRUE,  NOW()),
  ('USER_ACCOUNT_PASSWORD_RECOVERY', (SELECT id FROM public.module_types WHERE name = 'USER_MANAGEMENT'),         '1.0.0', 'User password recovery module',          TRUE,  NOW()),
  ('PROFILE_ADMINISTRATION',         (SELECT id FROM public.module_types WHERE name = 'PROFILE_MANAGEMENT'),      '1.0.0', 'Personal profile management module',     TRUE,  NOW()),
  ('ACCOUNT_ADMINISTRATION',         (SELECT id FROM public.module_types WHERE name = 'ACCOUNT_MANAGEMENT'),      '1.0.0', 'Account management module',              TRUE,  NOW()),
  ('MULTI_ACCOUNT_MANAGEMENT',       (SELECT id FROM public.module_types WHERE name = 'ACCOUNT_MANAGEMENT'),      '1.0.0', 'Multi-account management module',        FALSE, NOW()),
  ('MULTI_ENTITY_MANAGEMENT',        (SELECT id FROM public.module_types WHERE name = 'ACCOUNT_MANAGEMENT'),      '1.0.0', 'Multi-entity management module',         FALSE, NOW()),
  ('PLATFORM_ADMINISTRATION',        (SELECT id FROM public.module_types WHERE name = 'PLATFORM_MANAGEMENT'),     '1.0.0', 'Platform-wide administration module',    TRUE,  NOW()),
  ('ORGANIZATION_ADMINISTRATION',    (SELECT id FROM public.module_types WHERE name = 'ORGANIZATION_MANAGEMENT'), '1.0.0', 'Organization management module',         TRUE,  NOW())
ON CONFLICT (name) DO NOTHING;

------
-- 3b. Default sub-modules (sections inside complex modules)
--
-- A complex module groups its permissions under sub-modules; the role's sub-module links drive
-- which sections are VISIBLE (read), independent of the action permissions. Simple modules
-- (profile, password, multi-*, organization, user-creation) declare no sub-modules.
------
INSERT INTO public.sub_modules (module_id, name, description, updated_at)
VALUES
  -- ACCOUNT_ADMINISTRATION sections (the /account screen tabs)
  ((SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),  'OVERVIEW', 'Account / entity overview section',  NOW()),
  ((SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),  'USERS',    'Account / entity users section',     NOW()),
  ((SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),  'ENTITIES', 'Account entities section',           NOW()),
  ((SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),  'ROLES',    'Roles catalog section',              NOW()),
  ((SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),  'SETTINGS', 'Account settings section',           NOW()),
  -- PLATFORM_ADMINISTRATION sections
  ((SELECT id FROM public.modules WHERE name = 'PLATFORM_ADMINISTRATION'), 'PLATFORM_ACCOUNTS',     'All-accounts list section',    NOW()),
  ((SELECT id FROM public.modules WHERE name = 'PLATFORM_ADMINISTRATION'), 'PLATFORM_USERS',        'Cross-account users section',  NOW()),
  ((SELECT id FROM public.modules WHERE name = 'PLATFORM_ADMINISTRATION'), 'PLATFORM_MODULES',      'Platform modules section',     NOW()),
  ((SELECT id FROM public.modules WHERE name = 'PLATFORM_ADMINISTRATION'), 'PLATFORM_REACTIVATION', 'Reactivation requests section',NOW())
ON CONFLICT (module_id, name) DO NOTHING;

------
-- 4. Default permissions by module (with applicable scopes)
--
-- applicable_scopes drives which scopes a permission can be attached to when
-- building a custom role; the backend rejects bindings to incompatible scopes.
------
INSERT INTO public.module_permissions (module_id, name, description, applicable_scopes, updated_at)
VALUES
  -- user_account_creation module
  ((SELECT id FROM public.modules WHERE name = 'USER_ACCOUNT_CREATION'),          'USER_ACCOUNT_CREATE_OWN',           'Create a personal user account',                 ARRAY['PLATFORM']::role_scope[],                       NOW()),
  -- password_recovery module
  ((SELECT id FROM public.modules WHERE name = 'USER_ACCOUNT_PASSWORD_RECOVERY'), 'PASSWORD_RECOVERY_LINK_REQUEST_OWN','Request a password recovery link for own account',ARRAY['PLATFORM','ACCOUNT','ENTITY']::role_scope[],    NOW()),
  ((SELECT id FROM public.modules WHERE name = 'USER_ACCOUNT_PASSWORD_RECOVERY'), 'PASSWORD_RECOVERY_RESET_OWN',       'Reset own password using a valid token',         ARRAY['PLATFORM','ACCOUNT','ENTITY']::role_scope[],    NOW()),
  -- profile_administration module
  ((SELECT id FROM public.modules WHERE name = 'PROFILE_ADMINISTRATION'),         'PROFILE_UPDATE_OWN',                'Update own profile information',                 ARRAY['PLATFORM','ACCOUNT','ENTITY']::role_scope[],    NOW()),
  -- account_administration module
  ((SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),         'ACCOUNT_UPDATE',                    'Update an account',                              ARRAY['PLATFORM','ACCOUNT']::role_scope[],             NOW()),
  ((SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),         'ACCOUNT_USER_MANAGEMENT',           'Manage account users',                           ARRAY['PLATFORM','ACCOUNT']::role_scope[],             NOW()),
  ((SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),         'ACCOUNT_ENTITY_MANAGEMENT',         'Manage account entities',                        ARRAY['PLATFORM','ACCOUNT']::role_scope[],             NOW()),
  ((SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),         'USER_ACCOUNTS_INVITATION',          'Invite users to an account',                     ARRAY['PLATFORM','ACCOUNT']::role_scope[],             NOW()),
  ((SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),         'USER_ENTITIES_INVITATION',          'Invite users to an entity',                      ARRAY['PLATFORM','ACCOUNT','ENTITY']::role_scope[],    NOW()),
  ((SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),         'USER_ROLE_ALLOCATION',              'Allocate roles to users',                        ARRAY['PLATFORM','ACCOUNT','ENTITY']::role_scope[],    NOW()),
  ((SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),         'ENTITY_CREATION',                   'Create an entity',                               ARRAY['PLATFORM','ACCOUNT','ENTITY']::role_scope[],    NOW()),
  ((SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),         'ENTITY_USER_MANAGEMENT',            'Manage entity users',                            ARRAY['PLATFORM','ACCOUNT','ENTITY']::role_scope[],    NOW()),
  ((SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),         'ROLE_CUSTOM_MANAGEMENT',            'Create / edit custom roles within scope',        ARRAY['PLATFORM','ACCOUNT','ENTITY']::role_scope[],    NOW()),
  -- multi_account_management module — disabled by default; lets an account admin spin up an
  -- additional account they own (becomes admin of the new account, kept independent — no parent/child).
  ((SELECT id FROM public.modules WHERE name = 'MULTI_ACCOUNT_MANAGEMENT'),       'ACCOUNT_OWN_CREATE',                'Create an additional account owned by the user', ARRAY['ACCOUNT']::role_scope[],                        NOW()),
  -- multi_entity_management module — disabled by default; lets an entity admin spin up another
  -- entity inside the same parent account (becomes entity-admin of the new entity).
  ((SELECT id FROM public.modules WHERE name = 'MULTI_ENTITY_MANAGEMENT'),        'ENTITY_OWN_CREATE',                 'Create an additional entity owned by the user',  ARRAY['ENTITY']::role_scope[],                         NOW()),
  -- platform_administration module
  ((SELECT id FROM public.modules WHERE name = 'PLATFORM_ADMINISTRATION'),        'ACCOUNT_CREATE_ANY',                'Create a new account',                           ARRAY['PLATFORM']::role_scope[],                       NOW()),
  ((SELECT id FROM public.modules WHERE name = 'PLATFORM_ADMINISTRATION'),        'ACCOUNT_INVITE_OWNER',              'Invite a user to own a new account',             ARRAY['PLATFORM']::role_scope[],                       NOW()),
  ((SELECT id FROM public.modules WHERE name = 'PLATFORM_ADMINISTRATION'),        'MODULE_MANAGEMENT',                 'Activate / deactivate platform modules',         ARRAY['PLATFORM']::role_scope[],                       NOW()),
  ((SELECT id FROM public.modules WHERE name = 'PLATFORM_ADMINISTRATION'),        'ACCOUNT_REACTIVATION_REVIEW',       'Approve or reject account reactivation requests', ARRAY['PLATFORM']::role_scope[],                      NOW()),
  -- organization_management module
  ((SELECT id FROM public.modules WHERE name = 'ORGANIZATION_ADMINISTRATION'),    'ORGANIZATION_CREATION',             'Create an organization',                         ARRAY['PLATFORM','ACCOUNT','ENTITY']::role_scope[],    NOW()),
  ((SELECT id FROM public.modules WHERE name = 'ORGANIZATION_ADMINISTRATION'),    'ORGANIZATION_UPDATE',               'Update an organization',                         ARRAY['PLATFORM','ACCOUNT','ENTITY']::role_scope[],    NOW())
ON CONFLICT (name) DO NOTHING;


------
-- 4b. Attach each complex-module permission to its sub-module (section).
--     Permissions of simple modules keep sub_module_id = NULL (attached directly to the module).
------
UPDATE public.module_permissions mp SET sub_module_id = sm.id, updated_at = NOW()
FROM public.sub_modules sm
WHERE sm.module_id = mp.module_id
  AND (
       (sm.name = 'USERS'    AND mp.name IN ('ACCOUNT_USER_MANAGEMENT', 'USER_ACCOUNTS_INVITATION', 'USER_ENTITIES_INVITATION', 'ENTITY_USER_MANAGEMENT'))
    OR (sm.name = 'ENTITIES' AND mp.name IN ('ACCOUNT_ENTITY_MANAGEMENT', 'ENTITY_CREATION'))
    OR (sm.name = 'ROLES'    AND mp.name IN ('ROLE_CUSTOM_MANAGEMENT', 'USER_ROLE_ALLOCATION'))
    OR (sm.name = 'SETTINGS' AND mp.name IN ('ACCOUNT_UPDATE'))
    OR (sm.name = 'PLATFORM_ACCOUNTS'     AND mp.name IN ('ACCOUNT_CREATE_ANY', 'ACCOUNT_INVITE_OWNER'))
    OR (sm.name = 'PLATFORM_MODULES'      AND mp.name IN ('MODULE_MANAGEMENT'))
    OR (sm.name = 'PLATFORM_REACTIVATION' AND mp.name IN ('ACCOUNT_REACTIVATION_REVIEW'))
  );

------
-- 5. Link roles to authorized modules
------
INSERT INTO public.roles_modules_links (role_id, module_id, updated_at)
VALUES
  -- guest
  ((SELECT id FROM public.roles WHERE name = 'guest'),          (SELECT id FROM public.modules WHERE name = 'USER_ACCOUNT_CREATION'),          NOW()),
  ((SELECT id FROM public.roles WHERE name = 'guest'),          (SELECT id FROM public.modules WHERE name = 'USER_ACCOUNT_PASSWORD_RECOVERY'), NOW()),
  -- account-user (read-only: sees the account screen, no management permissions)
  ((SELECT id FROM public.roles WHERE name = 'account-user'),           (SELECT id FROM public.modules WHERE name = 'USER_ACCOUNT_PASSWORD_RECOVERY'), NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-user'),           (SELECT id FROM public.modules WHERE name = 'PROFILE_ADMINISTRATION'),         NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-user'),           (SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),         NOW()),
  -- admin (account scope)
  ((SELECT id FROM public.roles WHERE name = 'account-admin'),          (SELECT id FROM public.modules WHERE name = 'USER_ACCOUNT_PASSWORD_RECOVERY'), NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-admin'),          (SELECT id FROM public.modules WHERE name = 'PROFILE_ADMINISTRATION'),         NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-admin'),          (SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),         NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-admin'),          (SELECT id FROM public.modules WHERE name = 'MULTI_ACCOUNT_MANAGEMENT'),       NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-admin'),          (SELECT id FROM public.modules WHERE name = 'ORGANIZATION_ADMINISTRATION'),    NOW()),
  -- entity-admin (entity scope)
  ((SELECT id FROM public.roles WHERE name = 'entity-admin'),   (SELECT id FROM public.modules WHERE name = 'USER_ACCOUNT_PASSWORD_RECOVERY'), NOW()),
  ((SELECT id FROM public.roles WHERE name = 'entity-admin'),   (SELECT id FROM public.modules WHERE name = 'PROFILE_ADMINISTRATION'),         NOW()),
  ((SELECT id FROM public.roles WHERE name = 'entity-admin'),   (SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),         NOW()),
  ((SELECT id FROM public.roles WHERE name = 'entity-admin'),   (SELECT id FROM public.modules WHERE name = 'MULTI_ENTITY_MANAGEMENT'),        NOW()),
  ((SELECT id FROM public.roles WHERE name = 'entity-admin'),   (SELECT id FROM public.modules WHERE name = 'ORGANIZATION_ADMINISTRATION'),    NOW()),
  -- entity-user (entity scope — read-only account screen + profile + password recovery)
  ((SELECT id FROM public.roles WHERE name = 'entity-user'),    (SELECT id FROM public.modules WHERE name = 'USER_ACCOUNT_PASSWORD_RECOVERY'), NOW()),
  ((SELECT id FROM public.roles WHERE name = 'entity-user'),    (SELECT id FROM public.modules WHERE name = 'PROFILE_ADMINISTRATION'),         NOW()),
  ((SELECT id FROM public.roles WHERE name = 'entity-user'),    (SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),         NOW()),
  -- platform-admin (full)
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.modules WHERE name = 'USER_ACCOUNT_PASSWORD_RECOVERY'), NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.modules WHERE name = 'PROFILE_ADMINISTRATION'),         NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),         NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.modules WHERE name = 'PLATFORM_ADMINISTRATION'),        NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.modules WHERE name = 'ORGANIZATION_ADMINISTRATION'),    NOW()),
  -- platform-user (read-only: full platform + account vision, no management permissions)
  ((SELECT id FROM public.roles WHERE name = 'platform-user'),  (SELECT id FROM public.modules WHERE name = 'PROFILE_ADMINISTRATION'),         NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-user'),  (SELECT id FROM public.modules WHERE name = 'USER_ACCOUNT_PASSWORD_RECOVERY'), NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-user'),  (SELECT id FROM public.modules WHERE name = 'PLATFORM_ADMINISTRATION'),        NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-user'),  (SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),         NOW())
ON CONFLICT (role_id, module_id) DO NOTHING;

------
-- 5b. Link roles to visible sub-modules (section visibility / read).
--     Phase 2 (structural): admins receive the sub-modules matching their current effective access,
--     so behaviour is unchanged (sub-modules are not yet consumed by guards/frontend). The read-only
--     opening of -user roles happens in the behavioural phase (with backend/frontend re-gating).
------
INSERT INTO public.roles_sub_modules_links (role_id, sub_module_id, updated_at)
SELECT r.id, sm.id, NOW()
FROM public.roles r
CROSS JOIN public.sub_modules sm
WHERE
  -- account-admin: every ACCOUNT_ADMINISTRATION section
  (r.name = 'account-admin'  AND sm.module_id = (SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'))
  -- account-user: every ACCOUNT_ADMINISTRATION section read-only (incl. SETTINGS per D4)
  OR (r.name = 'account-user' AND sm.module_id = (SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'))
  -- entity-admin: OVERVIEW + USERS + ROLES (no ENTITIES, no SETTINGS — scoped to its entity)
  OR (r.name = 'entity-admin' AND sm.module_id = (SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION') AND sm.name IN ('OVERVIEW', 'USERS', 'ROLES'))
  -- entity-user: OVERVIEW + USERS + ROLES read-only (no ENTITIES, no SETTINGS per D5)
  OR (r.name = 'entity-user' AND sm.module_id = (SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION') AND sm.name IN ('OVERVIEW', 'USERS', 'ROLES'))
  -- platform-admin: every ACCOUNT_ADMINISTRATION + every PLATFORM_ADMINISTRATION section
  OR (r.name = 'platform-admin' AND sm.module_id IN (
        (SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),
        (SELECT id FROM public.modules WHERE name = 'PLATFORM_ADMINISTRATION')
     ))
  -- platform-user: full read into every ACCOUNT_ADMINISTRATION + PLATFORM_ADMINISTRATION section (per D6)
  OR (r.name = 'platform-user' AND sm.module_id IN (
        (SELECT id FROM public.modules WHERE name = 'ACCOUNT_ADMINISTRATION'),
        (SELECT id FROM public.modules WHERE name = 'PLATFORM_ADMINISTRATION')
     ))
ON CONFLICT (role_id, sub_module_id) DO NOTHING;

------
-- 6. Link roles to authorized permissions
------
INSERT INTO public.roles_permissions_links (role_id, permission_id, updated_at)
VALUES
  -- guest
  ((SELECT id FROM public.roles WHERE name = 'guest'),          (SELECT id FROM public.module_permissions WHERE name = 'USER_ACCOUNT_CREATE_OWN'),            NOW()),

  -- user (basic — own profile + password)
  ((SELECT id FROM public.roles WHERE name = 'account-user'),           (SELECT id FROM public.module_permissions WHERE name = 'PASSWORD_RECOVERY_LINK_REQUEST_OWN'), NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-user'),           (SELECT id FROM public.module_permissions WHERE name = 'PASSWORD_RECOVERY_RESET_OWN'),       NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-user'),           (SELECT id FROM public.module_permissions WHERE name = 'PROFILE_UPDATE_OWN'),                NOW()),

  -- admin (account-wide)
  ((SELECT id FROM public.roles WHERE name = 'account-admin'),          (SELECT id FROM public.module_permissions WHERE name = 'PASSWORD_RECOVERY_LINK_REQUEST_OWN'), NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-admin'),          (SELECT id FROM public.module_permissions WHERE name = 'PASSWORD_RECOVERY_RESET_OWN'),       NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-admin'),          (SELECT id FROM public.module_permissions WHERE name = 'PROFILE_UPDATE_OWN'),                NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-admin'),          (SELECT id FROM public.module_permissions WHERE name = 'ACCOUNT_UPDATE'),                    NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-admin'),          (SELECT id FROM public.module_permissions WHERE name = 'ACCOUNT_USER_MANAGEMENT'),           NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-admin'),          (SELECT id FROM public.module_permissions WHERE name = 'ACCOUNT_ENTITY_MANAGEMENT'),         NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-admin'),          (SELECT id FROM public.module_permissions WHERE name = 'USER_ACCOUNTS_INVITATION'),          NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-admin'),          (SELECT id FROM public.module_permissions WHERE name = 'USER_ENTITIES_INVITATION'),          NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-admin'),          (SELECT id FROM public.module_permissions WHERE name = 'USER_ROLE_ALLOCATION'),              NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-admin'),          (SELECT id FROM public.module_permissions WHERE name = 'ENTITY_CREATION'),                   NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-admin'),          (SELECT id FROM public.module_permissions WHERE name = 'ENTITY_USER_MANAGEMENT'),            NOW()),
  -- ROLE_CUSTOM_MANAGEMENT intentionally NOT granted by default — opt-in only (must be added
  -- to a custom role by a platform-admin or to an updated `admin` role permission set).
  -- ACCOUNT_OWN_CREATE is granted but gated by the MULTI_ACCOUNT_MANAGEMENT module activation:
  -- the perm is filtered out of the admin's effective set until a platform-admin enables the module.
  ((SELECT id FROM public.roles WHERE name = 'account-admin'),          (SELECT id FROM public.module_permissions WHERE name = 'ACCOUNT_OWN_CREATE'),                NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-admin'),          (SELECT id FROM public.module_permissions WHERE name = 'ORGANIZATION_CREATION'),             NOW()),
  ((SELECT id FROM public.roles WHERE name = 'account-admin'),          (SELECT id FROM public.module_permissions WHERE name = 'ORGANIZATION_UPDATE'),               NOW()),

  -- entity-admin (own entity)
  ((SELECT id FROM public.roles WHERE name = 'entity-admin'),   (SELECT id FROM public.module_permissions WHERE name = 'PASSWORD_RECOVERY_LINK_REQUEST_OWN'), NOW()),
  ((SELECT id FROM public.roles WHERE name = 'entity-admin'),   (SELECT id FROM public.module_permissions WHERE name = 'PASSWORD_RECOVERY_RESET_OWN'),       NOW()),
  ((SELECT id FROM public.roles WHERE name = 'entity-admin'),   (SELECT id FROM public.module_permissions WHERE name = 'PROFILE_UPDATE_OWN'),                NOW()),
  ((SELECT id FROM public.roles WHERE name = 'entity-admin'),   (SELECT id FROM public.module_permissions WHERE name = 'USER_ENTITIES_INVITATION'),          NOW()),
  ((SELECT id FROM public.roles WHERE name = 'entity-admin'),   (SELECT id FROM public.module_permissions WHERE name = 'USER_ROLE_ALLOCATION'),              NOW()),
  ((SELECT id FROM public.roles WHERE name = 'entity-admin'),   (SELECT id FROM public.module_permissions WHERE name = 'ENTITY_USER_MANAGEMENT'),            NOW()),
  ((SELECT id FROM public.roles WHERE name = 'entity-admin'),   (SELECT id FROM public.module_permissions WHERE name = 'ROLE_CUSTOM_MANAGEMENT'),            NOW()),
  -- ENTITY_OWN_CREATE is granted but gated by the MULTI_ENTITY_MANAGEMENT module activation:
  -- the effective-permissions filter in auth.service.ts hides it from /me when the module is OFF.
  ((SELECT id FROM public.roles WHERE name = 'entity-admin'),   (SELECT id FROM public.module_permissions WHERE name = 'ENTITY_OWN_CREATE'),                NOW()),
  ((SELECT id FROM public.roles WHERE name = 'entity-admin'),   (SELECT id FROM public.module_permissions WHERE name = 'ORGANIZATION_UPDATE'),               NOW()),

  -- entity-user (own profile + password recovery, no management perms)
  ((SELECT id FROM public.roles WHERE name = 'entity-user'),    (SELECT id FROM public.module_permissions WHERE name = 'PASSWORD_RECOVERY_LINK_REQUEST_OWN'), NOW()),
  ((SELECT id FROM public.roles WHERE name = 'entity-user'),    (SELECT id FROM public.module_permissions WHERE name = 'PASSWORD_RECOVERY_RESET_OWN'),       NOW()),
  ((SELECT id FROM public.roles WHERE name = 'entity-user'),    (SELECT id FROM public.module_permissions WHERE name = 'PROFILE_UPDATE_OWN'),                NOW()),

  -- platform-admin (everything)
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.module_permissions WHERE name = 'PASSWORD_RECOVERY_LINK_REQUEST_OWN'), NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.module_permissions WHERE name = 'PASSWORD_RECOVERY_RESET_OWN'),       NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.module_permissions WHERE name = 'PROFILE_UPDATE_OWN'),                NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.module_permissions WHERE name = 'ACCOUNT_CREATE_ANY'),                NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.module_permissions WHERE name = 'ACCOUNT_INVITE_OWNER'),              NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.module_permissions WHERE name = 'MODULE_MANAGEMENT'),                 NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.module_permissions WHERE name = 'ACCOUNT_REACTIVATION_REVIEW'),       NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.module_permissions WHERE name = 'ACCOUNT_UPDATE'),                    NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.module_permissions WHERE name = 'ACCOUNT_USER_MANAGEMENT'),           NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.module_permissions WHERE name = 'ACCOUNT_ENTITY_MANAGEMENT'),         NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.module_permissions WHERE name = 'USER_ACCOUNTS_INVITATION'),          NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.module_permissions WHERE name = 'USER_ENTITIES_INVITATION'),          NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.module_permissions WHERE name = 'USER_ROLE_ALLOCATION'),              NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.module_permissions WHERE name = 'ENTITY_CREATION'),                   NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.module_permissions WHERE name = 'ENTITY_USER_MANAGEMENT'),            NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.module_permissions WHERE name = 'ROLE_CUSTOM_MANAGEMENT'),            NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.module_permissions WHERE name = 'ORGANIZATION_CREATION'),             NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-admin'), (SELECT id FROM public.module_permissions WHERE name = 'ORGANIZATION_UPDATE'),               NOW()),

  -- platform-user (own profile + password recovery only)
  ((SELECT id FROM public.roles WHERE name = 'platform-user'),  (SELECT id FROM public.module_permissions WHERE name = 'PROFILE_UPDATE_OWN'),                NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-user'),  (SELECT id FROM public.module_permissions WHERE name = 'PASSWORD_RECOVERY_LINK_REQUEST_OWN'), NOW()),
  ((SELECT id FROM public.roles WHERE name = 'platform-user'),  (SELECT id FROM public.module_permissions WHERE name = 'PASSWORD_RECOVERY_RESET_OWN'),       NOW())
ON CONFLICT (role_id, permission_id) DO NOTHING;


------
-- 7. Create the technical guest user account
------
DO $$
DECLARE
  guest_user_id TEXT;
BEGIN
  INSERT INTO public.users (id, is_active, email, password, updated_at)
  VALUES ('clsystem00000000guest000000', TRUE, 'user@appguest.com', 'passwordNotUsed', NOW())
  ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
  RETURNING id INTO guest_user_id;

  INSERT INTO public.user_preferences (user_id, locale, updated_at)
  VALUES (guest_user_id, 'FR', NOW())
  ON CONFLICT (user_id) DO NOTHING;

  -- Guest is a PLATFORM-scoped role: assignment carries no account_id / entity_id.
  INSERT INTO public.users_roles_assignments (id, user_id, role_id, updated_at)
  VALUES (
    'clsystem00000000guest_assign_001',
    guest_user_id,
    (SELECT id FROM public.roles WHERE name = 'guest'),
    NOW()
  )
  ON CONFLICT DO NOTHING;
END $$;

------
-- Restore the exact mutable state of every system role that existed before
-- this dataset run. Roles first introduced by this version retain the defaults
-- seeded above; existing roles retain every administrator-managed grant.
------
DELETE FROM public.roles_permissions_links
WHERE role_id IN (SELECT id FROM sf_existing_system_roles);

DELETE FROM public.roles_sub_modules_links
WHERE role_id IN (SELECT id FROM sf_existing_system_roles);

DELETE FROM public.roles_modules_links
WHERE role_id IN (SELECT id FROM sf_existing_system_roles);

INSERT INTO public.roles_modules_links (role_id, module_id, created_at, updated_at)
SELECT role_id, module_id, created_at, updated_at
FROM sf_existing_role_modules;

INSERT INTO public.roles_sub_modules_links (role_id, sub_module_id, created_at, updated_at)
SELECT role_id, sub_module_id, created_at, updated_at
FROM sf_existing_role_sub_modules;

INSERT INTO public.roles_permissions_links (role_id, permission_id, created_at, updated_at)
SELECT role_id, permission_id, created_at, updated_at
FROM sf_existing_role_permissions;

UPDATE public.roles role
SET name = collision.name
FROM sf_colliding_custom_roles collision
WHERE role.id = collision.id;

COMMIT;
