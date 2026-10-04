-- Retire the anonymous identifier -> Auth email resolver. Login uses the
-- same work-email/password contract on Web and Android and never exposes
-- account emails to unauthenticated callers.
DROP FUNCTION IF EXISTS public.resolve_login_email(text);
