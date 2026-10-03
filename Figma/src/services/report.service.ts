import { getSupabaseClient } from '../lib/supabase';
import { shiftService } from './shift.service';

export interface ReportFilters {
  fromDate: string;
  toDate: string;
  branchId?: string;
  departmentId?: string;
  shiftId?: string;
  managerId?: string;
  employeeId?: string;
}

export type ReportFormat = 'CSV' | 'Excel' | 'PDF';

/**
 * Converts a JSON array of objects to a CSV string.
 */
function jsonToCsv(items: any[]): string {
  if (!items || items.length === 0) return '';
  const headers = Object.keys(items[0]);
  const rows = items.map(item => 
    headers.map(header => {
      const val = item[header];
      if (val === null || val === undefined) return '""';
      // Escape quotes
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    }).join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

/**
 * Triggers a browser download of the given content.
 */
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export const reportService = {
  /**
   * Generates and downloads the requested report.
   * Utilizes the database efficiently by filtering at the query level.
   */
  async generateReport(organizationId: string, reportId: string, filters: ReportFilters, format: ReportFormat) {
    const client = getSupabaseClient();
    
    // Step 1: Pre-resolve valid employee IDs based on HR filters (Manager, Dept, Site)
    // This allows us to efficiently query the transactional tables (attendance, etc) 
    // without loading the entire DB.
    let empQuery = client
      .from('employee_profiles')
      .select('id, full_name, employee_code, department:departments(name), branch:branches(name)')
      .eq('organization_id', organizationId);
      
    if (filters.branchId) empQuery = empQuery.eq('branch_id', filters.branchId);
    if (filters.departmentId) empQuery = empQuery.eq('department_id', filters.departmentId);
    if (filters.managerId) empQuery = empQuery.eq('manager_user_id', filters.managerId);
    if (filters.employeeId) empQuery = empQuery.eq('id', filters.employeeId);
    
    const { data: empsData, error: empErr } = await empQuery;
    if (empErr) throw empErr;
    
    const emps = (empsData as any[]) || [];
    if (!emps || emps.length === 0) {
      throw new Error('No employees matched the selected filters.');
    }
    
    const empIds = emps.map(e => e.id);
    const empMap = new Map(emps.map(e => [e.id, e]));

    // Helper to merge employee details into a record
    const enrich = (record: any) => {
      const e = empMap.get(record.employee_id) as any;
      return {
        'Employee Code': e?.employee_code || '',
        'Employee Name': e?.full_name || 'Unknown',
        'Department': Array.isArray(e?.department) ? e.department[0]?.name : e?.department?.name || '',
        'Site': Array.isArray(e?.branch) ? e.branch[0]?.name : e?.branch?.name || '',
        ...record
      };
    };

    let reportData: any[] = [];
    
    // Build efficient queries based on the requested report type
    switch (reportId) {
      case 'attendance_report':
      case 'employee_attendance_history': {
        const { data } = await client
          .from('attendance_records')
          .select('employee_id, attendance_date, check_in_at, check_out_at, status, source, geofence_validated')
          .eq('organization_id', organizationId)
          .gte('attendance_date', filters.fromDate)
          .lte('attendance_date', filters.toDate)
          .in('employee_id', empIds)
          .order('attendance_date', { ascending: false });
          
        reportData = (data || []).map(r => {
          const base = enrich(r);
          delete base.employee_id;
          return {
            ...base,
            'Check In': r.check_in_at ? new Date(r.check_in_at).toLocaleTimeString() : '',
            'Check Out': r.check_out_at ? new Date(r.check_out_at).toLocaleTimeString() : '',
          };
        });
        break;
      }
      
      case 'late_attendance': {
        const { data } = await client
          .from('attendance_records')
          .select('employee_id, attendance_date, check_in_at, late_minutes')
          .eq('organization_id', organizationId)
          .gte('attendance_date', filters.fromDate)
          .lte('attendance_date', filters.toDate)
          .in('employee_id', empIds)
          .gt('late_minutes', 0)
          .order('late_minutes', { ascending: false });
          
        reportData = (data || []).map(r => {
          const base = enrich(r);
          delete base.employee_id;
          return {
            ...base,
            'Late Minutes': r.late_minutes,
            'Check In': r.check_in_at ? new Date(r.check_in_at).toLocaleTimeString() : '',
          };
        });
        break;
      }
      
      case 'absence': {
        const { data } = await client
          .from('attendance_records')
          .select('employee_id, attendance_date, status')
          .eq('organization_id', organizationId)
          .gte('attendance_date', filters.fromDate)
          .lte('attendance_date', filters.toDate)
          .in('employee_id', empIds)
          .eq('status', 'absent');
          
        reportData = (data || []).map(r => {
          const base = enrich(r);
          delete base.employee_id;
          return base;
        });
        break;
      }
      
      case 'missing_attendance': {
        const { data } = await client
          .from('attendance_records')
          .select('employee_id, attendance_date, status, missing_minutes')
          .eq('organization_id', organizationId)
          .gte('attendance_date', filters.fromDate)
          .lte('attendance_date', filters.toDate)
          .in('employee_id', empIds)
          .in('status', ['missing_check_in', 'missing_check_out']);
          
        reportData = (data || []).map(r => {
          const base = enrich(r);
          delete base.employee_id;
          return base;
        });
        break;
      }
      
      case 'employee_working_hours': {
        const { data } = await client
          .from('attendance_records')
          .select('employee_id, attendance_date, worked_minutes')
          .eq('organization_id', organizationId)
          .gte('attendance_date', filters.fromDate)
          .lte('attendance_date', filters.toDate)
          .in('employee_id', empIds)
          .gt('worked_minutes', 0);
          
        reportData = (data || []).map(r => {
          const base = enrich(r);
          delete base.employee_id;
          return {
            ...base,
            'Worked Hours': (r.worked_minutes / 60).toFixed(2),
            'Worked Minutes': r.worked_minutes,
          };
        });
        break;
      }
      
      case 'overtime_report': {
        const { data } = await client
          .from('overtime_records')
          .select('employee_id, work_date, requested_minutes, approved_minutes, status, reason')
          .eq('organization_id', organizationId)
          .gte('work_date', filters.fromDate)
          .lte('work_date', filters.toDate)
          .in('employee_id', empIds);
          
        reportData = (data || []).map(r => {
          const base = enrich(r);
          delete base.employee_id;
          return base;
        });
        break;
      }
      
      case 'productivity_report': {
        const { data } = await client
          .from('productivity_records')
          .select('employee_id, work_date, metric_code, target_units, actual_units, productivity_percent, productive_hours')
          .eq('organization_id', organizationId)
          .gte('work_date', filters.fromDate)
          .lte('work_date', filters.toDate)
          .in('employee_id', empIds);
          
        reportData = (data || []).map(r => {
          const base = enrich(r);
          delete base.employee_id;
          return base;
        });
        break;
      }
      
      case 'geofence_exceptions': {
        const { data } = await client
          .from('attendance_events')
          .select('employee_id, event_at, event_type, inside_geofence, distance_meters, source')
          .eq('organization_id', organizationId)
          .gte('event_at', `${filters.fromDate}T00:00:00Z`)
          .lte('event_at', `${filters.toDate}T23:59:59Z`)
          .in('employee_id', empIds)
          .eq('inside_geofence', false);
          
        reportData = ((data as any[]) || []).map(r => {
          const base = enrich(r);
          delete base.employee_id;
          return {
            ...base,
            'Event Time': new Date(r.event_at).toLocaleString(),
            'Distance (m)': typeof r.distance_meters === 'number' ? Math.round(r.distance_meters) : 'Unknown'
          };
        });
        break;
      }
      
      case 'shift_report': {
        const data = (await Promise.all(empIds.map(async employeeId =>
          (await shiftService.resolveSchedule(employeeId, filters.fromDate, filters.toDate)).map(row => ({ ...row, employee_id: employeeId }))
        ))).flat();
        reportData = data.map(r => {
          const base = enrich(r);
          delete base.employee_id;
          return {
            ...base,
            'Shift Name': r.shift_name || r.state,
            'Schedule Source': r.source,
          };
        });
        break;
      }

      default:
        throw new Error('Unsupported report type: ' + reportId);
    }
    
    if (reportData.length === 0) {
      throw new Error('No data found for the selected filters.');
    }

    const filename = `${reportId}_${filters.fromDate}_${filters.toDate}`;

    if (format === 'CSV' || format === 'Excel') {
      const csvStr = jsonToCsv(reportData);
      // For excel compatibility with UTF8
      const bom = '\uFEFF'; 
      const mime = format === 'Excel' ? 'application/vnd.ms-excel' : 'text/csv;charset=utf-8;';
      downloadFile(bom + csvStr, `${filename}.csv`, mime);
    } else if (format === 'PDF') {
      // PDF export framework stub (could use jsPDF or backend PDF generation)
      throw new Error('PDF export is structurally supported but requires a PDF rendering library.');
    }
  }
};
