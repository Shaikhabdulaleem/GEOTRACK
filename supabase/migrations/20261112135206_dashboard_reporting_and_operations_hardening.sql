-- Reporting, advisor remediation, secure scheduling, and operational monitoring.

-- ---------------------------------------------------------------------------
-- Database-backed seven-day dashboard trends with tenant/scope enforcement.
-- Attendance/work dates are already organization-local business dates; event
-- timestamps are converted with the employee branch/org timezone.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Reliable breach-push delivery. Claiming no longer marks an alert delivered;
-- completion is recorded only after downstream FCM success. Stale claims are
-- replayed safely and transient failures use bounded exponential backoff.
-- ---------------------------------------------------------------------------
alter table public.geofence_breach_alerts
  add column if not exists delivery_status text not null default 'pending',
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_attempt_at timestamptz not null default clock_timestamp(),
  add column if not exists last_attempt_at timestamptz,
  add column if not exists last_error text,
  add column if not exists delivered_count integer not null default 0,
  add column if not exists failed_count integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'geofence_breach_alerts_delivery_status_check'
      and conrelid = 'public.geofence_breach_alerts'::regclass
  ) then
    alter table public.geofence_breach_alerts
      add constraint geofence_breach_alerts_delivery_status_check
      check (delivery_status in ('pending', 'in_flight', 'delivered', 'permanent_failure'));
  end if;
end
$$;

update public.geofence_breach_alerts
set delivery_status = case when pushed_at is null then 'pending' else 'delivered' end
where delivery_status = 'pending';

create index if not exists geofence_breach_alerts_delivery_queue_idx
  on public.geofence_breach_alerts (next_attempt_at, created_at)
  where delivery_status in ('pending', 'in_flight');

