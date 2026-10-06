import { useState } from 'react';
import { Users, UserCheck, UserX, Clock, Timer, TrendingUp, AlertCircle, Activity, AlertTriangle, Smartphone, ShieldAlert, ChevronDown, ChevronUp, CalendarDays, CheckCircle, ImageIcon } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import KpiCard from '../components/KpiCard';
import StatusBadge from '../components/StatusBadge';
import Avatar from '../components/Avatar';
import { employees, sessionStore, getSessions, leaveStore } from '../data/mockData';
import { useAuth } from '../auth/AuthContext';
import { todayInTimezone } from '../lib/dates';
import { productivityService } from '../services/productivity.service';
import { attendanceService } from '../services/attendance.service';
import { employeeService } from '../services/employee.service';
import { isSupabaseConfigured } from '../lib/supabase';
import { logger } from '../lib/logger';
import { useEffect } from 'react';
import type { DashboardGeofencePoint } from '../services/dashboard.service';

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload?.length) {
    return (
      <div className="rounded-lg px-3 py-2 text-xs" style={{ background: '#122338', border: '1px solid #1e3a5a', color: '#f0f6ff' }}>
        <div className="font-semibold mb-1">{label}</div>
        {payload.map((p: any, i: number) => (
          <div key={i} style={{ color: p.color }}>{p.name}: {p.value}</div>
        ))}
      </div>
    );
  }
  return null;
};

