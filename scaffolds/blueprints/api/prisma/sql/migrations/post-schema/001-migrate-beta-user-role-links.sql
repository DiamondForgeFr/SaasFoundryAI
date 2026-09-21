-- Convert every staged 1.0.0-beta flat user/role link after Prisma has created
-- the scoped assignment table and the current dataset has installed canonical
-- system roles. A source link without a safe scope mapping aborts the update;
-- it is never silently discarded.
DO $$
DECLARE
  legacy RECORD;
  target_role_id INTEGER;
  target_scope public.role_scope;
  target_account_id TEXT;
  target_entity_id TEXT;
  migrated_count INTEGER;
BEGIN
  IF to_regclass('saasfoundry_migration.beta_user_role_links') IS NULL THEN
    RETURN;
  END IF;

  FOR legacy IN
    SELECT *
    FROM saasfoundry_migration.beta_user_role_links
    ORDER BY user_id, role_id
  LOOP
    migrated_count := 0;
    target_account_id := NULL;
    target_entity_id := NULL;

    IF legacy.role_name = 'guest' THEN
      SELECT id, scope INTO target_role_id, target_scope
      FROM public.roles
      WHERE name = 'guest' AND account_id IS NULL;

      IF target_role_id IS NULL OR target_scope <> 'PLATFORM' THEN
        RAISE EXCEPTION 'Cannot migrate beta guest role % for user %: canonical PLATFORM role is missing', legacy.role_id, legacy.user_id;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM public.users_roles_assignments
        WHERE user_id = legacy.user_id AND role_id = target_role_id AND account_id IS NULL AND entity_id IS NULL
      ) THEN
        INSERT INTO public.users_roles_assignments (id, user_id, role_id, account_id, entity_id, created_at, updated_at)
        VALUES ('sfmig_' || md5(legacy.user_id || ':' || legacy.role_id || ':platform'), legacy.user_id, target_role_id, NULL, NULL, legacy.created_at, legacy.updated_at)
        ON CONFLICT DO NOTHING;
      END IF;
      SELECT COUNT(*) INTO migrated_count
      FROM public.users_roles_assignments
      WHERE user_id = legacy.user_id AND role_id = target_role_id AND account_id IS NULL AND entity_id IS NULL;
    ELSE
      IF legacy.role_name = 'user' THEN
        SELECT id, scope INTO target_role_id, target_scope
        FROM public.roles
        WHERE name = 'account-user' AND account_id IS NULL;
      ELSIF legacy.role_name = 'admin' THEN
        SELECT id, scope INTO target_role_id, target_scope
        FROM public.roles
        WHERE name = 'account-admin' AND account_id IS NULL;
      ELSE
        SELECT id, scope INTO target_role_id, target_scope
        FROM public.roles
        WHERE id = legacy.role_id;
      END IF;

      IF target_role_id IS NULL THEN
        RAISE EXCEPTION 'Cannot migrate beta role % (%) for user %: target role is missing', legacy.role_id, legacy.role_name, legacy.user_id;
      END IF;

      IF target_scope = 'PLATFORM' THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.users_roles_assignments
          WHERE user_id = legacy.user_id AND role_id = target_role_id AND account_id IS NULL AND entity_id IS NULL
        ) THEN
          INSERT INTO public.users_roles_assignments (id, user_id, role_id, account_id, entity_id, created_at, updated_at)
          VALUES ('sfmig_' || md5(legacy.user_id || ':' || legacy.role_id || ':platform'), legacy.user_id, target_role_id, NULL, NULL, legacy.created_at, legacy.updated_at)
          ON CONFLICT DO NOTHING;
        END IF;
        SELECT COUNT(*) INTO migrated_count
        FROM public.users_roles_assignments
        WHERE user_id = legacy.user_id AND role_id = target_role_id AND account_id IS NULL AND entity_id IS NULL;
      ELSIF target_scope = 'ACCOUNT' THEN
        FOR target_account_id IN
          SELECT account_id
          FROM public.users_accounts_links
          WHERE user_id = legacy.user_id
            AND (legacy.role_account_id IS NULL OR account_id = legacy.role_account_id)
          ORDER BY account_id
        LOOP
          IF NOT EXISTS (
            SELECT 1 FROM public.users_roles_assignments
            WHERE user_id = legacy.user_id AND role_id = target_role_id AND account_id = target_account_id AND entity_id IS NULL
          ) THEN
            INSERT INTO public.users_roles_assignments (id, user_id, role_id, account_id, entity_id, created_at, updated_at)
            VALUES (
              'sfmig_' || md5(legacy.user_id || ':' || legacy.role_id || ':account:' || target_account_id),
              legacy.user_id,
              target_role_id,
              target_account_id,
              NULL,
              legacy.created_at,
              legacy.updated_at
            )
            ON CONFLICT DO NOTHING;
          END IF;
          IF EXISTS (
            SELECT 1 FROM public.users_roles_assignments
            WHERE user_id = legacy.user_id AND role_id = target_role_id AND account_id = target_account_id AND entity_id IS NULL
          ) THEN
            migrated_count := migrated_count + 1;
          END IF;
        END LOOP;
      ELSIF target_scope = 'ENTITY' THEN
        FOR target_entity_id IN
          SELECT entity_id
          FROM public.users_entities_links
          WHERE user_id = legacy.user_id
          ORDER BY entity_id
        LOOP
          IF NOT EXISTS (
            SELECT 1 FROM public.users_roles_assignments
            WHERE user_id = legacy.user_id AND role_id = target_role_id AND account_id IS NULL AND entity_id = target_entity_id
          ) THEN
            INSERT INTO public.users_roles_assignments (id, user_id, role_id, account_id, entity_id, created_at, updated_at)
            VALUES (
              'sfmig_' || md5(legacy.user_id || ':' || legacy.role_id || ':entity:' || target_entity_id),
              legacy.user_id,
              target_role_id,
              NULL,
              target_entity_id,
              legacy.created_at,
              legacy.updated_at
            )
            ON CONFLICT DO NOTHING;
          END IF;
          IF EXISTS (
            SELECT 1 FROM public.users_roles_assignments
            WHERE user_id = legacy.user_id AND role_id = target_role_id AND account_id IS NULL AND entity_id = target_entity_id
          ) THEN
            migrated_count := migrated_count + 1;
          END IF;
        END LOOP;
      END IF;
    END IF;

    IF migrated_count = 0 THEN
      RAISE EXCEPTION 'Cannot safely scope beta role % (%) for user %; source link was retained in saasfoundry_migration.beta_user_role_links', legacy.role_id, legacy.role_name, legacy.user_id;
    END IF;
  END LOOP;

  DROP TABLE saasfoundry_migration.beta_user_role_links;
  DROP SCHEMA saasfoundry_migration;
END $$;