drop function if exists public.claim_breach_push_batch(integer);
create function public.claim_breach_push_batch(p_limit integer default 100)
returns table(
  alert_id uuid,
  notification_id uuid,
  recipient_user_id uuid,
  claim_token uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with claimable as (
    select a.id
    from public.geofence_breach_alerts a
    where (
        a.delivery_status = 'pending'
        and a.next_attempt_at <= clock_timestamp()
      ) or (
        a.delivery_status = 'in_flight'
        and a.claimed_at < clock_timestamp() - interval '10 minutes'
      )
    order by a.created_at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update skip locked
  ),
  claimed as (
    update public.geofence_breach_alerts a
       set delivery_status = 'in_flight',
           claim_token = gen_random_uuid(),
           claimed_at = clock_timestamp(),
           last_attempt_at = clock_timestamp(),
           attempt_count = a.attempt_count + 1,
           last_error = null
      from claimable c
     where a.id = c.id
    returning a.*
  )
  select c.id, c.notification_id, c.recipient_user_id,
         c.claim_token, c.attempt_count
  from claimed c;
end;
$$;

revoke all on function public.claim_breach_push_batch(integer)
  from public, anon, authenticated;
grant execute on function public.claim_breach_push_batch(integer) to service_role;

create or replace function public.complete_breach_push_attempt(
  p_alert_id uuid,
  p_claim_token uuid,
  p_sent_count integer,
  p_failed_count integer,
  p_error text default null,
  p_permanent boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  if p_sent_count < 0 or p_failed_count < 0 then
    raise exception 'Delivery counts must be non-negative' using errcode = '22023';
  end if;

  select attempt_count into v_attempts
  from public.geofence_breach_alerts
  where id = p_alert_id
    and claim_token = p_claim_token
    and delivery_status = 'in_flight'
  for update;
  if not found then return false; end if;

  if p_sent_count > 0 then
    update public.geofence_breach_alerts
       set delivery_status = 'delivered',
           pushed_at = clock_timestamp(),
           delivered_count = delivered_count + p_sent_count,
           failed_count = failed_count + p_failed_count,
           last_error = null,
           claim_token = null,
           claimed_at = null
     where id = p_alert_id;
  elsif p_permanent or v_attempts >= 8 then
    update public.geofence_breach_alerts
       set delivery_status = 'permanent_failure',
           failed_count = failed_count + greatest(p_failed_count, 1),
           last_error = left(coalesce(p_error, 'Push delivery permanently failed'), 1000),
           claim_token = null,
           claimed_at = null
     where id = p_alert_id;
  else
    update public.geofence_breach_alerts
       set delivery_status = 'pending',
           failed_count = failed_count + greatest(p_failed_count, 1),
           last_error = left(coalesce(p_error, 'Push delivery failed'), 1000),
           next_attempt_at = clock_timestamp() + make_interval(
             secs => least(21600, (30 * power(2, greatest(v_attempts - 1, 0)))::integer)
           ),
           claim_token = null,
           claimed_at = null
     where id = p_alert_id;
  end if;
  return true;
end;
$$;

revoke all on function public.complete_breach_push_attempt(
  uuid, uuid, integer, integer, text, boolean
) from public, anon, authenticated;
grant execute on function public.complete_breach_push_attempt(
  uuid, uuid, integer, integer, text, boolean
) to service_role;

-- ---------------------------------------------------------------------------
-- Current advisor findings: missing FK indexes and one un-cached auth lookup.
-- ---------------------------------------------------------------------------
create index if not exists employee_account_invitations_auth_user_id_idx
  on public.employee_account_invitations (auth_user_id);
create index if not exists employee_account_invitations_invited_by_idx
  on public.employee_account_invitations (invited_by);
create index if not exists employee_account_invitations_organization_id_idx
  on public.employee_account_invitations (organization_id);
create index if not exists geofence_breach_alerts_breach_id_idx
  on public.geofence_breach_alerts (breach_id);
create index if not exists geofence_breach_alerts_notification_id_idx
  on public.geofence_breach_alerts (notification_id);
create index if not exists geofence_breach_alerts_organization_id_idx
  on public.geofence_breach_alerts (organization_id);
create index if not exists geofence_breach_alerts_recipient_user_id_idx
  on public.geofence_breach_alerts (recipient_user_id);
create index if not exists geofence_breaches_attendance_record_id_idx
  on public.geofence_breaches (attendance_record_id);
create index if not exists geofence_breaches_organization_employee_idx
  on public.geofence_breaches (organization_id, employee_id);
create index if not exists recurring_schedule_rules_organization_shift_idx
  on public.recurring_schedule_rules (organization_id, shift_id);
create index if not exists recurring_schedules_organization_employee_idx
  on public.recurring_schedules (organization_id, employee_id);

drop policy if exists employee_account_invitations_admin
  on public.employee_account_invitations;
create policy employee_account_invitations_admin
  on public.employee_account_invitations
  for all to authenticated
  using ((select private.has_org_role(organization_id, array['administrator'])))
  with check (
    (select private.has_org_role(organization_id, array['administrator']))
    and invited_by = (select auth.uid())
  );

-- Consolidate administrator/manager UPDATE into one policy so Postgres does
-- not evaluate overlapping permissive policies for every employee row.
drop policy if exists employee_profiles_manage_admin on public.employee_profiles;
drop policy if exists employee_profiles_update_manager_scope on public.employee_profiles;
drop policy if exists employee_profiles_manage_admin_insert on public.employee_profiles;
drop policy if exists employee_profiles_manage_admin_update on public.employee_profiles;
drop policy if exists employee_profiles_manage_admin_delete on public.employee_profiles;

create policy employee_profiles_manage_admin_insert
  on public.employee_profiles for insert to authenticated
  with check (
    (select private.has_org_role(organization_id, array['administrator']))
    and private.valid_employee_references(
      organization_id, branch_id, department_id, manager_user_id
    )
  );
create policy employee_profiles_manage_scoped_update
  on public.employee_profiles for update to authenticated
  using (
    (select private.has_org_role(organization_id, array['administrator']))
    or (
      (select private.has_org_role(organization_id, array['manager']))
      and private.can_access_employee(organization_id, id)
    )
  )
  with check (
    (
      (select private.has_org_role(organization_id, array['administrator']))
      or (
        (select private.has_org_role(organization_id, array['manager']))
        and private.can_access_employee(organization_id, id)
      )
    )
    and private.valid_employee_references(
      organization_id, branch_id, department_id, manager_user_id
    )
  );
create policy employee_profiles_manage_admin_delete
  on public.employee_profiles for delete to authenticated
  using ((select private.has_org_role(organization_id, array['administrator'])));

-- ---------------------------------------------------------------------------
-- Operational failure state and cron monitor. It emits one administrator
-- notification per failed cron run instead of allowing failures to continue
-- silently. No employee data or secret values are recorded here.
-- ---------------------------------------------------------------------------
create table if not exists private.cron_failure_alert_state (
  job_name text primary key,
  last_failed_run_id bigint not null,
  notified_at timestamptz not null default clock_timestamp()
);
revoke all on table private.cron_failure_alert_state
  from public, anon, authenticated, service_role;

create table if not exists private.notification_failure_alert_state (
  breach_alert_id uuid primary key
    references public.geofence_breach_alerts(id) on delete cascade,
  notified_at timestamptz not null default clock_timestamp()
);
revoke all on table private.notification_failure_alert_state
  from public, anon, authenticated, service_role;

create or replace function private.monitor_geotrack_cron_failures()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_alerts integer := 0;
begin
  for r in
    select distinct on (j.jobid)
           j.jobname, d.runid, d.status, d.end_time
    from cron.job j
    join cron.job_run_details d on d.jobid = j.jobid
    where j.active
      and j.jobname like 'geotrack-%'
      and j.jobname <> 'geotrack-cron-failure-monitor'
    order by j.jobid, d.start_time desc
  loop
    if r.status = 'failed' and not exists (
      select 1 from private.cron_failure_alert_state s
      where s.job_name = r.jobname and s.last_failed_run_id = r.runid
    ) then
      insert into public.notifications (
        organization_id, recipient_user_id, notification_type, severity,
        title, body, entity_type
      )
      select m.organization_id, m.user_id, 'system', 'error',
             'Scheduled job failure',
             'Operational job ' || r.jobname ||
               ' failed at ' || coalesce(r.end_time, clock_timestamp())::text ||
               '. Review the Supabase Cron history.',
             'cron_job'
      from public.organization_memberships m
      where m.status::text = 'active'
        and m.role_code::text = 'administrator';

      insert into private.cron_failure_alert_state (
        job_name, last_failed_run_id, notified_at
      ) values (r.jobname, r.runid, clock_timestamp())
      on conflict (job_name) do update set
        last_failed_run_id = excluded.last_failed_run_id,
        notified_at = excluded.notified_at;
      v_alerts := v_alerts + 1;
    end if;
  end loop;

  -- A successful cron invocation does not mean FCM accepted a message. Surface
  -- terminal downstream failures once to organization administrators without
  -- re-enqueuing the same broken push and creating an alert loop.
  for r in
    select a.id, a.organization_id, a.attempt_count, a.last_attempt_at
    from public.geofence_breach_alerts a
    where a.delivery_status = 'permanent_failure'
      and not exists (
        select 1 from private.notification_failure_alert_state s
        where s.breach_alert_id = a.id
      )
    order by a.last_attempt_at nulls last, a.created_at
    limit 500
  loop
    insert into public.notifications (
      organization_id, recipient_user_id, notification_type, severity,
      title, body, entity_type, entity_id
    )
    select m.organization_id, m.user_id, 'system', 'error',
           'Critical notification delivery failure',
           'A geofence breach push could not be delivered after ' ||
             r.attempt_count::text ||
             ' attempt(s). Review push-token and Edge Function health.',
           'geofence_breach_alert', r.id
    from public.organization_memberships m
    where m.organization_id = r.organization_id
      and m.status::text = 'active'
      and m.role_code::text = 'administrator';

    insert into private.notification_failure_alert_state (
      breach_alert_id, notified_at
    ) values (r.id, clock_timestamp())
    on conflict (breach_alert_id) do nothing;
    v_alerts := v_alerts + 1;
  end loop;
  return v_alerts;
end;
$$;

revoke all on function private.monitor_geotrack_cron_failures()
  from public, anon, authenticated;
grant execute on function private.monitor_geotrack_cron_failures() to service_role;

do $cron$
begin
  create extension if not exists pg_cron;
  perform cron.schedule(
    'geotrack-cron-failure-monitor',
    '*/5 * * * *',
    $job$ select private.monitor_geotrack_cron_failures(); $job$
  );
exception when others then
  raise notice 'Cron failure monitor was not scheduled: %', sqlerrm;
end
$cron$;

-- Replace credential text embedded in cron.job with runtime Vault lookup. The
-- deployment runbook creates/rotates these two named secrets before applying
-- this migration. If either is absent, disable the unsafe dispatcher job.
do $secure_dispatch$
declare
  v_has_url boolean := false;
  v_has_secret boolean := false;
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    select exists (
      select 1 from vault.decrypted_secrets where name = 'geotrack_project_url'
    ) into v_has_url;
    select exists (
      select 1 from vault.decrypted_secrets where name = 'geotrack_breach_dispatch_secret'
    ) into v_has_secret;
  end if;

  if v_has_url and v_has_secret then
    perform cron.schedule(
      'geotrack-dispatch-breach-alerts',
      '*/3 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets
            where name = 'geotrack_project_url'
          ) || '/functions/v1/dispatch-breach-alerts',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret from vault.decrypted_secrets
              where name = 'geotrack_breach_dispatch_secret'
            )
          ),
          body := jsonb_build_object('scheduled_at', clock_timestamp()),
          timeout_milliseconds := 10000
        );
      $job$
    );
  elsif exists (select 1 from cron.job where jobname = 'geotrack-dispatch-breach-alerts') then
    perform cron.alter_job(
      job_id := (select jobid from cron.job where jobname = 'geotrack-dispatch-breach-alerts'),
      active := false
    );
    raise warning 'Breach dispatcher disabled until geotrack_project_url and geotrack_breach_dispatch_secret exist in Vault';
  end if;
exception when others then
  raise warning 'Secure breach dispatcher schedule requires operator review: %', sqlerrm;
end
$secure_dispatch$;
