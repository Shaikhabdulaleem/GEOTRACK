-- Multi-site master data, versioned shifts, recurring schedules, and one
-- schedule resolver shared by every client. Weekdays use PostgreSQL's
-- extract(dow) convention: Sunday=0 through Saturday=6.

alter table public.shifts
  add column template_key uuid,
  add column version_number integer not null default 1,
  add column effective_from date,
  add column effective_to date,
  add column created_by uuid references auth.users(id) on delete set null;

update public.shifts
set template_key = id,
    effective_from = coalesce(
      (select min(sa.work_date) from public.shift_assignments sa where sa.shift_id = shifts.id),
      created_at::date
    )
where template_key is null or effective_from is null;

alter table public.shifts
  alter column template_key set default gen_random_uuid(),
  alter column template_key set not null,
  alter column effective_from set default current_date,
  alter column effective_from set not null,
  add constraint shifts_effective_dates_check
    check (effective_to is null or effective_to >= effective_from),
  add constraint shifts_version_positive_check check (version_number > 0);

alter table public.shifts drop constraint if exists shifts_organization_id_code_key;
create unique index shifts_template_version_uidx
  on public.shifts (organization_id, template_key, version_number);
create unique index shifts_current_code_uidx
  on public.shifts (organization_id, lower(code)) where effective_to is null;
create index shifts_effective_lookup_idx
  on public.shifts (organization_id, template_key, effective_from, effective_to);
create index shifts_created_by_idx on public.shifts (created_by) where created_by is not null;

create table public.recurring_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  effective_from date not null,
  effective_to date,
  status public.record_status not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (employee_id, effective_from),
  check (effective_to is null or effective_to >= effective_from),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade
);

create table public.recurring_schedule_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  schedule_id uuid not null references public.recurring_schedules(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  shift_id uuid,
  is_off boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (schedule_id, weekday),
  check ((is_off and shift_id is null) or (not is_off and shift_id is not null)),
  foreign key (organization_id, shift_id)
    references public.shifts(organization_id, id)
);

create index recurring_schedules_employee_dates_idx
  on public.recurring_schedules (employee_id, effective_from, effective_to, status);
create index recurring_schedules_organization_idx on public.recurring_schedules (organization_id);
create index recurring_schedules_created_by_idx on public.recurring_schedules (created_by) where created_by is not null;
create index recurring_rules_schedule_weekday_idx
  on public.recurring_schedule_rules (schedule_id, weekday);
create index recurring_rules_organization_idx on public.recurring_schedule_rules (organization_id);
create index recurring_rules_shift_idx on public.recurring_schedule_rules (shift_id) where shift_id is not null;

alter table public.recurring_schedules enable row level security;
alter table public.recurring_schedule_rules enable row level security;

create policy recurring_schedules_select on public.recurring_schedules
  for select to authenticated
  using (
    private.is_employee_owner(employee_id)
    or private.can_access_employee(organization_id, employee_id)
  );
create policy recurring_schedules_insert on public.recurring_schedules
  for insert to authenticated
  with check (
    private.can_access_employee(organization_id, employee_id)
    and private.employee_belongs_to_org(employee_id, organization_id)
  );
create policy recurring_schedules_update on public.recurring_schedules
  for update to authenticated
  using (private.can_access_employee(organization_id, employee_id))
  with check (
    private.can_access_employee(organization_id, employee_id)
    and private.employee_belongs_to_org(employee_id, organization_id)
  );
create policy recurring_schedules_delete on public.recurring_schedules
  for delete to authenticated
  using (private.can_access_employee(organization_id, employee_id));

create policy recurring_rules_select on public.recurring_schedule_rules
  for select to authenticated
  using (
    exists (
      select 1 from public.recurring_schedules rs
      where rs.id = schedule_id
        and rs.organization_id = recurring_schedule_rules.organization_id
        and (
          private.is_employee_owner(rs.employee_id)
          or private.can_access_employee(rs.organization_id, rs.employee_id)
        )
    )
  );
create policy recurring_rules_insert on public.recurring_schedule_rules
  for insert to authenticated
  with check (
    exists (
      select 1 from public.recurring_schedules rs
      where rs.id = schedule_id
        and rs.organization_id = recurring_schedule_rules.organization_id
        and private.can_access_employee(rs.organization_id, rs.employee_id)
    )
  );
