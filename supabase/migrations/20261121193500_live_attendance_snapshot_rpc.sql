-- Migration: 20261121193500_live_attendance_snapshot_rpc.sql
--
-- Optimization: Server-side RPC for live shift workforce snapshot.
-- Replaces client-side bulk querying and manual iterating over thousands
-- of raw attendance_events, shift assignments, and weekly offs.

-- Index to optimize latest attendance_events per employee lookup
create index if not exists attendance_events_org_emp_event_idx
  on public.attendance_events (organization_id, employee_id, event_at desc);

create or replace function public.get_live_attendance_snapshot(
  p_organization_id uuid,
  p_date date default null,
  p_branch_id uuid default null,
  p_department_id uuid default null,
  p_shift_id uuid default null,
  p_manager_id uuid default null,
  p_employee_id uuid default null
)
returns table (
  id uuid,
  name text,
  employee_code text,
  department_id uuid,
  department_name text,
  shift text,
  shift_id uuid,
  shift_start text,
  shift_end text,
  crosses_midnight boolean,
  checkin timestamptz,
  checkout timestamptz,
  status text,
  attendance text,
  worked_minutes integer,
  inside boolean,
  is_off boolean,
  last_event_at timestamptz,
  latitude double precision,
  longitude double precision
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_date date;
  v_dow smallint;
  v_start_of_day_tz timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not private.has_org_role(p_organization_id, array['administrator', 'manager']) then
    raise exception 'Manager or administrator access required' using errcode = '42501';
  end if;

  select coalesce(nullif(timezone, ''), 'Asia/Riyadh')
  into v_tz
  from public.organizations
  where id = p_organization_id;

  if v_tz is null then
    v_tz := 'Asia/Riyadh';
  end if;

  if p_date is not null then
    v_date := p_date;
  else
    v_date := (clock_timestamp() at time zone v_tz)::date;
  end if;

  v_dow := extract(dow from v_date)::smallint;
  v_start_of_day_tz := (v_date::text || ' 00:00:00')::timestamp at time zone v_tz;

  return query
  with scoped_employees as (
    select
      ep.id,
      ep.full_name,
      ep.employee_code,
      ep.department_id,
      d.name as department_name,
      ep.employment_status,
      ep.joining_date,
      ep.created_at,
      ep.status_effective_date
    from public.employee_profiles ep
    left join public.departments d on d.id = ep.department_id and d.organization_id = ep.organization_id
    where ep.organization_id = p_organization_id
      and private.can_access_employee(ep.organization_id, ep.id)
      and (p_branch_id is null or ep.branch_id = p_branch_id)
      and (p_department_id is null or ep.department_id = p_department_id)
      and (p_manager_id is null or ep.manager_user_id = p_manager_id)
      and (p_employee_id is null or ep.id = p_employee_id)
  )
  select
    se.id,
    se.full_name as name,
    se.employee_code,
    se.department_id,
    coalesce(se.department_name, '—') as department_name,
    case
      when sa.status = 'off' or wo.id is not null then 'Week Off'
      else coalesce(sh.name, 'Day')
    end as shift,
    sa.shift_id,
    case
      when sh.start_time is not null then to_char(sh.start_time, 'HH24:MI')
      else '09:00'
    end as shift_start,
    case
      when sh.end_time is not null then to_char(sh.end_time, 'HH24:MI')
      else '17:00'
    end as shift_end,
    coalesce(sh.crosses_midnight, false) as crosses_midnight,
    ar.check_in_at as checkin,
    ar.check_out_at as checkout,
    case
      when ar.status in ('present', 'late') then initcap(ar.status)
      when sa.status = 'off' or wo.id is not null then 'Employee week Off'
      when ar.status = 'absent' then 'Absent'
      when ar.status is not null then 'Missing'
      when sa.status = 'off' or wo.id is not null then 'Employee week Off'
      else 'Absent'
    end as status,
    case
      when ar.status in ('present', 'late') then ar.status
      when sa.status = 'off' or wo.id is not null then 'Employee week Off'
      when ar.status = 'absent' then 'absent'
      when ar.status is not null then ar.status
      when sa.status = 'off' or wo.id is not null then 'Employee week Off'
      else 'absent'
    end as attendance,
    coalesce(
      ar.total_work_minutes,
      case
        when ar.check_in_at is not null then
          greatest(0, round(extract(epoch from (coalesce(ar.check_out_at, clock_timestamp()) - ar.check_in_at)) / 60)::integer)
        else 0
      end
    ) as worked_minutes,
    coalesce(ev.inside_geofence, false) as inside,
    (sa.status = 'off' or wo.id is not null) as is_off,
    ev.event_at as last_event_at,
    ev.latitude,
    ev.longitude
  from scoped_employees se
  left join public.attendance_records ar
    on ar.organization_id = p_organization_id
   and ar.employee_id = se.id
   and ar.attendance_date = v_date
  left join public.shift_assignments sa
    on sa.organization_id = p_organization_id
   and sa.employee_id = se.id
   and sa.work_date = v_date
  left join public.shifts sh
    on sh.id = sa.shift_id
  left join public.weekly_offs wo
    on wo.organization_id = p_organization_id
   and wo.employee_id = se.id
   and wo.weekday = v_dow
   and wo.effective_from <= v_date
   and (wo.effective_to is null or wo.effective_to >= v_date)
  left join lateral (
    select
      ae.inside_geofence,
      ae.event_at,
      (ae.location_point->'coordinates'->>1)::double precision as latitude,
      (ae.location_point->'coordinates'->>0)::double precision as longitude
    from public.attendance_events ae
    where ae.organization_id = p_organization_id
      and ae.employee_id = se.id
      and ae.event_at >= v_start_of_day_tz
    order by ae.event_at desc
    limit 1
  ) ev on true
  where
    -- Employee active filter or has attendance record today
    (
      ar.id is not null
      or (
        (se.joining_date is null or v_date >= se.joining_date)
        and (
          (se.employment_status = 'active' and (coalesce(se.status_effective_date, se.joining_date) is null or v_date >= coalesce(se.status_effective_date, se.joining_date)))
          or (se.employment_status in ('inactive', 'terminated') and se.status_effective_date is not null and se.status_effective_date <> coalesce(se.joining_date, se.created_at::date) and v_date <= se.status_effective_date)
          or (se.employment_status = 'on_leave')
        )
      )
    )
    and (p_shift_id is null or sa.shift_id = p_shift_id)
  order by
    case
      when ar.status in ('present', 'late') then 0
      when sa.status = 'off' or wo.id is not null then 3
      when ar.status = 'absent' then 2
      else 1
    end,
    se.full_name;
end;
$$;

revoke all on function public.get_live_attendance_snapshot(uuid, date, uuid, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.get_live_attendance_snapshot(uuid, date, uuid, uuid, uuid, uuid, uuid) to authenticated;
