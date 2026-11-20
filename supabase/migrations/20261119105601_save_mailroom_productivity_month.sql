create or replace function public.save_mailroom_productivity_month(
  p_organization_id uuid,
  p_days jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_day jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_previous_date date;
  v_work_date date;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) < 1 or jsonb_array_length(p_days) > 31 then
    raise exception 'Monthly import must contain between 1 and 31 daily entries' using errcode = '22023';
  end if;

  for v_day in select value from jsonb_array_elements(p_days)
  loop
    v_work_date := (v_day ->> 'work_date')::date;
    if v_work_date is null or (v_previous_date is not null and v_work_date <= v_previous_date) then
      raise exception 'Monthly import dates must be unique and in ascending order' using errcode = '22023';
    end if;

    v_result := public.save_mailroom_productivity_day(
      p_organization_id,
      v_work_date,
      v_day ->> 'status',
      coalesce(v_day -> 'clients', '[]'::jsonb),
      coalesce((v_day ->> 'returns_received')::bigint, 0),
      coalesce((v_day ->> 'returns_processed')::bigint, 0),
      coalesce(v_day -> 'dsp_allocations', '[]'::jsonb),
      v_day ->> 'notes'
    );
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'work_date', v_work_date,
      'result', v_result
    ));
    v_previous_date := v_work_date;
  end loop;

  return jsonb_build_object('saved_days', jsonb_array_length(v_results), 'days', v_results);
end;
$$;

revoke all on function public.save_mailroom_productivity_month(uuid, jsonb) from public, anon;
grant execute on function public.save_mailroom_productivity_month(uuid, jsonb) to authenticated;

comment on function public.save_mailroom_productivity_month(uuid, jsonb) is
  'Atomically saves an ordered batch of up to 31 Mailroom productivity days using the authenticated daily save workflow.';

notify pgrst, 'reload schema';
