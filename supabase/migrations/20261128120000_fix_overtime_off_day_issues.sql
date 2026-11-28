-- Ensure list_overtime_review_employees only counts attendance_records issues on scheduled working days,
-- so off-days (e.g. Sunday) with an absent record are not flagged as attendance issues.
create or replace function public.list_overtime_review_employees(
  p_organization_id uuid,
  p_from_date date,
  p_to_date date,
  p_search text default null,
  p_branch_id uuid default null,
  p_department_id uuid default null,
  p_overtime_status text default null,
  p_attendance_issue text default null,
  p_device_status text default null,
  p_action_required boolean default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  employee_id uuid,
  employee_code text,
  full_name text,
  job_title text,
  branch_id uuid,
  branch_name text,
  department_id uuid,
  department_name text,
  worked_days bigint,
  worked_minutes bigint,
  pending_count bigint,
  pending_minutes bigint,
  approved_minutes bigint,
  attendance_issue_count bigint,
  average_device_usage_percent numeric,
  average_productivity_percent numeric,
  action_required boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_from_date is null or p_to_date is null or p_to_date < p_from_date
     or p_to_date - p_from_date > 89 then
    raise exception 'Overtime review range must contain 1 to 90 days' using errcode = '22023';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator', 'manager']) then
    raise exception 'Overtime review access denied' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 100 or p_offset < 0 then
    raise exception 'Invalid pagination' using errcode = '22023';
  end if;

  return query
  with attendance as (
    select ar.employee_id,
      count(*) filter (where ar.worked_minutes > 0)::bigint as worked_days,
      coalesce(sum(ar.worked_minutes), 0)::bigint as worked_minutes,
      count(*) filter (
        where (
          ar.status::text in ('absent', 'missing_check_in', 'missing_check_out', 'invalid')
          or ar.check_in_at is null or ar.check_out_at is null or ar.check_out_at <= ar.check_in_at
          or (ar.worked_minutes = 0 and ar.missing_minutes > 0)
        )
        and exists (
          select 1
          from private.resolve_employee_schedule_internal(ar.employee_id, ar.attendance_date, ar.attendance_date) s
          where s.state = 'working'
        )
      )::bigint as issue_count
    from public.attendance_records ar
    where ar.organization_id = p_organization_id
      and ar.attendance_date between p_from_date and p_to_date
    group by ar.employee_id
  ), schedule_issues as (
    select e.id as employee_id, count(*)::bigint as issue_count
    from public.employee_profiles e
    cross join lateral private.resolve_employee_schedule_internal(e.id, p_from_date, p_to_date) s
    where e.organization_id = p_organization_id
      and e.employment_status::text = 'active'
      and private.can_access_employee(p_organization_id, e.id)
      and s.state = 'working'
      and not exists (
        select 1 from public.attendance_records ar
        where ar.organization_id = p_organization_id and ar.employee_id = e.id
          and ar.attendance_date = s.work_date
      )
    group by e.id
  ), overtime as (
    select ot.employee_id,
      count(*) filter (where ot.status::text = 'pending')::bigint as pending_count,
      coalesce(sum(ot.requested_minutes) filter (where ot.status::text = 'pending'), 0)::bigint as pending_minutes,
      coalesce(sum(ot.approved_minutes) filter (where ot.status::text = 'approved'), 0)::bigint as approved_minutes,
      bool_or(ot.status::text = coalesce(nullif(p_overtime_status, ''), ot.status::text)) as status_match
    from public.overtime_records ot
    join public.attendance_records ar on ar.id = ot.attendance_record_id
    where ot.organization_id = p_organization_id
      and ar.attendance_date between p_from_date and p_to_date
    group by ot.employee_id
  ), device as (
    select pu.employee_id, avg(pu.usage_percentage)::numeric(8,2) as average_usage
    from public.phone_usage_records pu
    where pu.organization_id = p_organization_id
      and pu.work_date between p_from_date and p_to_date
      and pu.usage_percentage is not null
    group by pu.employee_id
  ), productivity as (
    select pr.employee_id, avg(pr.productivity_percent)::numeric(8,2) as average_productivity
    from public.productivity_records pr
    where pr.organization_id = p_organization_id
      and pr.work_date between p_from_date and p_to_date
      and pr.productivity_percent is not null
    group by pr.employee_id
  ), scoped as (
    select e.id, e.employee_code, e.full_name, e.job_title, e.branch_id,
      b.name as branch_name, e.department_id, d.name as department_name,
      coalesce(a.worked_days, 0)::bigint as worked_days,
      coalesce(a.worked_minutes, 0)::bigint as worked_minutes,
      coalesce(o.pending_count, 0)::bigint as pending_count,
      coalesce(o.pending_minutes, 0)::bigint as pending_minutes,
      coalesce(o.approved_minutes, 0)::bigint as approved_minutes,
      (coalesce(a.issue_count, 0) + coalesce(si.issue_count, 0))::bigint as issue_count,
      dv.average_usage, pr.average_productivity,
      (coalesce(o.pending_count, 0) > 0 or coalesce(a.issue_count, 0) + coalesce(si.issue_count, 0) > 0) as needs_action
    from public.employee_profiles e
    join public.branches b on b.id = e.branch_id
    join public.departments d on d.id = e.department_id
    left join attendance a on a.employee_id = e.id
    left join schedule_issues si on si.employee_id = e.id
    left join overtime o on o.employee_id = e.id
    left join device dv on dv.employee_id = e.id
    left join productivity pr on pr.employee_id = e.id
    where e.organization_id = p_organization_id
      and e.employment_status::text = 'active'
      and private.can_access_employee(p_organization_id, e.id)
      and (p_branch_id is null or e.branch_id = p_branch_id)
      and (p_department_id is null or e.department_id = p_department_id)
      and (nullif(btrim(p_search), '') is null
        or e.full_name ilike '%' || btrim(p_search) || '%'
        or e.employee_code ilike '%' || btrim(p_search) || '%')
      and (nullif(p_overtime_status, '') is null or coalesce(o.status_match, false))
  ), filtered as (
    select s.* from scoped s
    where (p_attendance_issue is null or p_attendance_issue = ''
      or (p_attendance_issue = 'issues' and s.issue_count > 0)
      or (p_attendance_issue = 'clear' and s.issue_count = 0))
      and (p_device_status is null or p_device_status = ''
        or (p_device_status = 'unavailable' and s.average_usage is null)
        or (p_device_status = 'normal' and s.average_usage <= 30)
        or (p_device_status = 'review' and s.average_usage > 30 and s.average_usage <= 60)
        or (p_device_status = 'high' and s.average_usage > 60))
      and (p_action_required is null or s.needs_action = p_action_required)
  )
  select f.id, f.employee_code, f.full_name, f.job_title,
    f.branch_id, f.branch_name, f.department_id, f.department_name,
    f.worked_days, f.worked_minutes, f.pending_count, f.pending_minutes,
    f.approved_minutes, f.issue_count, f.average_usage,
    f.average_productivity, f.needs_action, count(*) over ()::bigint
  from filtered f
  order by f.needs_action desc, f.pending_minutes desc, f.issue_count desc, f.full_name
  limit p_limit offset p_offset;
end;
$$;
