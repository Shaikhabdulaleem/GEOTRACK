-- Credentials are generated and delivered by Supabase Auth Admin API; this
-- migration stores only an auditable invitation record, never passwords or
-- reset/invite tokens.
CREATE TABLE IF NOT EXISTS public.employee_account_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES auth.users(id),
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_account_invitations_pending_idx
  ON public.employee_account_invitations(employee_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
ALTER TABLE public.employee_account_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_account_invitations_admin ON public.employee_account_invitations;
CREATE POLICY employee_account_invitations_admin ON public.employee_account_invitations
  FOR ALL TO authenticated
  USING (private.has_org_role(organization_id, ARRAY['administrator']))
  WITH CHECK (private.has_org_role(organization_id, ARRAY['administrator']) AND invited_by = auth.uid());

CREATE OR REPLACE FUNCTION public.request_employee_invitation(p_employee_id uuid)
RETURNS public.employee_account_invitations
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_row public.employee_account_invitations;
BEGIN
  INSERT INTO public.employee_account_invitations (organization_id, employee_id, invited_by)
  SELECT e.organization_id, e.id, auth.uid()
  FROM public.employee_profiles e
  WHERE e.id = p_employee_id AND e.user_id IS NULL
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Employee is already provisioned or not found' USING errcode = 'P0002'; END IF;
  RETURN v_row;
END; $$;
REVOKE ALL ON FUNCTION public.request_employee_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_employee_invitation(uuid) TO authenticated;

-- Employees may read their own identity only. Managers/admins may read
-- organization user identities needed for operations; this prevents an
-- employee from enumerating manager/admin profile data through users.
DROP POLICY IF EXISTS users_select ON public.users;
CREATE POLICY users_select ON public.users FOR SELECT TO authenticated
USING (
  id = (select auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.organization_memberships mine
    JOIN public.organization_memberships theirs
      ON theirs.organization_id = mine.organization_id
    WHERE mine.user_id = (select auth.uid())
      AND mine.status::text = 'active'
      AND mine.role_code::text IN ('administrator', 'manager')
      AND theirs.user_id = users.id
      AND theirs.status::text = 'active'
  )
);
