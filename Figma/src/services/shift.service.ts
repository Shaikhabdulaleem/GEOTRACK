import { getSupabaseClient } from '../lib/supabase';
import { notificationService } from './notification.service';
import { executeQuery } from './database.service';
import { AppError } from '../lib/errors';
import type {
  ShiftRow,
  ShiftAssignmentRow,
  WeeklyOffRow,
  EmployeeProfileRow,
  TablesInsert,
  TablesUpdate,
  RecordStatus,
} from '../types/database';
import { logger } from '../lib/logger';

// ─────────────────────────────────────────────
// Extended types for shift scheduling features
// ─────────────────────────────────────────────

export interface ShiftTemplate {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  /** 'HH:MM' 24-hour, e.g. '09:00' */
  start_time: string;
  /** 'HH:MM' 24-hour, e.g. '17:00' or '05:00' */
  end_time: string;
  /** true when end_time is on the following calendar day (e.g. 21:00→05:00) */
  crosses_midnight: boolean;
  break_minutes: number;
  color: string | null;
  status: RecordStatus;
  created_at: string;
  updated_at: string;
}

export interface WeeklySchedule {
  employee_id: string;
  employee_name: string;
  department: string;
  /** day index (0=Mon…6=Sun) → shift_id or 'OFF' | 'Leave' */
  days: Record<number, { shift_id: string | null; status: 'scheduled' | 'off' | 'leave' | 'cancelled' }>;
}

export interface ConflictResult {
  employeeId: string;
  workDate: string;
  existingShiftId: string | null;
  incomingShiftId: string | null;
  reason: string;
}

export interface ShiftSummary {
  shift: ShiftRow;
  employeeCount: number;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Returns true if start_time > end_time (numerically), meaning the shift crosses midnight. */
export function detectCrossesMidnight(start: string, end: string): boolean {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  return endMins <= startMins; // end is on the next day
}

function validateShiftTimes(start: string, end: string, breakMinutes: number): void {
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
  if (!timePattern.test(start) || !timePattern.test(end)) {
    throw new AppError('VALIDATION_ERROR', 'Shift times must use a valid 24-hour HH:MM format.');
  }
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0) {
    throw new AppError('VALIDATION_ERROR', 'Break minutes must be a non-negative whole number.');
  }
  const duration = shiftDurationMinutes(start, end);
  if (breakMinutes >= duration) {
    throw new AppError('VALIDATION_ERROR', 'Break time must be shorter than the shift duration.');
  }
}

/** Returns shift duration in minutes, handling midnight crossing. */
export function shiftDurationMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMins = sh * 60 + sm;
  let endMins = eh * 60 + em;
  if (endMins <= startMins) endMins += 24 * 60; // add 24 h for overnight
  return endMins - startMins;
}

/** Format HH:MM to 12-hour display. */
export function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** ISO date string YYYY-MM-DD for a given Date object (local). */
export function toISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Get an array of ISO date strings for a week starting on Monday. */
export function getWeekDates(weekStart: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return toISODate(d);
  });
}

