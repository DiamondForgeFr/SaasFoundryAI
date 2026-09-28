-- Align destructive 1.0.0-beta schema changes before Prisma compares the
-- database with the current schema. Every destructive operation is gated by
-- an explicit invariant so a project with ambiguous legacy data stops with an
-- actionable error instead of relying on `prisma db push --accept-data-loss`.

DO $$
DECLARE
  overlong_count BIGINT;
  longest_name INTEGER;
BEGIN
  IF to_regclass('public.accounts') IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*), MAX(char_length(name))
  INTO overlong_count, longest_name
  FROM public.accounts
  WHERE char_length(name) > 100;

  IF overlong_count > 0 THEN
    RAISE EXCEPTION 'Cannot narrow accounts.name to varchar(100): % row(s) exceed 100 characters (maximum is %). Shorten those account names and retry.', overlong_count, longest_name;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'accounts'
      AND column_name = 'name'
      AND data_type <> 'character varying'
  ) THEN
    ALTER TABLE public.accounts
      ALTER COLUMN name TYPE VARCHAR(100) USING name::VARCHAR(100);
  END IF;
END $$;

DO $$
DECLARE
  row_count_before BIGINT;
  row_count_after BIGINT;
  distinct_pair_count BIGINT;
  duplicate_pair_count BIGINT;
  null_pair_count BIGINT;
BEGIN
  IF to_regclass('public.roles_modules_links') IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*),
         COUNT(DISTINCT (role_id, module_id)),
         COUNT(*) FILTER (WHERE role_id IS NULL OR module_id IS NULL)
  INTO row_count_before, distinct_pair_count, null_pair_count
  FROM public.roles_modules_links;

  SELECT COUNT(*)
  INTO duplicate_pair_count
  FROM (
    SELECT role_id, module_id
    FROM public.roles_modules_links
    GROUP BY role_id, module_id
    HAVING COUNT(*) > 1
  ) duplicates;

  IF null_pair_count > 0 THEN
    RAISE EXCEPTION 'Cannot replace roles_modules_links.id with the (role_id, module_id) primary key: % row(s) contain a NULL key component.', null_pair_count;
  END IF;
  IF distinct_pair_count <> row_count_before OR duplicate_pair_count > 0 THEN
    RAISE EXCEPTION 'Cannot replace roles_modules_links.id with the (role_id, module_id) primary key: % row(s), % distinct pair(s), % duplicated pair(s). Deduplicate the legacy links and retry.', row_count_before, distinct_pair_count, duplicate_pair_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'roles_modules_links'
      AND column_name = 'id'
  ) THEN
    ALTER TABLE public.roles_modules_links
      DROP CONSTRAINT IF EXISTS roles_modules_links_pkey,
      DROP CONSTRAINT IF EXISTS roles_modules_links_role_id_module_id_key,
      DROP COLUMN id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.roles_modules_links'::regclass
      AND conname = 'roles_modules_links_pkey'
      AND contype = 'p'
  ) THEN
    ALTER TABLE public.roles_modules_links
      ADD CONSTRAINT roles_modules_links_pkey PRIMARY KEY (role_id, module_id);
  END IF;

  SELECT COUNT(*) INTO row_count_after FROM public.roles_modules_links;
  IF row_count_after <> row_count_before THEN
    RAISE EXCEPTION 'roles_modules_links conversion changed the row count from % to %; transaction aborted.', row_count_before, row_count_after;
  END IF;
END $$;

