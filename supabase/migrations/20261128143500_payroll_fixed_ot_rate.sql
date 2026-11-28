-- ============================================================================
-- Support editable fixed hourly overtime rate (e.g. 12 SAR/hr) alongside
-- multiplier-based overtime in payroll settings and payroll run calculation.
-- ============================================================================

alter table public.payroll_settings
  add column if not exists overtime_rate_mode text not null default 'multiplier'
    check (overtime_rate_mode in ('multiplier', 'fixed_hourly')),
  add column if not exists overtime_hourly_rate numeric(10,2) not null default 0
    check (overtime_hourly_rate >= 0 and overtime_hourly_rate <= 10000);

alter table public.payroll_runs
  add column if not exists overtime_rate_mode text not null default 'multiplier'
    check (overtime_rate_mode in ('multiplier', 'fixed_hourly')),
  add column if not exists overtime_hourly_rate numeric(10,2) not null default 0
    check (overtime_hourly_rate >= 0 and overtime_hourly_rate <= 10000);

drop function if exists public.get_payroll_settings(uuid);
create or replace function public.get_payroll_settings(p_organization_id uuid)
returns table (
  organization_id uuid,
  currency_code text,
  month_basis_days integer,
  daily_hours numeric,
  overtime_multiplier numeric,
  overtime_rate_mode text,
  overtime_hourly_rate numeric,
  updated_at timestamptz
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
  if not private.has_org_role(p_organization_id, array['administrator', 'manager']) then
    raise exception 'Payroll access denied' using errcode = '42501';
  end if;

  return query
  select
    p_organization_id,
    coalesce(ps.currency_code, 'SAR'),
    coalesce(ps.month_basis_days, 30),
    coalesce(ps.daily_hours, 8.00),
    coalesce(ps.overtime_multiplier, 1.50),
    coalesce(ps.overtime_rate_mode, 'multiplier'),
    coalesce(ps.overtime_hourly_rate, 0.00),
    ps.updated_at
  from public.organizations o
  left join public.payroll_settings ps on ps.organization_id = o.id
  where o.id = p_organization_id;
end;
$$;

revoke all on function public.get_payroll_settings(uuid) from public, anon;
grant execute on function public.get_payroll_settings(uuid) to authenticated;

drop function if exists public.upsert_payroll_settings(uuid, text, integer, numeric, numeric);
create or replace function public.upsert_payroll_settings(
  p_organization_id uuid,
  p_currency_code text,
  p_month_basis_days integer,
  p_daily_hours numeric,
  p_overtime_multiplier numeric,
  p_overtime_rate_mode text default 'multiplier',
  p_overtime_hourly_rate numeric default 0
)
returns public.payroll_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.payroll_settings;
  v_mode text := coalesce(nullif(btrim(p_overtime_rate_mode), ''), 'multiplier');
  v_hourly_rate numeric(10,2) := round(coalesce(p_overtime_hourly_rate, 0), 2);
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator role required' using errcode = '42501';
  end if;
  if v_mode not in ('multiplier', 'fixed_hourly') then
    raise exception 'Invalid overtime rate mode' using errcode = '22023';
  end if;

  insert into public.payroll_settings (
    organization_id, currency_code, month_basis_days, daily_hours,
    overtime_multiplier, overtime_rate_mode, overtime_hourly_rate, updated_by
  ) values (
    p_organization_id, upper(btrim(p_currency_code)), p_month_basis_days, p_daily_hours,
    p_overtime_multiplier, v_mode, v_hourly_rate, (select auth.uid())
  )
  on conflict (organization_id) do update
    set currency_code = excluded.currency_code,
        month_basis_days = excluded.month_basis_days,
        daily_hours = excluded.daily_hours,
        overtime_multiplier = excluded.overtime_multiplier,
        overtime_rate_mode = excluded.overtime_rate_mode,
        overtime_hourly_rate = excluded.overtime_hourly_rate,
        updated_by = excluded.updated_by
  returning * into v_row;

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, after_data)
  values (p_organization_id, (select auth.uid()), 'payroll_settings_updated', 'payroll_settings', p_organization_id, to_jsonb(v_row));

  return v_row;
