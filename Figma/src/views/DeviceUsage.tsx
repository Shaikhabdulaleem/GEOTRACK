import { useState, useEffect } from 'react';
import { Smartphone, AlertTriangle, Info } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '../auth/AuthContext';
import { toAppError } from '../lib/errors';
import Avatar from '../components/Avatar';
import { deviceService } from '../services/device.service';
import { employeeService } from '../services/employee.service';

const POLICY_LIMIT = 30; // minutes

function usageLevel(min: number) {
  if (min <= 30) return { label: 'Normal', color: '#10b981', bg: 'rgba(16,185,129,0.1)' };
  if (min <= 60) return { label: 'Review', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' };
  return { label: 'High', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' };
}

export default function DeviceUsage() {
  const { activeMembership } = useAuth();
  const [employees, setEmployees] = useState<any[]>([]);
  const [weeklyUsage, setWeeklyUsage] = useState<Array<{ day: string; avg: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeMembership) return;
    let mounted = true;
    setLoading(true);

    const fetchEmployees = async () => {
      const workDate = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());
      const [profilesResult, usage, weekly] = await Promise.all([
        employeeService.listAll({ organizationId: activeMembership.organization_id }),
        deviceService.getDashboardUsage(activeMembership.organization_id, workDate),
        deviceService.getWeeklyAverages(activeMembership.organization_id, workDate),
      ]);
      const usageByEmployee = new Map(usage.map(row => [row.employee_id, row]));
      const mapped = profilesResult.map(p => {
        const row = usageByEmployee.get(p.id);
        const workedMinutes = row?.worked_minutes ?? 0;
        return {
          id: p.id,
          name: p.full_name,
          shift: '—',
          worked: `${Math.floor(workedMinutes / 60)}h ${workedMinutes % 60}m`,
          phone: row?.within_shift_minutes ?? 0,
          percent: row?.usage_percent ?? 0,
        };
      });

      if (mounted) {
        setEmployees(mapped);
        setWeeklyUsage(weekly);
      }
    };

    fetchEmployees()
      .catch(err => {
        if (mounted) setError(toAppError(err).message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, [activeMembership]);

  const withUsage = employees.filter(e => e.phone > 0);
  const avgUsage = withUsage.length > 0 ? Math.round(withUsage.reduce((s, e) => s + e.phone, 0) / withUsage.length) : 0;

  if (loading) return <div className="p-4 text-white">Loading...</div>;
  if (error) return <div className="p-4 text-red-500">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Device Usage During Shift</h1>
          <p className="text-sm mt-0.5" style={{ color: '#4b6a8a' }}>Company-managed devices only · Active shift hours</p>
        </div>
      </div>

      <div className="flex items-start gap-2 p-3 rounded-lg text-xs" style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.2)', color: '#93c5fd' }}>
        <Info size={13} className="flex-shrink-0 mt-0.5" />
        <span>Device usage data is collected only during active working hours on company-managed devices with employee consent. Personal/BYOD devices are excluded. No message content, personal browsing, or private data is collected.</span>
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
          <div className="font-semibold text-sm text-white mb-3">Avg Usage % by Day (This Week)</div>
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
              { label: 'Normal (0–30 min)', count: employees.filter(e=>e.phone<=30).length, total: employees.length || 1, color: '#10b981' },
              { label: 'Review (31–60 min)', count: employees.filter(e=>e.phone>30&&e.phone<=60).length, total: employees.length || 1, color: '#f59e0b' },
              { label: 'High (60+ min)', count: employees.filter(e=>e.phone>60).length, total: employees.length || 1, color: '#ef4444' },
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
              {['Employee', 'Shift', 'Shift Duration', 'Worked Hours', 'Phone Active', 'Usage %', 'Policy Status'].map(h => (
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
                      <span className="text-xs font-medium text-white">{emp.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: emp.shift === 'Day' ? '#3b82f6' : '#8b5cf6' }}>{emp.shift}</td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: '#4b6a8a' }}>8h 00m</td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: '#94a3b8' }}>{emp.worked}</td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: emp.phone > 0 ? level.color : '#4b6a8a' }}>
                    {emp.phone > 0 ? `${emp.phone}m` : <span style={{ color: '#4b6a8a', fontSize: 11 }}>Unmanaged device</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: emp.percent > 0 ? level.color : '#4b6a8a' }}>
                    {emp.percent > 0 ? `${emp.percent.toFixed(1)}%` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {emp.phone > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium" style={{ background: level.bg, color: level.color }}>
                        {level.label}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: '#4b6a8a' }}>N/A</span>
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
