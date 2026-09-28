import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Bell, Calendar, CheckCircle, Clock, Loader2, LogIn, LogOut, MapPin, RotateCcw, Timer, TrendingUp, UserRound, ArrowRight } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { attendanceService, type AttendanceActionInput } from '../services/attendance.service';
import { getErrorMessage } from '../lib/errors';
import type { AttendanceRecordRow } from '../types/database';
import { employeeDashboardService, type EmployeeDashboardMetrics } from '../services/employeeDashboard.service';

function getLocation(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location services are not available in this browser.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15_000,
    });
  });
}

function formatTime(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export default function EmployeeSelfService() {
  const { profile, employeeProfile, activeMembership } = useAuth();
  const [records, setRecords] = useState<AttendanceRecordRow[]>([]);
  const [dashMetrics, setDashMetrics] = useState<EmployeeDashboardMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<'check-in' | 'check-out' | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const loadAttendance = useCallback(async () => {
    if (!employeeProfile || !activeMembership || !profile) return;
    setLoading(true);
    setMessage(null);
    try {
      const nextRecords = await attendanceService.list({
        organizationId: activeMembership.organization_id,
        employeeId: employeeProfile.id,
      });
      setRecords(nextRecords.slice(0, 7));

      const metrics = await employeeDashboardService.getMetrics(
        activeMembership.organization_id,
        employeeProfile.id,
        profile.id
      );
      setDashMetrics(metrics);
    } catch (caught) {
      setMessage({ kind: 'error', text: getErrorMessage(caught) });
    } finally {
      setLoading(false);
    }
  }, [activeMembership, employeeProfile, profile]);

  useEffect(() => {
    void loadAttendance();
  }, [loadAttendance]);

  const submitAttendance = async (nextAction: 'check-in' | 'check-out') => {
    setAction(nextAction);
    setMessage(null);
    try {
      const position = await getLocation();
      
      let assignedGeofenceId = '';
      const { getSupabaseClient } = await import('../lib/supabase');
      const { data: assignments } = await getSupabaseClient()
        .from('geofence_assignments')
        .select('geofence_id')
        .eq('employee_id', employeeProfile!.id)
        .is('effective_to', null)
        .order('created_at', { ascending: false })
        .limit(1);
        
      if (assignments && assignments.length > 0) {
        assignedGeofenceId = assignments[0].geofence_id;
      }

      const input: AttendanceActionInput = {
        organizationId: activeMembership!.organization_id,
        employeeId: employeeProfile!.id,
        geofenceId: assignedGeofenceId,
        actionType: nextAction === 'check-in' ? 'check_in' : 'check_out',
        isAuto: false, // Manual via button
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        idempotencyKey: crypto.randomUUID(),
        deviceInfo: { platform: 'web', userAgent: navigator.userAgent },
      };

      const result = await attendanceService.processAttendance(input);

      setMessage({
        kind: 'success',
        text: `${nextAction === 'check-in' ? 'Check-in' : 'Check-out'} recorded${result.insideGeofence === false ? ' outside the assigned geofence' : ''}.`,
      });
      await loadAttendance();
    } catch (caught) {
      setMessage({ kind: 'error', text: getErrorMessage(caught) });
    } finally {
      setAction(null);
    }
  };

  if (!employeeProfile) {
    return (
      <div className="max-w-2xl mx-auto rounded-2xl p-6" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
        <div className="flex items-center gap-3">
          <AlertCircle size={22} style={{ color: '#f59e0b' }} />
          <div>
            <h1 className="font-bold text-white">Employee profile not linked</h1>
            <p className="text-xs mt-1" style={{ color: '#94a3b8' }}>
              The authenticated account {profile?.email ? `(${profile.email}) ` : ''}needs an employee profile in this organization.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const today = records.find(record => record.attendance_date === todayStr) ?? null;
  const initials = employeeProfile.full_name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="flex items-start gap-8">
      <div className="flex-shrink-0">
        <div className="text-xs mb-3 text-center" style={{ color: '#4b6a8a' }}>Employee Self-Service</div>
        <div className="rounded-3xl overflow-hidden shadow-2xl mx-auto relative" style={{ width: 340, background: '#0a0f1a', border: '2px solid #1e3a5a', boxShadow: '0 0 40px rgba(37,99,235,0.15)' }}>
          <div className="flex items-center justify-between px-4 py-2 text-xs" style={{ background: '#060d1a', color: '#4b6a8a' }}>
            <span className="font-mono">GEOTRACK</span>
            <MapPin size={11} />
          </div>

          <div className="p-4 space-y-4" style={{ minHeight: 600 }}>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-white" style={{ background: 'linear-gradient(135deg,#2563eb,#06b6d4)' }}>{initials}</div>
              <div className="min-w-0">
                <div className="font-bold text-white text-sm truncate">{employeeProfile.full_name}</div>
                <div className="text-xs font-mono" style={{ color: '#3b82f6' }}>{employeeProfile.employee_code}</div>
                <div className="text-xs mt-0.5 truncate" style={{ color: '#4b6a8a' }}>{employeeProfile.job_title || 'Employee'}</div>
              </div>
              <Bell size={18} className="ml-auto" style={{ color: '#4b6a8a' }} />
            </div>

            <div className="rounded-2xl p-4 text-center" style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.25)' }}>
              <MapPin size={18} className="mx-auto mb-1" style={{ color: '#3b82f6' }} />
              <div className="text-sm font-bold" style={{ color: '#93c5fd' }}>GEOFENCE VALIDATION</div>
              <div className="text-xs mt-1" style={{ color: '#4b6a8a' }}>Your location is verified securely when you check in or out.</div>
            </div>

            <div className="rounded-2xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
              <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#4b6a8a' }}>Today's Attendance</div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Check-In', value: formatTime(today?.check_in_at ?? null), color: '#10b981' },
                  { label: 'Check-Out', value: formatTime(today?.check_out_at ?? null), color: '#f59e0b' },
                  { label: 'Working Time', value: today ? `${Math.floor(today.worked_minutes / 60)}h ${today.worked_minutes % 60}m` : '—', color: '#3b82f6' },
                  { label: "Today's OT", value: today ? `${Math.floor(today.overtime_minutes / 60)}h ${today.overtime_minutes % 60}m` : '—', color: '#8b5cf6' },
                ].map(stat => (
                  <div key={stat.label} className="rounded-xl p-3" style={{ background: '#122338' }}>
                    <div className="text-xs" style={{ color: '#4b6a8a' }}>{stat.label}</div>
                    <div className="text-sm font-bold font-mono mt-0.5" style={{ color: stat.color }}>{stat.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {message && (
              <div className="rounded-xl p-3 flex gap-2 text-xs" style={{ background: message.kind === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)', color: message.kind === 'error' ? '#fca5a5' : '#6ee7b7' }} role="status">
                {message.kind === 'error' ? <AlertCircle size={15} /> : <CheckCircle size={15} />}
                <span>{message.text}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => void submitAttendance('check-in')} disabled={Boolean(action)} className="rounded-2xl py-4 font-bold text-sm" style={{ background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', opacity: action ? 0.6 : 1 }}>
                {action === 'check-in' ? <Loader2 size={20} className="mx-auto mb-1 animate-spin" /> : <LogIn size={20} className="mx-auto mb-1" />} CHECK IN
              </button>
              <button onClick={() => void submitAttendance('check-out')} disabled={Boolean(action)} className="rounded-2xl py-4 font-bold text-sm" style={{ background: 'linear-gradient(135deg,#ef4444,#dc2626)', color: '#fff', opacity: action ? 0.6 : 1 }}>
                {action === 'check-out' ? <Loader2 size={20} className="mx-auto mb-1 animate-spin" /> : <LogOut size={20} className="mx-auto mb-1" />} CHECK OUT
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: UserRound, label: 'Profile' },
                { icon: Calendar, label: 'Schedule' },
                { icon: Clock, label: 'Attendance' },
                { icon: RotateCcw, label: 'Correction' },
                { icon: Timer, label: 'Overtime' },
                { icon: TrendingUp, label: 'Productivity' },
              ].map(item => (
                <div key={item.label} className="rounded-xl p-3 flex flex-col items-center gap-1 text-xs" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: '#4b6a8a' }}>
                  <item.icon size={16} style={{ color: '#3b82f6' }} /> {item.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">My Dashboard</h1>
          <p className="text-sm" style={{ color: '#4b6a8a' }}>Overview of your schedule, attendance, and performance.</p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm" style={{ color: '#94a3b8' }}><Loader2 size={16} className="animate-spin" /> Loading dashboard…</div>
        ) : (
          <>
            {/* KPI Row */}
            <div className="grid grid-cols-4 gap-4">
              <div className="rounded-2xl p-4 flex flex-col" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
                <div className="text-xs font-semibold uppercase mb-1" style={{ color: '#4b6a8a' }}>This Week</div>
                <div className="text-2xl font-bold font-mono text-white mt-auto">
                  {Math.floor((dashMetrics?.weeklyWorkedMinutes || 0) / 60)}h {(dashMetrics?.weeklyWorkedMinutes || 0) % 60}m
                </div>
              </div>
              <div className="rounded-2xl p-4 flex flex-col" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
                <div className="text-xs font-semibold uppercase mb-1" style={{ color: '#4b6a8a' }}>This Month</div>
                <div className="text-2xl font-bold font-mono text-white mt-auto">
                  {Math.floor((dashMetrics?.monthlyWorkedMinutes || 0) / 60)}h {(dashMetrics?.monthlyWorkedMinutes || 0) % 60}m
                </div>
              </div>
              <div className="rounded-2xl p-4 flex flex-col" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
                <div className="text-xs font-semibold uppercase mb-1" style={{ color: '#4b6a8a' }}>Late / Missing</div>
                <div className="text-2xl font-bold font-mono text-white mt-auto">
                  {records.filter(r => r.status === 'late').length} / {records.filter(r => r.status === 'missing_check_in' || r.status === 'missing_check_out').length}
                </div>
              </div>
              <div className="rounded-2xl p-4 flex flex-col" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
                <div className="text-xs font-semibold uppercase mb-1" style={{ color: '#4b6a8a' }}>Productivity Today</div>
                <div className="text-2xl font-bold font-mono mt-auto" style={{ color: (dashMetrics?.productivityPercent || 0) >= 100 ? '#10b981' : (dashMetrics?.productivityPercent || 0) >= 80 ? '#f59e0b' : '#ef4444' }}>
                  {dashMetrics?.productivityPercent !== null ? `${dashMetrics?.productivityPercent}%` : 'N/A'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* Upcoming Schedule */}
              <div className="rounded-2xl p-5 flex flex-col" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
                <div className="flex items-center gap-2 mb-4">
                  <Calendar size={18} style={{ color: '#3b82f6' }} />
                  <h2 className="font-bold text-white">Upcoming Schedule & Weekly Off</h2>
                </div>
                {dashMetrics?.upcomingShifts && dashMetrics.upcomingShifts.length > 0 ? (
                  <div className="space-y-3">
                    {dashMetrics.upcomingShifts.map((shift: any, idx) => {
                      const sName = Array.isArray(shift.shift) ? shift.shift[0]?.name : shift.shift?.name;
                      const sStart = Array.isArray(shift.shift) ? shift.shift[0]?.start_time : shift.shift?.start_time;
                      const sEnd = Array.isArray(shift.shift) ? shift.shift[0]?.end_time : shift.shift?.end_time;
                      return (
                        <div key={idx} className="flex items-center justify-between p-3 rounded-xl" style={{ background: '#122338' }}>
                          <div>
                            <div className="text-sm font-semibold text-white">{shift.work_date}</div>
                            <div className="text-xs mt-1" style={{ color: '#4b6a8a' }}>{sName || 'Scheduled Shift'}</div>
                          </div>
                          <div className="text-xs font-mono" style={{ color: '#94a3b8' }}>
                            {sStart ? sStart.slice(0,5) : ''} - {sEnd ? sEnd.slice(0,5) : ''}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-center py-6" style={{ color: '#4b6a8a' }}>No upcoming shifts scheduled.</div>
                )}
              </div>

              {/* Notifications & Recent Attendance */}
              <div className="space-y-6">
                <div className="rounded-2xl p-5" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
                  <div className="flex items-center gap-2 mb-4">
                    <Bell size={18} style={{ color: '#f59e0b' }} />
                    <h2 className="font-bold text-white">Recent Notifications</h2>
                  </div>
                  {dashMetrics?.notifications && dashMetrics.notifications.length > 0 ? (
                    <div className="space-y-3">
                      {dashMetrics.notifications.map((n: any) => (
                        <div key={n.id} className="p-3 rounded-xl" style={{ background: '#122338', borderLeft: `3px solid ${n.severity === 'urgent' ? '#ef4444' : n.severity === 'warning' ? '#f59e0b' : '#3b82f6'}` }}>
                          <div className="text-sm font-semibold text-white">{n.title}</div>
                          <div className="text-xs mt-1" style={{ color: '#94a3b8' }}>{n.body}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-center py-6" style={{ color: '#4b6a8a' }}>No new notifications.</div>
                  )}
                </div>

                <div className="rounded-2xl p-5" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Clock size={18} style={{ color: '#10b981' }} />
                      <h2 className="font-bold text-white">Recent Attendance</h2>
                    </div>
                  </div>
                  {records.length > 0 ? (
                    <div className="space-y-2">
                      {records.slice(0, 4).map(record => (
                        <div key={record.id} className="rounded-xl p-3 flex items-center justify-between" style={{ background: '#122338' }}>
                          <div>
                            <div className="text-xs font-semibold text-white">{record.attendance_date}</div>
                            <div className="text-xs font-mono mt-0.5" style={{ color: '#4b6a8a' }}>{formatTime(record.check_in_at)} → {formatTime(record.check_out_at)}</div>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] px-2 py-1 rounded-lg capitalize block mb-1 text-center" style={{ background: 'rgba(37,99,235,0.12)', color: '#93c5fd' }}>{record.status.replace(/_/g, ' ')}</span>
                            {record.late_minutes > 0 && <span className="text-[10px] text-red-400">{record.late_minutes}m late</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-center py-6" style={{ color: '#4b6a8a' }}>No recent records.</div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
