CREATE TRIGGER check_role_assignment_scope
  BEFORE INSERT OR UPDATE ON public.users_roles_assignments
  FOR EACH ROW
    EXECUTE PROCEDURE public.check_role_assignment_scope();