// ── helpers ──────────────────────────────────────────────────────────────────
function sessionFmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function sessionFmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function sessionAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff}m ago`;
  const h = Math.floor(diff / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

// ── Leave Requests Widget (compact dashboard summary) ────────────────────────
function LeaveWidget({ onNav }: { onNav: (id: string) => void }) {
  const allRequests = employees.flatMap(emp =>
    (leaveStore[emp.id] ?? []).map(r => ({ ...r, emp }))
  ).sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

  const pending  = allRequests.filter(r => r.status === 'Pending').length;
  const approved = allRequests.filter(r => r.status === 'Approved').length;
  const rejected = allRequests.filter(r => r.status === 'Rejected').length;
  const withPhoto = allRequests.filter(r => r.photoUrl).length;
  const recentPending = allRequests.filter(r => r.status === 'Pending').slice(0, 4);

  return (
    <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: `1px solid ${pending > 0 ? 'rgba(245,158,11,0.35)' : '#1e3a5a'}` }}>
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold text-sm text-white flex items-center gap-2">
          <CalendarDays size={14} style={{ color: '#8b5cf6' }} />
          Leave Requests
          {pending > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-bold"
              style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)' }}>
              {pending} pending approval
            </span>
          )}
        </div>
        <button onClick={() => onNav('leave')}
          className="text-xs px-3 py-1.5 rounded-lg transition-colors hover:opacity-90"
          style={{ background: '#122338', color: '#3b82f6', border: '1px solid #1e3a5a' }}>
          View All →
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          { label: 'Pending',        value: pending,      color: '#f59e0b' },
          { label: 'Approved',       value: approved,     color: '#10b981' },
          { label: 'Rejected',       value: rejected,     color: '#ef4444' },
          { label: 'With Photo',     value: withPhoto,    color: '#8b5cf6' },
        ].map(k => (
          <button key={k.label} onClick={() => onNav('leave')}
            className="rounded-xl px-3 py-2.5 text-center transition-all hover:opacity-90"
            style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
            <div className="text-xl font-bold font-mono" style={{ color: k.color }}>{k.value}</div>
            <div className="text-xs mt-0.5" style={{ color: '#4b6a8a' }}>{k.label}</div>
          </button>
        ))}
      </div>

      {/* Pending requests preview */}
      {recentPending.length === 0 ? (
        <div className="flex items-center gap-2 py-3 text-xs justify-center" style={{ color: '#4b6a8a' }}>
          <CheckCircle size={13} style={{ color: '#10b981' }} />
          No pending leave requests — all clear
        </div>
      ) : (
        <div className="space-y-1.5">
          {recentPending.map(req => (
            <button key={req.id} onClick={() => onNav('leave')}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:opacity-90 text-left"
              style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ background: req.typeColor, minHeight: 32 }} />
              <img src={req.emp.photo} alt={req.emp.name} className="w-7 h-7 rounded-lg object-cover flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white truncate">{req.emp.name}</span>
                  <span className="text-xs flex-shrink-0" style={{ color: req.typeColor }}>{req.typeLabel}</span>
                </div>
                <div className="text-xs mt-0.5" style={{ color: '#4b6a8a' }}>
                  {req.from === req.to
                    ? new Date(req.from).toLocaleDateString('en-US',{month:'short',day:'numeric'})
                    : `${new Date(req.from).toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${new Date(req.to).toLocaleDateString('en-US',{month:'short',day:'numeric'})}`
                  } · {req.days}d
                </div>
              </div>
              {req.photoUrl && <ImageIcon size={12} style={{ color: '#8b5cf6', flexShrink: 0 }} />}
              <span className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
                style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)' }}>
                Pending
              </span>
            </button>
          ))}
          {pending > 4 && (
            <button onClick={() => onNav('leave')}
              className="w-full text-xs py-2 rounded-xl transition-all hover:opacity-80"
              style={{ background: '#122338', color: '#3b82f6', border: '1px solid #1e3a5a' }}>
              +{pending - 4} more pending — View all in Leave Management →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function LoginSessionsPanel() {
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);
  const [filterActive, setFilterActive] = useState(false);

  // Collect all sessions across all employees
  const allActive = employees.flatMap(e =>
    getSessions(e.id)
      .filter(s => s.active)
      .map(s => ({ ...s, emp: e }))
  );
  const multiDevice = employees.filter(e =>
    getSessions(e.id).filter(s => s.active).length > 1
  );
  const totalActive = allActive.length;

  const displayEmps = filterActive
    ? employees.filter(e => getSessions(e.id).some(s => s.active))
    : employees;

  return (
    <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold text-sm text-white flex items-center gap-2">
          <Smartphone size={14} style={{ color: '#3b82f6' }} />
          Login Sessions
        </div>
        <div className="flex items-center gap-2">
          {multiDevice.length > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
              <ShieldAlert size={11} />
              {multiDevice.length} multi-device
            </div>
          )}
          <button
            onClick={() => setFilterActive(v => !v)}
            className="text-xs px-2.5 py-1 rounded-lg transition-colors"
            style={{ background: filterActive ? '#2563eb' : '#122338', color: filterActive ? '#fff' : '#4b6a8a', border: '1px solid #1e3a5a' }}>
            Active only
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[
          { label: 'Active Sessions',    value: totalActive,                                               color: '#10b981' },
          { label: 'Multi-Device',       value: multiDevice.length,                                        color: multiDevice.length > 0 ? '#ef4444' : '#4b6a8a' },
          { label: 'Employees Online',   value: employees.filter(e => getSessions(e.id).some(s=>s.active)).length, color: '#3b82f6' },
          { label: 'Total Login Records',value: Object.values(sessionStore).reduce((n,s)=>n+s.length,0),  color: '#8b5cf6' },
        ].map(k => (
          <div key={k.label} className="rounded-xl px-3 py-2.5 text-center" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
            <div className="text-xl font-bold font-mono" style={{ color: k.color }}>{k.value}</div>
            <div className="text-xs mt-0.5" style={{ color: '#4b6a8a' }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Per-employee rows */}
      <div className="space-y-1.5">
        {displayEmps.map(emp => {
          const sessions = getSessions(emp.id);
          const activeSessions = sessions.filter(s => s.active);
          const isExpanded = expandedEmp === emp.id;
          const isMulti = activeSessions.length > 1;

          return (
            <div key={emp.id} className="rounded-xl overflow-hidden"
              style={{ border: `1px solid ${isMulti ? 'rgba(239,68,68,0.3)' : '#1e3a5a'}`, background: isMulti ? 'rgba(239,68,68,0.03)' : 'transparent' }}>
              {/* Row header */}
              <button
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                onClick={() => setExpandedEmp(isExpanded ? null : emp.id)}
              >
                <div className="relative flex-shrink-0">
                  <img src={emp.photo} alt={emp.name} className="w-7 h-7 rounded-lg object-cover" />
                  <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-slate-900 ${activeSessions.length > 0 ? 'animate-pulse' : ''}`}
                    style={{ background: activeSessions.length > 0 ? '#10b981' : '#1e3a5a' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white truncate">{emp.name}</span>
                    <span className="font-mono text-xs flex-shrink-0" style={{ color: '#4b6a8a' }}>{emp.id}</span>
                    {isMulti && (
                      <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                        <ShieldAlert size={9} />
                        {activeSessions.length} devices
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {activeSessions.length > 0 ? (
                      <span className="text-xs" style={{ color: '#10b981' }}>
                        {activeSessions.length} active · {activeSessions[0].device}
                        {activeSessions.length > 1 ? ` +${activeSessions.length - 1} more` : ''}
                        {' · '}{sessionAgo(activeSessions[0].loginAt)}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: '#4b6a8a' }}>
                        {sessions.length > 0
                          ? `Last seen ${sessionAgo(sessions[0].loginAt)} · ${sessions[0].device}`
                          : 'No login history'}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {activeSessions.length > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
                      Online
                    </span>
                  )}
                  {isExpanded ? <ChevronUp size={13} style={{ color: '#4b6a8a' }} /> : <ChevronDown size={13} style={{ color: '#4b6a8a' }} />}
                </div>
              </button>

              {/* Expanded: full session list */}
              {isExpanded && (
                <div className="border-t px-3 py-2 space-y-1.5" style={{ borderColor: '#1e3a5a', background: '#060d1a' }}>
                  {sessions.length === 0 ? (
                    <div className="text-xs py-2 text-center" style={{ color: '#4b6a8a' }}>No session records</div>
                  ) : sessions.map(s => (
                    <div key={s.sessionId} className="flex items-center gap-3 px-2.5 py-2 rounded-lg"
                      style={{ background: s.active ? (isMulti ? 'rgba(239,68,68,0.06)' : 'rgba(16,185,129,0.06)') : '#0d1b2e', border: `1px solid ${s.active ? (isMulti ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.15)') : '#1e3a5a'}` }}>
                      <Smartphone size={12} style={{ color: s.active ? (isMulti ? '#ef4444' : '#10b981') : '#4b6a8a', flexShrink: 0 }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-white truncate">{s.device}</span>
                          <span className="text-xs flex-shrink-0" style={{ color: '#4b6a8a' }}>{s.os}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs mt-0.5" style={{ color: '#4b6a8a' }}>
                          <span>Login: {sessionFmtDate(s.loginAt)} {sessionFmtTime(s.loginAt)}</span>
                          {s.logoutAt && <span>· Logout: {sessionFmtTime(s.logoutAt)}</span>}
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        {s.active ? (
                          <div className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: isMulti ? '#ef4444' : '#10b981' }} />
                            <span className="text-xs" style={{ color: isMulti ? '#ef4444' : '#10b981' }}>
                              {sessionAgo(s.loginAt)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs" style={{ color: '#4b6a8a' }}>Signed out</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Dashboard({ onNav }: { onNav: (id: string) => void }) {
  const { activeMembership } = useAuth();
  const organizationId = activeMembership?.organization_id ?? '';
  const supabaseReady = isSupabaseConfigured();

  // Filters
  const [filterDate, setFilterDate] = useState(todayInTimezone('Asia/Riyadh'));
  const [filterBranchId, setFilterBranchId] = useState('');
  const [filterDeptId, setFilterDeptId] = useState('');
  const [filterShiftId, setFilterShiftId] = useState('');
  const [filterManagerId, setFilterManagerId] = useState('');
  const [filterEmployeeId, setFilterEmployeeId] = useState('');

  // Dropdown Options
  const [branches, setBranches] = useState<Array<{id: string, name: string}>>([]);
  const [departments, setDepartments] = useState<Array<{id: string, name: string}>>([]);
  const [shifts, setShifts] = useState<Array<{id: string, name: string}>>([]);
  const [managers, setManagers] = useState<Array<{id: string, name: string}>>([]);
  const [employeeProfiles, setEmployeeProfiles] = useState<Array<any>>([]);

  // Metrics Data
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [prodMetrics, setProdMetrics] = useState<any>(null);
  const [phoneUsage, setPhoneUsage] = useState<Array<any>>([]);
  const [liveAttendance, setLiveAttendance] = useState<Array<any>>([]);

  useEffect(() => {
    if (!supabaseReady || !organizationId) return;
    const initLookups = async () => {
      const { dashboardService } = await import('../services/dashboard.service');
      const [lookups, empData] = await Promise.all([
        dashboardService.getLookups(organizationId),
        employeeService.listAll({ organizationId })
      ]);
      setBranches(lookups.branches);
      setDepartments(lookups.departments);
      setShifts(lookups.shifts);
      
      const emps = empData || [];
      setEmployeeProfiles(emps);
      
      // Extract unique managers
      const mgrIds = [...new Set(emps.map(e => e.manager_user_id).filter(Boolean))] as string[];
      // We can just use the employee records of those managers if they are also employees, or raw IDs
      setManagers(mgrIds.map(id => {
        const e = emps.find(x => x.user_id === id);
        return { id, name: e ? e.full_name : `Manager ${id.substring(0,6)}` };
      }));
    };
    initLookups();
  }, [supabaseReady, organizationId]);

  // Real per-employee live attendance (status, check-in time, shift, geofence).
  const filteredEmps = supabaseReady ? liveAttendance.map(e => ({
    id: e.id,
    name: e.name,
    status: e.attendance === 'late' ? 'Late' : e.attendance === 'present' ? 'Present' : e.attendance === 'absent' ? 'Absent' : 'Missing',
    phone: 0,
    dept: e.dept,
    shift: e.shift,
    attendance: e.attendance,
    location: e.location ?? '',
    checkin: e.checkInAt
      ? new Date(e.checkInAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Riyadh' })
      : null,
    inside: e.inside
  })) : [];

  useEffect(() => {
    if (!supabaseReady || !organizationId) return;
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const { dashboardService } = await import('../services/dashboard.service');
        const { deviceService } = await import('../services/device.service');

        const filters = {
          date: filterDate,
          branchId: filterBranchId || undefined,
          departmentId: filterDeptId || undefined,
          shiftId: filterShiftId || undefined,
          managerId: filterManagerId || undefined,
          employeeId: filterEmployeeId || undefined
        };

        const [dashData, prodData, phoneData, liveData] = await Promise.all([
          dashboardService.getMetrics(organizationId, filters),
          productivityService.getDashboardMetrics(organizationId, filterDate, filterDate),
          deviceService.getDashboardUsage(organizationId, filterDate),
          dashboardService.getLiveAttendance(organizationId, filters)
        ]);

        setMetrics(dashData);
        setProdMetrics(prodData);
        setPhoneUsage(phoneData);
        setLiveAttendance(liveData);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data.');
        logger.error('Unable to load dashboard data.', err);
      } finally {
        setLoading(false);
      }
    };
    void loadData();
  }, [supabaseReady, organizationId, filterDate, filterBranchId, filterDeptId, filterShiftId, filterManagerId, filterEmployeeId]);

  // Aggregate values
  const totalStaff = metrics ? metrics.totalEmployees : employees.length;
  const present = metrics ? metrics.presentCount : employees.filter(e => e.status === 'Present' || e.status === 'Late').length;
  const absent = metrics ? metrics.absentCount : employees.filter(e => e.status === 'Absent').length;
  const late = metrics ? metrics.lateCount : employees.filter(e => e.status === 'Late').length;
  const missing = metrics ? metrics.missingCount : employees.filter(e => e.status === 'Missing').length;
  const currentlyWorking = metrics ? metrics.currentlyWorkingCount : employees.filter(e => e.status === 'Present').length;
  
  const dayShift = metrics ? metrics.dayShiftCount : employees.filter(e => e.shift === 'Day').length;
  const nightShift = metrics ? metrics.nightShiftCount : employees.filter(e => e.shift === 'Night').length;

  const totalWorkingHours = metrics ? metrics.totalWorkingHours : 0;
  const totalOvertimeHours = metrics ? metrics.totalOvertimeHours : 0;
  const pendingApprovals = metrics ? metrics.pendingApprovals : 0;
  const geofenceViolations = metrics ? metrics.geofenceViolations : 0;

  const avgProd = supabaseReady && prodMetrics ? prodMetrics.averageProductivity : 0;

  const realRanking = (supabaseReady && prodMetrics) ? Object.entries(prodMetrics.byEmployee)
    .filter(([empId]) => !metrics || metrics.validEmpIds.includes(empId)) // Filter productivity by dashboard filters
    .map(([empId, data]: [string, any]) => {
    const e = employeeProfiles.find(x => x.id === empId);
    return {
      id: empId,
      name: e?.full_name || 'Unknown',
      productivity: data.target > 0 ? Math.round((data.actual / data.target) * 100) : 0,
    };
  }).sort((a, b) => b.productivity - a.productivity).map((r, i) => ({ ...r, rank: i + 1 })) : [];

  const realPhoneUsage = supabaseReady ? phoneUsage.map((u: any) => {
    const e = employeeProfiles.find(x => x.id === u.employee_id);
    return {
      id: u.employee_id,
      name: e?.full_name || 'Unknown',
      phone: u.within_shift_minutes || 0,
      percent: u.usage_percent || 0
    };
  }) : filteredEmps.filter(e => e.phone > 0).map(e => ({
    ...e,
    percent: Math.min(e.phone/90*100, 100)
  }));

  const attendanceTrend = supabaseReady && metrics ? metrics.attendanceTrend : [];
  const otTrend = supabaseReady && metrics ? metrics.otTrend : [];
  const productivityTrend = supabaseReady && metrics ? metrics.productivityTrend : [];
  const geofences: DashboardGeofencePoint[] = supabaseReady && metrics ? metrics.geofencesData : [];

  const alertCounts = { missing: missing, missingOut: 0, otApproval: pendingApprovals, correction: 0, geofence: geofenceViolations };

  return (
    <div className="space-y-5">
      {/* Header & Filter Bar */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Workforce Management Dashboard</h1>
            <p className="text-sm mt-0.5" style={{ color: '#4b6a8a' }}>
              Real-time operational metrics and filters
            </p>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse-slow" style={{ background: '#10b981' }}></span>
            Live Data
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        {/* Global Filter Bar */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar">
          <input
            type="date"
            value={filterDate}
            onChange={e => setFilterDate(e.target.value)}
            className="text-xs rounded-lg px-3 py-2 font-medium outline-none"
            style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: '#f0f6ff' }}
          />
          <select
            value={filterBranchId}
            onChange={e => setFilterBranchId(e.target.value)}
            className="text-xs rounded-lg px-3 py-2 font-medium outline-none cursor-pointer flex-shrink-0"
            style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: filterBranchId ? '#3b82f6' : '#94a3b8' }}
          >
            <option value="">All Sites</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select
            value={filterDeptId}
            onChange={e => setFilterDeptId(e.target.value)}
            className="text-xs rounded-lg px-3 py-2 font-medium outline-none cursor-pointer flex-shrink-0"
            style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: filterDeptId ? '#8b5cf6' : '#94a3b8' }}
          >
            <option value="">All Departments</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select
            value={filterShiftId}
            onChange={e => setFilterShiftId(e.target.value)}
            className="text-xs rounded-lg px-3 py-2 font-medium outline-none cursor-pointer flex-shrink-0"
            style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: filterShiftId ? '#10b981' : '#94a3b8' }}
          >
            <option value="">All Shifts</option>
            {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select
            value={filterManagerId}
            onChange={e => setFilterManagerId(e.target.value)}
            className="text-xs rounded-lg px-3 py-2 font-medium outline-none cursor-pointer flex-shrink-0"
            style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: filterManagerId ? '#f59e0b' : '#94a3b8' }}
          >
            <option value="">All Managers</option>
            {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select
            value={filterEmployeeId}
            onChange={e => setFilterEmployeeId(e.target.value)}
            className="text-xs rounded-lg px-3 py-2 font-medium outline-none cursor-pointer flex-shrink-0"
            style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: filterEmployeeId ? '#ef4444' : '#94a3b8' }}
          >
            <option value="">All Employees</option>
            {employeeProfiles.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
        </div>
      </div>

      {/* KPI Row 1 */}
      <div className="grid grid-cols-5 gap-3">
        <KpiCard title="Total Staff" value={totalStaff} sub="Registered employees" icon={Users} color="#3b82f6" />
        <KpiCard title="Present / Working" value={currentlyWorking} sub={`${totalStaff ? Math.round(present/totalStaff*100) : 0}% attendance rate`} icon={UserCheck} color="#10b981" />
        <KpiCard title="Absent" value={absent} sub="Missing check-in" icon={UserX} color="#ef4444" />
        <KpiCard title="Late Arrivals" value={late} sub="Employees arrived late" icon={Clock} color="#f59e0b" />
        <KpiCard title="OT Hours" value={`${totalOvertimeHours}h`} sub="System Calculated OT" icon={Timer} color="#8b5cf6" />
      </div>

      {/* KPI Row 2 */}
      <div className="grid grid-cols-5 gap-3">
        <KpiCard title="Day Shift" value={dayShift} sub="Checked-in today" icon={Activity} color="#2563eb" />
        <KpiCard title="Night Shift" value={nightShift} sub="Checked-in today" icon={Activity} color="#6366f1" />
        <KpiCard title="Total Worked Hours" value={`${totalWorkingHours}h`} sub="Productive hours tracked" icon={Clock} color="#3b82f6" />
        <KpiCard title="Pending Approvals" value={pendingApprovals} sub="Manager review needed" icon={CheckCircle} color="#f59e0b" />
        <KpiCard title="Active Alerts" value={missing + geofenceViolations} sub={`${geofenceViolations} geofence, ${missing} missing`} icon={AlertCircle} color="#ef4444" />
      </div>

      {/* Mid row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Live Attendance */}
        <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-sm text-white">Live Attendance by Shift</div>
            <button onClick={() => onNav('live')} className="text-xs transition-colors hover:text-blue-300" style={{ color: '#3b82f6' }}>View All →</button>
          </div>
          <div className="space-y-2">
            {filteredEmps.slice(0, 6).map(emp => (
              <div key={emp.id} className="flex items-center gap-3 py-2 rounded-lg px-2 transition-colors hover:bg-white/5">
                <Avatar name={emp.name} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-white truncate">{emp.name}</div>
                  <div className="text-xs" style={{ color: '#4b6a8a' }}>{emp.dept}{emp.shift ? ` · ${emp.shift} Shift` : ''}</div>
                </div>
                <div className="text-xs font-mono" style={{ color: '#94a3b8' }}>{emp.checkin ?? '—'}</div>
                <StatusBadge status={emp.attendance} />
              </div>
            ))}
          </div>
        </div>

        {/* Geofence Map */}
        <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-sm text-white">Geofence Workforce Map</div>
            <button onClick={() => onNav('geofences')} className="text-xs transition-colors hover:text-blue-300" style={{ color: '#3b82f6' }}>Manage →</button>
          </div>
          <div className="relative rounded-lg overflow-hidden" style={{ height: 200, background: '#060d1a' }}>
            <svg width="100%" height="100%" viewBox="0 0 660 210">
              {[0,1,2,3,4,5].map(i => (
                <line key={`h${i}`} x1="0" y1={i*42} x2="660" y2={i*42} stroke="#1e3a5a" strokeWidth="0.5" strokeDasharray="4,4" />
              ))}
              {[0,1,2,3,4,5,6].map(i => (
                <line key={`v${i}`} x1={i*110} y1="0" x2={i*110} y2="210" stroke="#1e3a5a" strokeWidth="0.5" strokeDasharray="4,4" />
              ))}
              {geofences.map(gf => (
                <g key={gf.id}>
                  <polygon points={gf.polygon.map(([x,y]) => `${x},${y}`).join(' ')} fill={`${gf.color}18`} stroke={gf.color} strokeWidth="1.5" strokeDasharray="5,3" />
                  <text x={gf.polygon.reduce((s,[x])=>s+x,0)/gf.polygon.length} y={gf.polygon.reduce((s,[,y])=>s+y,0)/gf.polygon.length} textAnchor="middle" fill={gf.color} fontSize="8" fontFamily="JetBrains Mono" fontWeight="600">{gf.present}/{gf.employees}</text>
                </g>
              ))}
              {filteredEmps.filter(e => e.inside).map((e, i) => {
                const gf = geofences.find(g => g.name.includes(e.location.split(' ').pop()!));
                if (!gf) return null;
                const cx = gf.polygon.reduce((s,[x])=>s+x,0)/gf.polygon.length + (i*15 - 30);
                const cy = gf.polygon.reduce((s,[,y])=>s+y,0)/gf.polygon.length;
                return (
                  <g key={e.id}>
                    <circle cx={cx} cy={cy} r="5" fill={e.status === 'Late' ? '#f59e0b' : '#10b981'} />
                    <circle cx={cx} cy={cy} r="8" fill="none" stroke={e.status === 'Late' ? '#f59e0b' : '#10b981'} strokeWidth="0.5" opacity="0.4" />
                  </g>
                );
              })}
            </svg>
            <div className="absolute bottom-2 left-2 flex flex-col gap-1">
              {geofences.map(gf => (
                <div key={gf.id} className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md" style={{ background: 'rgba(6,13,26,0.85)', color: '#f0f6ff' }}>
                  <span className="w-2 h-2 rounded-sm" style={{ background: gf.color }}></span>
                  {gf.name}: <span style={{ color: gf.color }}>{gf.present}/{gf.employees}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Productivity + Phone */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-sm text-white">Productivity Ranking</div>
            <button onClick={() => onNav('productivity')} className="text-xs" style={{ color: '#3b82f6' }}>Full Report →</button>
          </div>
          <div className="space-y-2">
            {realRanking.slice(0, 5).map(r => (
              <div key={r.id} className="flex items-center gap-3">
                <div className="w-5 text-center font-mono text-xs font-bold" style={{ color: r.rank <= 3 ? '#f59e0b' : '#4b6a8a' }}>#{r.rank}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-white">{r.name}</span>
                    <span className="text-xs font-mono font-bold" style={{ color: r.productivity >= 100 ? '#10b981' : r.productivity >= 90 ? '#f59e0b' : '#ef4444' }}>{r.productivity}%</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full" style={{ background: '#122338' }}>
                    <div className="h-1.5 rounded-full" style={{ width: `${Math.min(r.productivity, 100)}%`, background: r.productivity >= 100 ? '#10b981' : r.productivity >= 90 ? '#f59e0b' : '#ef4444' }}></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-sm text-white">Phone Usage During Shift</div>
            <button onClick={() => onNav('device')} className="text-xs" style={{ color: '#3b82f6' }}>Details →</button>
          </div>
          <div className="space-y-2">
            {realPhoneUsage.map((e: any) => (
              <div key={e.id} className="flex items-center gap-3">
                <Avatar name={e.name} size="sm" />
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="text-xs text-white">{e.name}</span>
                    <span className="text-xs font-mono" style={{ color: e.phone > 60 ? '#ef4444' : e.phone > 30 ? '#f59e0b' : '#10b981' }}>
                      {e.phone}m {e.percent > 0 ? `(${e.percent}%)` : ''}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: '#122338' }}>
                    <div className="h-1.5 rounded-full" style={{ width: `${e.percent}%`, background: e.phone > 60 ? '#ef4444' : e.phone > 30 ? '#f59e0b' : '#10b981' }}></div>
                  </div>
                </div>
              </div>
            ))}
            {realPhoneUsage.length === 0 && (
              <div className="text-xs text-center py-4" style={{ color: '#4b6a8a' }}>No phone usage data available today.</div>
            )}
          </div>
        </div>
      </div>

      {/* Trend Charts */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
          <div className="font-semibold text-sm text-white mb-3">Attendance Trend</div>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={attendanceTrend}>
              <defs>
                <linearGradient id="present" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5a" />
              <XAxis dataKey="day" tick={{ fill: '#4b6a8a', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#4b6a8a', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="present" name="Present" stroke="#10b981" fill="url(#present)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="late" name="Late" stroke="#f59e0b" fill="none" strokeWidth={1.5} dot={false} strokeDasharray="3 3" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
          <div className="font-semibold text-sm text-white mb-3">Overtime Trend</div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={otTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5a" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: '#4b6a8a', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#4b6a8a', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="hours" name="OT Hours" fill="#8b5cf6" radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
          <div className="font-semibold text-sm text-white mb-3">Productivity Trend</div>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={productivityTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5a" />
              <XAxis dataKey="day" tick={{ fill: '#4b6a8a', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#4b6a8a', fontSize: 10 }} axisLine={false} tickLine={false} domain={[70, 100]} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="productivity" name="Productivity %" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Login Sessions */}
      <LeaveWidget onNav={onNav} />

      <LoginSessionsPanel />

      {/* Action Required */}
      <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold text-sm text-white flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-400" />
            Action Required
          </div>
          <button onClick={() => onNav('notifications')} className="text-xs" style={{ color: '#3b82f6' }}>View All Alerts →</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { label: `${alertCounts.missing} Missing Check-Ins`, color: '#ef4444', bg: 'rgba(239,68,68,0.1)', nav: 'live' },
            { label: `${alertCounts.missingOut} Missing Check-Outs`, color: '#f97316', bg: 'rgba(249,115,22,0.1)', nav: 'attendance' },
            { label: `${alertCounts.otApproval} OT Approvals Pending`, color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', nav: 'overtime' },
            { label: `${alertCounts.correction} Attendance Correction`, color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', nav: 'attendance' },
            { label: `${alertCounts.geofence} Geofence Violations`, color: '#ef4444', bg: 'rgba(239,68,68,0.1)', nav: 'geofences' },
          ].map((a, i) => (
            <button
              key={i}
              onClick={() => onNav(a.nav)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all hover:opacity-80"
              style={{ background: a.bg, border: `1px solid ${a.color}30`, color: a.color }}
            >
              <AlertCircle size={12} />
              <span className="text-xs font-medium">{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
