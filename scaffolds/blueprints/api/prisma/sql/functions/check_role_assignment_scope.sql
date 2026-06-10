-----------------------------------------------------------------
-- Function triggered before insert/update on user_role_assignment
-- to enforce that the assignment's account_id / entity_id columns
-- match the scope declared on the referenced role:
--   role.scope = PLATFORM ⇒ account_id IS NULL AND entity_id IS NULL
--   role.scope = ACCOUNT  ⇒ account_id IS NOT NULL AND entity_id IS NULL
--   role.scope = ENTITY   ⇒ account_id IS NULL AND entity_id IS NOT NULL
-----------------------------------------------------------------

CREATE OR REPLACE
  FUNCTION public.check_role_assignment_scope()
    RETURNS TRIGGER
    LANGUAGE plpgsql
  AS
$$
DECLARE
  role_scope public.role_scope;
BEGIN
  SELECT scope INTO role_scope FROM public.roles WHERE id = NEW.role_id;

  IF role_scope IS NULL THEN
    RAISE EXCEPTION 'Role % not found', NEW.role_id;
  END IF;

  IF role_scope = 'PLATFORM' AND (NEW.account_id IS NOT NULL OR NEW.entity_id IS NOT NULL) THEN
    RAISE EXCEPTION 'PLATFORM role assignment must have account_id and entity_id NULL';
  END IF;

  IF role_scope = 'ACCOUNT' AND (NEW.account_id IS NULL OR NEW.entity_id IS NOT NULL) THEN
    RAISE EXCEPTION 'ACCOUNT role assignment requires account_id (entity_id must be NULL)';
  END IF;

  IF role_scope = 'ENTITY' AND (NEW.entity_id IS NULL OR NEW.account_id IS NOT NULL) THEN
    RAISE EXCEPTION 'ENTITY role assignment requires entity_id (account_id must be NULL)';
  END IF;

  RETURN NEW;
END;
$$;
