-- One-shot cleanup for sessions the old auto-close (pre-20261015120000) wrongly
-- clocked out at the scheduled shift end while the employee was still inside the
-- fence. Those carry a 'gps_exit' event with metadata auto_closed=true and
-- reason='shift_end' (an actual departure is reason='early_exit' and is left
-- alone).
--
-- Scope is the last 18 hours so we only reopen current / just-ended shifts, not
-- ancient history. Reopening nulls the check-out, drops the bogus event, and
-- resets the check-out-derived minutes (they are recomputed on the real
-- check-out anyway). The fixed auto-close then correctly re-closes anyone who
-- has since left the fence (back-dated to their real exit); anyone still inside
-- stays open for a manual check-out.
DO $cleanup$
DECLARE
  v_reopened integer;
BEGIN
  WITH wrongly_closed AS (
    SELECT ar.id AS record_id, ar.check_out_event_id AS event_id
    FROM public.attendance_records ar
    JOIN public.attendance_events ae ON ae.id = ar.check_out_event_id
    WHERE ar.check_out_at IS NOT NULL
      AND (ae.metadata->>'auto_closed')::boolean IS TRUE
      AND ae.metadata->>'reason' = 'shift_end'
      AND ar.check_out_at >= now() - interval '18 hours'
  ), reopened AS (
    UPDATE public.attendance_records ar SET
      check_out_at = NULL,
      check_out_event_id = NULL,
      worked_minutes = 0,
      overtime_minutes = 0,
      early_leaving_minutes = 0,
      updated_at = now()
    FROM wrongly_closed wc
    WHERE ar.id = wc.record_id
    RETURNING wc.event_id
  )
  DELETE FROM public.attendance_events ae
  USING reopened r
  WHERE ae.id = r.event_id;

  GET DIAGNOSTICS v_reopened = ROW_COUNT;
  RAISE NOTICE 'Reopened % wrongly auto-closed attendance session(s).', v_reopened;
END;
$cleanup$;
