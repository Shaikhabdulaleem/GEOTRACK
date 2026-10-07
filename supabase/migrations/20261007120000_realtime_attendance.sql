-- Enable Supabase Realtime for the live attendance monitor. The web dashboard
-- subscribes to attendance_records changes (scoped by organization_id) so the
-- Live Shift Monitor updates as employees check in/out without a page reload.
-- Delivery still respects RLS, so a subscriber only receives rows its policies
-- already allow it to SELECT.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'attendance_records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_records;
  END IF;
END $$;

-- REPLICA IDENTITY FULL so UPDATE/DELETE events carry enough columns for
-- client-side organization_id filtering to match reliably.
ALTER TABLE public.attendance_records REPLICA IDENTITY FULL;