create policy recurring_rules_update on public.recurring_schedule_rules
  for update to authenticated
  using (
    exists (
      select 1 from public.recurring_schedules rs
      where rs.id = schedule_id
        and private.can_access_employee(rs.organization_id, rs.employee_id)
    )
  )
  with check (
    exists (
      select 1 from public.recurring_schedules rs
      where rs.id = schedule_id
        and rs.organization_id = recurring_schedule_rules.organization_id
        and private.can_access_employee(rs.organization_id, rs.employee_id)
    )
  );
create policy recurring_rules_delete on public.recurring_schedule_rules
  for delete to authenticated
  using (
    exists (
      select 1 from public.recurring_schedules rs
      where rs.id = schedule_id
        and private.can_access_employee(rs.organization_id, rs.employee_id)
    )
  );

revoke all on public.recurring_schedules, public.recurring_schedule_rules from anon;
grant select, insert, update, delete on public.recurring_schedules, public.recurring_schedule_rules to authenticated;

-- Managers and administrators can maintain organization master data. Employee
-- and schedule scope remains enforced separately through can_access_employee.
drop policy if exists branches_manage_admin_insert on public.branches;
drop policy if exists branches_manage_admin_update on public.branches;
drop policy if exists branches_manage_admin_delete on public.branches;
create policy branches_manage_master_insert on public.branches for insert to authenticated
  with check (private.has_org_role(organization_id, array['administrator', 'manager']));
create policy branches_manage_master_update on public.branches for update to authenticated
  using (private.has_org_role(organization_id, array['administrator', 'manager']))
  with check (private.has_org_role(organization_id, array['administrator', 'manager']));

drop policy if exists departments_manage_admin_insert on public.departments;
drop policy if exists departments_manage_admin_update on public.departments;
drop policy if exists departments_manage_admin_delete on public.departments;
create policy departments_manage_master_insert on public.departments for insert to authenticated
  with check (private.has_org_role(organization_id, array['administrator', 'manager']));
create policy departments_manage_master_update on public.departments for update to authenticated
  using (private.has_org_role(organization_id, array['administrator', 'manager']))
  with check (private.has_org_role(organization_id, array['administrator', 'manager']));

create policy employee_profiles_update_manager_scope on public.employee_profiles
  for update to authenticated
  using (
    private.has_org_role(organization_id, array['manager'])
    and private.can_access_employee(organization_id, id)
  )
  with check (
    private.has_org_role(organization_id, array['manager'])
    and private.can_access_employee(organization_id, id)
    and private.valid_employee_references(organization_id, branch_id, department_id, manager_user_id)
  );

drop policy if exists geofences_manage_insert on public.geofences;
drop policy if exists geofences_manage_update on public.geofences;
create policy geofences_manage_master_insert on public.geofences for insert to authenticated
  with check (private.has_org_role(organization_id, array['administrator', 'manager']));
create policy geofences_manage_master_update on public.geofences for update to authenticated
  using (private.has_org_role(organization_id, array['administrator', 'manager']))
  with check (private.has_org_role(organization_id, array['administrator', 'manager']));

drop policy if exists geofence_polygons_manage_insert on public.geofence_polygons;
drop policy if exists geofence_polygons_manage_update on public.geofence_polygons;
create policy geofence_polygons_manage_master_insert on public.geofence_polygons for insert to authenticated
  with check (exists (
    select 1 from public.geofences g where g.id = geofence_id
      and private.has_org_role(g.organization_id, array['administrator', 'manager'])
  ));
create policy geofence_polygons_manage_master_update on public.geofence_polygons for update to authenticated
  using (exists (
    select 1 from public.geofences g where g.id = geofence_id
      and private.has_org_role(g.organization_id, array['administrator', 'manager'])
  ))
  with check (exists (
    select 1 from public.geofences g where g.id = geofence_id
      and private.has_org_role(g.organization_id, array['administrator', 'manager'])
  ));

