-- Employee-centric overtime review, secured manager corrections, and batch decisions.

create index if not exists overtime_records_org_employee_requested_status_idx
  on public.overtime_records (organization_id, employee_id, requested_at, status);
create index if not exists phone_usage_records_org_employee_date_idx
  on public.phone_usage_records (organization_id, employee_id, work_date);
create index if not exists productivity_records_org_employee_date_idx
  on public.productivity_records (organization_id, employee_id, work_date);
create index if not exists employee_profiles_org_branch_department_status_idx
  on public.employee_profiles (organization_id, branch_id, department_id, employment_status);

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
        where ar.status::text in ('absent', 'missing_check_in', 'missing_check_out', 'invalid')
           or ar.check_in_at is null or ar.check_out_at is null or ar.check_out_at <= ar.check_in_at
           or (ar.worked_minutes = 0 and ar.missing_minutes > 0)
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

create or replace function public.get_overtime_review_detail(
  p_organization_id uuid,
  p_employee_id uuid,
  p_from_date date,
  p_to_date date
)
returns table (
  work_date date,
  schedule_state text,
  shift_name text,
  shift_start time,
  shift_end time,
  attendance_record_id uuid,
  check_in_at timestamptz,
  check_out_at timestamptz,
  attendance_status text,
  worked_minutes integer,
  missing_minutes integer,
  late_minutes integer,
  early_leaving_minutes integer,
  calculated_overtime_minutes integer,
  overtime_record_id uuid,
  requested_minutes integer,
  approved_minutes integer,
  overtime_status text,
  device_minutes integer,
  device_usage_percent numeric,
  device_data_status text,
  productivity_percent numeric,
  attendance_issue boolean,
  reconciliation_issue boolean
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
  if not private.can_access_employee(p_organization_id, p_employee_id) then
    raise exception 'Employee review access denied' using errcode = '42501';
  end if;

  return query
  with schedule as (
    select * from private.resolve_employee_schedule_internal(p_employee_id, p_from_date, p_to_date)
  )
  select s.work_date, s.state, s.shift_name, s.start_time, s.end_time,
    ar.id, ar.check_in_at, ar.check_out_at, ar.status::text,
    coalesce(ar.worked_minutes, 0), coalesce(ar.missing_minutes, 0),
    coalesce(ar.late_minutes, 0), coalesce(ar.early_leaving_minutes, 0),
    coalesce(ar.overtime_minutes, 0),
    ot.id, coalesce(ot.requested_minutes, 0), ot.approved_minutes, ot.status::text,
    coalesce(pu.within_shift_minutes, 0), pu.usage_percentage,
    case
      when pu.id is null then 'unavailable'
      when coalesce(pu.source, '') like '%permission_not_granted' then 'permission_not_granted'
      when coalesce(pu.source, '') like '%partial_data' then 'partial_data'
      else 'available'
    end,
    pr.productivity_percent,
    (s.state = 'working' and (
      ar.id is null or ar.check_in_at is null or ar.check_out_at is null or ar.check_out_at <= ar.check_in_at
      or (ar.worked_minutes = 0 and ar.missing_minutes > 0)
      or ar.status::text in ('absent', 'missing_check_in', 'missing_check_out', 'invalid')
    )),
    (ot.status::text in ('approved', 'rejected') and ot.requested_minutes <> coalesce(ar.overtime_minutes, 0))
  from schedule s
  left join lateral (
    select x.* from public.attendance_records x
    where x.organization_id = p_organization_id
      and x.employee_id = p_employee_id and x.attendance_date = s.work_date
    order by x.session_number desc limit 1
  ) ar on true
  left join lateral (
    select x.* from public.overtime_records x
    where x.organization_id = p_organization_id and x.employee_id = p_employee_id
      and x.attendance_record_id = ar.id
    order by x.created_at desc limit 1
  ) ot on true
  left join lateral (
    select x.* from public.phone_usage_records x
    where x.organization_id = p_organization_id and x.employee_id = p_employee_id
      and x.work_date = s.work_date
    order by x.created_at desc limit 1
  ) pu on true
  left join lateral (
    select avg(x.productivity_percent)::numeric(8,2) as productivity_percent
    from public.productivity_records x
    where x.organization_id = p_organization_id and x.employee_id = p_employee_id
      and x.work_date = s.work_date and x.productivity_percent is not null
  ) pr on true
  order by s.work_date desc;
end;
$$;

create or replace function public.review_overtime_batch(p_decisions jsonb)
returns setof public.overtime_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_item jsonb;
  v_record public.overtime_records%rowtype;
  v_status text;
  v_minutes integer;
  v_note text;
  v_count integer;
  v_recipient uuid;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if jsonb_typeof(p_decisions) <> 'array' then
    raise exception 'Decisions must be an array' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_decisions);
  if v_count < 1 or v_count > 100 then
    raise exception 'Submit between 1 and 100 overtime decisions' using errcode = '22023';
  end if;

  perform 1 from public.overtime_records x
  where x.id in (select (value->>'id')::uuid from jsonb_array_elements(p_decisions))
  order by x.id for update;

  for v_item in select value from jsonb_array_elements(p_decisions) order by value->>'id'
  loop
    v_status := v_item->>'status';
    v_minutes := nullif(v_item->>'approved_minutes', '')::integer;
    v_note := nullif(btrim(v_item->>'review_note'), '');
    if v_status not in ('approved', 'rejected') then
      raise exception 'Invalid review status' using errcode = '22023';
    end if;
    select * into v_record from public.overtime_records
    where id = (v_item->>'id')::uuid;
    if not found then raise exception 'Overtime record not found' using errcode = 'P0002'; end if;
    if not private.can_access_employee(v_record.organization_id, v_record.employee_id) then
      raise exception 'Not authorized to review overtime' using errcode = '42501';
    end if;
    if v_record.status::text <> 'pending' then
      raise exception 'Overtime record changed; refresh and try again' using errcode = '40001';
    end if;
    if v_status = 'approved' and (v_minutes is null or v_minutes < 0 or v_minutes > v_record.requested_minutes) then
      raise exception 'Approved minutes must be between zero and requested minutes' using errcode = '22023';
    end if;
    if (v_status = 'rejected' or (v_status = 'approved' and v_minutes <> v_record.requested_minutes)) and v_note is null then
      raise exception 'A review note is required for rejection or adjusted minutes' using errcode = '22023';
    end if;

    insert into public.audit_logs (
      organization_id, actor_user_id, action, entity_type, entity_id,
      before_data, metadata
    ) values (
      v_record.organization_id, v_actor, 'overtime_reviewed', 'overtime_record', v_record.id,
      to_jsonb(v_record), jsonb_build_object('batch_size', v_count)
    );

    update public.overtime_records set
      status = v_status::public.approval_status,
      approved_minutes = case when v_status = 'approved' then v_minutes else 0 end,
      approved_by = v_actor, approved_at = clock_timestamp(), review_note = v_note
    where id = v_record.id returning * into v_record;

    update public.audit_logs set after_data = to_jsonb(v_record)
    where id = (select id from public.audit_logs
      where entity_type = 'overtime_record' and entity_id = v_record.id and actor_user_id = v_actor
      order by created_at desc limit 1);

    select user_id into v_recipient from public.employee_profiles where id = v_record.employee_id;
    if v_recipient is not null then
      insert into public.notifications (
        organization_id, recipient_user_id, notification_type, severity,
        title, body, entity_type, entity_id
      ) values (
        v_record.organization_id, v_recipient, 'overtime',
        case when v_status = 'approved' then 'info' else 'warning' end::public.notification_severity,
        'Overtime ' || v_status, 'Your overtime request has been ' || v_status || '.',
        'overtime_record', v_record.id
      );
    end if;
    return next v_record;
  end loop;
