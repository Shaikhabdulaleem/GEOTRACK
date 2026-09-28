import { useState, useEffect, useMemo } from 'react';
import { Search, CheckCircle, XCircle, AlertCircle, RefreshCw, Clock } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import Avatar from '../components/Avatar';
import { useAuth } from '../auth/AuthContext';
import { attendanceService } from '../services/attendance.service';
import { employeeService } from '../services/employee.service';
import { shiftService } from '../services/shift.service';
import { overtimeService } from '../services/overtime.service';
import { correctionService } from '../services/correction.service';
import { isSupabaseConfigured } from '../lib/supabase';
import { employees as mockEmployees } from '../data/mockData';
import type { AttendanceRecordRow, EmployeeProfileRow, ShiftAssignmentRow, ShiftRow, OvertimeRecordRow, ManualAttendanceRequestRow } from '../types/database';

const tabs = ['Today', 'Overtime', 'Corrections'];

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
  const { activeMembership, user } = useAuth();
  const organizationId = activeMembership?.organization_id ?? '';
  const supabaseReady = isSupabaseConfigured();

  const [tab, setTab] = useState('Today');
  const [search, setSearch] = useState('');
  
  // Real data state
  const [records, setRecords] = useState<AttendanceRecordRow[]>([]);
  const [emps, setEmps] = useState<EmployeeProfileRow[]>([]);
  const [assignments, setAssignments] = useState<(ShiftAssignmentRow & { shift: ShiftRow | null })[]>([]);
  const [overtimeRecords, setOvertimeRecords] = useState<OvertimeRecordRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Corrections (mocked for now, as requests system is not fully built yet)
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
      const today = new Date().toISOString().split('T')[0];
      
      const [recData, empData, assignData, otData, corrData] = await Promise.all([
        attendanceService.list({ organizationId, fromDate: today, toDate: today }),
        employeeService.list({ organizationId, pageSize: 100 }),
        shiftService.listAssignments({ organization_id: organizationId, from_date: today, to_date: today }),
        overtimeService.list({ organizationId }),
        correctionService.list({ organizationId })
      ]);
      
      setRecords(recData);
      setEmps(empData.rows);
      setAssignments(assignData);
      setOvertimeRecords(otData);
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

  const handleReviewOvertime = async (otId: string, status: 'approved' | 'rejected', requestedMins: number) => {
    if (!user) return;
    setLoading(true);
    try {
      await overtimeService.reviewOvertime(otId, status, requestedMins, user.id, status === 'approved' ? 'Manager approved' : 'Manager rejected');
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to review overtime.');
    } finally {
      setLoading(false);
    }
  };

  // Combine data for display
  const displayData = useMemo(() => {
    if (!supabaseReady) {
      // Fallback to mock if no supabase
      return mockEmployees.map(e => ({
        id: e.id,
        name: e.name,
        photo: e.photo,
        dept: e.dept,
        shiftName: e.shift,
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
      
      let statusStr = 'Absent';
      if (rec) {
        if (rec.status === 'present') statusStr = 'Present';
        else if (rec.status === 'late') statusStr = 'Late';
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
        name: emp.full_name,
        dept: 'General',
        shiftName: assignment?.shift?.name || 'Off / Unassigned',
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
  }, [supabaseReady, emps, records, assignments]);

  const filtered = displayData.filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.id.toLowerCase().includes(search.toLowerCase())
  );

  const stats = useMemo(() => {
    return {
      present: displayData.filter(e => e.attendanceStatus === 'Present' || e.attendanceStatus === 'Late').length,
      late: displayData.filter(e => e.attendanceStatus === 'Late').length,
      absent: displayData.filter(e => e.attendanceStatus === 'Absent').length,
      missing: displayData.filter(e => e.attendanceStatus === 'Missing').length,
    };
  }, [displayData]);

  const pendingOvertimeCount = overtimeRecords.filter(r => r.status === 'pending').length;

  const todayStr = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Attendance & Timesheets</h1>
          <p className="text-sm mt-0.5" style={{ color: '#4b6a8a' }}>{todayStr}</p>
        </div>
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
            {t === 'Overtime' && pendingOvertimeCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-mono" style={{ background: '#f59e0b', color: '#fff', fontSize: 10 }}>
                {pendingOvertimeCount}
              </span>
            )}
            {t === 'Corrections' && corrections.filter(r=>r.status==='pending').length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-mono" style={{ background: '#f97316', color: '#fff', fontSize: 10 }}>
                {corrections.filter(r=>r.status==='pending').length}
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
                  {['Employee', 'Shift', 'In/Out', 'Worked', 'Missing', 'Calc. OT', 'Status', 'Source'].map(h => (
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

      {tab === 'Overtime' && (
        <div className="space-y-3">
          {pendingOvertimeCount > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg text-sm" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b' }}>
              <Clock size={14} />
              {pendingOvertimeCount} overtime request(s) pending review
            </div>
          )}

          {overtimeRecords.map(req => {
            const emp = emps.find(e => e.id === req.employee_id);
            return (
              <div key={req.id} className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="font-semibold text-sm text-white">{emp?.full_name || 'Unknown Employee'}</div>
                      <StatusBadge status={req.status === 'pending' ? 'Pending' : req.status === 'approved' ? 'Approved' : 'Rejected'} />
                    </div>
                    <div className="text-xs" style={{ color: '#94a3b8' }}>
                      <span className="font-medium" style={{ color: '#f0f6ff' }}>Requested Overtime:</span> {formatDuration(req.requested_minutes)}
                    </div>
                    {req.status === 'approved' && (
                      <div className="text-xs mt-1" style={{ color: '#10b981' }}>
                        Approved for: {formatDuration(req.approved_minutes)}
                      </div>
                    )}
                    <div className="text-xs mt-1" style={{ color: '#4b6a8a' }}>Reason: {req.reason || 'None provided'}</div>
                  </div>
                  {req.status === 'pending' && (
                    <div className="flex gap-2 flex-shrink-0 ml-4">
                      <button
                        onClick={() => handleReviewOvertime(req.id, 'approved', req.requested_minutes)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                        style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}
                      >
                        <CheckCircle size={12} /> Approve All
                      </button>
                      <button
                        onClick={() => handleReviewOvertime(req.id, 'rejected', req.requested_minutes)}
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
          
          {overtimeRecords.length === 0 && !loading && (
            <div className="p-8 text-center text-sm" style={{ color: '#4b6a8a', border: '1px solid #1e3a5a', borderRadius: '12px' }}>
              No overtime requests found.
            </div>
          )}
        </div>
      )}

      {tab === 'Corrections' && (
        <div className="space-y-3">
          {corrections.filter(r=>r.status==='pending').length > 0 && (
            <div className="flex items-center gap-2 p-3 rounded-lg text-sm" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b' }}>
              <AlertCircle size={14} />
              {corrections.filter(r=>r.status==='pending').length} correction request(s) pending approval
            </div>
          )}

          {corrections.map(req => {
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
    </div>
  );
}
