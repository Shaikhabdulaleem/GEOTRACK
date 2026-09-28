import { getSupabaseClient } from '../lib/supabase';

import type { NotificationRow } from '../types/database';

export interface EmployeeDashboardMetrics {
  weeklyWorkedMinutes: number;
  monthlyWorkedMinutes: number;
  upcomingShifts: Array<{
    work_date: string;
    shift: {
      name: string;
      start_time: string;
      end_time: string;
    } | {
      name: string;
      start_time: string;
      end_time: string;
    }[] | null;
  }>;
  weeklyOffDays: string[];
  productivityPercent: number | null;
  notifications: NotificationRow[];
}

export const employeeDashboardService = {
  async getMetrics(organizationId: string, employeeId: string, userId: string): Promise<EmployeeDashboardMetrics> {
    const client = getSupabaseClient();
    const today = new Date();
    
    // Calculate week/month bounds
    const todayStr = today.toISOString().split('T')[0];
    
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    const weekStr = startOfWeek.toISOString().split('T')[0];
    
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthStr = startOfMonth.toISOString().split('T')[0];

    // Fetch attendance for week/month aggregations
    const { data: attData } = await client
      .from('attendance_records')
      .select('attendance_date, worked_minutes')
      .eq('organization_id', organizationId)
      .eq('employee_id', employeeId)
      .gte('attendance_date', monthStr);

    let weeklyMins = 0;
    let monthlyMins = 0;

    (attData || []).forEach(r => {
      monthlyMins += (r.worked_minutes || 0);
      if (r.attendance_date >= weekStr) {
        weeklyMins += (r.worked_minutes || 0);
      }
    });

    // Fetch upcoming schedule
    const { data: upcoming } = await client
      .from('shift_assignments')
      .select('work_date, shift:shifts(name, start_time, end_time)')
      .eq('organization_id', organizationId)
      .eq('employee_id', employeeId)
      .gt('work_date', todayStr)
      .order('work_date', { ascending: true })
      .limit(7);

    // Fetch productivity today
    const { data: prod } = await client
      .from('productivity_records')
      .select('productivity_percent')
      .eq('organization_id', organizationId)
      .eq('employee_id', employeeId)
      .eq('work_date', todayStr)
      .maybeSingle();

    // Fetch notifications
    const { data: notifs } = await client
      .from('notifications')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('recipient_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5);

    return {
      weeklyWorkedMinutes: weeklyMins,
      monthlyWorkedMinutes: monthlyMins,
      upcomingShifts: upcoming || [],
      weeklyOffDays: [], // Can compute from schedule bounds
      productivityPercent: prod ? prod.productivity_percent : null,
      notifications: notifs || []
    };
  }
};