end;
$$;

create or replace function public.manager_correct_attendance(
  p_organization_id uuid,
  p_employee_id uuid,
  p_work_date date,
  p_attendance_record_id uuid,
  p_check_in_at timestamptz,
  p_check_out_at timestamptz,
  p_reason text
)
returns setof public.attendance_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_before jsonb;
  v_record public.attendance_records%rowtype;
  v_schedule record;
  v_assignment_id uuid;
  v_overtime public.overtime_records%rowtype;
  v_recipient uuid;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_work_date is null or p_work_date > current_date + 1 then
    raise exception 'Invalid attendance date' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A correction reason is required' using errcode = '22023';
  end if;
  if p_check_in_at is null or p_check_out_at is null or p_check_out_at <= p_check_in_at then
    raise exception 'Valid check-in and check-out times are required' using errcode = '22023';
  end if;
  if not private.can_access_employee(p_organization_id, p_employee_id) then
    raise exception 'Attendance correction access denied' using errcode = '42501';
  end if;

  if p_attendance_record_id is not null then
    select * into v_record from public.attendance_records
    where id = p_attendance_record_id and organization_id = p_organization_id
      and employee_id = p_employee_id and attendance_date = p_work_date
    for update;
    if not found then raise exception 'Attendance record not found' using errcode = 'P0002'; end if;
    v_before := to_jsonb(v_record);
    update public.attendance_records set
      check_in_at = p_check_in_at, check_out_at = p_check_out_at,
      source = 'manual_manager'::public.attendance_source,
      approval_status = 'approved'::public.approval_status,
      approved_by = v_actor, approved_at = clock_timestamp(), notes = btrim(p_reason)
    where id = v_record.id;
  else
    select * into v_schedule from private.resolve_employee_schedule_internal(p_employee_id, p_work_date, p_work_date) limit 1;
    if not found or v_schedule.state <> 'working' or v_schedule.shift_id is null then
      raise exception 'A working shift is required before attendance can be created' using errcode = '22023';
    end if;
    v_assignment_id := v_schedule.shift_assignment_id;
    if v_assignment_id is null then
      insert into public.shift_assignments (
        organization_id, employee_id, shift_id, work_date, status, source, created_by
      ) values (
        p_organization_id, p_employee_id, v_schedule.shift_id, p_work_date,
        'scheduled'::public.shift_assignment_status, 'manual'::public.assignment_source, v_actor
      ) on conflict (employee_id, work_date) do update set
        shift_id = excluded.shift_id, status = excluded.status, source = excluded.source,
        created_by = excluded.created_by, updated_at = clock_timestamp()
      returning id into v_assignment_id;
    end if;
    insert into public.attendance_records (
      organization_id, employee_id, shift_assignment_id, attendance_date,
      check_in_at, check_out_at, source, status, geofence_validated,
      approval_status, approved_by, approved_at, notes
    ) values (
      p_organization_id, p_employee_id, v_assignment_id, p_work_date,
      p_check_in_at, p_check_out_at, 'manual_manager'::public.attendance_source,
      'present'::public.attendance_status, false, 'approved'::public.approval_status,
      v_actor, clock_timestamp(), btrim(p_reason)
    ) returning * into v_record;
  end if;

  perform private.recalculate_attendance(v_record.id);
  select * into v_record from public.attendance_records where id = v_record.id;

  select * into v_overtime from public.overtime_records
  where attendance_record_id = v_record.id order by created_at desc limit 1 for update;
  if found and v_overtime.status::text = 'pending' then
    update public.overtime_records set
      requested_minutes = v_record.overtime_minutes,
      status = case when v_record.overtime_minutes = 0
        then 'not_required'::public.approval_status else status end,
      approved_minutes = case when v_record.overtime_minutes = 0 then 0 else approved_minutes end,
      review_note = case when v_record.overtime_minutes = 0
        then 'Attendance correction removed calculated overtime' else review_note end
    where id = v_overtime.id;
  elsif not found and v_record.overtime_minutes > 0 then
    insert into public.overtime_records (
      organization_id, employee_id, attendance_record_id, requested_minutes,
      status, reason, requested_by, requested_at
    ) values (
      p_organization_id, p_employee_id, v_record.id, v_record.overtime_minutes,
      'pending'::public.approval_status, 'Manager attendance correction', v_actor, clock_timestamp()
    );
  end if;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id,
    before_data, after_data, metadata
  ) values (
    p_organization_id, v_actor, 'attendance_manager_corrected', 'attendance_record', v_record.id,
    v_before, to_jsonb(v_record), jsonb_build_object('reason', btrim(p_reason), 'work_date', p_work_date)
  );

  select user_id into v_recipient from public.employee_profiles where id = p_employee_id;
  if v_recipient is not null then
    insert into public.notifications (
      organization_id, recipient_user_id, notification_type, severity,
      title, body, entity_type, entity_id
    ) values (
      p_organization_id, v_recipient, 'attendance_correction', 'info',
      'Attendance corrected', 'A manager corrected your attendance for ' || p_work_date::text || '.',
      'attendance_record', v_record.id
    );
  end if;
  return next v_record;
end;
$$;

revoke all on function public.list_overtime_review_employees(uuid, date, date, text, uuid, uuid, text, text, text, boolean, integer, integer) from public, anon;
revoke all on function public.get_overtime_review_detail(uuid, uuid, date, date) from public, anon;
revoke all on function public.review_overtime_batch(jsonb) from public, anon;
revoke all on function public.manager_correct_attendance(uuid, uuid, date, uuid, timestamptz, timestamptz, text) from public, anon;

grant execute on function public.list_overtime_review_employees(uuid, date, date, text, uuid, uuid, text, text, text, boolean, integer, integer) to authenticated;
grant execute on function public.get_overtime_review_detail(uuid, uuid, date, date) to authenticated;
grant execute on function public.review_overtime_batch(jsonb) to authenticated;
grant execute on function public.manager_correct_attendance(uuid, uuid, date, uuid, timestamptz, timestamptz, text) to authenticated;
