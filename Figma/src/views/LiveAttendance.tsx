import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Filter, MapPin, Smartphone, TrendingUp } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import Avatar from '../components/Avatar';
import { getSupabaseClient } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { toAppError } from '../lib/errors';
import { todayInTimezone } from '../lib/dates';

const filters = ['All', 'Present', 'Late', 'Absent', 'Missing', 'Inside Geofence', 'Outside Geofence'];

export default function LiveAttendance() {
  const { activeMembership } = useAuth();
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!activeMembership) return;
    const client = getSupabaseClient();

    const { data: profiles, error: pError } = await client
      .from('employee_profiles')
      .select('*')
      .eq('organization_id', activeMembership.organization_id);
    if (pError) throw pError;

    const today = todayInTimezone('Asia/Riyadh');

    const { data: records, error: rError } = await client
      .from('attendance_records')
      .select('*')
      .eq('organization_id', activeMembership.organization_id)
      .eq('attendance_date', today);
    if (rError) throw rError;

    const recordMap = Object.fromEntries((records || []).map(r => [r.employee_id, r]));

    const mapped = (profiles || []).map(p => {
      const rec = recordMap[p.id];
      return {
        id: p.id,
        name: p.full_name,
        shift: 'Day',
        shiftStart: '09:00',
        checkin: rec ? (rec.check_in_at ? new Date(rec.check_in_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : null) : null,
        status: rec ? (rec.status ? rec.status.charAt(0).toUpperCase() + rec.status.slice(1) : 'Present') : 'Absent',
        worked: '0h 00m',
        inside: true, // simplified
        productivity: 0,
        phone: 0,
        ot: '0h 00m',
        attendance: rec ? rec.status : 'absent'
      };
    });

    if (mountedRef.current) {
      setEmployees(mapped);
      setLastUpdated(new Date());
    }
  }, [activeMembership]);

  useEffect(() => {
    if (!activeMembership) return;
    mountedRef.current = true;
    setLoading(true);

    fetchData()
      .catch(err => { if (mountedRef.current) setError(toAppError(err).message); })
      .finally(() => { if (mountedRef.current) setLoading(false); });

    // Live updates: refetch whenever today's attendance rows change for this
    // organization. Requires Realtime enabled on attendance_records (migration
    // 20261007120000_realtime_attendance.sql). If Realtime is not yet enabled
    // the subscription is simply idle and the initial load still works.
    const client = getSupabaseClient();
    const channel = client
      .channel(`live-attendance-${activeMembership.organization_id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'attendance_records',
          filter: `organization_id=eq.${activeMembership.organization_id}`,
        },
        () => { void fetchData().catch(() => undefined); },
      )
      .subscribe();

    return () => {
      mountedRef.current = false;
      void client.removeChannel(channel);
    };
  }, [activeMembership, fetchData]);

  const filtered = employees.filter(e => {
    if (search && !e.name.toLowerCase().includes(search.toLowerCase()) && !e.id.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'Present') return e.status === 'Present';
    if (filter === 'Late') return e.status === 'Late';
    if (filter === 'Absent') return e.status === 'Absent';
    if (filter === 'Missing') return e.status === 'Missing';
    if (filter === 'Inside Geofence') return e.inside;
    if (filter === 'Outside Geofence') return !e.inside;
    return true;
  });

  const timeStr = (lastUpdated ?? new Date()).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  if (loading) return <div className="p-4 text-white">Loading...</div>;
  if (error) return <div className="p-4 text-red-500">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            Live Shift Monitor
            <span className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-normal" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse-slow" style={{ background: '#10b981' }}></span>
              LIVE · {timeStr}
            </span>
          </h1>
          <p className="text-sm mt-0.5" style={{ color: '#4b6a8a' }}>Real-time attendance across all shifts and locations</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total', value: employees.length, color: '#3b82f6' },
          { label: 'Present', value: employees.filter(e=>e.status==='Present'||e.status==='Late').length, color: '#10b981' },
          { label: 'Absent / Missing', value: employees.filter(e=>e.status==='Absent'||e.status==='Missing').length, color: '#ef4444' },
          { label: 'Inside Geofence', value: employees.filter(e=>e.inside).length, color: '#06b6d4' },
        ].map((s,i) => (
          <div key={i} className="rounded-xl px-4 py-3 flex items-center gap-3" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
            <div className="text-2xl font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs" style={{ color: '#4b6a8a' }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#4b6a8a' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search employee..."
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: '#f0f6ff' }}
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {filters.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="text-xs px-3 py-1.5 rounded-lg transition-all"
              style={{
                background: filter === f ? '#2563eb' : '#0d1b2e',
                color: filter === f ? '#fff' : '#4b6a8a',
                border: `1px solid ${filter === f ? '#2563eb' : '#1e3a5a'}`,
              }}
            >{f}</button>
          ))}
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3a5a' }}>
        <table className="w-full">
          <thead>
            <tr style={{ background: '#122338' }}>
              {['Employee', 'Shift', 'Check-In', 'Status', 'Worked', 'Geofence'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#4b6a8a', letterSpacing: '0.07em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((emp, i) => (
              <tr key={emp.id} className="border-t transition-colors hover:bg-white/5" style={{ borderColor: '#1e3a5a', background: i % 2 === 0 ? 'transparent' : 'rgba(18,35,56,0.3)' }}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Avatar name={emp.name} />
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-slate-900" style={{ background: emp.inside ? '#10b981' : '#ef4444' }}></span>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-white">{emp.name}</div>
                      <div className="text-xs font-mono" style={{ color: '#4b6a8a' }}>{emp.id.substring(0,8)}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3"><StatusBadge status={emp.shift} /></td>
                <td className="px-4 py-3 font-mono text-xs" style={{ color: emp.checkin ? '#f0f6ff' : '#4b6a8a' }}>{emp.checkin ?? '—'}</td>
                <td className="px-4 py-3"><StatusBadge status={emp.attendance} /></td>
                <td className="px-4 py-3 font-mono text-xs" style={{ color: '#94a3b8' }}>{emp.worked}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <MapPin size={11} style={{ color: emp.inside ? '#10b981' : '#ef4444' }} />
                    <span className="text-xs" style={{ color: emp.inside ? '#10b981' : '#ef4444' }}>
                      {emp.inside ? 'Inside' : 'Outside'}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