end;
$$;

revoke all on function public.upsert_payroll_settings(uuid, text, integer, numeric, numeric, text, numeric) from public, anon;
grant execute on function public.upsert_payroll_settings(uuid, text, integer, numeric, numeric, text, numeric) to authenticated;

create or replace function public.generate_payroll_run(
  p_organization_id uuid,
  p_payroll_month date
)
returns public.payroll_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month_start date := date_trunc('month', p_payroll_month)::date;
  v_month_end date := (date_trunc('month', p_payroll_month) + interval '1 month - 1 day')::date;
  v_org_tz text;
  v_today_org date;
  v_currency text := 'SAR';
  v_basis_days integer := 30;
  v_daily_hours numeric(5,2) := 8.00;
  v_ot_multiplier numeric(5,2) := 1.50;
  v_ot_rate_mode text := 'multiplier';
  v_ot_hourly_rate numeric(10,2) := 0.00;
  v_run public.payroll_runs;
  v_emp record;
  v_join_date date;
  v_active_from date;
  v_active_to date;
  v_active_days integer;
  v_entry_id uuid;
  v_prev_review_status public.payroll_review_status;
  v_prev_reviewed_by uuid;
  v_prev_reviewed_at timestamptz;
  v_prev_review_note text;
  v_prev_fingerprint text;
  v_comp record;
  v_seg_from date;
  v_seg_to date;
  v_seg_days integer;
  v_seg_amount numeric(12,2);
  v_total_payable_days numeric(6,2);
  v_base_pay numeric(12,2);
  v_allowances_pay numeric(12,2);
  v_recurring_deductions numeric(12,2);
  v_overtime_pay numeric(12,2);
  v_approved_ot_min integer;
  v_pending_ot_min integer;
  v_pending_ot_count integer;
  v_ot_rec record;
  v_ot_salary numeric(12,2);
  v_ot_amount numeric(12,2);
  v_absence_deduction numeric(12,2);
  v_unpaid_leave_deduction numeric(12,2);
  v_absent_days integer;
  v_unpaid_days integer;
  v_sched_working_days integer;
  v_worked_days integer;
  v_day_rec record;
  v_day_salary numeric(12,2);
  v_day_deduction numeric(12,2);
  v_is_unpaid_leave boolean;
  v_is_paid_leave boolean;
  v_att record;
  v_manual_add numeric(12,2);
  v_manual_ded numeric(12,2);
  v_unresolved integer;
  v_gross numeric(12,2);
  v_total_ded numeric(12,2);
  v_net numeric(12,2);
  v_new_fingerprint text;
  v_waived_exceptions jsonb;
  v_waived_item jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator role required to generate payroll' using errcode = '42501';
  end if;

  select o.timezone into v_org_tz
  from public.organizations o
  where o.id = p_organization_id;

  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;

  v_org_tz := coalesce(nullif(btrim(v_org_tz), ''), 'UTC');
  v_today_org := (clock_timestamp() at time zone v_org_tz)::date;

  select
    coalesce(ps.currency_code, 'SAR'),
    coalesce(ps.month_basis_days, 30),
    coalesce(ps.daily_hours, 8.00),
    coalesce(ps.overtime_multiplier, 1.50),
    coalesce(ps.overtime_rate_mode, 'multiplier'),
    coalesce(ps.overtime_hourly_rate, 0.00)
  into v_currency, v_basis_days, v_daily_hours, v_ot_multiplier, v_ot_rate_mode, v_ot_hourly_rate
  from public.organizations o
  left join public.payroll_settings ps on ps.organization_id = o.id
  where o.id = p_organization_id;

  select * into v_run
  from public.payroll_runs
  where organization_id = p_organization_id
    and payroll_month = v_month_start;

  if found then
    if v_run.status = 'finalized' then
      raise exception 'Finalized payroll run cannot be regenerated; reopen it first' using errcode = '42501';
    end if;

    -- Refresh settings snapshot while not finalized
    update public.payroll_runs
    set currency_code = v_currency,
        month_basis_days = v_basis_days,
        daily_hours = v_daily_hours,
        overtime_multiplier = v_ot_multiplier,
        overtime_rate_mode = v_ot_rate_mode,
        overtime_hourly_rate = v_ot_hourly_rate,
        organization_timezone = v_org_tz,
        generated_at = clock_timestamp(),
        generated_by = (select auth.uid())
    where id = v_run.id
    returning * into v_run;
  else
    insert into public.payroll_runs (
      organization_id, payroll_month, status,
      currency_code, month_basis_days, daily_hours,
      overtime_multiplier, overtime_rate_mode, overtime_hourly_rate, organization_timezone,
      generated_at, generated_by, created_by
    ) values (
      p_organization_id, v_month_start, 'draft',
      v_currency, v_basis_days, v_daily_hours,
      v_ot_multiplier, v_ot_rate_mode, v_ot_hourly_rate, v_org_tz,
      clock_timestamp(), (select auth.uid()), (select auth.uid())
    )
    returning * into v_run;
  end if;

  -- Remove non-manual line items for regeneration; manual items stay intact
  delete from public.payroll_line_items
  where payroll_run_id = v_run.id
    and is_manual = false;

  for v_emp in
    select
      e.id,
      e.employee_code,
      e.full_name,
      e.branch_id,
      b.name as branch_name,
      e.department_id,
      d.name as department_name,
      e.job_title,
      e.joining_date,
      e.status_effective_date,
      e.employment_status,
      e.created_at
    from public.employee_profiles e
    join public.branches b on b.id = e.branch_id
    join public.departments d on d.id = e.department_id
    where e.organization_id = p_organization_id
    order by e.employee_code
  loop
    v_join_date := coalesce(v_emp.joining_date, v_emp.created_at::date);
    v_active_from := greatest(v_month_start, v_join_date);
    v_active_to := v_month_end;

    if v_emp.employment_status::text = 'active' then
      if v_emp.status_effective_date is not null and v_emp.status_effective_date > v_active_from then
        v_active_from := v_emp.status_effective_date;
      end if;
    elsif v_emp.employment_status::text in ('inactive', 'terminated') then
      if v_emp.status_effective_date is not null and v_emp.status_effective_date <> v_join_date then
        v_active_to := least(v_month_end, v_emp.status_effective_date);
      else
        -- Inactive without distinct effective date -> not active
        v_active_to := v_active_from - 1;
      end if;
    end if;

    if v_active_from > v_active_to then
      delete from public.payroll_entries
      where payroll_run_id = v_run.id and employee_id = v_emp.id;
      continue;
    end if;

    v_active_days := (v_active_to - v_active_from + 1);

    select id, review_status, reviewed_by, reviewed_at, review_note, source_fingerprint
    into v_entry_id, v_prev_review_status, v_prev_reviewed_by, v_prev_reviewed_at, v_prev_review_note, v_prev_fingerprint
    from public.payroll_entries
    where payroll_run_id = v_run.id and employee_id = v_emp.id;

    if v_entry_id is null then
      insert into public.payroll_entries (
        payroll_run_id, organization_id, employee_id,
        employee_code, employee_name, branch_id, branch_name, department_id, department_name, job_title,
        currency_code
      ) values (
        v_run.id, p_organization_id, v_emp.id,
        v_emp.employee_code, v_emp.full_name, v_emp.branch_id, v_emp.branch_name, v_emp.department_id, v_emp.department_name, v_emp.job_title,
        v_currency
      )
      returning id into v_entry_id;
    else
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'work_date', px.work_date,
          'exception_type', px.exception_type::text,
          'minutes', px.minutes,
          'waive_reason', px.waive_reason,
          'resolved_by', px.resolved_by,
          'resolved_at', px.resolved_at
        )),
        '[]'::jsonb
      ) into v_waived_exceptions
      from public.payroll_exceptions px
      where px.payroll_entry_id = v_entry_id
        and px.status = 'waived';

      delete from public.payroll_exceptions
      where payroll_entry_id = v_entry_id;
    end if;

    -- 1) Base Salary Segments
    v_base_pay := 0;
    v_total_payable_days := 0;

    for v_comp in
      select c.id, c.monthly_base_salary, c.effective_from, c.effective_to
      from public.employee_compensations c
      where c.organization_id = p_organization_id
        and c.employee_id = v_emp.id
        and daterange(c.effective_from, coalesce(c.effective_to, 'infinity'::date), '[]')
         && daterange(v_active_from, v_active_to, '[]')
      order by c.effective_from
    loop
      v_seg_from := greatest(v_active_from, v_comp.effective_from);
      v_seg_to := least(v_active_to, coalesce(v_comp.effective_to, v_active_to));
      v_seg_days := private.payroll_days_in_segment(
        v_seg_from, v_seg_to, v_month_start, v_month_end, v_active_from, v_active_to, v_basis_days
      );

      if v_seg_days > 0 then
        v_seg_amount := round(v_comp.monthly_base_salary * (v_seg_days::numeric / v_basis_days::numeric), 2);
        v_base_pay := round(v_base_pay + v_seg_amount, 2);
        v_total_payable_days := v_total_payable_days + v_seg_days;

        insert into public.payroll_line_items (
          payroll_run_id, payroll_entry_id, organization_id, employee_id,
          category, direction, code, label, is_manual,
          quantity, unit, rate, amount, metadata
        ) values (
          v_run.id, v_entry_id, p_organization_id, v_emp.id,
          'base_salary', 'earning', 'BASE',
          format('Base Salary (%s to %s)', v_seg_from, v_seg_to),
          false,
          v_seg_days, 'days', round(v_comp.monthly_base_salary / v_basis_days::numeric, 4), v_seg_amount,
          jsonb_build_object('from', v_seg_from, 'to', v_seg_to, 'monthly_salary', v_comp.monthly_base_salary)
        );
      end if;
    end loop;

    -- 2) Recurring Allowances & Deductions
    v_allowances_pay := 0;
    v_recurring_deductions := 0;

    for v_comp in
      select c.id, c.component_kind, c.code, c.name, c.amount, c.effective_from, c.effective_to
      from public.employee_payroll_components c
      where c.organization_id = p_organization_id
        and c.employee_id = v_emp.id
        and c.is_active = true
        and daterange(c.effective_from, coalesce(c.effective_to, 'infinity'::date), '[]')
         && daterange(v_active_from, v_active_to, '[]')
      order by c.component_kind, c.code
    loop
      v_seg_from := greatest(v_active_from, v_comp.effective_from);
      v_seg_to := least(v_active_to, coalesce(v_comp.effective_to, v_active_to));
      v_seg_days := private.payroll_days_in_segment(
        v_seg_from, v_seg_to, v_month_start, v_month_end, v_active_from, v_active_to, v_basis_days
      );

      if v_seg_days > 0 then
        v_seg_amount := round(v_comp.amount * (v_seg_days::numeric / v_basis_days::numeric), 2);
        if v_comp.component_kind = 'allowance' then
          v_allowances_pay := round(v_allowances_pay + v_seg_amount, 2);
          insert into public.payroll_line_items (
            payroll_run_id, payroll_entry_id, organization_id, employee_id,
            category, direction, code, label, is_manual,
            quantity, unit, rate, amount, metadata
          ) values (
            v_run.id, v_entry_id, p_organization_id, v_emp.id,
            'allowance', 'earning', v_comp.code, v_comp.name, false,
            v_seg_days, 'days', round(v_comp.amount / v_basis_days::numeric, 4), v_seg_amount,
            jsonb_build_object('component_id', v_comp.id, 'from', v_seg_from, 'to', v_seg_to)
          );
        else
          v_recurring_deductions := round(v_recurring_deductions + v_seg_amount, 2);
          insert into public.payroll_line_items (
            payroll_run_id, payroll_entry_id, organization_id, employee_id,
            category, direction, code, label, is_manual,
            quantity, unit, rate, amount, metadata
          ) values (
            v_run.id, v_entry_id, p_organization_id, v_emp.id,
            'recurring_deduction', 'deduction', v_comp.code, v_comp.name, false,
            v_seg_days, 'days', round(v_comp.amount / v_basis_days::numeric, 4), v_seg_amount,
            jsonb_build_object('component_id', v_comp.id, 'from', v_seg_from, 'to', v_seg_to)
          );
        end if;
      end if;
    end loop;

    -- 3) Overtime (multiplier of hourly base salary OR fixed hourly rate; pending tracked as blocker)
    v_overtime_pay := 0;
    v_approved_ot_min := 0;
    v_pending_ot_min := 0;
    v_pending_ot_count := 0;

    for v_ot_rec in
      select
        ot.id,
        ot.status,
        ot.requested_minutes,
        coalesce(ot.approved_minutes, ot.requested_minutes, 0) as eff_approved_minutes,
        ar.attendance_date
      from public.overtime_records ot
      join public.attendance_records ar on ar.id = ot.attendance_record_id
      where ot.organization_id = p_organization_id
        and ot.employee_id = v_emp.id
        and ar.attendance_date between v_active_from and v_active_to
    loop
      if v_ot_rec.status::text = 'pending' then
        v_pending_ot_count := v_pending_ot_count + 1;
        v_pending_ot_min := v_pending_ot_min + coalesce(v_ot_rec.requested_minutes, 0);
      elsif v_ot_rec.status::text = 'approved' and v_ot_rec.eff_approved_minutes > 0 then
        v_approved_ot_min := v_approved_ot_min + v_ot_rec.eff_approved_minutes;
        if v_ot_rate_mode = 'fixed_hourly' then
          if v_ot_hourly_rate > 0 then
            v_ot_amount := round((v_ot_rec.eff_approved_minutes::numeric / 60.0) * v_ot_hourly_rate, 2);
            v_overtime_pay := round(v_overtime_pay + v_ot_amount, 2);
          end if;
        else
          select c.monthly_base_salary into v_ot_salary
          from public.employee_compensations c
          where c.organization_id = p_organization_id
            and c.employee_id = v_emp.id
            and v_ot_rec.attendance_date between c.effective_from and coalesce(c.effective_to, v_active_to)
          order by c.effective_from desc
          limit 1;

          v_ot_salary := coalesce(v_ot_salary, 0);
          if v_ot_salary > 0 then
            v_ot_amount := round(
              (v_ot_rec.eff_approved_minutes::numeric / 60.0)
              * (v_ot_salary / (v_basis_days::numeric * v_daily_hours))
              * v_ot_multiplier,
              2
            );
            v_overtime_pay := round(v_overtime_pay + v_ot_amount, 2);
          end if;
        end if;
      end if;
    end loop;

    if v_approved_ot_min > 0 then
      insert into public.payroll_line_items (
        payroll_run_id, payroll_entry_id, organization_id, employee_id,
        category, direction, code, label, is_manual,
        quantity, unit, rate, amount, metadata
      ) values (
        v_run.id, v_entry_id, p_organization_id, v_emp.id,
        'overtime', 'earning', 'OT',
        case
          when v_ot_rate_mode = 'fixed_hourly'
            then format('Approved Overtime (%s hrs @ %s %s/hr)', round(v_approved_ot_min::numeric / 60.0, 2), v_ot_hourly_rate, v_currency)
          else format('Approved Overtime (%s hrs @ %sx)', round(v_approved_ot_min::numeric / 60.0, 2), v_ot_multiplier)
        end,
        false,
        round(v_approved_ot_min::numeric / 60.0, 4), 'hours',
        case when v_approved_ot_min > 0 then round(v_overtime_pay / (v_approved_ot_min::numeric / 60.0), 4) else 0 end,
        v_overtime_pay,
        jsonb_build_object(
          'approved_minutes', v_approved_ot_min,
          'rate_mode', v_ot_rate_mode,
          'hourly_rate', v_ot_hourly_rate,
          'multiplier', v_ot_multiplier
        )
      );
    end if;

    -- 4) Daily Schedule, Absences, Unpaid Leave (no double counting), and Attendance Exceptions
    v_absence_deduction := 0;
    v_unpaid_leave_deduction := 0;
    v_absent_days := 0;
    v_unpaid_days := 0;
    v_sched_working_days := 0;
    v_worked_days := 0;

    for v_day_rec in
      select s.work_date, s.state
      from private.resolve_employee_schedule_internal(v_emp.id, v_active_from, v_active_to) s
      order by s.work_date
    loop
      if v_day_rec.state = 'working' then
        v_sched_working_days := v_sched_working_days + 1;
      end if;

      select exists (
        select 1 from public.leave_requests lr
        where lr.organization_id = p_organization_id
          and lr.employee_id = v_emp.id
          and lr.status = 'approved'
          and lr.leave_type = 'unpaid'
          and v_day_rec.work_date between lr.from_date and lr.to_date
      ) into v_is_unpaid_leave;

      select exists (
        select 1 from public.leave_requests lr
        where lr.organization_id = p_organization_id
          and lr.employee_id = v_emp.id
          and lr.status = 'approved'
          and lr.leave_type <> 'unpaid'
          and v_day_rec.work_date between lr.from_date and lr.to_date
      ) into v_is_paid_leave;

      select c.monthly_base_salary into v_day_salary
      from public.employee_compensations c
      where c.organization_id = p_organization_id
        and c.employee_id = v_emp.id
        and v_day_rec.work_date between c.effective_from and coalesce(c.effective_to, v_active_to)
      order by c.effective_from desc
      limit 1;
      v_day_salary := coalesce(v_day_salary, 0);
      v_day_deduction := round(v_day_salary / v_basis_days::numeric, 2);

      select * into v_att
      from public.attendance_records ar
      where ar.organization_id = p_organization_id
        and ar.employee_id = v_emp.id
        and ar.attendance_date = v_day_rec.work_date
      order by ar.session_number asc
      limit 1;

      if found and coalesce(v_att.worked_minutes, 0) > 0 then
        v_worked_days := v_worked_days + 1;
      end if;

      if v_is_unpaid_leave then
        v_unpaid_days := v_unpaid_days + 1;
        v_unpaid_leave_deduction := round(v_unpaid_leave_deduction + v_day_deduction, 2);
      elsif not v_is_paid_leave and v_day_rec.state = 'working' then
        if v_att.id is not null then
          if v_att.status::text = 'absent' then
            v_absent_days := v_absent_days + 1;
            v_absence_deduction := round(v_absence_deduction + v_day_deduction, 2);
          elsif v_att.status::text <> 'on_leave' then
            if v_att.status::text in ('missing_check_in', 'missing_check_out', 'invalid')
               or (v_att.check_in_at is not null and v_att.check_out_at is null)
               or (v_att.check_out_at is not null and v_att.check_in_at is null) then
              insert into public.payroll_exceptions (
                payroll_run_id, payroll_entry_id, organization_id, employee_id,
                work_date, exception_type, minutes, attendance_record_id, status
              ) values (
                v_run.id, v_entry_id, p_organization_id, v_emp.id,
                v_day_rec.work_date, 'incomplete_attendance', coalesce(v_att.missing_minutes, 0), v_att.id, 'open'
              )
              on conflict (payroll_entry_id, work_date, exception_type) do nothing;
            end if;

            if coalesce(v_att.late_minutes, 0) > 0 then
              insert into public.payroll_exceptions (
                payroll_run_id, payroll_entry_id, organization_id, employee_id,
                work_date, exception_type, minutes, attendance_record_id, status
              ) values (
                v_run.id, v_entry_id, p_organization_id, v_emp.id,
                v_day_rec.work_date, 'late', v_att.late_minutes, v_att.id, 'open'
              )
              on conflict (payroll_entry_id, work_date, exception_type) do nothing;
            end if;

            if coalesce(v_att.early_leaving_minutes, 0) > 0 then
              insert into public.payroll_exceptions (
                payroll_run_id, payroll_entry_id, organization_id, employee_id,
                work_date, exception_type, minutes, attendance_record_id, status
              ) values (
                v_run.id, v_entry_id, p_organization_id, v_emp.id,
                v_day_rec.work_date, 'early_departure', v_att.early_leaving_minutes, v_att.id, 'open'
              )
              on conflict (payroll_entry_id, work_date, exception_type) do nothing;
            end if;
          end if;
        elsif v_day_rec.work_date < v_today_org then
          insert into public.payroll_exceptions (
            payroll_run_id, payroll_entry_id, organization_id, employee_id,
            work_date, exception_type, minutes, attendance_record_id, status
          ) values (
            v_run.id, v_entry_id, p_organization_id, v_emp.id,
            v_day_rec.work_date, 'incomplete_attendance', round(v_daily_hours * 60)::integer, null, 'open'
          )
          on conflict (payroll_entry_id, work_date, exception_type) do nothing;
        end if;
      end if;
    end loop;

    if v_waived_exceptions is not null and jsonb_array_length(v_waived_exceptions) > 0 then
      for v_waived_item in select * from jsonb_array_elements(v_waived_exceptions)
      loop
        update public.payroll_exceptions
        set status = 'waived',
            waive_reason = v_waived_item->>'waive_reason',
            resolved_by = nullif(v_waived_item->>'resolved_by', '')::uuid,
            resolved_at = nullif(v_waived_item->>'resolved_at', '')::timestamptz
        where payroll_entry_id = v_entry_id
          and work_date = (v_waived_item->>'work_date')::date
          and exception_type::text = v_waived_item->>'exception_type'
          and minutes = (v_waived_item->>'minutes')::integer;
      end loop;
    end if;

    if v_absent_days > 0 then
      insert into public.payroll_line_items (
        payroll_run_id, payroll_entry_id, organization_id, employee_id,
        category, direction, code, label, is_manual,
        quantity, unit, rate, amount, metadata
      ) values (
        v_run.id, v_entry_id, p_organization_id, v_emp.id,
        'absence_deduction', 'deduction', 'ABSENCE',
        format('Confirmed Absence Deduction (%s days)', v_absent_days),
        false,
        v_absent_days, 'days', round(v_absence_deduction / v_absent_days::numeric, 4), v_absence_deduction,
        jsonb_build_object('absent_days', v_absent_days)
      );
    end if;

    if v_unpaid_days > 0 then
      insert into public.payroll_line_items (
        payroll_run_id, payroll_entry_id, organization_id, employee_id,
        category, direction, code, label, is_manual,
        quantity, unit, rate, amount, metadata
      ) values (
        v_run.id, v_entry_id, p_organization_id, v_emp.id,
        'unpaid_leave_deduction', 'deduction', 'UNPAID_LEAVE',
        format('Approved Unpaid Leave Deduction (%s days)', v_unpaid_days),
        false,
        v_unpaid_days, 'days', round(v_unpaid_leave_deduction / v_unpaid_days::numeric, 4), v_unpaid_leave_deduction,
        jsonb_build_object('unpaid_leave_days', v_unpaid_days)
      );
    end if;

    select
      coalesce(round(sum(amount) filter (where is_manual and direction = 'earning'), 2), 0),
      coalesce(round(sum(amount) filter (where is_manual and direction = 'deduction'), 2), 0)
    into v_manual_add, v_manual_ded
    from public.payroll_line_items
    where payroll_entry_id = v_entry_id;

    select count(*)::integer into v_unresolved
    from public.payroll_exceptions
    where payroll_entry_id = v_entry_id and status = 'open';

    v_gross := round(v_base_pay + v_allowances_pay + v_overtime_pay + v_manual_add, 2);
    v_total_ded := round(v_absence_deduction + v_unpaid_leave_deduction + v_recurring_deductions + v_manual_ded, 2);
    v_net := round(v_gross - v_total_ded, 2);

    v_new_fingerprint := md5(concat_ws('|',
      v_total_payable_days::text,
      v_base_pay::text,
      v_allowances_pay::text,
      v_overtime_pay::text,
      v_manual_add::text,
      v_absence_deduction::text,
      v_unpaid_leave_deduction::text,
      v_recurring_deductions::text,
      v_manual_ded::text,
      v_pending_ot_count::text,
      v_unresolved::text
    ));

    if v_prev_fingerprint is not null and v_prev_fingerprint = v_new_fingerprint and v_prev_review_status = 'reviewed' then
      null;
    else
      v_prev_review_status := 'pending';
      v_prev_reviewed_by := null;
      v_prev_reviewed_at := null;
      v_prev_review_note := null;
    end if;

    update public.payroll_entries
    set employee_code = v_emp.employee_code,
        employee_name = v_emp.full_name,
        branch_id = v_emp.branch_id,
        branch_name = v_emp.branch_name,
        department_id = v_emp.department_id,
        department_name = v_emp.department_name,
        job_title = v_emp.job_title,
        active_days = v_active_days,
        payable_days = v_total_payable_days,
        scheduled_working_days = v_sched_working_days,
        worked_days = v_worked_days,
        absent_days = v_absent_days,
        unpaid_leave_days = v_unpaid_days,
        approved_overtime_minutes = v_approved_ot_min,
        pending_overtime_minutes = v_pending_ot_min,
        pending_overtime_count = v_pending_ot_count,
        unresolved_exception_count = v_unresolved,
        base_pay = v_base_pay,
        allowances_pay = v_allowances_pay,
        overtime_pay = v_overtime_pay,
        manual_additions = v_manual_add,
        absence_deduction = v_absence_deduction,
        unpaid_leave_deduction = v_unpaid_leave_deduction,
        recurring_deductions = v_recurring_deductions,
        manual_deductions = v_manual_ded,
        gross_pay = v_gross,
        total_deductions = v_total_ded,
        net_pay = v_net,
        currency_code = v_currency,
        review_status = v_prev_review_status,
        reviewed_by = v_prev_reviewed_by,
        reviewed_at = v_prev_reviewed_at,
        review_note = v_prev_review_note,
        source_fingerprint = v_new_fingerprint
    where id = v_entry_id;
  end loop;

  update public.payroll_runs r
  set employee_count = coalesce((select count(*)::integer from public.payroll_entries e where e.payroll_run_id = v_run.id), 0),
      total_gross_pay = coalesce((select round(sum(e.gross_pay), 2) from public.payroll_entries e where e.payroll_run_id = v_run.id), 0),
      total_deductions = coalesce((select round(sum(e.total_deductions), 2) from public.payroll_entries e where e.payroll_run_id = v_run.id), 0),
      total_net_pay = coalesce((select round(sum(e.net_pay), 2) from public.payroll_entries e where e.payroll_run_id = v_run.id), 0)
  where r.id = v_run.id
  returning * into v_run;

  return v_run;
end;
$$;
