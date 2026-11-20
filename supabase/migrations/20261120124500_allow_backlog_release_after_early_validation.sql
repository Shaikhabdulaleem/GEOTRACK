-- Aymakan occasionally records validation before the shipment receiving date.
-- Processing remains counted on Validation Date, while backlog is released only
-- after the shipment is received. Those two legitimate events can therefore
-- occur on different days, so the daily release need not be <= daily processed.
do $$
declare
  v_function regprocedure := 'public.save_mailroom_productivity_day(uuid,date,text,jsonb,bigint,bigint,jsonb,text)'::regprocedure;
  v_definition text;
  v_updated text;
begin
  v_definition := pg_get_functiondef(v_function);
  v_updated := regexp_replace(
    v_definition,
    E'\\n\\s*and coalesce\\(x\\.backlog_released_units, x\\.processed_units\\) <= x\\.processed_units',
    '',
    'i'
  );

  if v_updated <> v_definition then
    execute v_updated;
  end if;
end;
$$;

comment on function public.save_mailroom_productivity_day(uuid, date, text, jsonb, bigint, bigint, jsonb, text) is
  'Atomically saves one Mailroom day. Backlog release may occur after an earlier processing event; cumulative backlog must remain nonnegative.';

notify pgrst, 'reload schema';
