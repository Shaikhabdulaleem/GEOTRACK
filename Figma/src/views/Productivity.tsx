import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '../auth/AuthContext';
import { productivityService } from '../services/productivity.service';
import { employeeService } from '../services/employee.service';
import { shiftService } from '../services/shift.service';
import { isSupabaseConfigured } from '../lib/supabase';
import { logger } from '../lib/logger';
import type { ProductivityRecordRow, EmployeeProfileRow, ShiftAssignmentRow, ShiftRow } from '../types/database';

export default function Productivity() {
  const { activeMembership } = useAuth();
  const organizationId = activeMembership?.organization_id ?? '';
  const supabaseReady = isSupabaseConfigured();

  const [shiftFilter, setShiftFilter] = useState('All');
  const [period, setPeriod] = useState('Today');
  
  const [records, setRecords] = useState<ProductivityRecordRow[]>([]);
  const [emps, setEmps] = useState<Record<string, EmployeeProfileRow>>({});
  const [shifts, setShifts] = useState<Record<string, ShiftRow>>({});
  const [assignments, setAssignments] = useState<Record<string, ShiftAssignmentRow>>({});
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    if (!supabaseReady || !organizationId) return;
    setLoading(true);
    
    try {
      const now = new Date();
      let fromDate = new Date();
      if (period === 'Week') {
        fromDate.setDate(now.getDate() - 7);
      } else if (period === 'Month') {
        fromDate.setMonth(now.getMonth() - 1);
      }
      
      const fromIso = fromDate.toISOString().split('T')[0];
      const toIso = now.toISOString().split('T')[0];

      const [prodData, empData, assignData] = await Promise.all([
        productivityService.list({ organizationId, fromDate: fromIso, toDate: toIso }),
        employeeService.listAll({ organizationId }),
        shiftService.listAssignments({ organization_id: organizationId, from_date: fromIso, to_date: toIso })
      ]);

      setRecords(prodData);
      
      const empMap: Record<string, EmployeeProfileRow> = {};
      empData.forEach(e => empMap[e.id] = e);
      setEmps(empMap);

      const assignMap: Record<string, ShiftAssignmentRow> = {};
      assignData.forEach(a => assignMap[a.id] = a);
      setAssignments(assignMap);

      // Collect all shifts to know names (Day, Night, etc)
      const shiftMap: Record<string, ShiftRow> = {};
      assignData.forEach(a => {
        if (a.shift) {
          shiftMap[a.shift.id] = a.shift;
        }
      });
      setShifts(shiftMap);
      
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load productivity data.');
      logger.error('Unable to load productivity data.', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabaseReady, organizationId, period]);

  const displayData = useMemo(() => {
    if (!supabaseReady) {
      return [];
    }

    // Aggregate records by employee
    const agg: Record<string, { target: number; units: number; hours: number; shiftName: string }> = {};
    
    records.forEach(r => {
      if (!agg[r.employee_id]) {
        let sName = 'Unassigned';
        if (r.shift_assignment_id && assignments[r.shift_assignment_id]) {
           const sId = assignments[r.shift_assignment_id].shift_id;
           if (sId && shifts[sId]) {
              sName = shifts[sId].name;
           }
        }
        agg[r.employee_id] = { target: 0, units: 0, hours: 0, shiftName: sName };
      }
      agg[r.employee_id].target += r.target_units || 0;
      agg[r.employee_id].units += r.actual_units || 0;
      agg[r.employee_id].hours += r.productive_hours || 0;
    });

    const result = Object.entries(agg).map(([empId, data]) => {
      const e = emps[empId];
      const prod = data.target > 0 ? Math.round((data.units / data.target) * 100) : 0;
      return {
        id: empId,
        name: e?.full_name || 'Unknown',
        dept: 'General',
        shiftName: data.shiftName,
        target: data.target,
        units: data.units,
        productivity: prod,
        hours: data.hours,
        rank: 0 // Will sort later
      };
    }).filter(r => shiftFilter === 'All' || r.shiftName.includes(shiftFilter));

    // Sort by productivity desc
    result.sort((a, b) => b.productivity - a.productivity);
    result.forEach((r, idx) => r.rank = idx + 1);
    
    return result;
  }, [supabaseReady, records, emps, assignments, shifts, shiftFilter, period]);

  const avgProductivity = displayData.length 
    ? Math.round(displayData.reduce((s, r) => s + r.productivity, 0) / displayData.length) 
    : 0;
    
  const chartData = displayData.map(r => ({ 
    name: r.name.split(' ')[0], 
    productivity: r.productivity, 
    target: 100 
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Productivity</h1>
          <p className="text-sm mt-0.5" style={{ color: '#4b6a8a' }}>Output vs target by employee and shift · <span style={{ color: '#3b82f6' }}>{period}</span></p>
        </div>
        <div className="flex gap-2 items-center">
          {supabaseReady && (
            <button 
              onClick={() => void loadData()}
              disabled={loading}
              className="p-1.5 rounded-lg hover:bg-white/5 transition-colors mr-2"
              style={{ color: '#4b6a8a' }}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          )}
          {['Today', 'Week', 'Month'].map(p => (
            <button key={p} onClick={() => setPeriod(p)} className="text-xs px-3 py-1.5 rounded-lg transition-all"
              style={{ background: period === p ? '#2563eb' : '#0d1b2e', color: period === p ? '#fff' : '#4b6a8a', border: `1px solid ${period === p ? '#2563eb' : '#1e3a5a'}` }}>
              {p}
            </button>
          ))}
          <div className="w-px h-6 mx-1" style={{ background: '#1e3a5a' }}></div>
          {['All', 'Day', 'Night'].map(s => (
            <button key={s} onClick={() => setShiftFilter(s)} className="text-xs px-3 py-1.5 rounded-lg transition-all"
              style={{ background: '#0d1b2e', color: shiftFilter === s ? '#f0f6ff' : '#4b6a8a', border: `1px solid ${shiftFilter === s ? '#3b82f6' : '#1e3a5a'}` }}>
              {s === 'All' ? 'All Shifts' : `${s} Shift`}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Avg Productivity', value: `${avgProductivity}%`, color: avgProductivity >= 100 ? '#10b981' : '#f59e0b' },
          { label: 'Above Target', value: displayData.filter(r => r.productivity >= 100).length, color: '#10b981' },
          { label: 'Below Target', value: displayData.filter(r => r.productivity < 100).length, color: '#ef4444' },
          { label: 'Total Units', value: displayData.reduce((s, r) => s + r.units, 0).toLocaleString(), color: '#3b82f6' },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
            <div className="text-xs" style={{ color: '#4b6a8a' }}>{s.label}</div>
            <div className="text-2xl font-bold font-mono mt-1" style={{ color: s.color }}>
              {loading ? <span className="opacity-50">-</span> : s.value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
          <div className="font-semibold text-sm text-white mb-3">Productivity by Employee — {period}</div>
          {loading ? (
             <div className="flex justify-center items-center h-52"><Loader2 size={24} className="animate-spin text-blue-500" /></div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5a" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#4b6a8a', fontSize: 10 }} axisLine={false} tickLine={false} domain={[0, 130]} />
                <YAxis dataKey="name" type="category" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={65} />
                <Tooltip contentStyle={{ background: '#122338', border: '1px solid #1e3a5a', borderRadius: 8, color: '#f0f6ff', fontSize: 11 }} />
                <Bar dataKey="target" name="Target %" fill="#1e3a5a" radius={[0,3,3,0]} />
                <Bar dataKey="productivity" name="Actual %" fill="#2563eb" radius={[0,3,3,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', display: 'flex', flexDirection: 'column', maxHeight: '280px' }}>
          <div className="font-semibold text-sm text-white mb-3 flex-shrink-0">Productivity Leaderboard</div>
          {loading ? (
             <div className="flex justify-center items-center flex-1"><Loader2 size={24} className="animate-spin text-blue-500" /></div>
          ) : (
            <div className="space-y-3 overflow-y-auto flex-1 pr-1 custom-scrollbar">
              {displayData.map((r) => (
                <div key={r.id} className="flex items-center gap-3 p-2 rounded-lg" style={{ background: '#122338' }}>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold font-mono flex-shrink-0"
                    style={{ background: r.rank <= 3 ? 'rgba(245,158,11,0.2)' : '#1a3050', color: r.rank <= 3 ? '#f59e0b' : '#4b6a8a' }}>
                    {r.rank}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium text-white">{r.name}</div>
                        <div className="text-xs" style={{ color: '#4b6a8a' }}>{r.dept} · {r.shiftName}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold font-mono" style={{ color: r.productivity >= 100 ? '#10b981' : '#f59e0b' }}>{r.productivity}%</div>
                        <div className="text-xs font-mono" style={{ color: '#4b6a8a' }}>{r.units.toLocaleString()} / {r.target.toLocaleString()}</div>
                      </div>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full" style={{ background: '#1e3a5a' }}>
                      <div className="h-1 rounded-full" style={{ width: `${Math.min(r.productivity, 100)}%`, background: r.productivity >= 100 ? '#10b981' : '#f59e0b' }}></div>
                    </div>
                  </div>
                </div>
              ))}
              {displayData.length === 0 && (
                <div className="text-center text-xs py-4" style={{ color: '#4b6a8a' }}>No productivity records found for this period.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
