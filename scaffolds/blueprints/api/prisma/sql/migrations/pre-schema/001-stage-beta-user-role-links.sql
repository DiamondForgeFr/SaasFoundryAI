-- Preserve the 1.0.0-beta flat user/role links before Prisma replaces their
-- public table with the scoped assignment model. The private staging schema is
-- deliberately outside Prisma's managed `public` schema and is removed by the
-- matching post-schema migration only after every source link was converted.
DO $$
DECLARE
  source_count BIGINT;
  staged_count BIGINT;
BEGIN
  IF to_regclass('public.users_roles_links') IS NULL THEN
    RETURN;
  END IF;

  CREATE SCHEMA IF NOT EXISTS saasfoundry_migration;
  CREATE TABLE IF NOT EXISTS saasfoundry_migration.beta_user_role_links (
    user_id         TEXT NOT NULL,
    role_id         INTEGER NOT NULL,
    role_name       TEXT NOT NULL,
    role_account_id TEXT,
    created_at      TIMESTAMP(3) NOT NULL,
    updated_at      TIMESTAMP(3) NOT NULL,
    PRIMARY KEY (user_id, role_id)
  );

  INSERT INTO saasfoundry_migration.beta_user_role_links (
    user_id,
    role_id,
    role_name,
    role_account_id,
    created_at,
    updated_at
  )
  SELECT links.user_id, links.role_id, roles.name, roles.account_id, links.created_at, links.updated_at
  FROM public.users_roles_links links
  INNER JOIN public.roles roles ON roles.id = links.role_id
  ON CONFLICT (user_id, role_id) DO UPDATE
  SET role_name = EXCLUDED.role_name,
      role_account_id = EXCLUDED.role_account_id,
      created_at = EXCLUDED.created_at,
      updated_at = EXCLUDED.updated_at;

  SELECT COUNT(*) INTO source_count FROM public.users_roles_links;
  SELECT COUNT(*) INTO staged_count FROM saasfoundry_migration.beta_user_role_links;
  IF staged_count <> source_count THEN
    RAISE EXCEPTION 'Refusing to replace users_roles_links: staged % of % beta assignments', staged_count, source_count;
  END IF;

  -- Prisma may now create users_roles_assignments without being authorized to
  -- discard the legacy table. The staged count above is the destructive gate.
  DROP TABLE public.users_roles_links;
END $$;
