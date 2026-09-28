-----------------------------------------------------------------
-- Integrity functions for RBAC v2 grants (mirror check_role_assignment_scope).
--
-- 1. check_role_sub_module_grant — before insert/update on roles_sub_modules_links:
--    a role may only hold a sub-module whose parent module the role also holds
--    (via roles_modules_links).
--
-- 2. check_role_permission_grant — before insert/update on roles_permissions_links:
--    - a permission WITH a sub_module_id requires the role to hold that sub-module
--      (via roles_sub_modules_links);
--    - a permission WITHOUT a sub_module_id requires the role to hold its parent module
--      (via roles_modules_links).
-----------------------------------------------------------------

CREATE OR REPLACE
  FUNCTION public.check_role_sub_module_grant()
    RETURNS TRIGGER
    LANGUAGE plpgsql
  AS
$$
DECLARE
  parent_module_id INTEGER;
BEGIN
  SELECT module_id INTO parent_module_id FROM public.sub_modules WHERE id = NEW.sub_module_id;

  IF parent_module_id IS NULL THEN
    RAISE EXCEPTION 'Sub-module % not found', NEW.sub_module_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.roles_modules_links rml
    WHERE rml.role_id = NEW.role_id AND rml.module_id = parent_module_id
  ) THEN
    RAISE EXCEPTION 'Role % cannot hold sub-module % : its parent module % is not granted to the role', NEW.role_id, NEW.sub_module_id, parent_module_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE
  FUNCTION public.check_role_permission_grant()
    RETURNS TRIGGER
    LANGUAGE plpgsql
  AS
$$
DECLARE
  perm_module_id     INTEGER;
  perm_sub_module_id INTEGER;
BEGIN
  SELECT module_id, sub_module_id INTO perm_module_id, perm_sub_module_id
  FROM public.module_permissions WHERE id = NEW.permission_id;

  IF perm_module_id IS NULL THEN
    RAISE EXCEPTION 'Permission % not found', NEW.permission_id;
  END IF;

  IF perm_sub_module_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.roles_sub_modules_links rsml
      WHERE rsml.role_id = NEW.role_id AND rsml.sub_module_id = perm_sub_module_id
    ) THEN
      RAISE EXCEPTION 'Role % cannot hold permission % : its sub-module % is not granted to the role', NEW.role_id, NEW.permission_id, perm_sub_module_id;
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.roles_modules_links rml
      WHERE rml.role_id = NEW.role_id AND rml.module_id = perm_module_id
    ) THEN
      RAISE EXCEPTION 'Role % cannot hold permission % : its module % is not granted to the role', NEW.role_id, NEW.permission_id, perm_module_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
