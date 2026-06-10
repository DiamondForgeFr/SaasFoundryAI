CREATE TRIGGER check_role_sub_module_grant
  BEFORE INSERT OR UPDATE ON public.roles_sub_modules_links
  FOR EACH ROW
    EXECUTE PROCEDURE public.check_role_sub_module_grant();

CREATE TRIGGER check_role_permission_grant
  BEFORE INSERT OR UPDATE ON public.roles_permissions_links
  FOR EACH ROW
    EXECUTE PROCEDURE public.check_role_permission_grant();