-- Refuse deactivation while an active employee or future/active schedule still
-- depends on the record. Records are never hard-deleted by the dashboard.
create or replace function private.guard_master_data_deactivation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status::text = 'active' and new.status::text <> 'active' then
    if tg_table_name = 'branches' and (
      exists (select 1 from public.employee_profiles e where e.branch_id = old.id and e.employment_status::text = 'active')
      or exists (
        select 1 from public.recurring_schedules rs
        join public.employee_profiles e on e.id = rs.employee_id
        where e.branch_id = old.id and rs.status::text = 'active'
          and (rs.effective_to is null or rs.effective_to >= current_date)
      )
    ) then
      raise exception 'Reassign active employees and schedules before deactivating this site' using errcode = '23503';
    elsif tg_table_name = 'departments' and (
      exists (select 1 from public.employee_profiles e where e.department_id = old.id and e.employment_status::text = 'active')
      or exists (
        select 1 from public.recurring_schedules rs
        join public.employee_profiles e on e.id = rs.employee_id
        where e.department_id = old.id and rs.status::text = 'active'
          and (rs.effective_to is null or rs.effective_to >= current_date)
      )
    ) then
      raise exception 'Reassign active employees and schedules before deactivating this department' using errcode = '23503';
    elsif tg_table_name = 'shifts' and (
      exists (
        select 1 from public.shift_assignments sa
        join public.shifts sv on sv.id = sa.shift_id
        where sv.template_key = old.template_key and sa.work_date >= current_date and sa.status::text = 'scheduled'
      )
      or exists (
        select 1 from public.recurring_schedule_rules rr
        join public.recurring_schedules rs on rs.id = rr.schedule_id
        join public.shifts sv on sv.id = rr.shift_id
        where sv.template_key = old.template_key and rs.status::text = 'active'
          and (rs.effective_to is null or rs.effective_to >= current_date)
      )
    ) then
      raise exception 'Reassign active schedules before deactivating this shift' using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

create trigger branches_guard_deactivation before update of status on public.branches
  for each row execute function private.guard_master_data_deactivation();
create trigger departments_guard_deactivation before update of status on public.departments
  for each row execute function private.guard_master_data_deactivation();
create trigger shifts_guard_deactivation before update of status on public.shifts
  for each row execute function private.guard_master_data_deactivation();

create or replace function private.pin_assignment_shift_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare v_template_key uuid;
begin
  if new.shift_id is null then return new; end if;
  select s.template_key into v_template_key from public.shifts s
  where s.id = new.shift_id and s.organization_id = new.organization_id;
  select s.id into new.shift_id from public.shifts s
  where s.organization_id = new.organization_id
    and s.template_key = v_template_key
    and s.effective_from <= new.work_date
    and (s.effective_to is null or s.effective_to >= new.work_date)
  order by s.version_number desc limit 1;
  if new.shift_id is null then
    raise exception 'No shift version is effective on assignment date %', new.work_date using errcode = '23503';
  end if;
  return new;
end;
$$;
create trigger shift_assignments_pin_version
  before insert or update of shift_id, work_date on public.shift_assignments
  for each row execute function private.pin_assignment_shift_version();