/** Return the Monday of the week containing the given date. */
export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export const shiftService = {
  // ── Shift Templates ──────────────────────────

  /** List all active shift templates for an organization. */
  async listShifts(organizationId: string): Promise<ShiftRow[]> {
    return executeQuery(
      getSupabaseClient()
        .from('shifts')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .order('name'),
      'Unable to load shift templates.',
    );
  },

  /** Create a new shift template. crosses_midnight is auto-detected. */
  async createShift(input: {
    organization_id: string;
    code: string;
    name: string;
    start_time: string;
    end_time: string;
    break_minutes?: number;
    color?: string;
  }): Promise<ShiftRow> {
    validateShiftTimes(input.start_time, input.end_time, input.break_minutes ?? 0);
    if (!input.code.trim() || !input.name.trim()) {
      throw new AppError('VALIDATION_ERROR', 'Shift code and name are required.');
    }
    const crosses_midnight = detectCrossesMidnight(input.start_time, input.end_time);
    return executeQuery(
      getSupabaseClient()
        .from('shifts')
        .insert({
          organization_id: input.organization_id,
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          start_time: input.start_time,
          end_time: input.end_time,
          crosses_midnight,
          break_minutes: input.break_minutes ?? 0,
          color: input.color ?? null,
          status: 'active',
        } as TablesInsert<'shifts'>)
        .select('*')
        .single(),
      'Unable to create the shift template.',
    );
  },

  /** Update an existing shift template. crosses_midnight is recalculated. */
  async updateShift(shiftId: string, input: TablesUpdate<'shifts'>): Promise<ShiftRow> {
    const updates: TablesUpdate<'shifts'> = { ...input };
    if (input.start_time !== undefined || input.end_time !== undefined || input.break_minutes !== undefined) {
      // Re-derive crosses_midnight whenever times change
      const existing = (await executeQuery(
        getSupabaseClient().from('shifts').select('start_time,end_time,break_minutes').eq('id', shiftId).single(),
        'Unable to load shift.',
      )) as { start_time: string; end_time: string; break_minutes: number };
      const start = input.start_time ?? existing.start_time;
      const end = input.end_time ?? existing.end_time;
      validateShiftTimes(start, end, input.break_minutes ?? existing.break_minutes);
      updates.crosses_midnight = detectCrossesMidnight(start, end);
    }
    return executeQuery(
      getSupabaseClient().from('shifts').update(updates).eq('id', shiftId).select('*').single(),
      'Unable to update the shift template.',
    );
  },

  /** Soft-delete a shift template by setting status to 'inactive'. */
  async deactivateShift(shiftId: string): Promise<void> {
    const { error } = await getSupabaseClient()
      .from('shifts')
      .update({ status: 'inactive' } as TablesUpdate<'shifts'>)
      .eq('id', shiftId);
    if (error) throw error;
  },

  // ── Shift Assignments ────────────────────────

  /**
   * List shift assignments for a range of dates, with employee + shift data.
   */
  async listAssignments(input: {
    organization_id: string;
    from_date: string;
    to_date: string;
    employee_id?: string;
  }): Promise<(ShiftAssignmentRow & { shift: ShiftRow | null; employee: EmployeeProfileRow | null })[]> {
    let query = getSupabaseClient()
      .from('shift_assignments')
      .select('*, shift:shifts(*), employee:employee_profiles(*)')
      .eq('organization_id', input.organization_id)
      .gte('work_date', input.from_date)
      .lte('work_date', input.to_date)
      .order('work_date');

    if (input.employee_id) {
      query = query.eq('employee_id', input.employee_id);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as (ShiftAssignmentRow & { shift: ShiftRow | null; employee: EmployeeProfileRow | null })[];
  },

  /**
   * Assign a shift to an employee for a specific date.
   * Detects conflicts before saving. Throws if conflict found and force=false.
   */
  async assignShift(input: {
    organization_id: string;
    employee_id: string;
    shift_id: string | null;
    work_date: string;
    status?: 'scheduled' | 'off' | 'leave' | 'cancelled';
    source?: 'manual' | 'recurring' | 'imported';
    created_by?: string | null;
    force?: boolean;
  }): Promise<ShiftAssignmentRow> {
    // Conflict detection: check if employee already has a different assignment
    if (!input.force) {
      const existing = await this.getAssignment(input.organization_id, input.employee_id, input.work_date);
      if (existing && existing.shift_id !== input.shift_id) {
        throw new Error(
          `Conflict: ${input.employee_id} already has shift "${existing.shift_id ?? 'OFF'}" on ${input.work_date}. Use force=true to overwrite.`,
        );
      }
    }

    return executeQuery(
      getSupabaseClient()
        .from('shift_assignments')
        .upsert(
          {
            organization_id: input.organization_id,
            employee_id: input.employee_id,
            shift_id: input.shift_id,
            work_date: input.work_date,
            status: input.status ?? 'scheduled',
            source: input.source ?? 'manual',
            created_by: input.created_by ?? null,
          } as TablesInsert<'shift_assignments'>,
          { onConflict: 'employee_id,work_date' },
        )
        .select('*')
        .single(),
      'Unable to save the shift assignment.',
    ).then(async (assignment) => {
      // Notify employee of shift change
      try {
        const { data: empProfile } = await getSupabaseClient()
          .from('employee_profiles')
          .select('user_id')
          .eq('id', input.employee_id)
          .maybeSingle();
        if (empProfile?.user_id) {
          await notificationService.notifyUser({
            organization_id: input.organization_id,
            recipient_user_id: empProfile.user_id,
            notification_type: 'shift_change',
            severity: 'info',
            title: 'Shift Assignment Updated',
            body: 'Your shift has been changed.',
            entity_type: 'shift_assignment',
            entity_id: (assignment as unknown as ShiftAssignmentRow).id,
          });
        }
      } catch (e) {
      logger.warn('Failed to send shift notification.', { error: e });
      }
      return assignment as unknown as ShiftAssignmentRow;
    });
  },

  /** Get a single assignment for employee+date. */
  async getAssignment(
    organizationId: string,
    employeeId: string,
    workDate: string,
  ): Promise<ShiftAssignmentRow | null> {
    const { data } = await getSupabaseClient()
      .from('shift_assignments')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('employee_id', employeeId)
      .eq('work_date', workDate)
      .maybeSingle();
    return data;
  },

  /**
   * Apply a rotating schedule for a list of employees for a date range.
   * rotationPattern: array of shift_ids (or null for OFF) that repeats.
   * e.g. ['shift-day', 'shift-day', 'shift-day', 'shift-day', 'shift-day', null, null] = Mon–Fri day, Sat–Sun off
   */
  async applyRotatingSchedule(input: {
    organization_id: string;
    employee_ids: string[];
    from_date: string;
    to_date: string;
    rotation_pattern: (string | null)[];
    pattern_start_offset?: number;
    created_by?: string | null;
  }): Promise<ShiftAssignmentRow[]> {
    const { rotation_pattern, pattern_start_offset = 0 } = input;
    const from = new Date(input.from_date);
    const to = new Date(input.to_date);
    const rows: TablesInsert<'shift_assignments'>[] = [];

    for (const employee_id of input.employee_ids) {
      let dayIndex = 0;
      const cursor = new Date(from);
      while (cursor <= to) {
        const patternIdx = (pattern_start_offset + dayIndex) % rotation_pattern.length;
        const shift_id = rotation_pattern[patternIdx];
        rows.push({
          organization_id: input.organization_id,
          employee_id,
          shift_id,
          work_date: toISODate(cursor),
          status: shift_id ? 'scheduled' : 'off',
          source: 'recurring',
          created_by: input.created_by ?? null,
        } as TablesInsert<'shift_assignments'>);
        cursor.setDate(cursor.getDate() + 1);
        dayIndex++;
      }
    }

    const result = await executeQuery(
      getSupabaseClient()
        .from('shift_assignments')
        .upsert(rows, { onConflict: 'employee_id,work_date' })
        .select('*'),
      'Unable to apply rotating schedule.',
    );
    await this.notifyShiftChanged(input.organization_id, input.employee_ids);
    return result;
  },

  /**
   * Temporary shift change: override an employee's shift for specific dates
   * without modifying the underlying schedule pattern.
   */
  async temporaryShiftChange(input: {
    organization_id: string;
    employee_id: string;
    shift_id: string | null;
    dates: string[];
    reason?: string;
    created_by?: string | null;
  }): Promise<ShiftAssignmentRow[]> {
    const rows = input.dates.map(
      work_date =>
        ({
          organization_id: input.organization_id,
          employee_id: input.employee_id,
          shift_id: input.shift_id,
          work_date,
          status: input.shift_id ? 'scheduled' : 'off',
          source: 'manual',
          created_by: input.created_by ?? null,
        }) as TablesInsert<'shift_assignments'>,
    );

    const result = await executeQuery(
      getSupabaseClient()
        .from('shift_assignments')
        .upsert(rows, { onConflict: 'employee_id,work_date' })
        .select('*'),
      'Unable to apply temporary shift change.',
    );
    await this.notifyShiftChanged(input.organization_id, [input.employee_id]);
    return result;
  },

  // ── Weekly Off Days ──────────────────────────

  /** List weekly off day rules for employees. */
  async listWeeklyOffs(organizationId: string, employeeId?: string): Promise<WeeklyOffRow[]> {
    let query = getSupabaseClient()
      .from('weekly_offs')
      .select('*')
      .eq('organization_id', organizationId)
      .order('employee_id');

    if (employeeId) query = query.eq('employee_id', employeeId);

    return executeQuery(query, 'Unable to load weekly off days.');
  },

  /** Set weekly off days for an employee. Replaces all existing rules for that employee. */
  async setWeeklyOffs(input: {
    organization_id: string;
    employee_id: string;
    /** 0=Monday, 6=Sunday */
    weekdays: number[];
    effective_from: string;
    effective_to?: string | null;
  }): Promise<WeeklyOffRow[]> {
    // Remove existing rules for this employee
    await getSupabaseClient()
      .from('weekly_offs')
      .delete()
      .eq('organization_id', input.organization_id)
      .eq('employee_id', input.employee_id);

    if (input.weekdays.length === 0) {
      await this.notifyWeeklyOffChanged(input);
      return [];
    }

    const rows = input.weekdays.map(
      weekday =>
        ({
          organization_id: input.organization_id,
          employee_id: input.employee_id,
          weekday,
          effective_from: input.effective_from,
          effective_to: input.effective_to ?? null,
        }) as TablesInsert<'weekly_offs'>,
    );

    const result = await executeQuery(
      getSupabaseClient().from('weekly_offs').insert(rows).select('*'),
      'Unable to set weekly off days.',
    );
    await this.notifyWeeklyOffChanged(input);
    return result;
  },

  /** Notify the employee after a weekly-off rule mutation. */
  async notifyWeeklyOffChanged(input: {
    organization_id: string;
    employee_id: string;
  }): Promise<void> {
    try {
      const { data: employee } = await getSupabaseClient()
        .from('employee_profiles')
        .select('user_id')
        .eq('id', input.employee_id)
        .maybeSingle();
      if (!employee?.user_id) return;

      await notificationService.notifyUser({
        organization_id: input.organization_id,
        recipient_user_id: employee.user_id,
        notification_type: 'weekly_off_changed',
        severity: 'info',
        title: 'Weekly Off Updated',
        body: 'Your weekly off has changed.',
        entity_type: 'weekly_off',
        entity_id: input.employee_id,
      });
    } catch (e) {
      logger.warn('Failed to send weekly-off notification.', { error: e });
    }
  },

  /** Notify each affected employee after a bulk assignment mutation. */
  async notifyShiftChanged(organizationId: string, employeeIds: string[]): Promise<void> {
    const uniqueEmployeeIds = [...new Set(employeeIds)];
    if (uniqueEmployeeIds.length === 0) return;
    const { data: employees } = await getSupabaseClient()
      .from('employee_profiles')
      .select('id, user_id')
      .in('id', uniqueEmployeeIds);
    await Promise.allSettled((employees ?? []).filter(employee => employee.user_id).map(employee =>
      notificationService.notifyUser({
        organization_id: organizationId,
        recipient_user_id: employee.user_id,
        notification_type: 'shift_changed',
        severity: 'info',
        title: 'Shift Assignment Updated',
        body: 'Your shift has been changed.',
        entity_type: 'shift_assignment',
        entity_id: employee.id,
      }),
    ));
  },

  // ── Conflict Detection ───────────────────────

  /**
   * Detect scheduling conflicts in a date range for a list of employees.
   * A conflict is when two assignments exist for the same employee+date,
   * or when a night shift overlaps with a day shift on the following date.
   */
  async detectConflicts(input: {
    organization_id: string;
    from_date: string;
    to_date: string;
    employee_ids?: string[];
  }): Promise<ConflictResult[]> {
    let query = getSupabaseClient()
      .from('shift_assignments')
      .select('*, shift:shifts(*)')
      .eq('organization_id', input.organization_id)
      .gte('work_date', input.from_date)
      .lte('work_date', input.to_date)
      .eq('status', 'scheduled');

    if (input.employee_ids?.length) {
      query = query.in('employee_id', input.employee_ids);
    }

    const { data, error } = await query;
    if (error) throw error;

    const assignments = (data ?? []) as (ShiftAssignmentRow & { shift: ShiftRow | null })[];
    const conflicts: ConflictResult[] = [];

    // Group by employee
    const byEmployee: Record<string, typeof assignments> = {};
    for (const a of assignments) {
      (byEmployee[a.employee_id] ??= []).push(a);
    }

    for (const [employeeId, empAssignments] of Object.entries(byEmployee)) {
      // Sort by date
      empAssignments.sort((a, b) => a.work_date.localeCompare(b.work_date));

      for (let i = 0; i < empAssignments.length - 1; i++) {
        const curr = empAssignments[i];
        const next = empAssignments[i + 1];

        // Check if a night shift on day N bleeds into day N+1
        if (
          curr.shift?.crosses_midnight &&
          next.shift_id &&
          next.work_date === (() => {
            const d = new Date(curr.work_date);
            d.setDate(d.getDate() + 1);
            return toISODate(d);
          })()
        ) {
          const currEnd = curr.shift?.end_time ?? '05:00';
          const nextStart = next.shift?.start_time ?? '09:00';
          const [eh, em] = currEnd.split(':').map(Number);
          const [sh, sm] = nextStart.split(':').map(Number);
          const endMins = eh * 60 + em;
          const startMins = sh * 60 + sm;
          // If night shift ends after next shift starts (treating day as 0..1440)
          if (endMins > startMins) {
            conflicts.push({
              employeeId,
              workDate: next.work_date,
              existingShiftId: curr.shift_id,
              incomingShiftId: next.shift_id,
              reason: `Night shift on ${curr.work_date} ends at ${currEnd}, overlapping with shift starting ${nextStart} on ${next.work_date}.`,
            });
          }
        }
      }
    }

    return conflicts;
  },

  // ── Summary ──────────────────────────────────

  /** Per-shift head count for a given week. */
  async getWeeklySummary(input: {
    organization_id: string;
    from_date: string;
    to_date: string;
  }): Promise<ShiftSummary[]> {
    const shifts = await this.listShifts(input.organization_id);

    const { data, error } = await getSupabaseClient()
      .from('shift_assignments')
      .select('shift_id')
      .eq('organization_id', input.organization_id)
      .gte('work_date', input.from_date)
      .lte('work_date', input.to_date)
      .eq('status', 'scheduled');

    if (error) throw error;

    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      if (row.shift_id) counts[row.shift_id] = (counts[row.shift_id] ?? 0) + 1;
    }

    return shifts.map(shift => ({
      shift,
      employeeCount: counts[shift.id] ?? 0,
    }));
  },
};
