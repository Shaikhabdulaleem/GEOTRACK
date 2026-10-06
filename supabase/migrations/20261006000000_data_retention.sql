-- PDPL-aligned data minimization / retention.
--
-- Precise location is the most sensitive personal data this system holds. The
-- attendance_events row is the audit trail for payroll, so instead of deleting
-- it we REDACT the precise coordinates, accuracy and raw device_info once the
-- retention window passes, while keeping the validation result and timestamps.
-- Operational data with no long-term purpose (notifications, phone-usage
-- monitoring) is purged outright. Attendance_records (the payroll summary, which
-- holds no raw GPS) is intentionally retained for labor-law record-keeping.
--
-- Applying this migration defines the function only; it deletes nothing. The
-- function runs on a schedule (see the pg_cron block below) or on manual call.

CREATE OR REPLACE FUNCTION private.enforce_data_retention(
  p_location_redaction_days integer DEFAULT 180,
  p_notification_days integer DEFAULT 365,
  p_phone_usage_days integer DEFAULT 365
)
RETURNS TABLE (
  locations_redacted bigint,
  notifications_purged bigint,
  phone_usage_purged bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_locations bigint := 0;
  v_notifications bigint := 0;
  v_phone bigint := 0;
BEGIN
  IF p_location_redaction_days < 1 OR p_notification_days < 1 OR p_phone_usage_days < 1 THEN
    RAISE EXCEPTION 'Retention windows must be positive day counts' USING errcode = '22023';
  END IF;

  UPDATE public.attendance_events
     SET location_point = NULL,
         accuracy_meters = NULL,
         device_info = '{}'::jsonb,
         device_id = NULL
   WHERE received_at < now() - make_interval(days => p_location_redaction_days)
     AND (location_point IS NOT NULL OR device_id IS NOT NULL OR device_info <> '{}'::jsonb);
  GET DIAGNOSTICS v_locations = ROW_COUNT;

  DELETE FROM public.notifications
   WHERE created_at < now() - make_interval(days => p_notification_days);
  GET DIAGNOSTICS v_notifications = ROW_COUNT;

  DELETE FROM public.phone_usage_records
   WHERE created_at < now() - make_interval(days => p_phone_usage_days);
  GET DIAGNOSTICS v_phone = ROW_COUNT;

  RETURN QUERY SELECT v_locations, v_notifications, v_phone;
END;
$$;

-- Only the service role / scheduler may run retention; never clients.
REVOKE ALL ON FUNCTION private.enforce_data_retention(integer, integer, integer)
  FROM PUBLIC, anon, authenticated;

-- Best-effort daily schedule. No-ops cleanly where pg_cron is unavailable or the
-- role lacks permission (e.g. local shadow DB); enable it in the Supabase
-- dashboard (Database > Extensions > pg_cron) and this will take effect, or run
-- the cron.schedule call below once by hand.
DO $cron$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'geotrack-data-retention',
    '30 2 * * *',
    $job$ SELECT private.enforce_data_retention(); $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not scheduled (%): enable pg_cron and schedule enforce_data_retention manually.', SQLERRM;
END;
$cron$;