-- Internal resolver bypasses table RLS only after one of the public entry
-- points has authenticated and authorized the employee. It is not executable
-- from the Data API.
create or replace function private.resolve_employee_schedule_internal(
  p_employee_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  work_date date,
  state text,
  source text,
  shift_assignment_id uuid,
  recurring_schedule_id uuid,
  shift_id uuid,
  shift_name text,
  start_time time,
  end_time time,
  break_minutes integer,
  crosses_midnight boolean,
  reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  with employee as (
    select e.id, e.organization_id, e.branch_id
    from public.employee_profiles e
    where e.id = p_employee_id and (select auth.uid()) is not null
  ), dates as (
    select d::date as work_date
    from generate_series(p_start_date, p_end_date, interval '1 day') d
  ), resolved as (
    select d.work_date,
      l.leave_type::text as leave_reason,
      a.id as assignment_id, a.status::text as assignment_status, a.shift_id as assignment_shift_id,
      h.name as holiday_name,
      rs.id as recurring_id, rr.is_off as recurring_off, rr.shift_id as recurring_shift_id,
      wo.id as weekly_off_id
    from dates d
    cross join employee e
    left join lateral (
      select lr.leave_type from public.leave_requests lr
      where lr.employee_id = e.id and lr.status::text = 'approved'
        and d.work_date between lr.from_date and lr.to_date
      order by lr.created_at desc limit 1
    ) l on true
    left join lateral (
      select sa.id, sa.status, sa.shift_id from public.shift_assignments sa
      where sa.employee_id = e.id and sa.work_date = d.work_date
      limit 1
    ) a on true
    left join lateral (
      select hd.name from public.holidays hd
      where hd.organization_id = e.organization_id
        and (hd.branch_id is null or hd.branch_id = e.branch_id)
        and hd.holiday_date = d.work_date and not hd.is_working_day
      order by hd.branch_id nulls last limit 1
    ) h on true
    left join lateral (
      select x.id from public.recurring_schedules x
      where x.employee_id = e.id and x.status::text = 'active'
        and x.effective_from <= d.work_date
        and (x.effective_to is null or x.effective_to >= d.work_date)
      order by x.effective_from desc, x.created_at desc limit 1
    ) rs on true
    left join public.recurring_schedule_rules rr
      on rr.schedule_id = rs.id and rr.weekday = extract(dow from d.work_date)::smallint
    left join lateral (
      select w.id from public.weekly_offs w
      where w.employee_id = e.id and w.weekday = extract(dow from d.work_date)::smallint
        and w.effective_from <= d.work_date
        and (w.effective_to is null or w.effective_to >= d.work_date)
      order by w.effective_from desc limit 1
    ) wo on true
  )
  select r.work_date,
    case
      when r.leave_reason is not null or r.assignment_status = 'leave' then 'leave'
      when r.assignment_status = 'cancelled' then 'cancelled'
      when r.assignment_id is not null and r.assignment_status = 'off' then 'off'
      when r.assignment_id is not null and r.assignment_status = 'scheduled' then 'working'
      when r.holiday_name is not null then 'holiday'
      when r.recurring_off then 'off'
      when r.recurring_shift_id is not null then 'working'
      when r.weekly_off_id is not null then 'off'
      else 'unassigned'
    end as state,
    case
      when r.leave_reason is not null then 'leave'
      when r.assignment_id is not null then 'dated_override'
      when r.holiday_name is not null then 'holiday'
      when r.recurring_id is not null then 'recurring'
      when r.weekly_off_id is not null then 'legacy_weekly_off'
      else 'unassigned'
    end as source,
    r.assignment_id,
    r.recurring_id,
    s.id,
    s.name,
    s.start_time,
    s.end_time,
    s.break_minutes,
    coalesce(s.crosses_midnight, false),
    coalesce(r.leave_reason, r.holiday_name)
  from resolved r
  left join lateral (
    select sv.* from public.shifts sv
    where (
      (r.assignment_shift_id is not null and sv.id = r.assignment_shift_id)
      or (
        r.assignment_shift_id is null and r.recurring_shift_id is not null
        and sv.template_key = (select base.template_key from public.shifts base where base.id = r.recurring_shift_id)
        and sv.effective_from <= r.work_date
        and (sv.effective_to is null or sv.effective_to >= r.work_date)
      )
    )
    order by case when sv.id = r.assignment_shift_id then 0 else 1 end, sv.version_number desc
    limit 1
  ) s on true
  order by r.work_date;
$$;

revoke all on function private.resolve_employee_schedule_internal(uuid, date, date) from public, anon, authenticated;

create or replace function public.resolve_employee_schedule(
  p_employee_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  work_date date, state text, source text, shift_assignment_id uuid,
  recurring_schedule_id uuid, shift_id uuid, shift_name text, start_time time,
  end_time time, break_minutes integer, crosses_midnight boolean, reason text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare v_org_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date or p_end_date - p_start_date > 366 then
    raise exception 'Schedule date range must be between 1 and 367 days' using errcode = '22023';
  end if;
  select e.organization_id into v_org_id from public.employee_profiles e where e.id = p_employee_id;
  if v_org_id is null or not (
    private.is_employee_owner(p_employee_id)
    or private.can_access_employee(v_org_id, p_employee_id)
  ) then
    raise exception 'Schedule access denied' using errcode = '42501';
  end if;
  return query select * from private.resolve_employee_schedule_internal(p_employee_id, p_start_date, p_end_date);
end;
$$;

revoke all on function public.resolve_employee_schedule(uuid, date, date) from public, anon;
grant execute on function public.resolve_employee_schedule(uuid, date, date) to authenticated;

-- Replace a complete weekly pattern atomically. Closing the prior schedule
-- preserves history and permits future-effective changes.
create or replace function public.set_recurring_schedule(
  p_employee_id uuid,
  p_effective_from date,
  p_effective_to date,
  p_rules jsonb
)
returns public.recurring_schedules
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_schedule public.recurring_schedules%rowtype;
  v_rule jsonb;
begin
  select e.organization_id into v_org_id from public.employee_profiles e where e.id = p_employee_id;
  if v_org_id is null or not private.can_access_employee(v_org_id, p_employee_id) then
    raise exception 'Schedule management denied' using errcode = '42501';
  end if;
  if p_effective_from is null or (p_effective_to is not null and p_effective_to < p_effective_from) then
    raise exception 'Invalid effective date range' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) <> 7 then
    raise exception 'Exactly seven weekday rules are required' using errcode = '22023';
  end if;

  update public.recurring_schedules
    set effective_to = least(coalesce(effective_to, p_effective_from - 1), p_effective_from - 1),
        updated_at = clock_timestamp()
  where employee_id = p_employee_id and status::text = 'active'
    and effective_from < p_effective_from
    and (effective_to is null or effective_to >= p_effective_from);

  insert into public.recurring_schedules (
    organization_id, employee_id, effective_from, effective_to, created_by
  ) values (v_org_id, p_employee_id, p_effective_from, p_effective_to, (select auth.uid()))
  on conflict (employee_id, effective_from) do update
    set effective_to = excluded.effective_to, status = 'active', updated_at = clock_timestamp()
  returning * into v_schedule;

  delete from public.recurring_schedule_rules where schedule_id = v_schedule.id;
  for v_rule in select value from jsonb_array_elements(p_rules)
  loop
    insert into public.recurring_schedule_rules (
      organization_id, schedule_id, weekday, shift_id, is_off
    ) values (
      v_org_id,
      v_schedule.id,
      (v_rule->>'weekday')::smallint,
      nullif(v_rule->>'shift_id', '')::uuid,
      coalesce((v_rule->>'is_off')::boolean, false)
    );
  end loop;
  return v_schedule;
end;
$$;

revoke all on function public.set_recurring_schedule(uuid, date, date, jsonb) from public, anon;
grant execute on function public.set_recurring_schedule(uuid, date, date, jsonb) to authenticated;

-- Version a shift once it has been used. Unused shifts may still be corrected
-- in place. Future assignments resolve the version effective on their date.
create or replace function public.save_shift_template(
  p_shift_id uuid,
  p_organization_id uuid,
  p_code text,
  p_name text,
  p_start_time time,
  p_end_time time,
  p_break_minutes integer,
  p_color text,
  p_effective_from date
)
returns public.shifts
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old public.shifts%rowtype;
  v_new public.shifts%rowtype;
  v_used boolean;
begin
  if not private.has_org_role(p_organization_id, array['administrator', 'manager']) then
    raise exception 'Shift management denied' using errcode = '42501';
  end if;
  if nullif(btrim(p_code), '') is null or nullif(btrim(p_name), '') is null
     or p_start_time is null or p_end_time is null or p_break_minutes < 0 then
    raise exception 'Code, name, times, and a valid break are required' using errcode = '22023';
  end if;
  if p_shift_id is null then
    insert into public.shifts (
      organization_id, code, name, start_time, end_time, crosses_midnight,
      break_minutes, color, template_key, version_number, effective_from, created_by
    ) values (
      p_organization_id, upper(btrim(p_code)), btrim(p_name), p_start_time, p_end_time,
      p_end_time <= p_start_time, p_break_minutes, p_color, gen_random_uuid(), 1,
      coalesce(p_effective_from, current_date), (select auth.uid())
    ) returning * into v_new;
    return v_new;
  end if;

  select * into v_old from public.shifts
  where id = p_shift_id and organization_id = p_organization_id for update;
  if not found then raise exception 'Shift template not found' using errcode = 'P0002'; end if;
  select exists(select 1 from public.shift_assignments where shift_id = p_shift_id)
      or exists(select 1 from public.recurring_schedule_rules where shift_id = p_shift_id)
    into v_used;

  if not v_used and coalesce(p_effective_from, current_date) <= current_date then
    update public.shifts set
      code = upper(btrim(p_code)), name = btrim(p_name), start_time = p_start_time,
      end_time = p_end_time, crosses_midnight = p_end_time <= p_start_time,
      break_minutes = p_break_minutes, color = p_color, updated_at = clock_timestamp()
    where id = p_shift_id returning * into v_new;
    return v_new;
  end if;

  if coalesce(p_effective_from, current_date + 1) <= current_date then
    raise exception 'A used shift must be changed with a future effective date' using errcode = '22023';
  end if;
  update public.shifts
    set effective_to = coalesce(p_effective_from, current_date + 1) - 1,
        updated_at = clock_timestamp()
  where id = p_shift_id;
  insert into public.shifts (
    organization_id, code, name, start_time, end_time, crosses_midnight,
    break_minutes, color, template_key, version_number, effective_from, created_by
  ) values (
    p_organization_id, upper(btrim(p_code)), btrim(p_name), p_start_time, p_end_time,
    p_end_time <= p_start_time, p_break_minutes, p_color, v_old.template_key,
    v_old.version_number + 1, coalesce(p_effective_from, current_date + 1), (select auth.uid())
  ) returning * into v_new;
  return v_new;
end;
$$;

revoke all on function public.save_shift_template(uuid, uuid, text, text, time, time, integer, text, date) from public, anon;
grant execute on function public.save_shift_template(uuid, uuid, text, text, time, time, integer, text, date) to authenticated;

-- Atomic site creation, including an optional circular geofence represented as
-- a 32-point polygon. The radius defaults to 30 metres.
create or replace function public.create_site(
  p_organization_id uuid,
  p_name text,
  p_code text,
  p_timezone text,
  p_address text,
  p_latitude double precision,
  p_longitude double precision,
  p_create_geofence boolean default false,
  p_geofence_radius_meters integer default 30
)
returns public.branches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_site public.branches%rowtype;
  v_geofence_id uuid;
  v_points jsonb;
begin
  if not private.has_org_role(p_organization_id, array['administrator', 'manager']) then
    raise exception 'Site management denied' using errcode = '42501';
  end if;
  if p_create_geofence and (p_latitude is null or p_longitude is null) then
    raise exception 'Coordinates are required to create a geofence' using errcode = '22023';
  end if;
  if p_geofence_radius_meters <= 0 then raise exception 'Geofence radius must be positive' using errcode = '22023'; end if;
  insert into public.branches (
    organization_id, code, name, timezone, address, location_point,
    latitude, longitude, created_by
  ) values (
    p_organization_id, upper(btrim(p_code)), btrim(p_name), p_timezone, nullif(btrim(p_address), ''),
    case when p_latitude is null then null else jsonb_build_object('type','Point','coordinates',jsonb_build_array(p_longitude,p_latitude)) end,
    p_latitude, p_longitude, (select auth.uid())
  ) returning * into v_site;
  if p_create_geofence then
    insert into public.geofences (
      organization_id, branch_id, name, status, required_accuracy_meters,
      latitude, longitude, created_by
    ) values (
      p_organization_id, v_site.id, v_site.name || ' geofence', 'active',
      greatest(5, p_geofence_radius_meters), p_latitude, p_longitude, (select auth.uid())
    ) returning id into v_geofence_id;
    select jsonb_agg(jsonb_build_array(
      p_longitude + (p_geofence_radius_meters / (111320.0 * cos(radians(p_latitude)))) * sin(radians(i * 360.0 / 32.0)),
      p_latitude + (p_geofence_radius_meters / 110540.0) * cos(radians(i * 360.0 / 32.0))
    ) order by i) into v_points from generate_series(0, 32) i;
    insert into public.geofence_polygons (geofence_id, version_number, polygon, created_by)
    values (v_geofence_id, 1, jsonb_build_object('type','MultiPolygon','coordinates',jsonb_build_array(jsonb_build_array(v_points))), (select auth.uid()));
  end if;
  return v_site;
end;
$$;

revoke all on function public.create_site(uuid, text, text, text, text, double precision, double precision, boolean, integer) from public, anon;
grant execute on function public.create_site(uuid, text, text, text, text, double precision, double precision, boolean, integer) to authenticated;

-- Preserve existing records and backfill the requested weekly pattern for Md
-- Ariful Islam using the existing Morning template and schedule start.
do $$
declare
  v_employee public.employee_profiles%rowtype;
  v_shift public.shifts%rowtype;
  v_start date;
  v_schedule_id uuid;
  v_day smallint;
begin
  select * into v_employee from public.employee_profiles
  where full_name = 'Md Ariful Islam' order by created_at limit 1;
  if v_employee.id is null then return; end if;
  select * into v_shift from public.shifts
  where organization_id = v_employee.organization_id and lower(name) = 'morning'
    and effective_to is null order by version_number desc limit 1;
  if v_shift.id is null then return; end if;
  select coalesce(min(work_date), v_employee.joining_date, current_date) into v_start
  from public.shift_assignments where employee_id = v_employee.id;
  insert into public.recurring_schedules (organization_id, employee_id, effective_from, created_by)
  values (v_employee.organization_id, v_employee.id, v_start, null)
  on conflict (employee_id, effective_from) do update set status = 'active'
  returning id into v_schedule_id;
  delete from public.recurring_schedule_rules where schedule_id = v_schedule_id;
  for v_day in 0..6 loop
    insert into public.recurring_schedule_rules (organization_id, schedule_id, weekday, shift_id, is_off)
    values (v_employee.organization_id, v_schedule_id, v_day,
      case when v_day = 5 then null else v_shift.id end, v_day = 5);
  end loop;
end;
$$;

-- Route attendance through the same resolver. A recurring result is
-- materialized as a dated assignment at check-in so the existing attendance
-- record FK continues to pin the exact shift version used historically.
alter function public.process_attendance_event(
  uuid, uuid, text, boolean, double precision, double precision,
  double precision, boolean, text, jsonb
) rename to process_attendance_event_legacy;

revoke all on function public.process_attendance_event_legacy(
  uuid, uuid, text, boolean, double precision, double precision,
  double precision, boolean, text, jsonb
) from public, anon, authenticated;

create or replace function public.process_attendance_event(
  p_employee_id uuid,
  p_geofence_id uuid,
  p_action_type text,
  p_is_auto boolean,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_is_mock_location boolean,
  p_idempotency_key text,
  p_device_info jsonb
)
returns table (
  attendance_record_id uuid,
  event_id uuid,
  status text,
  inside_geofence boolean,
  validation_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employee_profiles%rowtype;
  v_timezone text;
  v_local_now timestamp;
  v_schedule record;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select * into v_employee from public.employee_profiles where id = p_employee_id;
  if v_employee.id is null or not (
    private.is_employee_owner(p_employee_id)
    or private.can_access_employee(v_employee.organization_id, p_employee_id)
  ) then
    raise exception 'Attendance access denied' using errcode = '42501';
  end if;

  if p_action_type = 'check_in' then
    select coalesce(nullif(b.timezone, ''), nullif(o.timezone, ''), 'UTC') into v_timezone
    from public.organizations o
    left join public.branches b on b.id = v_employee.branch_id and b.organization_id = o.id
    where o.id = v_employee.organization_id;
    v_local_now := clock_timestamp() at time zone coalesce(v_timezone, 'UTC');

    select * into v_schedule
    from private.resolve_employee_schedule_internal(
      p_employee_id, v_local_now::date - 1, v_local_now::date
    ) r
    where r.state = 'working'
      and (
        r.work_date = v_local_now::date
        or (r.work_date = v_local_now::date - 1 and r.crosses_midnight and v_local_now::time <= r.end_time)
      )
    order by case when r.work_date = v_local_now::date - 1 then 0 else 1 end
    limit 1;

    if v_schedule.work_date is null then
      raise exception 'No working shift is scheduled for this time' using errcode = '22023';
    end if;
    if v_schedule.shift_assignment_id is null and v_schedule.source = 'recurring' then
      insert into public.shift_assignments (
        organization_id, employee_id, shift_id, work_date, status, source, created_by
      ) values (
        v_employee.organization_id, p_employee_id, v_schedule.shift_id,
        v_schedule.work_date, 'scheduled', 'recurring', (select auth.uid())
      ) on conflict (employee_id, work_date) do nothing;
    end if;
  end if;

  return query select * from public.process_attendance_event_legacy(
    p_employee_id, p_geofence_id, p_action_type, p_is_auto,
    p_latitude, p_longitude, p_accuracy_meters, p_is_mock_location,
    p_idempotency_key, p_device_info
  );
end;
$$;

revoke all on function public.process_attendance_event(
  uuid, uuid, text, boolean, double precision, double precision,
  double precision, boolean, text, jsonb
) from public, anon;
grant execute on function public.process_attendance_event(
  uuid, uuid, text, boolean, double precision, double precision,
  double precision, boolean, text, jsonb
) to authenticated;
