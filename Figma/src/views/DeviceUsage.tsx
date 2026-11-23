import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Smartphone, AlertTriangle, Info, Calendar, ExternalLink, RefreshCw, Radio } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '../auth/AuthContext';
import { getSupabaseClient } from '../lib/supabase';
import { toAppError } from '../lib/errors';
import Avatar from '../components/Avatar';
import { deviceService } from '../services/device.service';
import { employeeService } from '../services/employee.service';
import { organizationService } from '../services/organization.service';
import { shiftService } from '../services/shift.service';
import type { DepartmentRow, ShiftRow } from '../types/database';

const POLICY_LIMIT = 30; // minutes

function usageLevel(min: number) {
  if (min <= 30) return { label: 'Normal', color: '#10b981', bg: 'rgba(16,185,129,0.1)' };
  if (min <= 60) return { label: 'Review', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' };
  return { label: 'High', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' };
}

function formatShiftDuration(shift: ShiftRow | null | undefined): string {
  if (!shift || !shift.start_time || !shift.end_time) return '—';
  const [sh, sm] = shift.start_time.split(':').map(Number);
  const [eh, em] = shift.end_time.split(':').map(Number);
  let totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
  if (shift.crosses_midnight || totalMinutes <= 0) {
    totalMinutes += 24 * 60;
  }
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

interface DeviceUsageEmployee {
  id: string;
  name: string;
  departmentId: string;
  shift: string;
  shiftDuration: string;
  worked: string;
  phone: number;
  percent: number;
  deviceName: string;
  deviceStatusLabel: string | null;
  deviceBadgeColor: string;
  deviceBadgeBg: string;
  dataStatus:
    | 'available'
    | 'partial_data'
    | 'permission_not_granted'
    | 'no_data'
    | 'pending_approval'
    | 'device_blocked'
    | 'no_shift'
    | 'awaiting_sync'
    | 'unmanaged';
}

export default function DeviceUsage() {
  const navigate = useNavigate();
  const { activeMembership } = useAuth();
  const todayStr = useMemo(() => {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }, []);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [employees, setEmployees] = useState<DeviceUsageEmployee[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [departmentId, setDepartmentId] = useState('');
  const [weeklyUsage, setWeeklyUsage] = useState<Array<{ day: string; avg: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchEmployees = useCallback(async (isSilent = false) => {
    if (!activeMembership) return;
    if (!isSilent) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);

    try {
      const [allProfiles, usage, devices, assignments, departmentData] = await Promise.all([
        employeeService.listAll({ organizationId: activeMembership.organization_id }),
        deviceService.getDashboardUsage(activeMembership.organization_id, selectedDate),
        deviceService.listDevices(activeMembership.organization_id).catch(() => []),
        shiftService.listAssignments({
          organization_id: activeMembership.organization_id,
          from_date: selectedDate,
          to_date: selectedDate,
        }).catch(() => []),
        organizationService.listDepartments(activeMembership.organization_id),
      ]);
      const profilesResult = departmentId
        ? allProfiles.filter(profile => profile.department_id === departmentId)
        : allProfiles;
      const weekly = await deviceService.getWeeklyAverages(
        activeMembership.organization_id,
        selectedDate,
        departmentId ? profilesResult.map(profile => profile.id) : undefined,
      );

      const devicesByEmployee = new Map<string, typeof devices>();
      for (const d of devices) {
        const list = devicesByEmployee.get(d.employee_id) ?? [];
        list.push(d);
        devicesByEmployee.set(d.employee_id, list);
      }

      const assignmentByEmployee = new Map(assignments.map(a => [a.employee_id, a]));
      const usageByEmployee = new Map(usage.map(row => [row.employee_id, row]));

      const mapped = profilesResult.map(p => {
        const row = usageByEmployee.get(p.id);
        const empDevices = devicesByEmployee.get(p.id) ?? [];
        const approvedDevice = empDevices.find(d => d.integrity_status === 'valid' && !d.revoked_at);
        const pendingDevice = empDevices.find(d => d.integrity_status === 'suspected' && !d.revoked_at);
        const blockedDevice = empDevices.find(d => d.integrity_status === 'blocked' || d.revoked_at);

        let deviceName = 'No registered device';
        let deviceStatusLabel: string | null = null;
        let deviceBadgeColor = '#64748b';
        let deviceBadgeBg = 'rgba(100,116,139,0.12)';

        if (approvedDevice) {
          deviceName = approvedDevice.model || `${approvedDevice.platform === 'android' ? 'Android' : 'iOS'} phone`;
          deviceStatusLabel = 'Approved';
          deviceBadgeColor = '#10b981';
          deviceBadgeBg = 'rgba(16,185,129,0.12)';
        } else if (pendingDevice) {
          deviceName = pendingDevice.model || `${pendingDevice.platform === 'android' ? 'Android' : 'iOS'} phone`;
          deviceStatusLabel = 'Pending Approval';
          deviceBadgeColor = '#f59e0b';
          deviceBadgeBg = 'rgba(245,158,11,0.15)';
        } else if (blockedDevice) {
          deviceName = blockedDevice.model || `${blockedDevice.platform === 'android' ? 'Android' : 'iOS'} phone`;
          deviceStatusLabel = 'Revoked';
          deviceBadgeColor = '#ef4444';
          deviceBadgeBg = 'rgba(239,68,68,0.15)';
        }

        const assignment = assignmentByEmployee.get(p.id);
        const shiftObj = assignment?.shift;
        const shiftName = shiftObj?.name ?? (assignment ? 'Scheduled Shift' : 'Off');
        const shiftDuration = formatShiftDuration(shiftObj);
        const workedMinutes = row?.worked_minutes ?? 0;

        let dataStatus: DeviceUsageEmployee['dataStatus'];
        if (row) {
          const status = row.data_status ?? '';
          const source = row.source ?? '';
          if (status === 'permission_not_granted' || source.endsWith('permission_not_granted')) {
            dataStatus = 'permission_not_granted';
          } else if (status === 'no_data' || source.endsWith('no_data')) {
            dataStatus = 'no_data';
          } else if (status === 'partial' || source.endsWith('partial_data')) {
            dataStatus = 'partial_data';
          } else {
            dataStatus = 'available';
          }
        } else {
          if (pendingDevice) {
            dataStatus = 'pending_approval';
          } else if (blockedDevice && !approvedDevice) {
            dataStatus = 'device_blocked';
          } else if (approvedDevice) {
            if (!shiftObj) {
              dataStatus = 'no_shift';
            } else {
              dataStatus = 'awaiting_sync';
            }
          } else {
            dataStatus = 'unmanaged';
          }
        }

        return {
          id: p.id,
          name: p.full_name,
          departmentId: p.department_id,
          shift: shiftName,
          shiftDuration,
          worked: `${Math.floor(workedMinutes / 60)}h ${workedMinutes % 60}m`,
          phone: row?.within_shift_minutes ?? 0,
          percent: row?.usage_percent ?? 0,
          deviceName,
          deviceStatusLabel,
          deviceBadgeColor,
          deviceBadgeBg,
          dataStatus,
        };
      });

      if (mountedRef.current) {
        setEmployees(mapped);
        setDepartments(departmentData.filter(department => department.status === 'active'));
        setWeeklyUsage(weekly);
        setLastRefreshedAt(new Date());
      }
    } catch (err) {
      if (mountedRef.current) setError(toAppError(err).message);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [activeMembership, departmentId, selectedDate]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchEmployees(false);

    if (!activeMembership) return;
    const client = getSupabaseClient();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const triggerRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void fetchEmployees(true);
      }, 1000);
    };

    const channel = client
      .channel(`device-usage-rt-${activeMembership.organization_id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'phone_usage_records',
          filter: `organization_id=eq.${activeMembership.organization_id}`,
        },
        triggerRefresh,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'employee_devices',
          filter: `organization_id=eq.${activeMembership.organization_id}`,
        },
        triggerRefresh,
      )
      .subscribe((status) => {
        if (mountedRef.current) {
          setIsRealtimeConnected(status === 'SUBSCRIBED');
        }
      });

    // Auto-refresh poll every 30 seconds when viewing today's live shift
    const intervalTimer = setInterval(() => {
      if (selectedDate === todayStr) {
        void fetchEmployees(true);
      }
    }, 30000);

    return () => {
      mountedRef.current = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(intervalTimer);
      void client.removeChannel(channel);
    };
  }, [activeMembership, fetchEmployees, selectedDate, todayStr]);

  const withUsage = employees.filter(e => e.dataStatus === 'available' || e.dataStatus === 'partial_data');
  const avgUsage = withUsage.length > 0 ? Math.round(withUsage.reduce((s, e) => s + e.phone, 0) / withUsage.length) : 0;
  const pendingApprovalCount = employees.filter(e => e.dataStatus === 'pending_approval').length;

  if (loading) return <div className="p-4 text-white">Loading...</div>;
  if (error) return <div className="p-4 text-red-500">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white">Device Usage During Shift</h1>
            <span
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium"
              style={{
                background: isRealtimeConnected ? 'rgba(16,185,129,0.12)' : 'rgba(100,116,139,0.15)',
                color: isRealtimeConnected ? '#10b981' : '#94a3b8',
                border: `1px solid ${isRealtimeConnected ? 'rgba(16,185,129,0.3)' : 'rgba(100,116,139,0.3)'}`,
              }}
              title={isRealtimeConnected ? 'Real-time telemetry subscription active' : 'Connecting to live events...'}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isRealtimeConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
              {isRealtimeConnected ? 'Live Real-time' : 'Connecting...'}
            </span>
          </div>
          <p className="text-sm mt-0.5" style={{ color: '#4b6a8a' }}>
            Company-managed devices only · Active shift hours
            {refreshing && <span className="ml-2 text-cyan-400 animate-pulse">Updating live...</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchEmployees(false)}
            disabled={loading || refreshing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-white/10 transition disabled:opacity-50"
            style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: '#93c5fd' }}
            title={`Last refreshed at ${lastRefreshedAt.toLocaleTimeString()}`}
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin text-cyan-400' : ''} />
            <span>Sync Live</span>
          </button>
          <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
            <Calendar size={13} style={{ color: '#4b6a8a' }} />
            <input
              type="date"
              aria-label="Filter device usage by date"
              value={selectedDate}
              onChange={event => setSelectedDate(event.target.value)}
              className="bg-transparent text-xs text-white outline-none cursor-pointer"
            />
          </div>
          {selectedDate !== todayStr && (
            <button
              type="button"
              onClick={() => setSelectedDate(todayStr)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-white/10 transition"
              style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: '#93c5fd' }}
            >
              Today
            </button>
          )}
          <select
            aria-label="Filter device usage by department"
            value={departmentId}
            onChange={event => setDepartmentId(event.target.value)}
            className="px-3 py-2 rounded-lg text-xs outline-none"
            style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: '#94a3b8' }}
          >
            <option value="">All Departments</option>
            {departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
          </select>
        </div>
      </div>

      {pendingApprovalCount > 0 && (
        <div className="flex items-center justify-between p-3 rounded-lg text-xs" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', color: '#fcd34d' }}>
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="flex-shrink-0 text-amber-400" />
            <span>
              <strong>{pendingApprovalCount} employee device(s)</strong> are waiting for administrator approval before shift telemetry can sync.
            </span>
          </div>
          <button
            onClick={() => navigate('/device-approvals')}
            className="inline-flex items-center gap-1 px-3 py-1 rounded bg-amber-500 text-slate-950 font-semibold text-xs hover:bg-amber-400 transition"
          >
            Review Device Approvals <ExternalLink size={12} />
          </button>
        </div>
      )}

      <div className="flex items-start gap-2 p-3 rounded-lg text-xs" style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.2)', color: '#93c5fd' }}>
        <Info size={13} className="flex-shrink-0 mt-0.5" />
        <span>Device usage data is collected only during active working hours on approved company-managed devices with employee consent. Personal/BYOD devices are excluded. No message content, personal browsing, or private data is collected.</span>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Screen Time', value: `${withUsage.reduce((s,e)=>s+e.phone,0)}m`, color: '#3b82f6' },
          { label: 'Average Per Employee', value: `${avgUsage}m`, color: avgUsage > POLICY_LIMIT ? '#f59e0b' : '#10b981' },
          { label: 'Above Policy Limit', value: employees.filter(e=>e.phone > POLICY_LIMIT).length, color: '#f97316' },
          { label: 'Policy Limit', value: `${POLICY_LIMIT}m`, color: '#94a3b8' },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
            <div className="text-xs" style={{ color: '#4b6a8a' }}>{s.label}</div>
            <div className="text-2xl font-bold font-mono mt-1" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
          <div className="font-semibold text-sm text-white mb-3">Avg Usage % by Day (Selected Week)</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={weeklyUsage}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5a" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: '#4b6a8a', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#4b6a8a', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: '#122338', border: '1px solid #1e3a5a', borderRadius: 8, color: '#f0f6ff', fontSize: 11 }} />
              <Bar dataKey="avg" name="Avg Usage %" fill="#3b82f6" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
          <div className="font-semibold text-sm text-white mb-3">Usage Policy Distribution</div>
          <div className="space-y-3 mt-4">
            {[
              { label: 'Normal (0–30 min)', count: withUsage.filter(e=>e.phone<=30).length, total: withUsage.length || 1, color: '#10b981' },
              { label: 'Review (31–60 min)', count: withUsage.filter(e=>e.phone>30&&e.phone<=60).length, total: withUsage.length || 1, color: '#f59e0b' },
              { label: 'High (60+ min)', count: withUsage.filter(e=>e.phone>60).length, total: withUsage.length || 1, color: '#ef4444' },
            ].map(b => (
              <div key={b.label}>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: '#94a3b8' }}>{b.label}</span>
                  <span className="font-mono" style={{ color: b.color }}>{b.count} employees</span>
                </div>
                <div className="h-2 rounded-full" style={{ background: '#1e3a5a' }}>
                  <div className="h-2 rounded-full" style={{ width: `${b.count/b.total*100}%`, background: b.color }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3a5a' }}>
        <table className="w-full">
          <thead>
            <tr style={{ background: '#122338' }}>
              {['Employee & Device', 'Shift', 'Shift Duration', 'Worked Hours', 'Phone Active', 'Usage %', 'Policy Status'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#4b6a8a' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">No employees found.</td></tr>
            ) : employees.map((emp) => {
              const level = usageLevel(emp.phone);
              return (
                <tr key={emp.id} className="border-t hover:bg-white/5" style={{ borderColor: '#1e3a5a' }}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar name={emp.name} size="sm" />
                      <div>
                        <div className="text-xs font-medium text-white">{emp.name}</div>
                        <div className="text-[11px] flex items-center gap-1.5 mt-0.5">
                          <Smartphone size={10} style={{ color: emp.deviceBadgeColor }} />
                          <span style={{ color: emp.deviceBadgeColor }}>{emp.deviceName}</span>
                          {emp.deviceStatusLabel && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-medium" style={{ background: emp.deviceBadgeBg, color: emp.deviceBadgeColor }}>
                              {emp.deviceStatusLabel}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: emp.shift === 'Off' ? '#64748b' : '#3b82f6' }}>{emp.shift}</td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: '#4b6a8a' }}>{emp.shiftDuration}</td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: '#94a3b8' }}>{emp.worked}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {emp.dataStatus === 'available' || emp.dataStatus === 'partial_data' ? (
                      <span style={{ color: emp.phone > 0 ? level.color : '#4b6a8a' }}>{emp.phone}m</span>
                    ) : emp.dataStatus === 'pending_approval' ? (
                      <span className="inline-flex items-center gap-1 font-medium" style={{ color: '#f59e0b', fontSize: 11 }}>
                        <AlertTriangle size={12} /> Pending approval
                      </span>
                    ) : emp.dataStatus === 'permission_not_granted' ? (
                      <span style={{ color: '#ef4444', fontSize: 11 }}>Permission required</span>
                    ) : emp.dataStatus === 'no_data' ? (
                      <span style={{ color: '#94a3b8', fontSize: 11 }}>No usage in shift</span>
                    ) : emp.dataStatus === 'no_shift' ? (
                      <span style={{ color: '#4b6a8a', fontSize: 11 }}>No shift scheduled</span>
                    ) : emp.dataStatus === 'awaiting_sync' ? (
                      <span style={{ color: '#38bdf8', fontSize: 11 }}>Awaiting sync</span>
                    ) : emp.dataStatus === 'device_blocked' ? (
                      <span style={{ color: '#ef4444', fontSize: 11 }}>Device revoked</span>
                    ) : (
                      <span style={{ color: '#4b6a8a', fontSize: 11 }}>No device enrolled</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: emp.percent > 0 ? level.color : '#4b6a8a' }}>
                    {emp.dataStatus === 'available' || emp.dataStatus === 'partial_data' ? `${emp.percent.toFixed(1)}%` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {emp.dataStatus === 'available' || emp.dataStatus === 'partial_data' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium" style={{ background: level.bg, color: level.color }}>
                        {level.label}
                      </span>
                    ) : emp.dataStatus === 'pending_approval' ? (
                      <button
                        onClick={() => navigate('/device-approvals')}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium hover:underline"
                        style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}
                        title="Click to review and approve in Device Approvals"
                      >
                        Review <ExternalLink size={10} />
                      </button>
                    ) : emp.dataStatus === 'permission_not_granted' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                        Permission Missing
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: '#4b6a8a' }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
