import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CheckCircle, XCircle, AlertCircle, RefreshCw, Edit3, RotateCcw, ExternalLink, Loader2, X } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import Avatar from '../components/Avatar';
import { useAuth } from '../auth/AuthContext';
import { attendanceService } from '../services/attendance.service';
import { employeeService } from '../services/employee.service';
import { organizationService } from '../services/organization.service';
import { shiftService } from '../services/shift.service';
import { correctionService } from '../services/correction.service';
import { isSupabaseConfigured } from '../lib/supabase';
import { employees as mockEmployees } from '../data/mockData';
import { todayInTimezone } from '../lib/dates';
import { getErrorMessage } from '../lib/errors';
import type { AttendanceRecordRow, DepartmentRow, EmployeeProfileRow, ShiftAssignmentRow, ShiftRow, ManualAttendanceRequestRow } from '../types/database';

const tabs = ['Today', 'Corrections'];

// Helper to format ISO strings to HH:MM AM/PM
function formatTime(isoString: string | null) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

// Helper to format minutes into HH:MM
function formatDuration(minutes: number | null) {
  if (minutes == null || minutes === 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export default function Attendance() {
  const { activeMembership, user, hasAnyRole } = useAuth();
  const organizationId = activeMembership?.organization_id ?? '';
  const supabaseReady = isSupabaseConfigured();
  const navigate = useNavigate();
  const canManage = hasAnyRole(['administrator', 'manager']);

  const [tab, setTab] = useState('Today');
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  
  // Real data state
  const [records, setRecords] = useState<AttendanceRecordRow[]>([]);
  const [emps, setEmps] = useState<EmployeeProfileRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [assignments, setAssignments] = useState<(ShiftAssignmentRow & { shift: ShiftRow | null })[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Direct correction modal state
  const [correctingTarget, setCorrectingTarget] = useState<{
    employeeId: string;
    name: string;
    code: string;
    shiftName: string;
    shiftStart: string | null;
    shiftEnd: string | null;
    checkInAt: string | null;
    checkOutAt: string | null;
    recordId: string | null;
  } | null>(null);
  const [correctingIn, setCorrectingIn] = useState('');
  const [correctingOut, setCorrectingOut] = useState('');
  const [correctingReason, setCorrectingReason] = useState('');
  const [correctingSaving, setCorrectingSaving] = useState(false);
  const [correctingError, setCorrectingError] = useState('');

  // Corrections requests
  const [corrections, setCorrections] = useState<ManualAttendanceRequestRow[]>([]);

  const approveCorrection = async (id: string) => {
    if (!user) return;
    setLoading(true);
    try {
      await correctionService.reviewRequest(id, 'approved', user.id, 'Manager approved');
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to approve correction.');
    } finally {
      setLoading(false);
    }
  };
  
  const rejectCorrection = async (id: string) => {
    if (!user) return;
    setLoading(true);
    try {
      await correctionService.reviewRequest(id, 'rejected', user.id, 'Manager rejected');
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reject correction.');
    } finally {
      setLoading(false);
    }
  };

  const loadData = async () => {
    if (!supabaseReady || !organizationId) return;
    setLoading(true);
    setError('');
    try {
      const today = todayInTimezone('Asia/Riyadh');
      
      const [recData, empData, departmentData, assignData, corrData] = await Promise.all([
        attendanceService.list({ organizationId, fromDate: today, toDate: today }),
        employeeService.listAll({ organizationId }),
        organizationService.listDepartments(organizationId),
        shiftService.listAssignments({ organization_id: organizationId, from_date: today, to_date: today }),
        correctionService.list({ organizationId })
      ]);
      
      setRecords(recData);
      setEmps(empData);
      setDepartments(departmentData.filter(department => department.status === 'active'));
      setAssignments(assignData);
      setCorrections(corrData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load attendance.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabaseReady, organizationId]);

  // Combine data for display
  const departmentNames = useMemo(() => new Map(departments.map(department => [department.id, department.name])), [departments]);

  const displayData = useMemo(() => {
    if (!supabaseReady) {
      // Fallback to mock if no supabase
      return mockEmployees.map(e => ({
        id: e.id,
        employeeId: e.id,
        name: e.name,
        photo: e.photo,
        dept: e.dept,
        deptId: e.dept,
        shiftName: e.shift,
        shiftStart: '09:00:00' as string | null,
        shiftEnd: '17:00:00' as string | null,
        recordId: null as string | null,
        rawCheckIn: null as string | null,
        rawCheckOut: null as string | null,
        checkin: e.checkin,
        checkout: e.checkout,
        worked: e.worked,
        lateMin: e.lateMin,
        earlyMin: 0,
        missingMin: 0,
        calcOvertime: 0,
        attendanceStatus: e.attendance,
        source: e.checkin ? 'Auto Geo Check-In' : '—',
      }));
    }

    return emps.map(emp => {
      const rec = records.find(r => r.employee_id === emp.id);
      const assignment = assignments.find(a => a.employee_id === emp.id);
      
      const isOff = assignment?.status === 'off';
      let statusStr = isOff ? 'Employee week Off' : 'Absent';
      if (rec) {
        if (rec.status === 'present') statusStr = 'Present';
        else if (rec.status === 'late') statusStr = 'Late';
        else if (isOff) statusStr = 'Employee week Off';
        else if (rec.status === 'absent') statusStr = 'Absent';
        else if (rec.status === 'missing_check_in' || rec.status === 'missing_check_out') statusStr = 'Missing';
      }

      let sourceStr = '—';
      if (rec?.source === 'automatic_geofence') sourceStr = 'Auto Geofence';
      else if (rec?.source === 'manual_employee') sourceStr = 'Manual (Employee)';
      else if (rec?.source === 'manual_manager') sourceStr = 'Manual (Manager)';
      else if (rec?.source === 'admin') sourceStr = 'Admin';

      return {
        id: emp.employee_code || emp.id.substring(0, 8),
        employeeId: emp.id,
        name: emp.full_name,
        dept: departmentNames.get(emp.department_id) ?? 'Unassigned',
        deptId: emp.department_id,
        shiftName: assignment?.shift?.name || 'Off / Unassigned',
        shiftStart: assignment?.shift?.start_time ?? null,
        shiftEnd: assignment?.shift?.end_time ?? null,
        recordId: rec?.id ?? null,
        rawCheckIn: rec?.check_in_at ?? null,
        rawCheckOut: rec?.check_out_at ?? null,
        checkin: formatTime(rec?.check_in_at ?? null),
        checkout: formatTime(rec?.check_out_at ?? null),
        worked: formatDuration(rec?.worked_minutes ?? null),
        lateMin: rec?.late_minutes || 0,
        earlyMin: rec?.early_leaving_minutes || 0,
        missingMin: rec?.missing_minutes || 0,
        calcOvertime: rec?.overtime_minutes || 0,
        attendanceStatus: statusStr,
        source: sourceStr,
      };
    });
  }, [supabaseReady, emps, records, assignments, departmentNames]);

  const openCorrection = (emp: (typeof displayData)[number]) => {
    const today = todayInTimezone('Asia/Riyadh');
    const inVal = emp.rawCheckIn
      ? emp.rawCheckIn.slice(0, 16)
      : `${today}T${(emp.shiftStart || '09:00').slice(0, 5)}`;
    const isCross = emp.shiftStart && emp.shiftEnd && emp.shiftEnd <= emp.shiftStart;
    const nextDay = new Date(`${today}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const outDate = isCross ? nextDay.toISOString().slice(0, 10) : today;
    const outVal = emp.rawCheckOut
      ? emp.rawCheckOut.slice(0, 16)
      : `${outDate}T${(emp.shiftEnd || '17:00').slice(0, 5)}`;

    setCorrectingIn(inVal);
    setCorrectingOut(outVal);
    setCorrectingReason('');
    setCorrectingError('');
    setCorrectingTarget({
      employeeId: emp.employeeId,
      name: emp.name,
      code: emp.id,
      shiftName: emp.shiftName,
      shiftStart: emp.shiftStart,
      shiftEnd: emp.shiftEnd,
      checkInAt: emp.rawCheckIn,
      checkOutAt: emp.rawCheckOut,
      recordId: emp.recordId,
    });
  };

  const submitDirectCorrection = async () => {
    if (!correctingTarget) return;
    if (!correctingIn || !correctingOut) {
      setCorrectingError('Both check-in and check-out timestamps are required.');
      return;
    }
    if (Date.parse(correctingOut) <= Date.parse(correctingIn)) {
      setCorrectingError('Check-out timestamp must be after check-in.');
      return;
    }
    if (correctingReason.trim().length < 3) {
      setCorrectingError('Please enter a valid correction reason (at least 3 characters).');
      return;
    }
    setCorrectingSaving(true);
    setCorrectingError('');
    try {
      const today = todayInTimezone('Asia/Riyadh');
      await correctionService.directCorrection({
        organizationId,
        employeeId: correctingTarget.employeeId,
        workDate: today,
        attendanceRecordId: correctingTarget.recordId,
        checkInAt: new Date(correctingIn).toISOString(),
        checkOutAt: new Date(correctingOut).toISOString(),
        reason: correctingReason.trim(),
      });
      setCorrectingTarget(null);
      await loadData();
    } catch (err) {
      setCorrectingError(getErrorMessage(err));
    } finally {
      setCorrectingSaving(false);
    }
  };

  const departmentDisplayData = useMemo(
    () => departmentId ? displayData.filter(employee => employee.deptId === departmentId) : displayData,
    [departmentId, displayData],
  );

  const filtered = departmentDisplayData.filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.id.toLowerCase().includes(search.toLowerCase())
  );

  const stats = useMemo(() => {
    return {
      present: departmentDisplayData.filter(e => e.attendanceStatus === 'Present' || e.attendanceStatus === 'Late').length,
      late: departmentDisplayData.filter(e => e.attendanceStatus === 'Late').length,
      absent: departmentDisplayData.filter(e => e.attendanceStatus === 'Absent').length,
      missing: departmentDisplayData.filter(e => e.attendanceStatus === 'Missing').length,
    };
  }, [departmentDisplayData]);

  const departmentEmployeeIds = useMemo(
    () => new Set((departmentId ? emps.filter(employee => employee.department_id === departmentId) : emps).map(employee => employee.id)),
    [departmentId, emps],
  );
  const filteredCorrections = useMemo(
    () => departmentId ? corrections.filter(record => departmentEmployeeIds.has(record.employee_id)) : corrections,
    [corrections, departmentEmployeeIds, departmentId],
  );
  const pendingCorrectionCount = filteredCorrections.filter(r => r.status === 'pending').length;

  const todayStr = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Attendance & Timesheets</h1>
          <p className="text-sm mt-0.5" style={{ color: '#4b6a8a' }}>{todayStr}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Filter attendance by department"
            value={departmentId}
            onChange={event => setDepartmentId(event.target.value)}
            className="px-3 py-2 rounded-lg text-xs outline-none"
            style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: '#94a3b8' }}
          >
            <option value="">All Departments</option>
            {departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
          </select>
        {supabaseReady && (
          <button 
            onClick={() => void loadData()}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors"
            style={{ border: '1px solid #1e3a5a', color: '#4b6a8a' }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      <div className="flex gap-1 border-b" style={{ borderColor: '#1e3a5a' }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} className="px-4 py-2.5 text-sm font-medium transition-all"
            style={{ color: tab === t ? '#f0f6ff' : '#4b6a8a', borderBottom: tab === t ? '2px solid #2563eb' : '2px solid transparent', marginBottom: '-1px' }}>
            {t}
            {t === 'Corrections' && pendingCorrectionCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-mono" style={{ background: '#f97316', color: '#fff', fontSize: 10 }}>
                {pendingCorrectionCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'Today' && (
        <>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Present', value: stats.present, color: '#10b981' },
              { label: 'Late', value: stats.late, color: '#f59e0b' },
              { label: 'Absent', value: stats.absent, color: '#ef4444' },
              { label: 'Missing Check-In', value: stats.missing, color: '#f97316' },
            ].map(s => (
              <div key={s.label} className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
                <div className="text-xs" style={{ color: '#4b6a8a' }}>{s.label}</div>
                <div className="text-3xl font-bold font-mono mt-1" style={{ color: s.color }}>
                  {loading ? '-' : s.value}
                </div>
              </div>
            ))}
          </div>

          <div className="relative max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#4b6a8a' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employee..." className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: '#f0f6ff' }} />
          </div>

          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3a5a' }}>
            <table className="w-full">
              <thead>
                <tr style={{ background: '#122338' }}>
                  {['Employee', 'Shift', 'In/Out', 'Worked', 'Missing', 'Calc. OT', 'Status', 'Source', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#4b6a8a' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((emp) => (
                  <tr key={emp.id} className="border-t hover:bg-white/5 transition-colors" style={{ borderColor: '#1e3a5a' }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar name={emp.name} size="sm" />
                        <div>
                          <div className="text-xs font-medium text-white">{emp.name}</div>
                          <div className="text-xs font-mono" style={{ color: '#4b6a8a' }}>{emp.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: '#f0f6ff' }}>{emp.shiftName}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <div style={{ color: emp.checkin !== '—' ? '#10b981' : '#4b6a8a' }}>{emp.checkin}</div>
                      <div style={{ color: emp.checkout !== '—' ? '#f59e0b' : '#4b6a8a', fontSize: '10px' }}>{emp.checkout}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: '#94a3b8' }}>
                      {emp.worked}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {emp.missingMin > 0 ? (
                        <span style={{ color: '#ef4444' }}>{formatDuration(emp.missingMin)}</span>
                      ) : (
                        <span style={{ color: '#4b6a8a' }}>—</span>
                      )}
                      {emp.earlyMin > 0 && <div style={{ color: '#f59e0b', fontSize: '10px' }}>{formatDuration(emp.earlyMin)} early</div>}
                      {emp.lateMin > 0 && <div style={{ color: '#f59e0b', fontSize: '10px' }}>{formatDuration(emp.lateMin)} late</div>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: emp.calcOvertime > 0 ? '#8b5cf6' : '#4b6a8a' }}>
                      {emp.calcOvertime > 0 ? formatDuration(emp.calcOvertime) : '—'}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={emp.attendanceStatus} /></td>
                    <td className="px-4 py-3 text-xs" style={{ color: '#4b6a8a' }}>{emp.source}</td>
                    <td className="px-4 py-3">
                      {canManage && (
                        <button
                          onClick={() => openCorrection(emp)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors"
                          style={{ background: 'rgba(37,99,235,0.12)', color: '#93c5fd', border: '1px solid rgba(37,99,235,0.25)' }}
                          title="Correct attendance for this employee"
                        >
                          <Edit3 size={11} /> Correct
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && !loading && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: '#4b6a8a' }}>
                      No attendance records found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'Corrections' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
            <div>
              <div className="text-sm font-semibold text-white flex items-center gap-2">
                <RotateCcw size={16} className="text-blue-400" />
                Attendance Correction Management
              </div>
              <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>
                For custom date ranges, manager direct corrections, and timesheet recalculations, access the full module.
              </div>
            </div>
            <button
              onClick={() => navigate('/corrections')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold"
              style={{ background: '#2563eb', color: '#fff' }}
            >
              <span>Open Correction Module</span>
              <ExternalLink size={13} />
            </button>
          </div>

          {pendingCorrectionCount > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg text-sm" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b' }}>
              <AlertCircle size={14} />
              {pendingCorrectionCount} correction request(s) pending approval
            </div>
          )}

          {filteredCorrections.map(req => {
            const emp = emps.find(e => e.id === req.employee_id);
            return (
              <div key={req.id} className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="font-semibold text-sm text-white">{emp?.full_name || 'Unknown Employee'}</div>
                      <StatusBadge status={req.status === 'pending' ? 'Pending' : req.status === 'approved' ? 'Approved' : 'Rejected'} />
                    </div>
                    <div className="text-xs" style={{ color: '#4b6a8a' }}>{emp?.employee_code || req.employee_id.slice(0, 8)} · {req.request_type === 'check_in' ? 'Check In' : 'Check Out'}</div>
                    <div className="text-xs mt-2" style={{ color: '#94a3b8' }}>
                      <span className="font-medium" style={{ color: '#f0f6ff' }}>Requested Time:</span> {formatTime(req.requested_at)}
                    </div>
                    <div className="text-xs mt-1" style={{ color: '#4b6a8a' }}>Reason: {req.reason || 'None provided'}</div>
                    <div className="text-xs mt-0.5" style={{ color: '#4b6a8a' }}>Submitted: {formatTime(req.created_at)}</div>
                  </div>
                  {req.status === 'pending' && (
                    <div className="flex gap-2 flex-shrink-0 ml-4">
                      <button
                        onClick={() => approveCorrection(req.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                        style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}
                      >
                        <CheckCircle size={12} /> Approve
                      </button>
                      <button
                        onClick={() => rejectCorrection(req.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                        style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
                      >
                        <XCircle size={12} /> Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Row Direct Correction Dialog */}
      {correctingTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(6,13,26,0.85)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl"
            style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}
          >
            <div
              className="flex items-center justify-between px-6 py-4"
              style={{ borderBottom: '1px solid #1e3a5a', background: '#08111f' }}
            >
              <div>
                <h3 className="font-bold text-white text-sm">Correct Attendance</h3>
                <div className="text-[11px]" style={{ color: '#64748b' }}>
                  {correctingTarget.name} ({correctingTarget.code}) · {correctingTarget.shiftName}
                </div>
              </div>
              <button
                onClick={() => setCorrectingTarget(null)}
                style={{ color: '#4b6a8a' }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {correctingError && (
                <div
                  className="p-3 rounded-xl flex gap-2 text-xs"
                  style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}
                >
                  <AlertCircle size={15} />
                  <span>{correctingError}</span>
                </div>
              )}

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block mb-1 font-medium" style={{ color: '#94a3b8' }}>
                    Corrected Check-in *
                  </label>
                  <input
                    type="datetime-local"
                    value={correctingIn}
                    onChange={e => setCorrectingIn(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg outline-none font-mono"
                    style={{ background: '#08111f', border: '1px solid #1e3a5a', color: '#f0f6ff' }}
                  />
                </div>

                <div>
                  <label className="block mb-1 font-medium" style={{ color: '#94a3b8' }}>
                    Corrected Check-out *
                  </label>
                  <input
                    type="datetime-local"
                    value={correctingOut}
                    onChange={e => setCorrectingOut(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg outline-none font-mono"
                    style={{ background: '#08111f', border: '1px solid #1e3a5a', color: '#f0f6ff' }}
                  />
                </div>

                <div>
                  <label className="block mb-1 font-medium" style={{ color: '#94a3b8' }}>
                    Correction Reason / Audit Note *
                  </label>
                  <textarea
                    rows={3}
                    value={correctingReason}
                    onChange={e => setCorrectingReason(e.target.value)}
                    placeholder="State reason for manual attendance correction…"
                    className="w-full px-3 py-2 rounded-xl outline-none resize-none"
                    style={{ background: '#08111f', border: '1px solid #1e3a5a', color: '#f0f6ff' }}
                  />
                  <div className="text-[11px] mt-1" style={{ color: '#64748b' }}>
                    Worked hours, late minutes, and overtime will be automatically recalculated.
                  </div>
                </div>
              </div>
            </div>

            <div
              className="px-6 py-4 flex justify-end gap-3"
              style={{ borderTop: '1px solid #1e3a5a', background: '#08111f' }}
            >
              <button
                onClick={() => setCorrectingTarget(null)}
                className="px-4 py-2 rounded-lg text-xs"
                style={{ background: '#122338', color: '#94a3b8' }}
              >
                Cancel
              </button>
              <button
                disabled={correctingSaving}
                onClick={() => void submitDirectCorrection()}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                style={{ background: '#2563eb', color: '#fff' }}
              >
                {correctingSaving && <Loader2 size={13} className="animate-spin" />}
                Save & Recalculate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