DO $$
DECLARE
  organization_conflicts BIGINT;
  entity_conflicts BIGINT;
  source_pair_count BIGINT;
  migrated_pair_count BIGINT;
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RETURN;
  END IF;

  CREATE TEMP TABLE sf_organization_entity_pairs (
    organization_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    PRIMARY KEY (organization_id, entity_id)
  ) ON COMMIT DROP;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'entity_id'
  ) THEN
    INSERT INTO sf_organization_entity_pairs (organization_id, entity_id)
    SELECT id, entity_id FROM public.organizations WHERE entity_id IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'entities' AND column_name = 'organization_id'
  ) THEN
    INSERT INTO sf_organization_entity_pairs (organization_id, entity_id)
    SELECT organization_id, id FROM public.entities WHERE organization_id IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;

  IF to_regclass('public.organizations_entities_links') IS NOT NULL THEN
    INSERT INTO sf_organization_entity_pairs (organization_id, entity_id)
    SELECT organization_id, entity_id FROM public.organizations_entities_links
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT COUNT(*) INTO organization_conflicts
  FROM (
    SELECT organization_id
    FROM sf_organization_entity_pairs
    GROUP BY organization_id
    HAVING COUNT(DISTINCT entity_id) > 1
  ) conflicts;
  IF organization_conflicts > 0 THEN
    RAISE EXCEPTION 'Cannot migrate organizations.entity_id: % organization(s) are linked to multiple entities. Resolve those beta links and retry.', organization_conflicts;
  END IF;

  SELECT COUNT(*) INTO entity_conflicts
  FROM (
    SELECT entity_id
    FROM sf_organization_entity_pairs
    GROUP BY entity_id
    HAVING COUNT(DISTINCT organization_id) > 1
  ) conflicts;
  IF entity_conflicts > 0 THEN
    RAISE EXCEPTION 'Cannot enforce organizations_entity_id_key: % entity/entities are linked to multiple organizations. Resolve those beta links and retry.', entity_conflicts;
  END IF;

  SELECT COUNT(*) INTO source_pair_count FROM sf_organization_entity_pairs;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'entity_id'
  ) THEN
    ALTER TABLE public.organizations ADD COLUMN entity_id TEXT;
  END IF;

  UPDATE public.organizations organization
  SET entity_id = pair.entity_id
  FROM sf_organization_entity_pairs pair
  WHERE organization.id = pair.organization_id
    AND organization.entity_id IS DISTINCT FROM pair.entity_id;

  SELECT COUNT(*) INTO migrated_pair_count
  FROM sf_organization_entity_pairs pair
  INNER JOIN public.organizations organization
    ON organization.id = pair.organization_id
   AND organization.entity_id = pair.entity_id;
  IF migrated_pair_count <> source_pair_count THEN
    RAISE EXCEPTION 'Cannot migrate organizations.entity_id: preserved % of % validated beta relationship(s). Transaction aborted.', migrated_pair_count, source_pair_count;
  END IF;

  -- Prisma represents @unique as a standalone unique index, whereas older
  -- beta schemas may expose the same invariant as a UNIQUE constraint. Both
  -- own the relation name below and both satisfy the target schema.
  IF to_regclass('public.organizations_entity_id_key') IS NULL THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_entity_id_key UNIQUE (entity_id);
  ELSIF NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid = 'public.organizations_entity_id_key'::regclass
      AND indrelid = 'public.organizations'::regclass
      AND indisunique
      AND indisvalid
      AND indisready
      AND indpred IS NULL
      AND indexprs IS NULL
      AND indnkeyatts = 1
      AND indnatts = 1
      AND indkey[0] = (
        SELECT attnum
        FROM pg_attribute
        WHERE attrelid = 'public.organizations'::regclass
          AND attname = 'entity_id'
          AND NOT attisdropped
      )
  ) THEN
    RAISE EXCEPTION 'Cannot enforce organizations.entity_id uniqueness: public.organizations_entity_id_key is not one valid, unqualified unique key on public.organizations(entity_id).';
  END IF;

  IF to_regclass('public.organizations_entities_links') IS NOT NULL THEN
    DROP TABLE public.organizations_entities_links;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'entities' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE public.entities DROP COLUMN organization_id;
  END IF;
END $$;

DO $$
DECLARE
  duplicate_pair_count BIGINT;
BEGIN
  IF to_regclass('public.roles') IS NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO duplicate_pair_count
  FROM (
    SELECT name, account_id
    FROM public.roles
    GROUP BY name, account_id
    HAVING COUNT(*) > 1
  ) duplicates;
  IF duplicate_pair_count > 0 THEN
    RAISE EXCEPTION 'Cannot enforce roles_name_account_id_key: % duplicated (name, account_id) pair(s) exist. Rename or merge those roles and retry.', duplicate_pair_count;
  END IF;

  IF to_regclass('public.roles_name_account_id_key') IS NULL THEN
    ALTER TABLE public.roles
      ADD CONSTRAINT roles_name_account_id_key UNIQUE (name, account_id);
  ELSIF NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid = 'public.roles_name_account_id_key'::regclass
      AND indrelid = 'public.roles'::regclass
      AND indisunique
      AND indisvalid
      AND indisready
      AND indpred IS NULL
      AND indexprs IS NULL
      AND indnkeyatts = 2
      AND indnatts = 2
      AND indkey[0] = (
        SELECT attnum
        FROM pg_attribute
        WHERE attrelid = 'public.roles'::regclass
          AND attname = 'name'
          AND NOT attisdropped
      )
      AND indkey[1] = (
        SELECT attnum
        FROM pg_attribute
        WHERE attrelid = 'public.roles'::regclass
          AND attname = 'account_id'
          AND NOT attisdropped
      )
  ) THEN
    RAISE EXCEPTION 'Cannot enforce role name/account uniqueness: public.roles_name_account_id_key is not one valid, unqualified unique key on public.roles(name, account_id).';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.roles'::regclass
      AND conname = 'roles_name_key'
      AND contype = 'u'
  ) THEN
    ALTER TABLE public.roles DROP CONSTRAINT roles_name_key;
  ELSIF to_regclass('public.roles_name_key') IS NOT NULL THEN
    DROP INDEX public.roles_name_key;
  END IF;
END $$;
