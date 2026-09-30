-- Allow unauthenticated clients to resolve an employee ID or Iqama number into an Auth email
-- This bridges the gap between GoTrue (which requires email/phone) and the custom login requirement

CREATE OR REPLACE FUNCTION public.resolve_login_email(p_identifier text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.email
  FROM public.employee_profiles ep
  JOIN auth.users u ON u.id = ep.user_id
  WHERE lower(ep.employee_code) = lower(p_identifier) 
     OR ep.iqama_number = p_identifier
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_login_email(text) TO anon, authenticated;
