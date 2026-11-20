-- Restore the dashboard's seven-day trend RPC without applying the unrelated
-- operations changes from the broader hardening migration.
create or replace function public.get_dashboard_trends(
  p_organization_id uuid,
  p_end_date date,
  p_days integer default 7,
  p_branch_id uuid default null,
  p_department_id uuid default null,
  p_shift_id uuid default null,
  p_manager_id uuid default null,
  p_employee_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start_date date;
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator', 'manager']) then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;
  if p_end_date is null or p_days is null or p_days < 1 or p_days > 366 then
    raise exception 'Invalid reporting date range' using errcode = '22023';
  end if;
  v_start_date := p_end_date - (p_days - 1);

  with recursive
  dates as (
    select generate_series(v_start_date, p_end_date, interval '1 day')::date as work_date
  ),
  scoped_employees as materialized (
    select ep.id, ep.branch_id, ep.department_id,
           coalesce(nullif(b.timezone, ''), nullif(o.timezone, ''), 'UTC') as timezone
    from public.employee_profiles ep
    join public.organizations o on o.id = ep.organization_id
    left join public.branches b
      on b.id = ep.branch_id and b.organization_id = ep.organization_id
    where ep.organization_id = p_organization_id
      and ep.employment_status::text = 'active'
      and private.can_access_employee(ep.organization_id, ep.id)
      and (p_branch_id is null or ep.branch_id = p_branch_id)
      and (p_department_id is null or ep.department_id = p_department_id)
      and (p_manager_id is null or ep.manager_user_id = p_manager_id)
      and (p_employee_id is null or ep.id = p_employee_id)
  ),
  attendance as (
    select ar.attendance_date as work_date,
           count(*) filter (where ar.status::text in ('present', 'late'))::integer as present,
           count(*) filter (where ar.status::text = 'late')::integer as late,
           count(*) filter (where ar.status::text = 'absent')::integer as absent,
           count(*) filter (where ar.status::text in ('missing_check_in', 'missing_check_out'))::integer as missing,
           coalesce(sum(ar.worked_minutes), 0)::integer as worked_minutes,
           coalesce(sum(ar.overtime_minutes), 0)::integer as overtime_minutes
    from public.attendance_records ar
    join scoped_employees se on se.id = ar.employee_id
    left join public.shift_assignments sa on sa.id = ar.shift_assignment_id
    where ar.organization_id = p_organization_id
      and ar.attendance_date between v_start_date and p_end_date
      and (p_shift_id is null or sa.shift_id = p_shift_id)
    group by ar.attendance_date
  ),
  productivity as (
    select pr.work_date,
           case when sum(pr.target_units) > 0
             then round(sum(pr.actual_units)::numeric / sum(pr.target_units)::numeric * 100, 1)
             else null
           end as productivity_percent
    from public.productivity_records pr
    join scoped_employees se on se.id = pr.employee_id
    left join public.shift_assignments sa on sa.id = pr.shift_assignment_id
    where pr.organization_id = p_organization_id
      and pr.work_date between v_start_date and p_end_date
      and (p_shift_id is null or sa.shift_id = p_shift_id)
    group by pr.work_date
  ),
  geofence_events as (
    select (ae.event_at at time zone se.timezone)::date as work_date,
           count(*)::integer as violations
    from public.attendance_events ae
    join scoped_employees se on se.id = ae.employee_id
    left join public.shift_assignments sa
      on sa.organization_id = ae.organization_id
     and sa.employee_id = ae.employee_id
     and sa.work_date = (ae.event_at at time zone se.timezone)::date
    where ae.organization_id = p_organization_id
      and ae.event_at >= (v_start_date::timestamp at time zone 'UTC') - interval '1 day'
      and ae.event_at < ((p_end_date + 1)::timestamp at time zone 'UTC') + interval '1 day'
      and ae.inside_geofence is false
      and (p_shift_id is null or sa.shift_id = p_shift_id)
    group by (ae.event_at at time zone se.timezone)::date
  )
  select jsonb_build_object(
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', d.work_date,
        'day', to_char(d.work_date, 'Dy'),
        'present', coalesce(a.present, 0),
        'late', coalesce(a.late, 0),
        'absent', coalesce(a.absent, 0),
        'missing', coalesce(a.missing, 0),
        'workedHours', round(coalesce(a.worked_minutes, 0)::numeric / 60, 1)
      ) order by d.work_date)
      from dates d left join attendance a using (work_date)
    ), '[]'::jsonb),
    'overtime', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', d.work_date,
        'day', to_char(d.work_date, 'Dy'),
        'hours', round(coalesce(a.overtime_minutes, 0)::numeric / 60, 1)
      ) order by d.work_date)
      from dates d left join attendance a using (work_date)
    ), '[]'::jsonb),
    'productivity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', d.work_date,
        'day', to_char(d.work_date, 'Dy'),
        'productivity', p.productivity_percent,
        'available', p.productivity_percent is not null
      ) order by d.work_date)
      from dates d left join productivity p using (work_date)
    ), '[]'::jsonb),
    'geofence', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', d.work_date,
        'day', to_char(d.work_date, 'Dy'),
        'violations', coalesce(g.violations, 0)
      ) order by d.work_date)
      from dates d left join geofence_events g using (work_date)
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_dashboard_trends(
  uuid, date, integer, uuid, uuid, uuid, uuid, uuid
) from public, anon;
grant execute on function public.get_dashboard_trends(
  uuid, date, integer, uuid, uuid, uuid, uuid, uuid
) to authenticated;
