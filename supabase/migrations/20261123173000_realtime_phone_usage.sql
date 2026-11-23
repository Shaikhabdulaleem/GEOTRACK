-- Enable Supabase Realtime for phone_usage_records so that the Device Usage
-- view immediately updates in real-time when native mobile telemetry syncs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'phone_usage_records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.phone_usage_records;
  END IF;
END $$;

-- REPLICA IDENTITY FULL so UPDATE/DELETE events carry enough columns for
-- client-side organization_id filtering to match reliably.
ALTER TABLE public.phone_usage_records REPLICA IDENTITY FULL;
