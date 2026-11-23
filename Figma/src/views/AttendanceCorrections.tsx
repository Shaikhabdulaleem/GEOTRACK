import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';
import StatusBadge from '../components/StatusBadge';
import {
  correctionService,
  type DirectAttendanceCorrectionInput,
} from '../services/correction.service';
import { attendanceService } from '../services/attendance.service';
import { shiftService } from '../services/shift.service';
import { employeeService, isEmployeeActiveOnDate, type EmployeeLookups } from '../services/employee.service';
import { organizationService } from '../services/organization.service';
import { todayInTimezone } from '../lib/dates';
import { getErrorMessage } from '../lib/errors';
import type {
  ApprovalStatus,
  AttendanceRecordRow,
  DepartmentRow,
  EmployeeProfileRow,
  EmploymentStatus,
  ManualAttendanceRequestRow,
  ResolvedScheduleRow,
  ShiftAssignmentRow,
  ShiftRow,
} from '../types/database';

const fieldStyle = {
  background: '#0d1b2e',
  border: '1px solid #1e3a5a',
  color: '#f0f6ff',
};

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  try {
    const d = new Date(value);
    return d.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function formatTimeOnly(value: string | null): string {
  if (!value) return '—';
  try {
    const d = new Date(value);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return value;
  }
}

function formatDuration(minutes: number): string {
  if (!minutes) return '0m';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h${remainder ? ` ${remainder}m` : ''}` : `${remainder}m`;
}

function localDateTimeInput(dateStr: string, timeStr = '09:00'): string {
  return `${dateStr}T${timeStr.slice(0, 5)}`;
}

export interface TimesheetCorrectionRow {
  rowKey: string;
  workDate: string;
  emp: EmployeeProfileRow;
  deptName: string;
  shiftName: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  rec: AttendanceRecordRow | null;
  status: 'present' | 'late' | 'missing_in' | 'missing_out' | 'missed' | 'corrected';
  statusLabel: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  source: string;
}

export default function AttendanceCorrections() {
  const { user, activeMembership, hasAnyRole, roles, assignedDepartmentIds } = useAuth();
  const organizationId = activeMembership?.organization_id ?? '';
  const isManager = roles.includes('manager') && !roles.includes('administrator');
  const canManage = hasAnyRole(['administrator', 'manager']);

  const [activeTab, setActiveTab] = useState<'attendance' | 'requests' | 'direct'>('attendance');
  const [requests, setRequests] = useState<ManualAttendanceRequestRow[]>([]);
  const [directRecords, setDirectRecords] = useState<AttendanceRecordRow[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecordRow[]>([]);
  const [shiftAssignments, setShiftAssignments] = useState<
    (ShiftAssignmentRow & { shift: ShiftRow | null; employee: EmployeeProfileRow | null })[]
  >([]);
  const [employees, setEmployees] = useState<EmployeeProfileRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [lookups, setLookups] = useState<EmployeeLookups>({
    branches: [],
    departments: [],
    shifts: [],
    managers: [],
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [attendanceFilter, setAttendanceFilter] = useState<
    'all' | 'present' | 'missed' | 'late' | 'missing' | 'corrected'
  >('all');
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [departmentId, setDepartmentId] = useState('');
  const [employmentStatus, setEmploymentStatus] = useState<EmploymentStatus | ''>('');
  const [fromDate, setFromDate] = useState(() => todayInTimezone('Asia/Riyadh'));
  const [toDate, setToDate] = useState(() => todayInTimezone('Asia/Riyadh'));

  // Modals
  const [reviewingRequest, setReviewingRequest] = useState<ManualAttendanceRequestRow | null>(null);
  const [showDirectModal, setShowDirectModal] = useState(false);
  const [targetEmpForCorrection, setTargetEmpForCorrection] = useState<{
    employeeId: string;
    workDate: string;
  } | null>(null);

  const stepSingleDay = (offsetDays: number) => {
    const base = fromDate || todayInTimezone('Asia/Riyadh');
    const d = new Date(`${base}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    const nextDate = d.toISOString().slice(0, 10);
    setFromDate(nextDate);
    setToDate(nextDate);
  };

  const setDatePreset = (preset: 'today' | 'yesterday' | 'week' | 'month' | 'clear') => {
    if (preset === 'clear') {
      setFromDate('');
      setToDate('');
      return;
    }
    const today = todayInTimezone('Asia/Riyadh');
    if (preset === 'today') {
      setFromDate(today);
      setToDate(today);
      return;
    }
    if (preset === 'yesterday') {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      const yest = d.toISOString().slice(0, 10);
      setFromDate(yest);
      setToDate(yest);
      return;
    }
    const curr = new Date(`${today}T00:00:00Z`);
    if (preset === 'week') {
      const dayOfWeek = curr.getUTCDay() || 7;
      const start = new Date(curr);
      start.setUTCDate(curr.getUTCDate() - dayOfWeek + 1);
      setFromDate(start.toISOString().slice(0, 10));
      setToDate(today);
    } else if (preset === 'month') {
      const start = new Date(Date.UTC(curr.getUTCFullYear(), curr.getUTCMonth(), 1));
      setFromDate(start.toISOString().slice(0, 10));
      setToDate(today);
    }
  };

  const loadData = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError('');
    try {
      const today = todayInTimezone('Asia/Riyadh');
      const start = fromDate || today;
      const end = toDate || start;

      const [reqList, directList, empList, deptList, lookupData, attRecords, assignments] =
        await Promise.all([
          correctionService.list({
            organizationId,
            status: statusFilter === 'all' ? undefined : statusFilter,
            fromDate: fromDate || undefined,
            toDate: toDate || undefined,
          }),
          correctionService.listDirectCorrections(
            organizationId,
            fromDate || undefined,
            toDate || undefined,
          ),
          employeeService.listAll({ organizationId }),
          organizationService.listDepartments(organizationId),
          employeeService.getLookups(organizationId),
          attendanceService.list({
            organizationId,
            fromDate: start,
            toDate: end,
          }),
          shiftService.listAssignments({
            organization_id: organizationId,
            from_date: start,
            to_date: end,
          }),
        ]);

      setRequests(reqList);
      setDirectRecords(directList);
      const activeDepts = deptList.filter(d => d.status === 'active');
      const filteredDepts = isManager ? activeDepts.filter(d => assignedDepartmentIds.includes(d.id)) : activeDepts;
      setDepartments(filteredDepts);
      const filteredEmps = isManager ? empList.filter(e => e.department_id && assignedDepartmentIds.includes(e.department_id)) : empList;
      setEmployees(filteredEmps);
      const filteredLookups = isManager ? { ...lookupData, departments: lookupData.departments.filter(d => assignedDepartmentIds.includes(d.id)) } : lookupData;
      setLookups(filteredLookups);
      setAttendanceRecords(attRecords);
      setShiftAssignments(assignments);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [organizationId, statusFilter, fromDate, toDate]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const empMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);
  const deptMap = useMemo(() => new Map(departments.map(d => [d.id, d.name])), [departments]);

  // Build daily timesheet records across active employees and filtered dates
  const timesheetRows = useMemo<TimesheetCorrectionRow[]>(() => {
    const today = todayInTimezone('Asia/Riyadh');
    const start = fromDate || today;
    const end = toDate || start;

    const dates: string[] = [];
    const d = new Date(`${start}T00:00:00Z`);
    const endD = new Date(`${end}T00:00:00Z`);
    let count = 0;
    while (d <= endD && count < 31) {
      dates.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
      count++;
    }
    if (dates.length === 0) dates.push(start);

    const rows: TimesheetCorrectionRow[] = [];

    for (const workDate of dates) {
      for (const emp of employees) {
        const isActiveOnDate = isEmployeeActiveOnDate(emp, workDate);
        const hasRecord = attendanceRecords.some(
          r => r.employee_id === emp.id && r.attendance_date === workDate,
        );
        const hasShift = shiftAssignments.some(
          a => a.employee_id === emp.id && a.work_date === workDate,
        );

        if (employmentStatus === 'active') {
          if (!isActiveOnDate && !hasRecord) continue;
        } else if (employmentStatus === 'inactive') {
          if (isActiveOnDate && !hasRecord) continue;
        } else if (employmentStatus) {
          if (emp.employment_status !== employmentStatus && !hasRecord) continue;
        } else {
          // If employee is inactive on this date and has neither attendance nor shift, do not generate a phantom "Missed / Absent" row!
          if (!isActiveOnDate && !hasRecord && !hasShift) continue;
        }

        const rec =
          attendanceRecords.find(
            r => r.employee_id === emp.id && r.attendance_date === workDate,
          ) || null;

        const assignment = shiftAssignments.find(
          a => a.employee_id === emp.id && a.work_date === workDate,
        );

        const shift = assignment?.shift || null;
        const shiftName = shift?.name || 'Unassigned';
        const shiftStart = shift?.start_time || null;
        const shiftEnd = shift?.end_time || null;

        const isOff = assignment?.status === 'off';
        let status: TimesheetCorrectionRow['status'] = isOff ? ('off' as any) : 'missed';
        let statusLabel = isOff ? 'Employee week Off' : 'Missed / Absent';

        if (rec) {
          if (rec.source === 'manual_manager') {
            status = 'corrected';
            statusLabel = 'Manager Corrected';
          } else if (rec.status === 'present') {
            status = 'present';
            statusLabel = 'Correctly Marked';
          } else if (rec.status === 'late') {
            status = 'late';
            statusLabel = 'Late';
          } else if (isOff) {
            status = 'off' as any;
            statusLabel = 'Employee week Off';
          } else if (rec.status === 'missing_check_in') {
            status = 'missing_in';
            statusLabel = 'Missing Check-In';
          } else if (rec.status === 'missing_check_out') {
            status = 'missing_out';
            statusLabel = 'Missing Check-Out';
          } else if (rec.status === 'absent') {
            status = 'missed';
            statusLabel = 'Missed / Absent';
          }
        }

        let source = '—';
        if (rec?.source === 'automatic_geofence') source = 'Auto Geofence';
        else if (rec?.source === 'manual_employee') source = 'Manual (Employee)';
        else if (rec?.source === 'manual_manager') source = 'Manager Corrected';
        else if (rec?.source === 'admin') source = 'Admin';

        rows.push({
          rowKey: `${emp.id}_${workDate}`,
          workDate,
          emp,
          deptName: deptMap.get(emp.department_id) || 'Unassigned',
          shiftName,
          shiftStart,
          shiftEnd,
          rec,
          status,
          statusLabel,
          checkInAt: rec?.check_in_at || null,
          checkOutAt: rec?.check_out_at || null,
          workedMinutes: rec?.worked_minutes || 0,
          lateMinutes: rec?.late_minutes || 0,
          overtimeMinutes: rec?.overtime_minutes || 0,
          source,
        });
      }
    }

    return rows;
  }, [fromDate, toDate, employees, attendanceRecords, shiftAssignments, deptMap, employmentStatus]);

  // Filter daily timesheet records
  const filteredTimesheetRows = useMemo(() => {
    return timesheetRows.filter(row => {
      if (departmentId && row.emp.department_id !== departmentId) return false;
      if (employmentStatus && row.emp.employment_status !== employmentStatus) return false;
      if (attendanceFilter !== 'all') {
        if (attendanceFilter === 'present' && row.status !== 'present') return false;
        if (attendanceFilter === 'missed' && row.status !== 'missed') return false;
        if (attendanceFilter === 'late' && row.status !== 'late') return false;
        if (
          attendanceFilter === 'missing' &&
          row.status !== 'missing_in' &&
          row.status !== 'missing_out'
        )
          return false;
        if (attendanceFilter === 'corrected' && row.status !== 'corrected') return false;
      }
      if (search.trim()) {
        const query = search.trim().toLowerCase();
        const nameMatch = row.emp.full_name?.toLowerCase().includes(query);
        const codeMatch = row.emp.employee_code?.toLowerCase().includes(query);
        const deptMatch = row.deptName?.toLowerCase().includes(query);
        if (!nameMatch && !codeMatch && !deptMatch) return false;
      }
      return true;
    });
  }, [timesheetRows, departmentId, employmentStatus, attendanceFilter, search]);

  // Department & Employment status scoped daily timesheet rows for KPI metrics
  const deptTimesheetRows = useMemo(() => {
    let rows = timesheetRows;
    if (departmentId) {
      rows = rows.filter(r => r.emp.department_id === departmentId);
    }
    if (employmentStatus) {
      rows = rows.filter(r => r.emp.employment_status === employmentStatus);
    }
    return rows;
  }, [timesheetRows, departmentId, employmentStatus]);

  const timesheetMetrics = useMemo(() => {
    let present = 0;
    let missed = 0;
    let late = 0;
    let missingPunches = 0;
    let corrected = 0;

    for (const row of deptTimesheetRows) {
      if (row.status === 'present') present++;
      else if (row.status === 'missed') missed++;
      else if (row.status === 'late') late++;
      else if (row.status === 'missing_in' || row.status === 'missing_out') missingPunches++;
      else if (row.status === 'corrected') corrected++;
    }

    return {
      total: deptTimesheetRows.length,
      present,
      missed,
      late,
      missingPunches,
      corrected,
    };
  }, [deptTimesheetRows]);

  const departmentEmployeeIds = useMemo(() => {
    return new Set(
      employees
        .filter(e => {
          if (departmentId && e.department_id !== departmentId) return false;
          if (employmentStatus && e.employment_status !== employmentStatus) return false;
          return true;
        })
        .map(e => e.id),
    );
  }, [departmentId, employmentStatus, employees]);

  const deptRequests = useMemo(() => {
    return departmentId || employmentStatus
      ? requests.filter(r => departmentEmployeeIds.has(r.employee_id))
      : requests;
  }, [requests, departmentEmployeeIds, departmentId, employmentStatus]);

  const deptDirectRecords = useMemo(() => {
    return departmentId || employmentStatus
      ? directRecords.filter(r => departmentEmployeeIds.has(r.employee_id))
      : directRecords;
  }, [directRecords, departmentEmployeeIds, departmentId, employmentStatus]);

  // Filter requests
  const filteredRequests = useMemo(() => {
    return deptRequests.filter(req => {
      const emp = empMap.get(req.employee_id);
      if (typeFilter !== 'all' && req.request_type !== typeFilter) return false;
      if (search.trim()) {
        const query = search.trim().toLowerCase();
        const nameMatch = emp?.full_name?.toLowerCase().includes(query);
        const codeMatch = emp?.employee_code?.toLowerCase().includes(query);
        const reasonMatch = req.reason?.toLowerCase().includes(query);
        if (!nameMatch && !codeMatch && !reasonMatch) return false;
      }
      return true;
    });
  }, [deptRequests, empMap, typeFilter, search]);

  // Filter direct corrections
  const filteredDirectRecords = useMemo(() => {
    return deptDirectRecords.filter(rec => {
      const emp = empMap.get(rec.employee_id);
      if (search.trim()) {
        const query = search.trim().toLowerCase();
        const nameMatch = emp?.full_name?.toLowerCase().includes(query);
        const codeMatch = emp?.employee_code?.toLowerCase().includes(query);
        const noteMatch = rec.notes?.toLowerCase().includes(query);
        if (!nameMatch && !codeMatch && !noteMatch) return false;
      }
      return true;
    });
  }, [deptDirectRecords, empMap, search]);

  // Metrics
  const pendingCount = useMemo(() => deptRequests.filter(r => r.status === 'pending').length, [deptRequests]);
  const approvedCount = useMemo(() => deptRequests.filter(r => r.status === 'approved').length, [deptRequests]);
  const rejectedCount = useMemo(() => deptRequests.filter(r => r.status === 'rejected').length, [deptRequests]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center font-bold"
              style={{ background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)', color: '#fff' }}
            >
              <RotateCcw size={20} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Attendance Correction Module</h1>
              <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>
                Review employee attendance adjustments, apply direct manager corrections, and track timesheet recalculations.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Top Department Filter */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs" style={fieldStyle}>
            <span style={{ color: '#64748b' }}>Department:</span>
            <select
              aria-label="Filter by department"
              value={departmentId}
              onChange={e => setDepartmentId(e.target.value)}
              className="bg-transparent text-xs text-white outline-none cursor-pointer"
            >
              <option value="" className="bg-[#0d1b2e] text-white">All Departments</option>
              {departments.map(d => (
                <option key={d.id} value={d.id} className="bg-[#0d1b2e] text-white">
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          {/* Top Employment Status Filter */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs" style={fieldStyle}>
            <span style={{ color: '#64748b' }}>Status:</span>
            <select
              aria-label="Filter by employment status"
              value={employmentStatus}
              onChange={e => setEmploymentStatus(e.target.value as EmploymentStatus | '')}
              className="bg-transparent text-xs text-white outline-none cursor-pointer capitalize"
            >
              <option value="" className="bg-[#0d1b2e] text-white">All statuses</option>
              <option value="active" className="bg-[#0d1b2e] text-white">active</option>
              <option value="inactive" className="bg-[#0d1b2e] text-white">inactive</option>
              <option value="on_leave" className="bg-[#0d1b2e] text-white">on leave</option>
              <option value="terminated" className="bg-[#0d1b2e] text-white">terminated</option>
            </select>
          </div>

          <button
            onClick={() => void loadData()}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors"
            style={{ ...fieldStyle, color: '#94a3b8' }}
            title="Refresh corrections"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          {canManage && (
            <button
              onClick={() => {
                setTargetEmpForCorrection(null);
                setShowDirectModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold shadow-sm"
              style={{ background: '#2563eb', color: '#fff' }}
            >
              <Plus size={14} /> New Attendance Correction
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          className="flex items-center gap-2 p-3 rounded-xl text-xs"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}
        >
          <AlertCircle size={15} />
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto underline">
            Dismiss
          </button>
        </div>
      )}

      {successMsg && (
        <div
          className="flex items-center gap-2 p-3 rounded-xl text-xs"
          style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: '#6ee7b7' }}
        >
          <CheckCircle2 size={15} />
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg('')} className="ml-auto underline">
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Cards */}
      {activeTab === 'attendance' ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div
            className="rounded-xl p-3 cursor-pointer transition-all"
            onClick={() => setAttendanceFilter('all')}
            style={{
              ...fieldStyle,
              borderColor: attendanceFilter === 'all' ? '#3b82f6' : '#1e3a5a',
            }}
          >
            <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">
              Total In Date Scope
            </div>
            <div className="text-xl font-bold font-mono mt-1 text-white">{timesheetMetrics.total}</div>
            <div className="text-[10px] mt-0.5 text-slate-500">Employees in date filter</div>
          </div>

          <div
            className="rounded-xl p-3 cursor-pointer transition-all"
            onClick={() => setAttendanceFilter('present')}
            style={{
              ...fieldStyle,
              borderColor: attendanceFilter === 'present' ? '#10b981' : '#1e3a5a',
            }}
          >
            <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald-400">
              Correctly Marked
            </div>
            <div className="text-xl font-bold font-mono mt-1 text-white">{timesheetMetrics.present}</div>
            <div className="text-[10px] mt-0.5 text-slate-500">Present on time</div>
          </div>

          <div
            className="rounded-xl p-3 cursor-pointer transition-all"
            onClick={() => setAttendanceFilter('missed')}
            style={{
              ...fieldStyle,
              borderColor: attendanceFilter === 'missed' ? '#ef4444' : '#1e3a5a',
            }}
          >
            <div className="text-[11px] uppercase tracking-wider font-semibold text-red-400">
              Missed / Absent
            </div>
            <div className="text-xl font-bold font-mono mt-1 text-white">{timesheetMetrics.missed}</div>
            <div className="text-[10px] mt-0.5 text-slate-500">No punches recorded</div>
          </div>

          <div
            className="rounded-xl p-3 cursor-pointer transition-all"
            onClick={() => setAttendanceFilter('late')}
            style={{
              ...fieldStyle,
              borderColor:
                attendanceFilter === 'late' || attendanceFilter === 'missing'
                  ? '#f59e0b'
                  : '#1e3a5a',
            }}
          >
            <div className="text-[11px] uppercase tracking-wider font-semibold text-amber-400">
              Late & Missing
            </div>
            <div className="text-xl font-bold font-mono mt-1 text-white">
              {timesheetMetrics.late + timesheetMetrics.missingPunches}
            </div>
            <div className="text-[10px] mt-0.5 text-slate-500">Requires review / correction</div>
          </div>

          <div
            className="rounded-xl p-3 cursor-pointer transition-all"
            onClick={() => setAttendanceFilter('corrected')}
            style={{
              ...fieldStyle,
              borderColor: attendanceFilter === 'corrected' ? '#38bdf8' : '#1e3a5a',
            }}
          >
            <div className="text-[11px] uppercase tracking-wider font-semibold text-sky-400">
              Manager Corrected
            </div>
            <div className="text-xl font-bold font-mono mt-1 text-white">{timesheetMetrics.corrected}</div>
            <div className="text-[10px] mt-0.5 text-slate-500">Directly edited by manager</div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div
            className="rounded-xl p-4 cursor-pointer transition-all"
            onClick={() => {
              setActiveTab('requests');
              setStatusFilter('pending');
            }}
            style={{
              ...fieldStyle,
              borderColor: statusFilter === 'pending' ? '#f59e0b' : '#1e3a5a',
            }}
          >
            <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: '#f59e0b' }}>
              Pending Requests
            </div>
            <div className="text-2xl font-bold font-mono mt-1 text-white">{pendingCount}</div>
            <div className="text-[11px] mt-1" style={{ color: '#64748b' }}>
              Awaiting manager decision
            </div>
          </div>

          <div
            className="rounded-xl p-4 cursor-pointer transition-all"
            onClick={() => {
              setActiveTab('requests');
              setStatusFilter('approved');
            }}
            style={{
              ...fieldStyle,
              borderColor: statusFilter === 'approved' ? '#10b981' : '#1e3a5a',
            }}
          >
            <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: '#10b981' }}>
              Approved Requests
            </div>
            <div className="text-2xl font-bold font-mono mt-1 text-white">{approvedCount}</div>
            <div className="text-[11px] mt-1" style={{ color: '#64748b' }}>
              Timesheet recalculated
            </div>
          </div>

          <div
            className="rounded-xl p-4 cursor-pointer transition-all"
            onClick={() => {
              setActiveTab('requests');
              setStatusFilter('rejected');
            }}
            style={{
              ...fieldStyle,
              borderColor: statusFilter === 'rejected' ? '#ef4444' : '#1e3a5a',
            }}
          >
            <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: '#ef4444' }}>
              Rejected Requests
            </div>
            <div className="text-2xl font-bold font-mono mt-1 text-white">{rejectedCount}</div>
            <div className="text-[11px] mt-1" style={{ color: '#64748b' }}>
              Declined with note
            </div>
          </div>

          <div
            className="rounded-xl p-4 cursor-pointer transition-all"
            onClick={() => setActiveTab('direct')}
            style={{
              ...fieldStyle,
              borderColor: activeTab === 'direct' ? '#3b82f6' : '#1e3a5a',
            }}
          >
            <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: '#93c5fd' }}>
              Direct Corrections
            </div>
            <div className="text-2xl font-bold font-mono mt-1 text-white">{directRecords.length}</div>
            <div className="text-[11px] mt-1" style={{ color: '#64748b' }}>
              Logged by management
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: '#1e3a5a' }}>
        <button
          onClick={() => setActiveTab('attendance')}
          className="flex items-center gap-2 px-5 py-3 text-xs font-semibold transition-all relative"
          style={{
            color: activeTab === 'attendance' ? '#fff' : '#64748b',
            borderBottom: activeTab === 'attendance' ? '2px solid #2563eb' : '2px solid transparent',
            marginBottom: '-1px',
          }}
        >
          <span>Daily Attendance & Corrections</span>
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-mono"
            style={{ background: '#122338', color: '#94a3b8' }}
          >
            {deptTimesheetRows.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('requests')}
          className="flex items-center gap-2 px-5 py-3 text-xs font-semibold transition-all relative"
          style={{
            color: activeTab === 'requests' ? '#fff' : '#64748b',
            borderBottom: activeTab === 'requests' ? '2px solid #2563eb' : '2px solid transparent',
            marginBottom: '-1px',
          }}
        >
          <span>Employee Correction Requests</span>
          {pendingCount > 0 && (
            <span
              className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
              style={{ background: '#f59e0b', color: '#000' }}
            >
              {pendingCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('direct')}
          className="flex items-center gap-2 px-5 py-3 text-xs font-semibold transition-all relative"
          style={{
            color: activeTab === 'direct' ? '#fff' : '#64748b',
            borderBottom: activeTab === 'direct' ? '2px solid #2563eb' : '2px solid transparent',
            marginBottom: '-1px',
          }}
        >
          <span>Manager Direct Corrections Log</span>
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-mono"
            style={{ background: '#122338', color: '#94a3b8' }}
          >
            {deptDirectRecords.length}
          </span>
        </button>
      </div>

      {/* Filters Bar */}
      <div
        className="rounded-xl p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-2 text-xs"
        style={fieldStyle}
      >
        <div className="relative lg:col-span-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#4b6a8a' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search employee, ID, or department…"
            className="w-full pl-9 pr-3 py-2 rounded-lg outline-none"
            style={fieldStyle}
          />
        </div>

        {activeTab === 'attendance' && (
          <div>
            <select
              value={attendanceFilter}
              onChange={e =>
                setAttendanceFilter(
                  e.target.value as 'all' | 'present' | 'missed' | 'late' | 'missing' | 'corrected',
                )
              }
              className="w-full px-3 py-2 rounded-lg outline-none"
              style={fieldStyle}
            >
              <option value="all">All Attendance Records</option>
              <option value="present">Correctly Marked (Present)</option>
              <option value="missed">Missed Attendance (Absent)</option>
              <option value="late">Late Check-In</option>
              <option value="missing">Missing Punches (In/Out)</option>
              <option value="corrected">Manager Corrected</option>
            </select>
          </div>
        )}

        {activeTab === 'requests' && (
          <div>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as ApprovalStatus | 'all')}
              className="w-full px-3 py-2 rounded-lg outline-none"
              style={fieldStyle}
            >
              <option value="all">All Request Statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        )}

        {activeTab === 'requests' && (
          <div>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-lg outline-none"
              style={fieldStyle}
            >
              <option value="all">All Request Types</option>
              <option value="check_in">Check In</option>
              <option value="check_out">Check Out</option>
              <option value="correction">Generic Correction</option>
            </select>
          </div>
        )}

        <div>
          <select
            aria-label="Filter by department"
            value={departmentId}
            onChange={e => setDepartmentId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg outline-none"
            style={fieldStyle}
          >
            <option value="">All Departments</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <select
            aria-label="Filter by employment status"
            value={employmentStatus}
            onChange={e => setEmploymentStatus(e.target.value as EmploymentStatus | '')}
            className="w-full px-3 py-2 rounded-lg outline-none capitalize"
            style={fieldStyle}
          >
            <option value="">All statuses</option>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
            <option value="on_leave">on leave</option>
            <option value="terminated">terminated</option>
          </select>
        </div>

        <div className={`flex items-center gap-1.5 ${activeTab === 'requests' ? 'lg:col-span-1' : 'lg:col-span-2'}`}>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg outline-none text-[11px]"
            style={fieldStyle}
            title="From date"
          />
          <span style={{ color: '#4b6a8a' }}>–</span>
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg outline-none text-[11px]"
            style={fieldStyle}
            title="To date"
          />
        </div>
      </div>

      {/* Date Quick Presets & Day Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span style={{ color: '#64748b' }}>Quick Range:</span>
          <button
            onClick={() => setDatePreset('today')}
            className={`px-2.5 py-1 rounded text-[11px] transition ${
              fromDate === todayInTimezone('Asia/Riyadh') && toDate === todayInTimezone('Asia/Riyadh')
                ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                : ''
            }`}
            style={fieldStyle}
          >
            Today
          </button>
          <button
            onClick={() => setDatePreset('yesterday')}
            className="px-2.5 py-1 rounded text-[11px]"
            style={fieldStyle}
          >
            Yesterday
          </button>
          <button
            onClick={() => setDatePreset('week')}
            className="px-2.5 py-1 rounded text-[11px]"
            style={fieldStyle}
          >
            This Week
          </button>
          <button
            onClick={() => setDatePreset('month')}
            className="px-2.5 py-1 rounded text-[11px]"
            style={fieldStyle}
          >
            This Month
          </button>
          {(fromDate || toDate) && (
            <button
              onClick={() => setDatePreset('clear')}
              className="px-2.5 py-1 rounded text-[11px] text-rose-400"
              style={fieldStyle}
            >
              Clear
            </button>
          )}
          {departmentId && (
            <button
              onClick={() => setDepartmentId('')}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] bg-sky-500/15 text-sky-300 border border-sky-500/30 hover:bg-sky-500/25 transition"
              title="Clear department filter"
            >
              <span>Dept: {deptMap.get(departmentId) || 'Selected'}</span>
              <X size={11} />
            </button>
          )}
          {employmentStatus && (
            <button
              onClick={() => setEmploymentStatus('')}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/25 transition capitalize"
              title="Clear employment status filter"
            >
              <span>Status: {employmentStatus.replace(/_/g, ' ')}</span>
              <X size={11} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => stepSingleDay(-1)}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] hover:bg-white/5 transition"
            style={fieldStyle}
            title="Previous day"
          >
            <ChevronLeft size={13} />
            <span>Prev Day</span>
          </button>
          <button
            onClick={() => stepSingleDay(1)}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] hover:bg-white/5 transition"
            style={fieldStyle}
            title="Next day"
          >
            <span>Next Day</span>
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {/* Main Content */}
      {activeTab === 'attendance' ? (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3a5a' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: '#122338', color: '#64748b' }}>
                  <th className="text-left px-4 py-3">Employee</th>
                  <th className="text-left px-4 py-3">Work Date</th>
                  <th className="text-left px-4 py-3">Scheduled Shift</th>
                  <th className="text-left px-4 py-3">Actual Check-In</th>
                  <th className="text-left px-4 py-3">Actual Check-Out</th>
                  <th className="text-right px-4 py-3">Worked / OT</th>
                  <th className="text-center px-4 py-3">Attendance Status</th>
                  <th className="text-left px-4 py-3">Punch Method</th>
                  <th className="text-right px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="p-10 text-center">
                      <Loader2 size={20} className="animate-spin mx-auto text-blue-500" />
                    </td>
                  </tr>
                ) : filteredTimesheetRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-12 text-center">
                      <Clock size={28} className="mx-auto mb-2" style={{ color: '#1e3a5a' }} />
                      <div className="font-semibold text-white">No attendance records found</div>
                      <div className="text-xs mt-1" style={{ color: '#4b6a8a' }}>
                        No employees match the selected date filter and criteria.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredTimesheetRows.map(row => {
                    return (
                      <tr
                        key={row.rowKey}
                        className="border-t hover:bg-white/[0.02] transition-colors"
                        style={{ borderColor: '#1e3a5a' }}
                      >
                        {/* Employee */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={row.emp.full_name} size="sm" />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-white">{row.emp.full_name}</span>
                                {row.emp.employment_status !== 'active' && (
                                  <span
                                    className="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase font-semibold"
                                    style={{
                                      background:
                                        row.emp.employment_status === 'on_leave'
                                          ? 'rgba(245,158,11,0.15)'
                                          : 'rgba(239,68,68,0.15)',
                                      color:
                                        row.emp.employment_status === 'on_leave'
                                          ? '#fbbf24'
                                          : '#fca5a5',
                                    }}
                                  >
                                    {row.emp.employment_status.replace(/_/g, ' ')}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] font-mono" style={{ color: '#4b6a8a' }}>
                                {row.emp.employee_code || row.emp.id.slice(0, 8)} · {row.deptName}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Work Date */}
                        <td className="px-4 py-3 font-mono font-medium text-white">
                          {row.workDate}
                        </td>

                        {/* Scheduled Shift */}
                        <td className="px-4 py-3">
                          <div className="text-slate-200 font-medium">{row.shiftName}</div>
                          <div className="text-[11px] font-mono" style={{ color: '#64748b' }}>
                            {row.shiftStart
                              ? `${row.shiftStart.slice(0, 5)} – ${(row.shiftEnd || '').slice(0, 5)}`
                              : 'Off / Unassigned'}
                          </div>
                        </td>

                        {/* Check-In */}
                        <td className="px-4 py-3 font-mono">
                          {row.checkInAt ? (
                            <span className="text-emerald-400 font-medium">
                              {formatTimeOnly(row.checkInAt)}
                            </span>
                          ) : (
                            <span className="text-amber-400/80 text-[11px]">
                              {row.status === 'missed' ? '—' : 'Missing In'}
                            </span>
                          )}
                        </td>

                        {/* Check-Out */}
                        <td className="px-4 py-3 font-mono">
                          {row.checkOutAt ? (
                            <span className="text-emerald-400 font-medium">
                              {formatTimeOnly(row.checkOutAt)}
                            </span>
                          ) : (
                            <span className="text-amber-400/80 text-[11px]">
                              {row.status === 'missed' ? '—' : 'Missing Out'}
                            </span>
                          )}
                        </td>

                        {/* Worked / OT */}
                        <td className="px-4 py-3 text-right font-mono">
                          <div className="text-white font-medium">
                            {row.workedMinutes > 0 ? formatDuration(row.workedMinutes) : '—'}
                          </div>
                          {row.overtimeMinutes > 0 && (
                            <span className="text-emerald-400 text-[10px] block font-mono">
                              +{formatDuration(row.overtimeMinutes)} OT
                            </span>
                          )}
                          {row.lateMinutes > 0 && (
                            <span className="text-rose-400 text-[10px] block font-mono">
                              {row.lateMinutes}m Late
                            </span>
                          )}
                        </td>

                        {/* Status Badge */}
                        <td className="px-4 py-3 text-center">
                          <div className="inline-flex justify-center">
                            {row.status === 'corrected' && (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/30 flex items-center gap-1">
                                <RotateCcw size={10} /> Corrected
                              </span>
                            )}
                            {row.status === 'present' && (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                                <CheckCircle2 size={10} /> Correctly Marked
                              </span>
                            )}
                            {row.status === 'late' && (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                                <Clock size={10} /> Late
                              </span>
                            )}
                            {row.status === 'missing_in' && (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                                <AlertCircle size={10} /> Missed Check-In
                              </span>
                            )}
                            {row.status === 'missing_out' && (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                                <AlertCircle size={10} /> Missed Check-Out
                              </span>
                            )}
                            {row.status === 'missed' && (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-500/15 text-red-400 border border-red-500/30 flex items-center gap-1">
                                <XCircle size={10} /> Missed / Absent
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Punch Method */}
                        <td className="px-4 py-3 text-slate-400 text-[11px]">{row.source}</td>

                        {/* Action */}
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => {
                              setTargetEmpForCorrection({
                                employeeId: row.emp.id,
                                workDate: row.workDate,
                              });
                              setShowDirectModal(true);
                            }}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-all shadow-sm"
                            style={{
                              background:
                                row.status === 'missed'
                                  ? 'rgba(239,68,68,0.15)'
                                  : row.status === 'corrected'
                                    ? 'rgba(56,189,248,0.15)'
                                    : 'rgba(59,130,246,0.15)',
                              color:
                                row.status === 'missed'
                                  ? '#fca5a5'
                                  : row.status === 'corrected'
                                    ? '#38bdf8'
                                    : '#93c5fd',
                              border:
                                row.status === 'missed'
                                  ? '1px solid rgba(239,68,68,0.3)'
                                  : row.status === 'corrected'
                                    ? '1px solid rgba(56,189,248,0.3)'
                                    : '1px solid rgba(59,130,246,0.3)',
                            }}
                            title="Edit or correct this employee attendance"
                          >
                            <PenLine size={12} />
                            <span>{row.rec ? 'Edit Punch' : 'Correct / Add Punch'}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === 'requests' ? (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3a5a' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: '#122338', color: '#64748b' }}>
                  <th className="text-left px-4 py-3">Employee</th>
                  <th className="text-left px-4 py-3">Request Type</th>
                  <th className="text-left px-4 py-3">Requested Time</th>
                  <th className="text-left px-4 py-3">Stated Reason</th>
                  <th className="text-center px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Submitted</th>
                  <th className="text-right px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center">
                      <Loader2 size={20} className="animate-spin mx-auto text-blue-500" />
                    </td>
                  </tr>
                ) : filteredRequests.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-12 text-center">
                      <Clock size={28} className="mx-auto mb-2" style={{ color: '#1e3a5a' }} />
                      <div className="font-semibold text-white">No correction requests found</div>
                      <div className="text-xs mt-1" style={{ color: '#4b6a8a' }}>
                        No pending or reviewed requests match the selected filters.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredRequests.map(req => {
                    const emp = empMap.get(req.employee_id);
                    return (
                      <tr
                        key={req.id}
                        className="border-t hover:bg-white/[0.02] transition-colors"
                        style={{ borderColor: '#1e3a5a' }}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={emp?.full_name || 'Employee'} size="sm" />
                            <div>
                              <div className="font-semibold text-white">
                                {emp?.full_name || 'Unknown Employee'}
                              </div>
                              <div className="text-[11px] font-mono" style={{ color: '#4b6a8a' }}>
                                {emp?.employee_code || req.employee_id.slice(0, 8)} ·{' '}
                                {emp?.department_id ? deptMap.get(emp.department_id) || '—' : '—'}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3">
                          <span
                            className="px-2 py-0.5 rounded text-[11px] font-semibold uppercase"
                            style={{
                              background:
                                req.request_type === 'check_in'
                                  ? 'rgba(16,185,129,0.12)'
                                  : req.request_type === 'check_out'
                                    ? 'rgba(245,158,11,0.12)'
                                    : 'rgba(59,130,246,0.12)',
                              color:
                                req.request_type === 'check_in'
                                  ? '#6ee7b7'
                                  : req.request_type === 'check_out'
                                    ? '#fcd34d'
                                    : '#93c5fd',
                              border: '1px solid rgba(255,255,255,0.08)',
                            }}
                          >
                            {req.request_type.replace(/_/g, ' ')}
                          </span>
                        </td>

                        <td className="px-4 py-3 font-mono font-medium" style={{ color: '#93c5fd' }}>
                          {formatDateTime(req.requested_at)}
                        </td>

                        <td className="px-4 py-3 max-w-xs">
                          <div className="truncate text-slate-300" title={req.reason}>
                            {req.reason}
                          </div>
                          {req.review_note && (
                            <div className="text-[10px] mt-0.5 truncate" style={{ color: '#94a3b8' }}>
                              Review note: {req.review_note}
                            </div>
                          )}
                        </td>

                        <td className="px-4 py-3 text-center">
                          <StatusBadge
                            status={
                              req.status === 'pending'
                                ? 'Pending'
                                : req.status === 'approved'
                                  ? 'Approved'
                                  : 'Rejected'
                            }
                          />
                        </td>

                        <td className="px-4 py-3 text-slate-400 font-mono text-[11px]">
                          {formatDateTime(req.created_at)}
                        </td>

                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setReviewingRequest(req)}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                            style={{
                              background: req.status === 'pending' ? '#2563eb' : '#122338',
                              color: req.status === 'pending' ? '#fff' : '#93c5fd',
                              border: '1px solid #1e3a5a',
                            }}
                          >
                            {req.status === 'pending' ? 'Review & Decide' : 'View Details'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Direct Corrections Log */
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3a5a' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: '#122338', color: '#64748b' }}>
                  <th className="text-left px-4 py-3">Work Date</th>
                  <th className="text-left px-4 py-3">Employee</th>
                  <th className="text-left px-4 py-3">Corrected Times (In / Out)</th>
                  <th className="text-right px-4 py-3">Worked</th>
                  <th className="text-right px-4 py-3">Overtime</th>
                  <th className="text-left px-4 py-3">Correction Audit Reason</th>
                  <th className="text-center px-4 py-3">Recalculated</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center">
                      <Loader2 size={20} className="animate-spin mx-auto text-blue-500" />
                    </td>
                  </tr>
                ) : filteredDirectRecords.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-12 text-center">
                      <RotateCcw size={28} className="mx-auto mb-2" style={{ color: '#1e3a5a' }} />
                      <div className="font-semibold text-white">No direct manager corrections logged</div>
                      <div className="text-xs mt-1" style={{ color: '#4b6a8a' }}>
                        Click &quot;+ New Attendance Correction&quot; to apply a correction.
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredDirectRecords.map(rec => {
                    const emp = empMap.get(rec.employee_id);
                    return (
                      <tr
                        key={rec.id}
                        className="border-t hover:bg-white/[0.02] transition-colors"
                        style={{ borderColor: '#1e3a5a' }}
                      >
                        <td className="px-4 py-3 font-mono font-medium text-white">
                          {rec.attendance_date}
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Avatar name={emp?.full_name || 'Employee'} size="sm" />
                            <div>
                              <div className="font-semibold text-white">
                                {emp?.full_name || 'Unknown Employee'}
                              </div>
                              <div className="text-[11px] font-mono" style={{ color: '#4b6a8a' }}>
                                {emp?.employee_code || rec.employee_id.slice(0, 8)}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-4 py-3 font-mono">
                          <div className="text-emerald-400">In: {formatTimeOnly(rec.check_in_at)}</div>
                          <div className="text-amber-400">Out: {formatTimeOnly(rec.check_out_at)}</div>
                        </td>

                        <td className="px-4 py-3 text-right font-mono text-white">
                          {formatDuration(rec.worked_minutes)}
                        </td>

                        <td className="px-4 py-3 text-right font-mono" style={{ color: rec.overtime_minutes > 0 ? '#c4b5fd' : '#64748b' }}>
                          {rec.overtime_minutes > 0 ? formatDuration(rec.overtime_minutes) : '—'}
                        </td>

                        <td className="px-4 py-3 max-w-sm">
                          <div className="text-slate-300 truncate" title={rec.notes || ''}>
                            {rec.notes || 'Direct attendance correction'}
                          </div>
                          <div className="text-[10px]" style={{ color: '#64748b' }}>
                            Applied on {formatDateTime(rec.updated_at || rec.created_at)}
                          </div>
                        </td>

                        <td className="px-4 py-3 text-center">
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase"
                            style={{
                              background: 'rgba(16,185,129,0.12)',
                              color: '#6ee7b7',
                              border: '1px solid rgba(16,185,129,0.25)',
                            }}
                          >
                            Recalculated
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Review Request Modal */}
      {reviewingRequest && (
        <ReviewModal
          request={reviewingRequest}
          employee={empMap.get(reviewingRequest.employee_id) ?? null}
          departmentName={deptMap.get(empMap.get(reviewingRequest.employee_id)?.department_id ?? '') ?? '—'}
          currentUserId={user?.id ?? ''}
          canManage={canManage}
          onClose={() => setReviewingRequest(null)}
          onReviewed={async (msg) => {
            setReviewingRequest(null);
            setSuccessMsg(msg);
            await loadData();
          }}
        />
      )}

      {/* Direct Attendance Correction Modal */}
      {showDirectModal && (
        <DirectCorrectionModal
          organizationId={organizationId}
          employees={employees}
          departments={departments}
          lookups={lookups}
          initialEmployeeId={targetEmpForCorrection?.employeeId}
          initialWorkDate={targetEmpForCorrection?.workDate}
          onClose={() => {
            setShowDirectModal(false);
            setTargetEmpForCorrection(null);
          }}
          onSaved={async (msg) => {
            setShowDirectModal(false);
            setTargetEmpForCorrection(null);
            setSuccessMsg(msg);
            await loadData();
          }}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// Review Modal for Employee Request
// -------------------------------------------------------------
function ReviewModal({
  request,
  employee,
  departmentName,
  currentUserId,
  canManage,
  onClose,
  onReviewed,
}: {
  request: ManualAttendanceRequestRow;
  employee: EmployeeProfileRow | null;
  departmentName: string;
  currentUserId: string;
  canManage: boolean;
  onClose: () => void;
  onReviewed: (message: string) => Promise<void>;
}) {
  const [reviewNote, setReviewNote] = useState(request.review_note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleDecision = async (status: 'approved' | 'rejected') => {
    if (!canManage) {
      setError('You do not have permission to review correction requests.');
      return;
    }
    if (status === 'rejected' && reviewNote.trim().length < 3) {
      setError('Please provide a review note explaining the rejection reason.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await correctionService.reviewRequest(
        request.id,
        status,
        currentUserId,
        reviewNote.trim() || (status === 'approved' ? 'Approved by manager' : null),
      );
      await onReviewed(
        `Correction request ${status === 'approved' ? 'approved and attendance recalculated' : 'rejected'}.`,
      );
    } catch (err) {
      setError(getErrorMessage(err));
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(6,13,26,0.85)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}
      >
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid #1e3a5a', background: '#08111f' }}
        >
          <div className="font-bold text-white text-sm">Attendance Correction Request</div>
          <button onClick={onClose} style={{ color: '#4b6a8a' }}>
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div
              className="p-3 rounded-xl flex gap-2 text-xs"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}
            >
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          {/* Employee Info Header */}
          <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: '#122338' }}>
            <Avatar name={employee?.full_name || 'Employee'} />
            <div>
              <div className="font-semibold text-white">{employee?.full_name || 'Unknown'}</div>
              <div className="text-xs font-mono" style={{ color: '#3b82f6' }}>
                {employee?.employee_code} · {departmentName}
              </div>
            </div>
            <div className="ml-auto">
              <StatusBadge
                status={
                  request.status === 'pending'
                    ? 'Pending'
                    : request.status === 'approved'
                      ? 'Approved'
                      : 'Rejected'
                }
              />
            </div>
          </div>

          {/* Request Details Grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-xl" style={{ background: '#122338' }}>
              <div style={{ color: '#4b6a8a' }}>Correction Type</div>
              <div className="font-semibold text-white mt-1 uppercase">
                {request.request_type.replace(/_/g, ' ')}
              </div>
            </div>
            <div className="p-3 rounded-xl" style={{ background: '#122338' }}>
              <div style={{ color: '#4b6a8a' }}>Requested Timestamp</div>
              <div className="font-semibold font-mono text-blue-400 mt-1">
                {formatDateTime(request.requested_at)}
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl text-xs space-y-1" style={{ background: '#122338' }}>
            <div style={{ color: '#4b6a8a' }}>Employee Explanation / Reason</div>
            <div className="text-white mt-1">{request.reason}</div>
          </div>

          {/* Reviewer Note */}
          <div>
            <label className="block text-xs mb-1" style={{ color: '#94a3b8' }}>
              Reviewer Decision Note {request.status === 'pending' && <span style={{ color: '#64748b' }}>(Required if rejecting)</span>}
            </label>
            <textarea
              rows={3}
              disabled={request.status !== 'pending' || !canManage}
              value={reviewNote}
              onChange={e => setReviewNote(e.target.value)}
              placeholder="Add review notes or audit feedback for the employee…"
              className="w-full px-3 py-2 rounded-xl text-xs outline-none resize-none"
              style={fieldStyle}
            />
          </div>

          {request.status !== 'pending' && (
            <div className="text-[11px]" style={{ color: '#64748b' }}>
              Decision recorded on {formatDateTime(request.reviewed_at)}
            </div>
          )}
        </div>

        <div
          className="px-6 py-4 flex justify-end gap-3"
          style={{ borderTop: '1px solid #1e3a5a', background: '#08111f' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs"
            style={{ background: '#122338', color: '#94a3b8' }}
          >
            Close
          </button>

          {request.status === 'pending' && canManage && (
            <>
              <button
                disabled={saving}
                onClick={() => void handleDecision('rejected')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                Reject
              </button>
              <button
                disabled={saving}
                onClick={() => void handleDecision('approved')}
                className="flex items-center gap-1.5 px-5 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                style={{ background: '#059669', color: '#fff' }}
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                Approve & Recalculate
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Direct Attendance Correction Modal
// -------------------------------------------------------------
function DirectCorrectionModal({
  organizationId,
  employees,
  departments,
  lookups,
  initialEmployeeId,
  initialWorkDate,
  onClose,
  onSaved,
}: {
  organizationId: string;
  employees: EmployeeProfileRow[];
  departments: DepartmentRow[];
  lookups: EmployeeLookups;
  initialEmployeeId?: string;
  initialWorkDate?: string;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const initEmp = employees.find(e => e.id === initialEmployeeId);
  const [modalDeptId, setModalDeptId] = useState(initEmp?.department_id || '');
  const [selectedEmpId, setSelectedEmpId] = useState(initialEmployeeId || '');
  const [workDate, setWorkDate] = useState(() => initialWorkDate || todayInTimezone('Asia/Riyadh'));
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (initialEmployeeId) {
      setSelectedEmpId(initialEmployeeId);
      const matched = employees.find(e => e.id === initialEmployeeId);
      if (matched?.department_id) setModalDeptId(matched.department_id);
    }
    if (initialWorkDate) setWorkDate(initialWorkDate);
  }, [initialEmployeeId, initialWorkDate, employees]);

  const filteredEmployees = useMemo(() => {
    return modalDeptId
      ? employees.filter(e => e.department_id === modalDeptId)
      : employees;
  }, [employees, modalDeptId]);

  const [loadingDetails, setLoadingDetails] = useState(false);
  const [existingAttendance, setExistingAttendance] = useState<AttendanceRecordRow | null>(null);
  const [schedule, setSchedule] = useState<ResolvedScheduleRow | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Load details whenever employee or workDate changes
  useEffect(() => {
    if (!selectedEmpId || !workDate) {
      setExistingAttendance(null);
      setSchedule(null);
      return;
    }
    let cancelled = false;
    setLoadingDetails(true);
    setError('');

    correctionService
      .getAttendanceDetails(organizationId, selectedEmpId, workDate)
      .then(res => {
        if (cancelled) return;
        setExistingAttendance(res.attendance);
        setSchedule(res.schedule);

        // Pre-fill checkIn / checkOut from existing attendance or shift template
        if (res.attendance?.check_in_at) {
          setCheckIn(res.attendance.check_in_at.slice(0, 16));
        } else if (res.schedule?.start_time) {
          setCheckIn(localDateTimeInput(workDate, res.schedule.start_time));
        } else {
          setCheckIn(localDateTimeInput(workDate, '09:00'));
        }

        if (res.attendance?.check_out_at) {
          setCheckOut(res.attendance.check_out_at.slice(0, 16));
        } else if (res.schedule?.end_time) {
          // Night shift cross midnight check
          const isCrossMidnight =
            res.schedule.crosses_midnight ||
            (Boolean(res.schedule.start_time) && res.schedule.end_time <= res.schedule.start_time!);
          const nextDay = new Date(`${workDate}T00:00:00Z`);
          nextDay.setUTCDate(nextDay.getUTCDate() + 1);
          const outDate = isCrossMidnight ? nextDay.toISOString().slice(0, 10) : workDate;
          setCheckOut(localDateTimeInput(outDate, res.schedule.end_time));
        } else {
          setCheckOut(localDateTimeInput(workDate, '17:00'));
        }
      })
      .catch(err => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingDetails(false);
      });

    return () => {
      cancelled = true;
    };
  }, [organizationId, selectedEmpId, workDate]);

  const submit = async () => {
    if (!selectedEmpId) {
      setError('Please select an employee.');
      return;
    }
    if (!workDate) {
      setError('Please select a work date.');
      return;
    }
    if (!checkIn || !checkOut) {
      setError('Both check-in and check-out timestamps are required.');
      return;
    }
    if (Date.parse(checkOut) <= Date.parse(checkIn)) {
      setError('Check-out timestamp must be after check-in timestamp.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Please provide a valid correction reason / audit note (at least 3 characters).');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const input: DirectAttendanceCorrectionInput = {
        organizationId,
        employeeId: selectedEmpId,
        workDate,
        attendanceRecordId: existingAttendance?.id || null,
        checkInAt: new Date(checkIn).toISOString(),
        checkOutAt: new Date(checkOut).toISOString(),
        reason: reason.trim(),
      };

      await correctionService.directCorrection(input);
      const emp = employees.find(e => e.id === selectedEmpId);
      await onSaved(
        `Attendance for ${emp?.full_name || 'employee'} on ${workDate} successfully corrected and recalculated.`,
      );
    } catch (err) {
      setError(getErrorMessage(err));
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(6,13,26,0.85)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}
      >
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid #1e3a5a', background: '#08111f' }}
        >
          <div>
            <h2 className="font-bold text-white text-sm">Direct Attendance Correction</h2>
            <div className="text-[11px]" style={{ color: '#64748b' }}>
              Create or override timesheet punches with automatic attendance recalculation.
            </div>
          </div>
          <button onClick={onClose} style={{ color: '#4b6a8a' }}>
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {error && (
            <div
              className="p-3 rounded-xl flex gap-2 text-xs"
              style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}
            >
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          {/* Department, Employee & Date Selection */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block mb-1 font-medium" style={{ color: '#94a3b8' }}>
                Filter Department
              </label>
              <select
                value={modalDeptId}
                onChange={e => {
                  const newDept = e.target.value;
                  setModalDeptId(newDept);
                  if (selectedEmpId) {
                    const emp = employees.find(x => x.id === selectedEmpId);
                    if (newDept && emp && emp.department_id !== newDept) {
                      setSelectedEmpId('');
                    }
                  }
                }}
                className="w-full px-3 py-2 rounded-lg outline-none"
                style={fieldStyle}
              >
                <option value="">All Departments</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block mb-1 font-medium" style={{ color: '#94a3b8' }}>
                Select Employee *
              </label>
              <select
                value={selectedEmpId}
                onChange={e => setSelectedEmpId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg outline-none"
                style={fieldStyle}
              >
                <option value="">Choose an employee…</option>
                {filteredEmployees.map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name} ({emp.employee_code})
                    {emp.employment_status !== 'active'
                      ? ` [${emp.employment_status.replace(/_/g, ' ')}]`
                      : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block mb-1 font-medium" style={{ color: '#94a3b8' }}>
                Work Date *
              </label>
              <input
                type="date"
                value={workDate}
                onChange={e => setWorkDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg outline-none"
                style={fieldStyle}
              />
            </div>
          </div>

          {/* Schedule & Attendance State Preview */}
          {selectedEmpId && (
            <div className="p-3 rounded-xl space-y-2 text-xs" style={{ background: '#122338' }}>
              <div className="font-semibold text-white flex items-center justify-between">
                <span>Date & Shift Status</span>
                {loadingDetails && <Loader2 size={13} className="animate-spin text-blue-400" />}
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span style={{ color: '#64748b' }}>Scheduled Shift: </span>
                  <span className="font-medium text-slate-200">
                    {schedule?.shift_name || schedule?.state || 'Off / Unassigned'}
                  </span>
                  {schedule?.start_time && (
                    <span className="font-mono text-slate-400 ml-1">
                      ({schedule.start_time} – {schedule.end_time || '—'})
                    </span>
                  )}
                </div>

                <div>
                  <span style={{ color: '#64748b' }}>Current Attendance: </span>
                  <span
                    className="font-medium"
                    style={{
                      color: existingAttendance ? '#6ee7b7' : '#fca5a5',
                    }}
                  >
                    {existingAttendance
                      ? `${existingAttendance.status.replace(/_/g, ' ')} (${formatDuration(existingAttendance.worked_minutes)})`
                      : 'No attendance recorded (Absent)'}
                  </span>
                </div>
              </div>

              {existingAttendance && (
                <div className="text-[11px] font-mono text-slate-400 pt-1 border-t" style={{ borderColor: '#1e3a5a' }}>
                  Current In: {formatTimeOnly(existingAttendance.check_in_at)} · Current Out: {formatTimeOnly(existingAttendance.check_out_at)}
                </div>
              )}
            </div>
          )}

          {/* Corrected Punches */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block mb-1 font-medium" style={{ color: '#94a3b8' }}>
                Corrected Check-in *
              </label>
              <input
                type="datetime-local"
                value={checkIn}
                onChange={e => setCheckIn(e.target.value)}
                className="w-full px-3 py-2 rounded-lg outline-none font-mono"
                style={fieldStyle}
              />
            </div>

            <div>
              <label className="block mb-1 font-medium" style={{ color: '#94a3b8' }}>
                Corrected Check-out *
              </label>
              <input
                type="datetime-local"
                value={checkOut}
                onChange={e => setCheckOut(e.target.value)}
                className="w-full px-3 py-2 rounded-lg outline-none font-mono"
                style={fieldStyle}
              />
            </div>
          </div>

          {/* Reason */}
          <div className="text-xs">
            <label className="block mb-1 font-medium" style={{ color: '#94a3b8' }}>
              Correction Reason / Audit Note *
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Explain the reason for this attendance correction (e.g. Device failure, approved manager adjustment, gate punch missed)…"
              className="w-full px-3 py-2 rounded-xl text-xs outline-none resize-none"
              style={fieldStyle}
            />
            <div className="text-[11px] mt-1" style={{ color: '#64748b' }}>
              This audit reason will be permanently stored on the attendance record and logged in system audit trails.
            </div>
          </div>
        </div>

        <div
          className="px-6 py-4 flex justify-end gap-3"
          style={{ borderTop: '1px solid #1e3a5a', background: '#08111f' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs"
            style={{ background: '#122338', color: '#94a3b8' }}
          >
            Cancel
          </button>
          <button
            disabled={saving || !selectedEmpId}
            onClick={() => void submit()}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
            style={{ background: '#2563eb', color: '#fff' }}
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            Save & Recalculate
          </button>
        </div>
      </div>
    </div>
  );
}
