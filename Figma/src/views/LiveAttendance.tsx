import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Filter, MapPin, Smartphone, TrendingUp } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import Avatar from '../components/Avatar';
import { getSupabaseClient } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { toAppError } from '../lib/errors';
import { todayInTimezone } from '../lib/dates';
import { isEmployeeActiveOnDate } from '../services/employee.service';

const filters = ['All', 'Present', 'Late', 'Employee week Off', 'Absent', 'Missing', 'Inside Geofence', 'Outside Geofence'];

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

    const today = todayInTimezone('Asia/Riyadh');

    // ── Optimized Server-side RPC path ──────────────────────────────────────────
    // Fetches the exact scoped snapshot in 1 query without downloading thousands
    // of raw attendance_events over the wire.
    try {
      const { data: rpcData, error: rpcErr } = await client.rpc('get_live_attendance_snapshot', {
        p_organization_id: activeMembership.organization_id,
        p_date: today,
      });

      if (!rpcErr && Array.isArray(rpcData)) {
        const mapped = rpcData.map((row: any) => {
          const totalMins = Number(row.worked_minutes) || 0;
          const hours = Math.floor(totalMins / 60);
          const mins = totalMins % 60;
          const checkinTime = row.checkin
            ? new Date(row.checkin).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : null;

          return {
            id: row.id,
            name: row.name,
            shift: row.shift ?? 'Day',
            shiftStart: row.shift_start ?? '09:00',
            checkin: checkinTime,
            status: row.status,
            worked: `${hours}h ${String(mins).padStart(2, '0')}m`,
            inside: Boolean(row.inside),
            productivity: 0,
            phone: 0,
            ot: '0h 00m',
            attendance: row.attendance,
            isOff: Boolean(row.is_off),
          };
        });

        if (mountedRef.current) {
          setEmployees(mapped);
          setLastUpdated(new Date());
        }
        return;
      }
    } catch {
      // Fall through to client-side fallback if RPC is not yet deployed
    }

    // ── Fallback client-side path ────────────────────────────────────────────────
    const { data: profiles, error: pError } = await client
      .from('employee_profiles')
      .select('*')
      .eq('organization_id', activeMembership.organization_id);
    if (pError) throw pError;

    const { data: records, error: rError } = await client
      .from('attendance_records')
      .select('*')
      .eq('organization_id', activeMembership.organization_id)
      .eq('attendance_date', today);
    if (rError) throw rError;

    const recordMap = Object.fromEntries((records || []).map(r => [r.employee_id, r]));

    // Latest location signal per employee today. Riyadh is a fixed +03:00 offset,
    // matching todayInTimezone above. Limit to recent rows for safety.
    const [{ data: events, error: eError }, { data: assignments }, { data: weeklyOffRows }] = await Promise.all([
      client
        .from('attendance_events')
        .select('employee_id, inside_geofence, event_at')
        .eq('organization_id', activeMembership.organization_id)
        .gte('event_at', `${today}T00:00:00+03:00`)
        .order('event_at', { ascending: false })
        .limit(2000),
      client
        .from('shift_assignments')
        .select('employee_id, shift_id, status, shift:shifts(name)')
        .eq('organization_id', activeMembership.organization_id)
        .eq('work_date', today),
      client
        .from('weekly_offs')
        .select('employee_id')
        .eq('organization_id', activeMembership.organization_id)
        .eq('weekday', new Date(`${today}T12:00:00Z`).getUTCDay())
        .lte('effective_from', today)
        .or(`effective_to.is.null,effective_to.gte.${today}`),
    ]);
    if (eError) throw eError;

    const assignMap: Record<string, any> = Object.fromEntries((assignments || []).map((a: any) => [a.employee_id, a]));
    const weeklyOffSet = new Set((weeklyOffRows || []).map((w: any) => w.employee_id));

    const insideMap: Record<string, boolean> = {};
    for (const ev of events || []) {
      if (!(ev.employee_id in insideMap)) insideMap[ev.employee_id] = !!ev.inside_geofence;
    }

    const mapped = (profiles || [])
      .filter(p => {
        const rec = recordMap[p.id];
        return isEmployeeActiveOnDate(p, today) || !!rec;
      })
      .map(p => {
      const rec = recordMap[p.id];
      const assign = assignMap[p.id];
      const isOff = assign?.status === 'off' || weeklyOffSet.has(p.id);

      let status = 'Absent';
      let attendance = 'absent';
      if (rec) {
        if (rec.status === 'present') {
          status = 'Present';
          attendance = 'present';
        } else if (rec.status === 'late') {
          status = 'Late';
          attendance = 'late';
        } else if (isOff) {
          status = 'Employee week Off';
          attendance = 'Employee week Off';
        } else if (rec.status === 'absent') {
          status = 'Absent';
          attendance = 'absent';
        } else {
          status = 'Missing';
          attendance = rec.status;
        }
      } else {
        if (isOff) {
          status = 'Employee week Off';
          attendance = 'Employee week Off';
        } else {
          status = 'Absent';
          attendance = 'absent';
        }
      }

      const shiftObj = Array.isArray(assign?.shift) ? assign?.shift[0] : assign?.shift;

      return {
        id: p.id,
        name: p.full_name,
        shift: isOff ? 'Week Off' : (shiftObj?.name ?? 'Day'),
        shiftStart: '09:00',
        checkin: rec ? (rec.check_in_at ? new Date(rec.check_in_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : null) : null,
        status,
        worked: '0h 00m',
        inside: insideMap[p.id] ?? false, // no location signal today → not Inside
        productivity: 0,
        phone: 0,
        ot: '0h 00m',
        attendance,
        isOff,
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

    // Live updates: debounced refetch whenever attendance punches or location events
    // occur for this organization.
    const client = getSupabaseClient();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const triggerRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void fetchData().catch(() => undefined);
      }, 1000);
    };

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
        triggerRefresh,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'attendance_events',
          filter: `organization_id=eq.${activeMembership.organization_id}`,
        },
        triggerRefresh,
      )
      .subscribe();

    return () => {
      mountedRef.current = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      void client.removeChannel(channel);
    };
  }, [activeMembership, fetchData]);

  const filtered = employees.filter(e => {
    if (search && !e.name.toLowerCase().includes(search.toLowerCase()) && !e.id.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'Present') return e.status === 'Present';
    if (filter === 'Late') return e.status === 'Late';
    if (filter === 'Employee week Off') return e.status === 'Employee week Off';
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
                <td className="px-4 py-3"><StatusBadge status={emp.status} /></td>
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
