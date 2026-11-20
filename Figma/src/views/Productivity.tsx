import { useState, useEffect, useMemo, useRef } from 'react';
import { TrendingUp, TrendingDown, Minus, RefreshCw, Loader2, AlertCircle, Save, Settings, PackageCheck, Users, Clock, Plus, CalendarDays, ClipboardList, Copy, CheckCircle2, Upload } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts';
import { useAuth } from '../auth/AuthContext';
import { addDays, buildMailroomDayPreview, buildMailroomOperationalModel, dateRange, getApprovedOvertimeMinutes, getEmployeeOtRate, isEmployeeActiveOnDate, productivityService, startOfSundayWeek, type MailroomDailyClientInput, type MailroomDailyDspInput, type MailroomDailyInput, type MailroomWorkspace } from '../services/productivity.service';
import { employeeService } from '../services/employee.service';
import { shiftService } from '../services/shift.service';
import { isSupabaseConfigured } from '../lib/supabase';
import { logger } from '../lib/logger';
import { aggregateAymakanReturnsByClient, aggregateAymakanSnapshot, aggregateAymakanTurnaroundMetrics, firstCompleteAymakanMonthDate, getAymakanImportGroup, getAymakanReceivingDates, groupAymakanImportDaysByMonth, isJntProvider, parseAymakanFile, type AymakanImportGroup, type AymakanImportResult } from '../lib/aymakan-import';
import type { ProductivityRecordRow, EmployeeProfileRow, MailroomDailyEntryStatus, ShiftAssignmentRow, ShiftRow } from '../types/database';

function EmployeeProductivity() {
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

type ModuleTab = 'dashboard' | 'entry' | 'employee' | 'setup';
type DashboardPeriod = 'day' | 'week' | 'month';

const panelStyle = { background: '#0d1b2e', border: '1px solid #1e3a5a' };
const fieldStyle = { background: '#081424', border: '1px solid #1e3a5a', color: '#f0f6ff' };

function riyadhToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function monthEnd(month: string): string {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(year, value, 0);
  return `${year}-${String(value).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shortDay(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function number(value: number, digits = 0): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function dspCellKey(clientId: string, partnerId: string): string {
  return `${clientId}:${partnerId}`;
}

function MetricCard({ label, value, detail, color = '#f0f6ff' }: { label: string; value: string; detail?: string; color?: string }) {
  return <div className="rounded-xl p-4" style={panelStyle}><div className="text-[11px] uppercase tracking-wider" style={{ color: '#4b6a8a' }}>{label}</div><div className="text-2xl font-bold font-mono mt-1" style={{ color }}>{value}</div>{detail && <div className="text-xs mt-1" style={{ color: '#64748b' }}>{detail}</div>}</div>;
}

function OperationsDashboard({ workspace, fromDate, toDate, today }: { workspace: MailroomWorkspace; fromDate: string; toDate: string; today: string }) {
  const model = useMemo(() => buildMailroomOperationalModel(workspace, fromDate, toDate, today), [workspace, fromDate, toDate, today]);
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const turnaround = useMemo(() => {
    const branches = [...new Set(workspace.turnaroundMetrics.map(row => row.warehouse_code))].sort();
    const selected = workspace.turnaroundMetrics.filter(row => warehouseFilter === 'all' || row.warehouse_code === warehouseFilter);
    const rows = workspace.clients.filter(client => client.status === 'active').map(client => {
      const metrics = selected.filter(row => row.client_id === client.id);
      const minutes = metrics.reduce((sum, row) => sum + Number(row.total_minutes), 0);
      const shipments = metrics.reduce((sum, row) => sum + Number(row.shipment_count), 0);
      return { id: client.id, name: client.name, minutes, shipments, averageHours: shipments > 0 ? minutes / shipments / 60 : null };
    }).filter(row => row.shipments > 0);
    const totalMinutes = rows.reduce((sum, row) => sum + row.minutes, 0);
    const totalShipments = rows.reduce((sum, row) => sum + row.shipments, 0);
    return { branches, rows, averageHours: totalShipments > 0 ? totalMinutes / totalShipments / 60 : null, totalShipments };
  }, [workspace, warehouseFilter]);
  const dspBreakdown = useMemo(() => {
    const entryIds = new Set(workspace.dailyEntries
      .filter(entry => entry.status === 'finalized' && entry.work_date >= fromDate && entry.work_date <= toDate)
      .map(entry => entry.id));
    const rows = workspace.clients.filter(client => client.status === 'active').map(client => {
      const byPartner = Object.fromEntries(workspace.dspPartners.map(partner => [partner.id, 0])) as Record<string, number>;
      workspace.dspAllocations.forEach(allocation => {
        if (entryIds.has(allocation.daily_entry_id) && allocation.client_id === client.id) {
          byPartner[allocation.partner_id] = (byPartner[allocation.partner_id] ?? 0) + allocation.allocated_units;
        }
      });
      return { id: client.id, name: client.name, byPartner, total: Object.values(byPartner).reduce((sum, value) => sum + value, 0) };
    });
    return { partners: workspace.dspPartners.filter(partner => partner.status === 'active'), rows };
  }, [workspace, fromDate, toDate]);
  const chartData = model.days.map(day => ({ date: shortDay(day.date), received: day.received, processed: day.processed, required: Number(day.requiredFte.toFixed(2)), available: day.scheduledDlp }));
  const utilization = model.totalRegularCapacityHours > 0 ? model.totalRequiredHours / model.totalRegularCapacityHours * 100 : 0;
  return <div className="space-y-4">
    {model.draftDates.length > 0 && <div className="p-3 rounded-lg text-xs" style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)', color: '#fbbf24' }}>{model.draftDates.length} draft day{model.draftDates.length === 1 ? '' : 's'} excluded from official totals: {model.draftDates.join(', ')}</div>}
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      <MetricCard label="Received" value={number(model.totalReceived)} color="#3b82f6" />
      <MetricCard label="Processed / Handover" value={number(model.totalProcessed)} color="#10b981" />
      <MetricCard label="Labor Hours Needed" value={`${number(model.totalRequiredHours, 1)}h`} color="#f59e0b" />
      <MetricCard label="Employees Required" value={number(model.averageRequiredFte, 1)} detail={`Peak ${number(model.peakRequiredFte, 1)}`} color="#f59e0b" />
      <MetricCard
        label="OT Required"
        value={`${number(model.overtimeRecommendedHours, 1)}h`}
        detail={`Est: SAR ${number(model.overtimeRecommendedCost, 2)}${model.uncoveredHours ? ` · ${number(model.uncoveredHours, 1)}h uncovered` : ''}`}
        color={model.uncoveredHours ? '#ef4444' : '#8b5cf6'}
      />
      <MetricCard
        label="Actual OT (Done)"
        value={`${number(model.actualOvertimeHours, 1)}h`}
        detail={`Approved cost: SAR ${number(model.actualOvertimeCost, 2)}`}
        color="#10b981"
      />
      <MetricCard
        label="Approved OT Cost"
        value={`SAR ${number(model.actualOvertimeCost, 2)}`}
        detail={
          (workspace.settings.overtime_hourly_cost_own || workspace.settings.overtime_hourly_cost_3pl || workspace.settings.overtime_hourly_cost) > 0
            ? `Own: SAR ${number(workspace.settings.overtime_hourly_cost_own || workspace.settings.overtime_hourly_cost, 2)}/h · 3PL: SAR ${number(workspace.settings.overtime_hourly_cost_3pl || workspace.settings.overtime_hourly_cost, 2)}/h`
            : 'Set OT hourly cost in Setup'
        }
        color="#f59e0b"
      />
      <MetricCard label="OT Cost Saved" value={`SAR ${number(model.overtimeCostSaved, 2)}`} detail="Unused recommended OT" color="#10b981" />
      <MetricCard label="Additional 3PL" value={number(model.peakAdditional3pl)} detail="After available OT" color={model.peakAdditional3pl ? '#ef4444' : '#10b981'} />
    </div>

    <div className="rounded-xl overflow-hidden" style={panelStyle}><div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3"><div><div className="font-semibold text-sm text-white">Average time to LMD handover</div><div className="text-xs mt-1" style={{ color: '#64748b' }}>Barq/ELM: Receiving to LMD handover. Validation clients: Validation to LMD handover.</div></div><select aria-label="Destination branch filter" value={warehouseFilter} onChange={event => setWarehouseFilter(event.target.value)} className="px-3 py-2 rounded-lg text-xs" style={fieldStyle}><option value="all">All destination branches</option>{turnaround.branches.map(branch => <option key={branch} value={branch}>{branch}</option>)}</select></div><div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 p-4 border-t" style={{ borderColor: '#1e3a5a' }}><div className="rounded-lg p-3" style={{ background: '#122338' }}><div className="text-[10px] uppercase" style={{ color: '#64748b' }}>Overall average</div><div className="font-mono font-bold text-xl mt-1 text-white">{turnaround.averageHours == null ? '—' : `${number(turnaround.averageHours, 2)}h`}</div><div className="text-xs mt-1" style={{ color: '#64748b' }}>{number(turnaround.totalShipments)} handed-over shipments</div></div>{turnaround.rows.map(row => <div key={row.id} className="rounded-lg p-3" style={{ background: '#122338' }}><div className="text-xs font-medium text-white">{row.name}</div><div className="font-mono font-bold text-lg mt-1" style={{ color: '#93c5fd' }}>{row.averageHours == null ? '—' : `${number(row.averageHours, 2)}h`}</div><div className="text-xs" style={{ color: '#64748b' }}>{number(row.shipments)} shipments</div></div>)}</div></div>

    <div className="grid xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 rounded-xl p-4" style={panelStyle}>
        <div className="flex items-center justify-between mb-3"><div className="font-semibold text-sm text-white">Daily shipment flow</div><div className="text-xs" style={{ color: '#4b6a8a' }}>{fromDate} to {toDate}</div></div>
        <ResponsiveContainer width="100%" height={250}><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#1e3a5a" /><XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} /><YAxis tick={{ fill: '#64748b', fontSize: 10 }} /><Tooltip contentStyle={{ background: '#122338', border: '1px solid #1e3a5a', borderRadius: 8 }} /><Legend /><Line type="monotone" dataKey="received" name="Received" stroke="#3b82f6" strokeWidth={2} /><Line type="monotone" dataKey="processed" name="Processed" stroke="#10b981" strokeWidth={2} /></LineChart></ResponsiveContainer>
      </div>
      <div className="rounded-xl p-4" style={panelStyle}>
        <div className="font-semibold text-sm text-white mb-3">Mailroom workforce</div>
        <div className="space-y-3">
          {[['Own DLP', model.ownDlp, '#3b82f6'], ['3PL DLP', model.threePlDlp, '#8b5cf6'], ['Managers / Non-DLP', model.nonDlp, '#64748b'], ['Workload utilization', `${number(utilization, 0)}%`, utilization > 100 ? '#ef4444' : '#10b981'], [model.shortageHours > 0 ? 'Capacity shortage' : 'Surplus capacity', `${number(model.shortageHours > 0 ? model.shortageHours : model.surplusHours, 1)}h`, model.shortageHours > 0 ? '#ef4444' : '#10b981']].map(([label, value, color]) => <div key={String(label)} className="flex justify-between items-center p-3 rounded-lg" style={{ background: '#122338' }}><span className="text-xs" style={{ color: '#94a3b8' }}>{label}</span><span className="font-mono font-bold" style={{ color: String(color) }}>{value}</span></div>)}
        </div>
      </div>
    </div>

    <div className="grid xl:grid-cols-2 gap-4">
      <div className="rounded-xl overflow-hidden" style={panelStyle}><div className="px-4 py-3 font-semibold text-sm text-white">Client flow and ending backlog</div><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr style={{ background: '#122338', color: '#64748b' }}>{['Client', 'Received', 'Processed', 'Returns', 'Unprocessed backlog'].map(h => <th key={h} className="text-right first:text-left px-3 py-2">{h}</th>)}</tr></thead><tbody>{model.clients.map(client => <tr key={client.id} className="border-t" style={{ borderColor: '#1e3a5a' }}><td className="px-3 py-2 font-medium text-white">{client.name}</td>{[client.received, client.processed, client.returns, client.unprocessedBacklog].map((v, i) => <td key={i} className="px-3 py-2 text-right font-mono" style={{ color: i === 3 && v > 0 ? '#f59e0b' : '#94a3b8' }}>{number(v)}</td>)}</tr>)}</tbody></table></div><div className="grid grid-cols-3 gap-2 p-3 border-t" style={{ borderColor: '#1e3a5a' }}><div className="text-xs" style={{ color: '#64748b' }}>Returns received <strong className="block text-white font-mono">{number(model.totalReturnsReceived)}</strong></div><div className="text-xs" style={{ color: '#64748b' }}>Returns processed <strong className="block text-white font-mono">{number(model.totalReturnsProcessed)}</strong></div><div className="text-xs" style={{ color: '#64748b' }}>DSP allocated <strong className="block text-white font-mono">{number(model.totalDspAllocated)}</strong></div></div></div>
      <div className="rounded-xl overflow-hidden" style={panelStyle}><div className="px-4 py-3 font-semibold text-sm text-white">Activity staffing requirement</div><div className="max-h-[390px] overflow-auto"><table className="w-full text-xs"><thead className="sticky top-0"><tr style={{ background: '#122338', color: '#64748b' }}>{['Activity', 'Volume', 'Rate/hour', 'Hours', 'Avg employees', 'Peak employees'].map(h => <th key={h} className="text-right first:text-left px-3 py-2">{h}</th>)}</tr></thead><tbody>{model.activities.map(activity => <tr key={activity.id} className="border-t" style={{ borderColor: '#1e3a5a' }}><td className="px-3 py-2 text-white">{activity.name}</td><td className="px-3 py-2 text-right font-mono">{number(activity.volume)}</td><td className="px-3 py-2 text-right font-mono">{number(activity.rate)}</td><td className="px-3 py-2 text-right font-mono">{number(activity.laborHours, 1)}</td><td className="px-3 py-2 text-right font-mono" style={{ color: '#f59e0b' }}>{number(activity.averageEmployees, 1)}</td><td className="px-3 py-2 text-right font-mono" style={{ color: '#f59e0b' }}>{number(activity.peakEmployees, 1)}</td></tr>)}<tr className="border-t-2 font-semibold" style={{ borderColor: '#3b82f6' }}><td className="px-3 py-2 text-white">DLP workload requirement</td><td colSpan={2}></td><td className="px-3 py-2 text-right font-mono text-white">{number(model.totalRequiredHours, 1)}</td><td className="px-3 py-2 text-right font-mono text-white">{number(model.averageRequiredFte, 1)}</td><td className="px-3 py-2 text-right font-mono text-white">{number(model.peakRequiredFte, 1)}</td></tr><tr><td className="px-3 py-2" style={{ color: '#94a3b8' }}>Planned absence reserve ({number(workspace.settings.planned_absence_percent)}%)</td><td colSpan={3}></td><td className="px-3 py-2 text-right font-mono">{number(model.absenceReserveFte, 1)}</td><td></td></tr><tr className="font-semibold" style={{ background: '#122338' }}><td className="px-3 py-2 text-white">Total planned staff requirement</td><td colSpan={3}></td><td className="px-3 py-2 text-right font-mono text-white">{number(model.totalPlannedFte, 1)}</td><td></td></tr></tbody></table></div></div>
    </div>

    {dspBreakdown.partners.length > 0 && <div className="rounded-xl overflow-hidden" style={panelStyle}><div className="px-4 py-3"><div className="font-semibold text-sm text-white">DSP allocation by client</div><div className="text-xs mt-1" style={{ color: '#64748b' }}>Finalized last-mile volume for the selected period.</div></div><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr style={{ background: '#122338', color: '#64748b' }}><th className="text-left px-3 py-2">Client</th>{dspBreakdown.partners.map(partner => <th key={partner.id} className="text-right px-3 py-2">{partner.name}</th>)}<th className="text-right px-3 py-2">Total</th></tr></thead><tbody>{dspBreakdown.rows.map(row => <tr key={row.id} className="border-t" style={{ borderColor: '#1e3a5a' }}><td className="px-3 py-2 text-white font-medium">{row.name}</td>{dspBreakdown.partners.map(partner => <td key={partner.id} className="px-3 py-2 text-right font-mono" style={{ color: '#94a3b8' }}>{number(row.byPartner[partner.id] ?? 0)}</td>)}<td className="px-3 py-2 text-right font-mono font-semibold text-white">{number(row.total)}</td></tr>)}</tbody></table></div></div>}

    <div className="rounded-xl overflow-hidden" style={panelStyle}>
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b" style={{ borderColor: '#1e3a5a' }}>
        <div>
          <div className="font-semibold text-sm text-white">Overtime tracking — Required vs Done (Approved)</div>
          <div className="text-xs mt-1" style={{ color: '#64748b' }}>Workload shortage hours requiring overtime compared with actual manager-approved overtime performed by Mailroom employees.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="px-3 py-1.5 rounded-lg" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
            <span style={{ color: '#94a3b8' }}>OT Required: </span>
            <strong className="font-mono text-white">{number(model.overtimeRecommendedHours, 1)}h</strong>
            <span className="text-[10px] font-mono ml-1" style={{ color: '#c4b5fd' }}>(SAR {number(model.overtimeRecommendedCost, 2)})</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
            <span style={{ color: '#94a3b8' }}>OT Done (Approved): </span>
            <strong className="font-mono" style={{ color: '#10b981' }}>{number(model.actualOvertimeHours, 1)}h</strong>
          </div>
          <div className="px-3 py-1.5 rounded-lg" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
            <span style={{ color: '#94a3b8' }}>Total Approved Cost: </span>
            <strong className="font-mono" style={{ color: '#f59e0b' }}>SAR {number(model.actualOvertimeCost, 2)}</strong>
          </div>
          <div className="px-3 py-1.5 rounded-lg font-mono text-[11px] font-bold" style={{
            background: model.actualOvertimeHours >= model.overtimeRecommendedHours ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
            color: model.actualOvertimeHours >= model.overtimeRecommendedHours ? '#10b981' : '#f59e0b',
            border: `1px solid ${model.actualOvertimeHours >= model.overtimeRecommendedHours ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}`,
          }}>
            {model.actualOvertimeHours >= model.overtimeRecommendedHours
              ? `+${number(model.actualOvertimeHours - model.overtimeRecommendedHours, 1)}h covered`
              : `${number(model.actualOvertimeHours - model.overtimeRecommendedHours, 1)}h shortage`}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: '#122338', color: '#64748b' }}>
              <th className="text-left px-3 py-2">Date</th>
              <th className="text-center px-3 py-2">Status</th>
              <th className="text-right px-3 py-2">Workload Demand</th>
              <th className="text-right px-3 py-2">Regular Capacity</th>
              <th className="text-right px-3 py-2">OT Required</th>
              <th className="text-right px-3 py-2">Req. Cost</th>
              <th className="text-right px-3 py-2">OT Done (Approved)</th>
              <th className="text-right px-3 py-2">Done Cost</th>
              <th className="text-right px-3 py-2">Variance</th>
              <th className="text-center px-3 py-2">Fulfillment</th>
            </tr>
          </thead>
          <tbody>
            {model.days.map(day => {
              const variance = day.actualOvertimeHours - day.overtimeRecommendedHours;
              const fulfillmentPercent = day.overtimeRecommendedHours > 0
                ? Math.min(100, Math.round((day.actualOvertimeHours / day.overtimeRecommendedHours) * 100))
                : (day.actualOvertimeHours > 0 ? 100 : null);
              return (
                <tr key={day.date} className="border-t" style={{ borderColor: '#1e3a5a' }}>
                  <td className="px-3 py-2 text-white font-medium">{shortDay(day.date)} <span style={{ color: '#64748b' }}>({day.date})</span></td>
                  <td className="px-3 py-2 text-center uppercase text-[10px] font-semibold" style={{ color: day.status === 'finalized' ? '#10b981' : day.status === 'draft' ? '#f59e0b' : '#64748b' }}>
                    {day.status}
                  </td>
                  <td className="px-3 py-2 text-right font-mono" style={{ color: '#93c5fd' }}>{number(day.requiredHours, 1)}h</td>
                  <td className="px-3 py-2 text-right font-mono" style={{ color: '#94a3b8' }}>{number(day.regularCapacityHours, 1)}h</td>
                  <td className="px-3 py-2 text-right font-mono font-medium" style={{ color: day.overtimeRecommendedHours > 0 ? '#8b5cf6' : '#64748b' }}>
                    {number(day.overtimeRecommendedHours, 1)}h
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[11px]" style={{ color: day.overtimeRecommendedCost > 0 ? '#c4b5fd' : '#64748b' }}>
                    {day.overtimeRecommendedCost > 0 ? `SAR ${number(day.overtimeRecommendedCost, 2)}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold" style={{ color: day.actualOvertimeHours > 0 ? '#10b981' : '#64748b' }}>
                    {number(day.actualOvertimeHours, 1)}h
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold" style={{ color: day.actualOvertimeCost > 0 ? '#f59e0b' : '#64748b' }}>
                    {day.actualOvertimeCost > 0 ? `SAR ${number(day.actualOvertimeCost, 2)}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[11px]" style={{ color: variance >= 0 ? '#10b981' : '#f59e0b' }}>
                    {day.overtimeRecommendedHours > 0 || day.actualOvertimeHours > 0
                      ? `${variance >= 0 ? '+' : ''}${number(variance, 1)}h`
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {fulfillmentPercent == null ? (
                      <span className="text-[10px]" style={{ color: '#64748b' }}>No OT required</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold font-mono" style={{
                        background: fulfillmentPercent >= 100 ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
                        color: fulfillmentPercent >= 100 ? '#6ee7b7' : '#fcd34d',
                        border: `1px solid ${fulfillmentPercent >= 100 ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}`,
                      }}>
                        {fulfillmentPercent}%
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 font-semibold" style={{ borderColor: '#3b82f6', background: '#122338' }}>
              <td colSpan={2} className="px-3 py-2.5 text-white">Period Totals</td>
              <td className="px-3 py-2.5 text-right font-mono text-white">{number(model.totalRequiredHours, 1)}h</td>
              <td className="px-3 py-2.5 text-right font-mono text-white">{number(model.totalRegularCapacityHours, 1)}h</td>
              <td className="px-3 py-2.5 text-right font-mono" style={{ color: '#8b5cf6' }}>{number(model.overtimeRecommendedHours, 1)}h</td>
              <td className="px-3 py-2.5 text-right font-mono font-bold" style={{ color: '#10b981' }}>{number(model.actualOvertimeHours, 1)}h</td>
              <td className="px-3 py-2.5 text-right font-mono text-[11px]" style={{ color: model.actualOvertimeHours >= model.overtimeRecommendedHours ? '#10b981' : '#f59e0b' }}>
                {`${model.actualOvertimeHours >= model.overtimeRecommendedHours ? '+' : ''}${number(model.actualOvertimeHours - model.overtimeRecommendedHours, 1)}h`}
              </td>
              <td className="px-3 py-2.5 text-right font-mono font-bold" style={{ color: '#f59e0b' }}>SAR {number(model.actualOvertimeCost, 2)}</td>
              <td className="px-3 py-2.5 text-center text-[10px]" style={{ color: '#93c5fd' }}>
                {model.overtimeRecommendedHours > 0
                  ? `${Math.round((model.actualOvertimeHours / model.overtimeRecommendedHours) * 100)}% overall fulfillment`
                  : '—'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    {model.approvedOvertimeByEmployee.length > 0 && (
      <div className="rounded-xl overflow-hidden" style={panelStyle}>
        <div className="px-4 py-3 flex justify-between items-center border-b" style={{ borderColor: '#1e3a5a' }}>
          <div>
            <div className="font-semibold text-sm text-white">Approved overtime by employee — period breakdown</div>
            <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>Mailroom workforce who completed approved overtime in this period.</div>
          </div>
          <div className="text-xs font-mono" style={{ color: '#10b981' }}>
            {model.approvedOvertimeByEmployee.length} employee{model.approvedOvertimeByEmployee.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: '#122338', color: '#64748b' }}>
                <th className="text-left px-3 py-2">Employee</th>
                <th className="text-left px-3 py-2">Classification</th>
                <th className="text-right px-3 py-2">OT Days</th>
                <th className="text-right px-3 py-2">Approved Hours</th>
                <th className="text-right px-3 py-2">Hourly Cost</th>
                <th className="text-right px-3 py-2">Total OT Cost</th>
              </tr>
            </thead>
            <tbody>
              {model.approvedOvertimeByEmployee.map(emp => (
                <tr key={emp.employeeId} className="border-t" style={{ borderColor: '#1e3a5a' }}>
                  <td className="px-3 py-2.5 text-white font-medium">
                    {emp.employeeName}
                    <div className="text-[10px]" style={{ color: '#64748b' }}>{emp.employeeCode}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="uppercase text-[10px] font-semibold px-2 py-0.5 rounded" style={{
                      background: emp.laborClass === 'dlp' ? 'rgba(37,99,235,0.12)' : 'rgba(100,116,139,0.12)',
                      color: emp.laborClass === 'dlp' ? '#93c5fd' : '#94a3b8',
                      border: `1px solid ${emp.laborClass === 'dlp' ? 'rgba(37,99,235,0.25)' : 'rgba(100,116,139,0.25)'}`,
                    }}>
                      {emp.laborClass.toUpperCase()} · {emp.employmentSource.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono" style={{ color: '#93c5fd' }}>{emp.daysCount}</td>
                  <td className="px-3 py-2.5 text-right font-mono font-bold" style={{ color: '#10b981' }}>{number(emp.approvedHours, 1)}h</td>
                  <td className="px-3 py-2.5 text-right font-mono" style={{ color: '#94a3b8' }}>SAR {number(emp.hourlyCost, 2)}</td>
                  <td className="px-3 py-2.5 text-right font-mono font-bold" style={{ color: '#f59e0b' }}>SAR {number(emp.totalCost, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}

    {model.overtimeAllocations.length > 0 && <div className="rounded-xl p-4" style={panelStyle}><div className="font-semibold text-sm text-white mb-3">Suggested overtime allocation using existing Mailroom DLP</div><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">{model.overtimeAllocations.map(item => <div key={item.employeeId} className="flex justify-between p-3 rounded-lg" style={{ background: '#122338' }}><span className="text-xs text-white">{item.employeeName}</span><span className="text-xs font-mono" style={{ color: '#c4b5fd' }}>{number(item.hours, 1)}h</span></div>)}</div></div>}
  </div>;
}

function DailyEntry({ workspace, today, workDate, setWorkDate, saving, onSave, onSaveMonths, onLoadRange }: { workspace: MailroomWorkspace; today: string; workDate: string; setWorkDate: (value: string) => void; saving: boolean; onSave: (input: { workDate: string; status: MailroomDailyEntryStatus; clients: MailroomDailyClientInput[]; returnsReceived: number; returnsProcessed: number; dspAllocations: MailroomDailyDspInput[]; notes: string }) => Promise<void>; onSaveMonths: (batches: Array<Parameters<typeof productivityService.saveMailroomMonth>[1]>) => Promise<void>; onLoadRange: (fromDate: string, toDate: string) => Promise<MailroomWorkspace | null> }) {
  const activeClients = workspace.clients.filter(client => client.status === 'active');
  const activePartners = workspace.dspPartners.filter(partner => partner.status === 'active');
  const isJntPartner = (value: string) => isJntProvider(value);
  const jntPartner = activePartners.find(partner => isJntPartner(partner.code) || isJntPartner(partner.name));
  const [clientValues, setClientValues] = useState<Record<string, MailroomDailyClientInput>>({});
  const [dspValues, setDspValues] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [importSummaries, setImportSummaries] = useState<Partial<Record<AymakanImportGroup, AymakanImportResult>>>({});
  const [pendingImportDays, setPendingImportDays] = useState<Partial<Record<AymakanImportGroup, MailroomDailyInput[]>>>({});
  const pendingImportDaysRef = useRef(pendingImportDays);
  pendingImportDaysRef.current = pendingImportDays;
  const [importError, setImportError] = useState<string | null>(null);
  const existingEntry = workspace.dailyEntries.find(entry => entry.work_date === workDate);
  const importSummary = useMemo<AymakanImportResult | null>(() => {
    const summaries = Object.values(importSummaries);
    if (summaries.length === 0) return null;
    const importedClients = new Map(summaries.flatMap(summary => summary.clients.map(client => [client.client_id, client] as const)));
    return {
      workDate,
      uniqueShipments: summaries.reduce((sum, summary) => sum + summary.uniqueShipments, 0),
      duplicateShipments: summaries.reduce((sum, summary) => sum + summary.duplicateShipments, 0),
      ignoredShipments: summaries.reduce((sum, summary) => sum + summary.ignoredShipments, 0),
      unmatchedCustomers: [...new Set(summaries.flatMap(summary => summary.unmatchedCustomers))].sort(),
      clients: activeClients.flatMap(client => importedClients.has(client.id) ? [importedClients.get(client.id)!] : []),
    };
  }, [activeClients, importSummaries, workDate]);

  useEffect(() => {
    const stagedValidationDay = pendingImportDaysRef.current.validation?.find(day => day.workDate === workDate);
    const stagedReceivingDay = pendingImportDaysRef.current.receiving?.find(day => day.workDate === workDate);

    const nextClients: Record<string, MailroomDailyClientInput> = {};
    activeClients.forEach(client => {
      const clientGroup = getAymakanImportGroup(client.code) ?? getAymakanImportGroup(client.name);
      const stagedClient = clientGroup === 'validation'
        ? stagedValidationDay?.clients.find(item => item.client_id === client.id)
        : clientGroup === 'receiving'
          ? stagedReceivingDay?.clients.find(item => item.client_id === client.id)
          : undefined;

      const row = workspace.shipments.find(item => item.client_id === client.id && item.work_date === workDate);
      nextClients[client.id] = stagedClient ?? {
        client_id: client.id,
        received_units: row?.received_units ?? 0,
        processed_units: row?.processed_units ?? 0,
        backlog_released_units: row?.backlog_released_units ?? row?.processed_units ?? 0,
        batch_closed_units: row?.batch_closed_units ?? 0,
        return_units: row?.returns_received ?? 0,
      };
    });
    const entry = workspace.dailyEntries.find(item => item.work_date === workDate);
    const nextDsp: Record<string, number> = {};
    activeClients.forEach(client => activePartners.forEach(partner => {
      const key = dspCellKey(client.id, partner.id);
      const clientGroup = getAymakanImportGroup(client.code) ?? getAymakanImportGroup(client.name);
      const stagedDsp = clientGroup === 'validation'
        ? stagedValidationDay?.dspAllocations.find(item => item.client_id === client.id && item.partner_id === partner.id)
        : clientGroup === 'receiving'
          ? stagedReceivingDay?.dspAllocations.find(item => item.client_id === client.id && item.partner_id === partner.id)
          : undefined;

      nextDsp[key] = stagedDsp != null
        ? stagedDsp.allocated_units
        : (entry ? (workspace.dspAllocations.find(item => item.daily_entry_id === entry.id && item.client_id === client.id && item.partner_id === partner.id)?.allocated_units ?? 0) : 0);
    }));
    setClientValues(nextClients);
    setDspValues(nextDsp);
    setNotes(entry?.notes ?? '');
    setImportSummaries({});
    setImportError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workDate, workspace]);

  const setClientNumber = (clientId: string, field: 'received_units' | 'processed_units', raw: string) => {
    const value = Math.max(0, Math.floor(Number(raw) || 0));
    setClientValues(current => {
      const previous = current[clientId] ?? { client_id: clientId, received_units: 0, processed_units: 0 };
      const followsProcessed = (previous.backlog_released_units ?? previous.processed_units) === previous.processed_units
        && (previous.batch_closed_units ?? 0) === 0;
      return {
        ...current,
        [clientId]: {
          ...previous,
          [field]: value,
          ...(field === 'processed_units' && followsProcessed ? { backlog_released_units: value } : {}),
        },
      };
    });
  };
  const setClientReturn = (clientId: string, raw: string) => {
    const value = Math.max(0, Math.floor(Number(raw) || 0));
    setClientValues(current => ({
      ...current,
      [clientId]: {
        ...(current[clientId] ?? { client_id: clientId, received_units: 0, processed_units: 0 }),
        return_units: value,
      },
    }));
  };
  const historicalClientBacklog = (clientId: string) => {
    const client = activeClients.find(item => item.id === clientId);
    return (client?.opening_unprocessed_units ?? 0) + workspace.shipments
      .filter(row => row.client_id === clientId && row.work_date < workDate)
      .reduce((sum, row) => sum + row.received_units - row.backlog_released_units - row.batch_closed_units, 0);
  };
  const historicalReturnsBacklog = workspace.settings.opening_return_backlog + workspace.dailyEntries
    .filter(entry => entry.work_date < workDate)
    .reduce((sum, entry) => sum + entry.returns_received - entry.returns_processed, 0);
  const clientRows = activeClients.map(client => clientValues[client.id] ?? { client_id: client.id, received_units: 0, processed_units: 0 });
  const returnsReceived = clientRows.reduce((sum, row) => sum + (row.return_units ?? 0), 0);
  const returnsProcessed = returnsReceived;
  const processedTotal = clientRows.reduce((sum, row) => sum + row.processed_units, 0);
  const dspTotal = Object.values(dspValues).reduce((sum, value) => sum + value, 0);
  const dspRemaining = processedTotal - dspTotal;
  const clientDspTotals = Object.fromEntries(activeClients.map(client => [client.id, activePartners.reduce((sum, partner) => sum + (dspValues[dspCellKey(client.id, partner.id)] ?? 0), 0)])) as Record<string, number>;
  const overAllocatedDspClients = activeClients.filter(client => (clientDspTotals[client.id] ?? 0) > (clientValues[client.id]?.processed_units ?? 0));
  const invalidClients = activeClients.filter(client => {
    const row = clientValues[client.id];
    const backlogReduction = (row?.backlog_released_units ?? row?.processed_units ?? 0) + (row?.batch_closed_units ?? 0);
    return row && backlogReduction > historicalClientBacklog(client.id) + row.received_units;
  });
  const invalidReturns = returnsProcessed > historicalReturnsBacklog + returnsReceived;
  const preview = useMemo(() => buildMailroomDayPreview(workspace, workDate, clientRows, returnsReceived, dspTotal, today), [workspace, workDate, clientRows, returnsReceived, dspTotal, today]);
  const weekDates = dateRange(startOfSundayWeek(workDate), addDays(startOfSundayWeek(workDate), 6));
  const pendingImportDayCount = new Set(Object.values(pendingImportDays).flatMap(days => days?.map(day => day.workDate) ?? [])).size;

  const employeeOvertimeRows = useMemo(() => {
    return workspace.employees
      .filter(employee => isEmployeeActiveOnDate(employee, workDate))
      .map(employee => {
        const setting = workspace.employeeSettings.find(s => s.employee_id === employee.id);
        const schedule = workspace.schedules[employee.id]?.find(s => s.work_date === workDate);
        const attendance = workspace.attendance.filter(a => a.employee_id === employee.id && a.attendance_date === workDate);
        const workedHours = attendance.reduce((sum, a) => sum + (a.worked_minutes || 0) / 60, 0);
        const { approvedMinutes, requestedMinutes, status } = getApprovedOvertimeMinutes(
          employee.id,
          workDate,
          workspace.attendance,
          workspace.overtimeRecords ?? []
        );
        const approvedHours = approvedMinutes / 60;
        const requestedHours = requestedMinutes / 60;
        const otHours = approvedHours > 0 ? approvedHours : requestedHours;
        const hourlyRate = getEmployeeOtRate(setting, workspace.settings);
        const approvedCost = otHours * hourlyRate;
        const maxOt = setting?.max_overtime_hours_override ?? workspace.settings.max_overtime_hours_per_day;

        return {
          id: employee.id,
          name: employee.full_name,
          code: employee.employee_code,
          jobTitle: employee.job_title ?? '—',
          laborClass: setting?.labor_class ?? 'dlp',
          employmentSource: setting?.employment_source ?? 'own',
          overtimeEligible: setting?.overtime_eligible ?? true,
          maxOt,
          scheduleState: schedule?.state ?? 'unassigned',
          shiftName: schedule?.shift_name ?? (schedule?.state === 'working' ? 'Working' : schedule?.state ?? '—'),
          workedHours,
          requestedHours,
          approvedHours,
          otHours,
          status: status === 'none' && otHours > 0 ? 'pending' : status,
          hourlyRate,
          approvedCost,
        };
      })
      .sort((a, b) => b.otHours - a.otHours || a.name.localeCompare(b.name));
  }, [workspace, workDate]);

  const totalApprovedOtHours = employeeOvertimeRows.reduce((sum, r) => sum + r.otHours, 0);
  const totalApprovedOtCost = employeeOvertimeRows.reduce((sum, r) => sum + r.approvedCost, 0);
  const totalWorkedHours = employeeOvertimeRows.reduce((sum, r) => sum + r.workedHours, 0);
  const otVariance = totalApprovedOtHours - preview.overtimeHours;

  const copyPreviousDay = () => {
    const previous = addDays(workDate, -1);
    const next: Record<string, MailroomDailyClientInput> = {};
    activeClients.forEach(client => {
      const row = workspace.shipments.find(item => item.client_id === client.id && item.work_date === previous);
      next[client.id] = {
        client_id: client.id,
        received_units: row?.received_units ?? 0,
        processed_units: row?.processed_units ?? 0,
        backlog_released_units: row?.backlog_released_units ?? row?.processed_units ?? 0,
        batch_closed_units: row?.batch_closed_units ?? 0,
        return_units: row?.returns_received ?? 0,
      };
    });
    setClientValues(next);
    const prevEntry = workspace.dailyEntries.find(item => item.work_date === previous);
    const nextDsp: Record<string, number> = {};
    activeClients.forEach(client => activePartners.forEach(partner => {
      const key = dspCellKey(client.id, partner.id);
      nextDsp[key] = prevEntry
        ? (workspace.dspAllocations.find(item => item.daily_entry_id === prevEntry.id && item.client_id === client.id && item.partner_id === partner.id)?.allocated_units ?? 0)
        : 0;
    }));
    setDspValues(nextDsp);
  };
  const importAymakanSnapshot = async (files: File[], group: AymakanImportGroup) => {
    setImportError(null);
    try {
      const snapshots = await Promise.all(files.map(async file => parseAymakanFile(await file.text(), file.name)));
      const snapshot = {
        source: 'aymakan-portal' as const,
        work_date: workDate,
        shipments: snapshots.flatMap(item => item.shipments),
      };
      if (!snapshot.shipments.some(shipment => getAymakanImportGroup(shipment.customer) === group)) {
        throw new Error(group === 'receiving'
          ? 'This export has no Barq, ELM, or Elm - Express shipments.'
          : 'This export has no Urpay, Neoleap, or Al Mawarid shipments.');
      }
      const groupSnapshot = { ...snapshot, shipments: snapshot.shipments.filter(shipment => getAymakanImportGroup(shipment.customer) === group) };
      const result = aggregateAymakanSnapshot(groupSnapshot, activeClients, workDate);
      const groupCodes = group === 'receiving' ? new Set(['BARQ', 'ELM']) : new Set(['NEOLEAP', 'URPAY', 'AL_MAWARID']);
      const scopedResult = { ...result, clients: result.clients.filter(client => groupCodes.has(client.client_code)) };
      let stagedDays: MailroomDailyInput[] = [];
      if (group === 'validation') {
        const observedDates = groupSnapshot.shipments
          .flatMap(shipment => [shipment.receiving_date, shipment.validation_date, shipment.updated_date])
          .filter((date): date is string => Boolean(date))
          .sort();
        const firstObservedDate = observedDates[0];
        const lastObservedDate = observedDates.at(-1);
        if (!firstObservedDate || !lastObservedDate) throw new Error('This validation export has no Receiving or Validation dates.');
        const firstImportDate = firstCompleteAymakanMonthDate(firstObservedDate);
        if (firstImportDate > lastObservedDate) throw new Error('This validation export does not contain one complete calendar month.');
        const validationCodes = new Set(['NEOLEAP', 'URPAY', 'AL_MAWARID']);
        const lastImportDate = workDate.slice(0, 7) === lastObservedDate.slice(0, 7) && workDate > lastObservedDate ? workDate : lastObservedDate;
        const importDates = dateRange(firstImportDate, lastImportDate);
        const importWorkspace = await onLoadRange(firstImportDate, lastImportDate);
        if (!importWorkspace) throw new Error('Mailroom productivity is not initialized for this organization.');
        const importResults = importDates.map(date => aggregateAymakanSnapshot(groupSnapshot, activeClients, date, firstImportDate));
        const importJntTotal = importResults.reduce((sum, day) => sum + day.clients.reduce((daySum, client) => daySum + (validationCodes.has(client.client_code) ? client.jnt_units : 0), 0), 0);
        if (importJntTotal > 0 && !jntPartner) throw new Error('Add an active JNT DSP partner in Setup before importing this monthly export.');

        const importInputs = importDates.map((date, index) => {
          const dayResult = importResults[index];
          const validationByClient = new Map(dayResult.clients.filter(client => validationCodes.has(client.client_code)).map(client => [client.client_id, client]));
          const entry = importWorkspace.dailyEntries.find(item => item.work_date === date);
          const existingNote = entry?.notes?.trim() ?? '';
          const auditNote = `Aymakan validation monthly import ${date.slice(0, 7)}`;
          const returnsByClient = aggregateAymakanReturnsByClient(groupSnapshot, activeClients, date);
          const turnaroundMetrics = aggregateAymakanTurnaroundMetrics(groupSnapshot, activeClients, date);
          const importedClientIds = new Set(validationByClient.keys());
          const clients = activeClients.map(client => {
            const imported = validationByClient.get(client.id);
            const pendingReceivingDay = pendingImportDays.receiving?.find(item => item.workDate === date);
            const pendingReceivingClient = pendingReceivingDay?.clients.find(item => item.client_id === client.id);
            const existing = importWorkspace.shipments.find(item => item.client_id === client.id && item.work_date === date);
            return imported
              ? {
                  client_id: client.id,
                  received_units: imported.received_units,
                  processed_units: imported.processed_units,
                  backlog_released_units: imported.backlog_released_units,
                  batch_closed_units: imported.batch_closed_units,
                  return_units: imported.return_units ?? returnsByClient.get(client.id) ?? 0,
                }
              : {
                  client_id: client.id,
                  received_units: pendingReceivingClient?.received_units ?? existing?.received_units ?? 0,
                  processed_units: pendingReceivingClient?.processed_units ?? existing?.processed_units ?? 0,
                  backlog_released_units: pendingReceivingClient?.backlog_released_units ?? existing?.backlog_released_units ?? existing?.processed_units ?? 0,
                  batch_closed_units: pendingReceivingClient?.batch_closed_units ?? existing?.batch_closed_units ?? 0,
                  return_units: pendingReceivingClient?.return_units ?? existing?.returns_received ?? 0,
                };
          });
          const totalReturns = clients.reduce((sum, client) => sum + (client.return_units ?? 0), 0);
          return {
            workDate: date,
            status: entry?.status ?? 'draft',
            clients,
            returnsReceived: totalReturns,
            returnsProcessed: totalReturns,
            dspAllocations: activeClients.flatMap(client => activePartners.map(partner => {
              const imported = validationByClient.get(client.id);
              const pendingReceivingDay = pendingImportDays.receiving?.find(item => item.workDate === date);
              const pendingDsp = pendingReceivingDay?.dspAllocations.find(item => item.client_id === client.id && item.partner_id === partner.id);
              const existing = entry ? importWorkspace.dspAllocations.find(item => item.daily_entry_id === entry.id && item.client_id === client.id && item.partner_id === partner.id) : undefined;
              return {
                client_id: client.id,
                partner_id: partner.id,
                allocated_units: imported
                  ? (partner.id === jntPartner?.id ? imported.jnt_units : 0)
                  : (pendingDsp?.allocated_units ?? existing?.allocated_units ?? 0),
              };
            })),
            notes: existingNote.includes(auditNote) ? existingNote : `${existingNote ? `${existingNote}\n` : ''}${auditNote}`,
            turnaroundMetrics: [
              ...[...importedClientIds].map(client_id => ({ client_id, warehouse_code: '__RESET__', total_minutes: 0, shipment_count: 0 })),
              ...turnaroundMetrics,
            ],
          };
        });
        stagedDays = importInputs;
      } else {
        const receivingDates = getAymakanReceivingDates(groupSnapshot, 'receiving');
        const firstReceivingDate = receivingDates[0];
        const lastReceivingDate = receivingDates.at(-1);
        if (!firstReceivingDate || !lastReceivingDate) throw new Error('This Barq/ELM export has no Receiving dates.');
        const importWorkspace = await onLoadRange(firstReceivingDate, lastReceivingDate);
        if (!importWorkspace) throw new Error('Mailroom productivity is not initialized for this organization.');
        const receivingCodes = new Set(['BARQ', 'ELM']);
        const receivingResults = receivingDates.map(date => aggregateAymakanSnapshot(groupSnapshot, activeClients, date));
        const receivingJntTotal = receivingResults.reduce((sum, day) => sum + day.clients.reduce((daySum, client) => daySum + (receivingCodes.has(client.client_code) ? client.jnt_units : 0), 0), 0);
        if (receivingJntTotal > 0 && !jntPartner) throw new Error('Add an active JNT DSP partner in Setup before importing this Barq/ELM export.');

        stagedDays = receivingDates.map((date, index) => {
          const receivingByClient = new Map(receivingResults[index].clients.filter(client => receivingCodes.has(client.client_code)).map(client => [client.client_id, client]));
          const entry = importWorkspace.dailyEntries.find(item => item.work_date === date);
          const existingNote = entry?.notes?.trim() ?? '';
          const auditNote = `Aymakan Barq/ELM receiving import ${date}`;
          const turnaroundMetrics = aggregateAymakanTurnaroundMetrics(groupSnapshot, activeClients, date);
          const returnsByClient = aggregateAymakanReturnsByClient(groupSnapshot, activeClients, date);
          const importedClientIds = new Set(receivingByClient.keys());
          const clients = activeClients.map(client => {
            const imported = receivingByClient.get(client.id);
            const pendingValidationDay = pendingImportDays.validation?.find(item => item.workDate === date);
            const pendingValidationClient = pendingValidationDay?.clients.find(item => item.client_id === client.id);
            const existing = importWorkspace.shipments.find(item => item.client_id === client.id && item.work_date === date);
            return imported
              ? {
                  client_id: client.id,
                  received_units: imported.received_units,
                  processed_units: imported.processed_units,
                  backlog_released_units: imported.backlog_released_units,
                  batch_closed_units: imported.batch_closed_units,
                  return_units: imported.return_units ?? returnsByClient.get(client.id) ?? 0,
                }
              : {
                  client_id: client.id,
                  received_units: pendingValidationClient?.received_units ?? existing?.received_units ?? 0,
                  processed_units: pendingValidationClient?.processed_units ?? existing?.processed_units ?? 0,
                  backlog_released_units: pendingValidationClient?.backlog_released_units ?? existing?.backlog_released_units ?? existing?.processed_units ?? 0,
                  batch_closed_units: pendingValidationClient?.batch_closed_units ?? existing?.batch_closed_units ?? 0,
                  return_units: pendingValidationClient?.return_units ?? existing?.returns_received ?? 0,
                };
          });
          const totalReturns = clients.reduce((sum, client) => sum + (client.return_units ?? 0), 0);
          return {
            workDate: date,
            status: entry?.status ?? 'draft',
            clients,
            returnsReceived: totalReturns,
            returnsProcessed: totalReturns,
            dspAllocations: activeClients.flatMap(client => activePartners.map(partner => {
              const imported = receivingByClient.get(client.id);
              const pendingValidationDay = pendingImportDays.validation?.find(item => item.workDate === date);
              const pendingDsp = pendingValidationDay?.dspAllocations.find(item => item.client_id === client.id && item.partner_id === partner.id);
              const existing = entry ? importWorkspace.dspAllocations.find(item => item.daily_entry_id === entry.id && item.client_id === client.id && item.partner_id === partner.id) : undefined;
              return {
                client_id: client.id,
                partner_id: partner.id,
                allocated_units: imported
                  ? (partner.id === jntPartner?.id ? imported.jnt_units : 0)
                  : (pendingDsp?.allocated_units ?? existing?.allocated_units ?? 0),
              };
            })),
            notes: existingNote.includes(auditNote) ? existingNote : `${existingNote ? `${existingNote}\n` : ''}${auditNote}`,
            turnaroundMetrics: [
              ...[...importedClientIds].map(client_id => ({ client_id, warehouse_code: '__RESET__', total_minutes: 0, shipment_count: 0 })),
              ...turnaroundMetrics,
            ],
          };
        });
      }
      const jntTotal = scopedResult.clients.reduce((sum, client) => sum + client.jnt_units, 0);
      if (jntTotal > 0 && !jntPartner) throw new Error('Add an active JNT DSP partner in Setup before importing this snapshot.');

      setPendingImportDays(current => ({ ...current, [group]: stagedDays }));

      const returnsByClientForWorkDate = aggregateAymakanReturnsByClient(groupSnapshot, activeClients, workDate);
      setClientValues(current => {
        const next = { ...current };
        scopedResult.clients.forEach(client => {
          const previous = current[client.client_id];
          next[client.client_id] = {
            client_id: client.client_id,
            received_units: client.received_units,
            processed_units: client.processed_units,
            backlog_released_units: client.backlog_released_units,
            batch_closed_units: client.batch_closed_units,
            return_units: client.return_units ?? returnsByClientForWorkDate.get(client.client_id) ?? previous?.return_units ?? 0,
          };
        });
        return next;
      });
      setDspValues(current => {
        const next = { ...current };
        scopedResult.clients.forEach(client => activePartners.forEach(partner => { next[dspCellKey(client.client_id, partner.id)] = 0; }));
        if (jntPartner) scopedResult.clients.forEach(client => { next[dspCellKey(client.client_id, jntPartner.id)] = client.jnt_units; });
        return next;
      });
      const groupLabel = group === 'receiving' ? 'Barq/ELM receiving-date' : 'Urpay/Neoleap/Al Mawarid monthly validation';
      setNotes(current => `${current ? `${current}\n` : ''}Aymakan ${groupLabel} import ${scopedResult.workDate}: ${scopedResult.uniqueShipments} relevant shipments; ${scopedResult.duplicateShipments} duplicate rows excluded.`);
      setImportSummaries(current => ({ ...current, [group]: scopedResult }));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Unable to import the Aymakan shipping export.');
    }
  };
  const saveImportedData = async () => {
    setImportError(null);
    try {
      const mergedByDate = new Map<string, MailroomDailyInput>();
      (['validation', 'receiving'] as AymakanImportGroup[]).forEach(group => {
        const groupClientIds = new Set(activeClients
          .filter(client => getAymakanImportGroup(client.code) === group || getAymakanImportGroup(client.name) === group)
          .map(client => client.id));
        (pendingImportDays[group] ?? []).forEach(day => {
          const current = mergedByDate.get(day.workDate);
          if (!current) {
            const dayReturns = day.clients.reduce((sum, client) => sum + (client.return_units ?? 0), 0);
            mergedByDate.set(day.workDate, {
              ...day,
              status: 'finalized',
              returnsReceived: dayReturns,
              returnsProcessed: dayReturns,
            });
            return;
          }
          const incomingClients = new Map(day.clients.filter(client => groupClientIds.has(client.client_id)).map(client => [client.client_id, client]));
          const incomingDsp = new Map(day.dspAllocations.filter(row => groupClientIds.has(row.client_id)).map(row => [dspCellKey(row.client_id, row.partner_id), row]));
          const incomingTurnaround = (day.turnaroundMetrics ?? []).filter(row => groupClientIds.has(row.client_id));
          const noteLines = [...new Set(`${current.notes}\n${day.notes}`.split('\n').map(line => line.trim()).filter(Boolean))];
          const mergedClients = current.clients.map(client => incomingClients.get(client.client_id) ?? client);
          const mergedReturns = mergedClients.reduce((sum, client) => sum + (client.return_units ?? 0), 0);
          mergedByDate.set(day.workDate, {
            ...current,
            status: 'finalized',
            clients: mergedClients,
            returnsReceived: mergedReturns,
            returnsProcessed: mergedReturns,
            dspAllocations: [...new Map([
              ...current.dspAllocations.map(row => [dspCellKey(row.client_id, row.partner_id), row] as const),
              ...incomingDsp.entries(),
            ]).values()],
            turnaroundMetrics: [
              ...(current.turnaroundMetrics ?? []).filter(row => !groupClientIds.has(row.client_id)),
              ...incomingTurnaround,
            ],
            notes: noteLines.join('\n'),
          });
        });
      });
      const days = [...mergedByDate.values()].sort((left, right) => left.workDate.localeCompare(right.workDate));
      if (days.length === 0) throw new Error('Upload an Aymakan export before saving.');
      if (jntPartner) {
        const importedGroupClientIds = new Set<string>();
        const expectedJnt = (['validation', 'receiving'] as AymakanImportGroup[]).reduce((total, group) => {
          const groupClientIds = new Set(activeClients
            .filter(client => getAymakanImportGroup(client.code) === group || getAymakanImportGroup(client.name) === group)
            .map(client => client.id));
          if ((pendingImportDays[group] ?? []).length > 0) groupClientIds.forEach(clientId => importedGroupClientIds.add(clientId));
          return total + (pendingImportDays[group] ?? []).reduce((dayTotal, day) => dayTotal + day.dspAllocations
            .filter(row => row.partner_id === jntPartner.id && groupClientIds.has(row.client_id))
            .reduce((sum, row) => sum + row.allocated_units, 0), 0);
        }, 0);
        const mergedJnt = days.reduce((total, day) => total + day.dspAllocations
          .filter(row => row.partner_id === jntPartner.id && importedGroupClientIds.has(row.client_id))
          .reduce((sum, row) => sum + row.allocated_units, 0), 0);
        if (mergedJnt !== expectedJnt) throw new Error(`J&T allocation merge failed: expected ${expectedJnt.toLocaleString()}, prepared ${mergedJnt.toLocaleString()}.`);
      }
      await onSaveMonths(groupAymakanImportDaysByMonth(days));
      setPendingImportDays({});
      setImportSummaries({});
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Unable to save the imported Aymakan data.');
    }
  };
  const submit = (status: MailroomDailyEntryStatus) => onSave({
    workDate,
    status,
    clients: clientRows,
    returnsReceived,
    returnsProcessed,
    dspAllocations: activeClients.flatMap(client => activePartners.map(partner => ({ client_id: client.id, partner_id: partner.id, allocated_units: dspValues[dspCellKey(client.id, partner.id)] ?? 0 }))),
    notes,
  });
  const cannotFinalize = invalidClients.length > 0 || invalidReturns || overAllocatedDspClients.length > 0;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-semibold text-white">Daily Mailroom entry</div><div className="text-xs mt-1" style={{ color: '#64748b' }}>Upload daily or overall exports, then save and finalize every imported date with one click.</div></div><div className="flex flex-wrap gap-2"><input aria-label="Mailroom entry date" type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} className="px-3 py-2 rounded-lg text-xs" style={fieldStyle} /><label title="Daily or overall Receiving Date export: Barq, ELM and Elm - Express" className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs cursor-pointer" style={{ ...fieldStyle, color: '#93c5fd', opacity: saving ? 0.5 : 1 }}><Upload size={13} />Import Barq / ELM<input type="file" multiple accept="text/csv,.csv,application/json,.json" disabled={saving} className="hidden" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length > 0) void importAymakanSnapshot(files, 'receiving'); }} /></label><label title="Full export: stages Urpay, Neoleap and Al Mawarid for one-click finalization" className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs cursor-pointer" style={{ ...fieldStyle, color: '#c4b5fd', opacity: saving ? 0.5 : 1 }}><Upload size={13} />Import Validation Clients<input type="file" multiple accept="text/csv,.csv,application/json,.json" disabled={saving} className="hidden" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length > 0) void importAymakanSnapshot(files, 'validation'); }} /></label><button type="button" onClick={copyPreviousDay} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ ...fieldStyle, color: '#94a3b8' }}><Copy size={13} />Copy previous day</button></div></div>
    <div className="grid grid-cols-7 gap-1">{weekDates.map(date => { const status = workspace.dailyEntries.find(entry => entry.work_date === date)?.status ?? 'missing'; return <button key={date} type="button" onClick={() => setWorkDate(date)} className="p-2 rounded-lg text-center" style={{ background: date === workDate ? '#1d4ed8' : '#0d1b2e', border: '1px solid #1e3a5a' }}><div className="text-[10px]" style={{ color: date === workDate ? '#fff' : '#64748b' }}>{shortDay(date)}</div><div className="text-[9px] mt-1 uppercase" style={{ color: status === 'finalized' ? '#10b981' : status === 'draft' ? '#f59e0b' : '#475569' }}>{status}</div></button>; })}</div>
    {importError && <div className="flex items-center gap-2 p-3 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#fca5a5' }}><AlertCircle size={13} />{importError}</div>}
    {importSummary && <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(37,99,235,.08)', border: '1px solid rgba(37,99,235,.25)', color: '#bfdbfe' }}><div className="font-semibold">Aymakan preview loaded — review before saving</div><div className="mt-1">{importSummary.uniqueShipments.toLocaleString()} shipments received or validated on {importSummary.workDate} · {importSummary.duplicateShipments.toLocaleString()} duplicates excluded · {importSummary.ignoredShipments.toLocaleString()} unmatched rows ignored</div><div className="flex flex-wrap gap-2 mt-2">{importSummary.clients.map(client => <span key={client.client_id} className="px-2 py-1 rounded font-mono" style={{ background: '#122338' }}>{client.client_name}: {client.received_units} received / {client.processed_units} processed / {client.return_units} returns / {client.jnt_units} JNT</span>)}</div>{importSummary.unmatchedCustomers.length > 0 && <div className="mt-2" style={{ color: '#fbbf24' }}>Unmatched customers: {importSummary.unmatchedCustomers.join(', ')}</div>}</div>}
    {pendingImportDayCount > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg p-3" style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.25)' }}><div><div className="text-sm font-semibold" style={{ color: '#6ee7b7' }}>{pendingImportDayCount} imported date{pendingImportDayCount === 1 ? '' : 's'} ready</div><div className="text-xs mt-1" style={{ color: '#94a3b8' }}>One click will save, finalize, and update all staged dates.</div></div><button type="button" disabled={saving} onClick={() => void saveImportedData()} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ background: '#059669', color: '#fff' }}><Save size={14} />{saving ? 'Saving imported data…' : 'Save & finalize imported data'}</button></div>}

    <div className="grid xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 rounded-xl overflow-hidden" style={panelStyle}><div className="px-4 py-3 flex justify-between"><div className="font-semibold text-sm text-white">Client shipment flow</div>{existingEntry && <span className="text-[10px] uppercase font-bold" style={{ color: existingEntry.status === 'finalized' ? '#10b981' : '#f59e0b' }}>{existingEntry.status}</span>}</div><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr style={{ background: '#122338', color: '#64748b' }}>{['Client', 'Opening / previous backlog', 'Received', 'Available', 'Processed / handover', 'Ending backlog'].map(header => <th key={header} className="text-right first:text-left px-3 py-2">{header}</th>)}</tr></thead><tbody>{activeClients.map(client => { const row = clientValues[client.id] ?? { client_id: client.id, received_units: 0, processed_units: 0 }; const opening = historicalClientBacklog(client.id); const available = opening + row.received_units; const backlogReduction = (row.backlog_released_units ?? row.processed_units) + (row.batch_closed_units ?? 0); const ending = available - backlogReduction; return <tr key={client.id} className="border-t" style={{ borderColor: '#1e3a5a' }}><td className="px-3 py-3 text-white font-medium">{client.name}</td><td className="px-3 py-3 text-right font-mono">{number(opening)}</td><td className="px-3 py-2 text-right"><input aria-label={`${client.name} received ${workDate}`} type="number" min="0" value={row.received_units} onChange={event => setClientNumber(client.id, 'received_units', event.target.value)} className="w-24 px-2 py-2 rounded text-right font-mono" style={fieldStyle} /></td><td className="px-3 py-3 text-right font-mono" style={{ color: '#93c5fd' }}>{number(available)}</td><td className="px-3 py-2 text-right"><input aria-label={`${client.name} processed ${workDate}`} type="number" min="0" value={row.processed_units} onChange={event => setClientNumber(client.id, 'processed_units', event.target.value)} className="w-24 px-2 py-2 rounded text-right font-mono" style={{ ...fieldStyle, borderColor: ending < 0 ? '#ef4444' : '#1e3a5a' }} /></td><td className="px-3 py-3 text-right font-mono" style={{ color: ending < 0 ? '#ef4444' : ending > 0 ? '#f59e0b' : '#10b981' }}>{number(ending)}</td></tr>; })}</tbody></table></div></div>
      <div className="space-y-4">
        <div className="rounded-xl overflow-hidden" style={panelStyle}><div className="px-4 py-3"><div className="font-semibold text-sm text-white">Client-wise returns</div><div className="text-xs mt-1" style={{ color: '#64748b' }}>MR-On hold by Updated At. Received and processed are recorded equally for each client.</div></div><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr style={{ background: '#122338', color: '#64748b' }}><th className="text-left px-3 py-2">Client</th><th className="text-right px-3 py-2">Returns received</th><th className="text-right px-3 py-2">Returns processed</th></tr></thead><tbody>{activeClients.map(client => { const value = clientValues[client.id]?.return_units ?? 0; return <tr key={client.id} className="border-t" style={{ borderColor: '#1e3a5a' }}><td className="px-3 py-2 text-white font-medium">{client.name}</td><td className="px-3 py-2 text-right"><input aria-label={`${client.name} returns received`} type="number" min="0" value={value} onChange={event => setClientReturn(client.id, event.target.value)} className="w-24 px-2 py-1 rounded text-right font-mono" style={fieldStyle} /></td><td className="px-3 py-2 text-right font-mono" style={{ color: '#10b981' }}>{number(value)}</td></tr>; })}</tbody><tfoot><tr className="border-t" style={{ borderColor: '#3b82f6' }}><td className="px-3 py-2 text-white font-semibold">Total</td><td className="px-3 py-2 text-right font-mono font-semibold text-white">{number(returnsReceived)}</td><td className="px-3 py-2 text-right font-mono font-semibold text-white">{number(returnsProcessed)}</td></tr></tfoot></table></div><div className="px-4 py-3 text-xs border-t" style={{ borderColor: '#1e3a5a', color: '#64748b' }}>Available return backlog: <span className="font-mono text-white">{number(historicalReturnsBacklog + returnsReceived)}</span></div></div>
        <div className="rounded-xl p-4" style={panelStyle}><div className="font-semibold text-sm text-white mb-3">Daily control totals</div><div className="space-y-2">{[['Received', clientRows.reduce((sum, row) => sum + row.received_units, 0)], ['Processed', processedTotal], ['JNT / DSP allocated', dspTotal], ['Non-DSP processed', dspRemaining]].map(([label, value]) => <div key={String(label)} className="flex justify-between p-2 rounded text-xs" style={{ background: '#122338', color: '#94a3b8' }}><span>{label}</span><strong className="font-mono text-white">{number(Number(value))}</strong></div>)}</div>{overAllocatedDspClients.length > 0 && <div className="text-xs mt-3" style={{ color: '#ef4444' }}>DSP allocation cannot exceed processed volume.</div>}</div>
      </div>
    </div>

    <div className="rounded-xl overflow-hidden" style={panelStyle}><div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2"><div><div className="font-semibold text-sm text-white">DSP partner allocation — client-wise</div><div className="text-xs mt-1" style={{ color: '#64748b' }}>Only shipments assigned to a 3PL provider belong here. Aymakan imports JNT volume only.</div></div><span className="text-xs font-mono" style={{ color: overAllocatedDspClients.length === 0 ? '#10b981' : '#ef4444' }}>{overAllocatedDspClients.length === 0 ? 'Allocations within processed totals' : `${overAllocatedDspClients.length} over-allocated client${overAllocatedDspClients.length === 1 ? '' : 's'}`}</span></div>{activePartners.length === 0 ? <div className="px-4 pb-4 text-xs" style={{ color: '#64748b' }}>No active DSP partner. Non-DSP processed volume can still be finalized.</div> : <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr style={{ background: '#122338', color: '#64748b' }}><th className="text-left px-3 py-2">Client</th><th className="text-right px-3 py-2">Processed</th>{activePartners.map(partner => <th key={partner.id} className="text-right px-3 py-2 min-w-28">{partner.name}</th>)}<th className="text-right px-3 py-2">Allocated</th><th className="text-right px-3 py-2">Non-DSP</th></tr></thead><tbody>{activeClients.map(client => { const processed = clientValues[client.id]?.processed_units ?? 0; const allocated = clientDspTotals[client.id] ?? 0; const remaining = processed - allocated; return <tr key={client.id} className="border-t" style={{ borderColor: '#1e3a5a' }}><td className="px-3 py-3 text-white font-medium">{client.name}</td><td className="px-3 py-3 text-right font-mono">{number(processed)}</td>{activePartners.map(partner => { const key = dspCellKey(client.id, partner.id); return <td key={partner.id} className="px-3 py-2 text-right"><input aria-label={`${client.name} to ${partner.name}`} type="number" min="0" value={dspValues[key] ?? 0} onChange={event => setDspValues(current => ({ ...current, [key]: Math.max(0, Math.floor(Number(event.target.value) || 0)) }))} className="w-24 px-2 py-2 rounded text-right font-mono" style={fieldStyle} /></td>; })}<td className="px-3 py-3 text-right font-mono text-white">{number(allocated)}</td><td className="px-3 py-3 text-right font-mono" style={{ color: remaining < 0 ? '#ef4444' : '#94a3b8' }}>{number(remaining)}</td></tr>; })}</tbody></table></div>}</div>

    {(invalidClients.length > 0 || invalidReturns) && <div className="p-3 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#fca5a5' }}>{invalidClients.length > 0 ? `Processed volume exceeds available backlog for ${invalidClients.map(client => client.name).join(', ')}.` : 'Returns processed exceeds the available return backlog.'}</div>}
    {overAllocatedDspClients.length > 0 && activePartners.length > 0 && <div className="p-3 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#fca5a5' }}>Reduce DSP allocation for: {overAllocatedDspClients.map(client => client.name).join(', ')}. Allocation cannot exceed processed volume.</div>}

    <div className="rounded-xl overflow-hidden" style={panelStyle}><div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2"><div><div className="font-semibold text-sm text-white">Live staffing impact</div><div className="text-xs" style={{ color: '#64748b' }}>Calculated before saving from the values above.</div></div><div className="flex flex-wrap gap-4 text-right"><div><div className="text-[10px]" style={{ color: '#64748b' }}>HOURS NEEDED</div><div className="font-mono font-bold text-white">{number(preview.requiredHours, 1)}h</div></div><div><div className="text-[10px]" style={{ color: '#64748b' }}>EMPLOYEES</div><div className="font-mono font-bold" style={{ color: '#f59e0b' }}>{number(preview.requiredEmployees, 1)}</div></div><div><div className="text-[10px]" style={{ color: '#64748b' }}>OT REQUIRED</div><div className="font-mono font-bold" style={{ color: '#8b5cf6' }}>{number(preview.overtimeHours, 1)}h</div><div className="text-[10px] font-mono" style={{ color: '#c4b5fd' }}>SAR {number(preview.overtimeCost, 2)}</div></div><div><div className="text-[10px]" style={{ color: '#64748b' }}>OT DONE (APPROVED)</div><div className="font-mono font-bold" style={{ color: totalApprovedOtHours >= preview.overtimeHours ? '#10b981' : '#f59e0b' }}>{number(totalApprovedOtHours, 1)}h</div><div className="text-[10px] font-mono" style={{ color: '#10b981' }}>SAR {number(totalApprovedOtCost, 2)}</div></div><div><div className="text-[10px]" style={{ color: '#64748b' }}>APPROVED OT COST</div><div className="font-mono font-bold" style={{ color: '#f59e0b' }}>SAR {number(totalApprovedOtCost, 2)}</div><div className="text-[10px] font-mono" style={{ color: '#94a3b8' }}>{number(totalApprovedOtHours, 1)}h × rate</div></div><div><div className="text-[10px]" style={{ color: '#64748b' }}>EXTRA 3PL</div><div className="font-mono font-bold" style={{ color: preview.additionalEmployees ? '#ef4444' : '#10b981' }}>{preview.additionalEmployees}</div></div></div></div><div className="max-h-72 overflow-auto"><table className="w-full text-xs"><thead><tr style={{ background: '#122338', color: '#64748b' }}>{['Activity', 'Volume', 'Rate/hour', 'Hours', 'Employees required'].map(header => <th key={header} className="text-right first:text-left px-3 py-2">{header}</th>)}</tr></thead><tbody>{preview.activities.map(activity => <tr key={activity.id} className="border-t" style={{ borderColor: '#1e3a5a' }}><td className="px-3 py-2 text-white">{activity.name}</td><td className="px-3 py-2 text-right font-mono">{number(activity.volume)}</td><td className="px-3 py-2 text-right font-mono">{number(activity.rate)}</td><td className="px-3 py-2 text-right font-mono">{number(activity.laborHours, 1)}</td><td className="px-3 py-2 text-right font-mono" style={{ color: '#f59e0b' }}>{number(activity.averageEmployees, 1)}</td></tr>)}</tbody></table></div></div>

    <div className="rounded-xl overflow-hidden" style={panelStyle}>
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b" style={{ borderColor: '#1e3a5a' }}>
        <div>
          <div className="font-semibold text-sm text-white">Approved employee overtime — {workDate}</div>
          <div className="text-xs mt-1" style={{ color: '#64748b' }}>Overtime hours and calculated cost (Hours × OT Rate/h) for the Mailroom workforce.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="px-3 py-1.5 rounded-lg" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
            <span style={{ color: '#94a3b8' }}>OT Required: </span>
            <strong className="font-mono text-white">{number(preview.overtimeHours, 1)}h</strong>
            <span className="text-[10px] font-mono ml-1" style={{ color: '#c4b5fd' }}>(SAR {number(preview.overtimeCost, 2)})</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
            <span style={{ color: '#94a3b8' }}>OT Done (Approved): </span>
            <strong className="font-mono" style={{ color: '#10b981' }}>{number(totalApprovedOtHours, 1)}h</strong>
          </div>
          <div className="px-3 py-1.5 rounded-lg" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
            <span style={{ color: '#94a3b8' }}>Total OT Cost: </span>
            <strong className="font-mono" style={{ color: '#f59e0b' }}>SAR {number(totalApprovedOtCost, 2)}</strong>
            <span className="text-[10px] font-mono ml-1" style={{ color: '#94a3b8' }}>({number(totalApprovedOtHours, 1)}h × rate)</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg font-mono text-[11px] font-bold" style={{
            background: otVariance >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
            color: otVariance >= 0 ? '#10b981' : '#f59e0b',
            border: `1px solid ${otVariance >= 0 ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}`,
          }}>
            {otVariance >= 0 ? `+${number(otVariance, 1)}h covered` : `${number(otVariance, 1)}h shortage`}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: '#122338', color: '#64748b' }}>
              <th className="text-left px-3 py-2">Employee</th>
              <th className="text-left px-3 py-2">Classification</th>
              <th className="text-left px-3 py-2">Shift / Schedule</th>
              <th className="text-right px-3 py-2">Worked</th>
              <th className="text-right px-3 py-2">OT Hours</th>
              <th className="text-center px-3 py-2">Status</th>
              <th className="text-right px-3 py-2">OT Rate</th>
              <th className="text-right px-3 py-2">Approved Cost</th>
            </tr>
          </thead>
          <tbody>
            {employeeOvertimeRows.length === 0 ? (
              <tr><td colSpan={8} className="p-4 text-center text-xs" style={{ color: '#64748b' }}>No employees registered in the Mailroom department.</td></tr>
            ) : (
              employeeOvertimeRows.map(row => (
                <tr key={row.id} className="border-t" style={{ borderColor: '#1e3a5a' }}>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-white">{row.name}</div>
                    <div className="text-[10px]" style={{ color: '#64748b' }}>{row.code} · {row.jobTitle}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="uppercase text-[10px] font-semibold px-2 py-0.5 rounded" style={{
                      background: row.laborClass === 'dlp' ? 'rgba(37,99,235,0.12)' : 'rgba(100,116,139,0.12)',
                      color: row.laborClass === 'dlp' ? '#93c5fd' : '#94a3b8',
                      border: `1px solid ${row.laborClass === 'dlp' ? 'rgba(37,99,235,0.25)' : 'rgba(100,116,139,0.25)'}`,
                    }}>
                      {row.laborClass.toUpperCase()} · {row.employmentSource.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-slate-300">{row.shiftName}</span>
                    {!row.overtimeEligible && <span className="ml-1.5 text-[9px] text-rose-400 font-semibold">(No OT)</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono" style={{ color: row.workedHours > 0 ? '#93c5fd' : (row.scheduleState === 'working' ? '#f59e0b' : '#64748b') }}>
                    {row.workedHours > 0 ? `${number(row.workedHours, 1)}h` : (row.scheduleState === 'working' ? '0h (Absent)' : '—')}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {row.otHours > 0 ? (
                      <span className={`font-bold ${row.status === 'approved' ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {number(row.otHours, 1)}h
                      </span>
                    ) : (
                      <span style={{ color: '#64748b' }}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {row.status === 'approved' ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{ background: 'rgba(16,185,129,0.12)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.25)' }}>Approved</span>
                    ) : row.status === 'pending' ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{ background: 'rgba(245,158,11,0.12)', color: '#fcd34d', border: '1px solid rgba(245,158,11,0.25)' }}>Recorded / Pending</span>
                    ) : row.status === 'rejected' ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{ background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.25)' }}>Rejected</span>
                    ) : (
                      <span style={{ color: '#475569' }}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono" style={{ color: '#94a3b8' }}>
                    SAR {number(row.hourlyRate, 2)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono font-medium" style={{ color: row.approvedCost > 0 ? '#f59e0b' : '#64748b' }}>
                    {row.approvedCost > 0 ? (
                      <div>
                        <div>SAR {number(row.approvedCost, 2)}</div>
                        <div className="text-[10px]" style={{ color: '#94a3b8' }}>{number(row.otHours, 1)}h × SAR {number(row.hourlyRate, 2)}</div>
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {employeeOvertimeRows.length > 0 && (
            <tfoot>
              <tr className="border-t-2" style={{ borderColor: '#3b82f6', background: '#122338' }}>
                <td colSpan={3} className="px-3 py-2.5 font-semibold text-white">Daily Workforce Overtime Totals</td>
                <td className="px-3 py-2.5 text-right font-mono font-semibold text-white">{number(totalWorkedHours, 1)}h</td>
                <td className="px-3 py-2.5 text-right font-mono font-bold" style={{ color: '#10b981' }}>{number(totalApprovedOtHours, 1)}h</td>
                <td className="px-3 py-2.5 text-center text-[10px]" style={{ color: '#94a3b8' }}>{employeeOvertimeRows.filter(r => r.approvedHours > 0).length} with approved OT</td>
                <td className="px-3 py-2.5 text-right font-mono text-slate-400">—</td>
                <td className="px-3 py-2.5 text-right font-mono font-bold" style={{ color: '#f59e0b' }}>SAR {number(totalApprovedOtCost, 2)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>

    <div className="rounded-xl p-4 flex flex-wrap items-end justify-between gap-3" style={panelStyle}><label className="flex-1 min-w-64 text-xs" style={{ color: '#94a3b8' }}>Daily notes<textarea value={notes} onChange={event => setNotes(event.target.value)} rows={2} className="mt-1 w-full px-3 py-2 rounded-lg resize-none" style={fieldStyle} /></label><div className="flex gap-2"><button type="button" onClick={() => void submit('draft')} disabled={saving || invalidClients.length > 0 || invalidReturns} className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: '#334155', color: '#fff' }}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}Save draft</button><button type="button" onClick={() => void submit('finalized')} disabled={saving || cannotFinalize} className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: '#2563eb', color: '#fff' }}><CheckCircle2 size={14} />Finalize day</button></div></div>
  </div>;
}

function SetupPanel({ workspace, refresh }: { workspace: MailroomWorkspace; refresh: () => Promise<unknown> }) {
  const [saving, setSaving] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [newClient, setNewClient] = useState({ name: '', code: '', mode: 'validation_gated' as 'immediate' | 'validation_gated', template: workspace.clients[1]?.id ?? workspace.clients[0]?.id ?? '' });
  const [newPartner, setNewPartner] = useState({ name: '', code: '' });
  const runSetupChange = async (operation: () => Promise<void>, fallback: string) => {
    setSaving(true);
    setSetupError(null);
    try { await operation(); }
    catch (error) { setSetupError(error instanceof Error ? error.message : fallback); }
    finally { setSaving(false); }
  };
  const savePolicy = async (field: string, value: number) => runSetupChange(async () => {
    const limits: Record<string, [number, number]> = {
      standard_hours_per_day: [0.25, 24],
      planned_absence_percent: [0, 99],
      max_overtime_hours_per_day: [0, 12],
      overtime_hourly_cost: [0, 10000],
      overtime_hourly_cost_own: [0, 10000],
      overtime_hourly_cost_3pl: [0, 10000],
      opening_return_backlog: [0, Number.MAX_SAFE_INTEGER],
    };
    const [minimum, maximum] = limits[field] ?? [0, Number.MAX_SAFE_INTEGER];
    const validValue = Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum;
    if (typeof window !== 'undefined') {
      if (field === 'overtime_hourly_cost_own') {
        localStorage.setItem(`mailroom_ot_rate_own_${workspace.settings.organization_id}`, String(validValue));
        workspace.settings.overtime_hourly_cost_own = validValue;
      }
      if (field === 'overtime_hourly_cost_3pl') {
        localStorage.setItem(`mailroom_ot_rate_3pl_${workspace.settings.organization_id}`, String(validValue));
        workspace.settings.overtime_hourly_cost_3pl = validValue;
      }
    }
    const updates: Record<string, number> = { [field]: validValue };
    if (field === 'overtime_hourly_cost_own') {
      updates.overtime_hourly_cost = validValue;
    }
    await productivityService.updateMailroomSettings(workspace.settings.id, updates);
    await refresh();
  }, 'Unable to update the Mailroom planning policy.');
  const createClient = async () => {
    if (!newClient.name.trim() || !newClient.code.trim() || !newClient.template) return;
    await runSetupChange(async () => {
      await productivityService.createMailroomClient({ organizationId: workspace.settings.organization_id, branchId: workspace.settings.branch_id, code: newClient.code, name: newClient.name, processingMode: newClient.mode, templateClientId: newClient.template });
      setNewClient(current => ({ ...current, name: '', code: '' }));
      await refresh();
    }, 'Unable to add the Mailroom client.');
  };
  const createPartner = async () => {
    if (!newPartner.name.trim() || !newPartner.code.trim()) return;
    await runSetupChange(async () => {
      await productivityService.createDspPartner({ organizationId: workspace.settings.organization_id, branchId: workspace.settings.branch_id, code: newPartner.code, name: newPartner.name });
      setNewPartner({ name: '', code: '' });
      await refresh();
    }, 'Unable to add the DSP partner.');
  };
  return <div className="space-y-4">
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="rounded-xl p-4" style={panelStyle}><div className="font-semibold text-sm text-white mb-3">Planning policy</div><div className="space-y-3">{[
        ['Standard productive hours/day', 'standard_hours_per_day', workspace.settings.standard_hours_per_day, 0.25, 24],
        ['Planned absence %', 'planned_absence_percent', workspace.settings.planned_absence_percent, 0, 99],
        ['Maximum OT hours/day', 'max_overtime_hours_per_day', workspace.settings.max_overtime_hours_per_day, 0, 12],
        ['Own OT rate (SAR/h)', 'overtime_hourly_cost_own', workspace.settings.overtime_hourly_cost_own || workspace.settings.overtime_hourly_cost, 0, 10000],
        ['3PL OT rate (SAR/h)', 'overtime_hourly_cost_3pl', workspace.settings.overtime_hourly_cost_3pl || workspace.settings.overtime_hourly_cost, 0, 10000],
      ].map(([label, field, value, minimum, maximum]) => <label key={String(field)} className="block text-xs" style={{ color: '#94a3b8' }}>{label}<input type="number" min={Number(minimum)} max={Number(maximum)} step="0.5" defaultValue={Number(value)} onBlur={e => void savePolicy(String(field), Number(e.target.value))} className="mt-1 w-full px-3 py-2 rounded-lg font-mono" style={fieldStyle} /></label>)}</div></div>
      <div className="lg:col-span-2 rounded-xl p-4" style={panelStyle}><div className="font-semibold text-sm text-white mb-3">Add Mailroom client or bank</div><div className="grid sm:grid-cols-2 gap-3"><input value={newClient.name} onChange={e => setNewClient({ ...newClient, name: e.target.value })} placeholder="Client name" className="px-3 py-2 rounded-lg text-sm" style={fieldStyle} /><input value={newClient.code} onChange={e => setNewClient({ ...newClient, code: e.target.value })} placeholder="Client code" className="px-3 py-2 rounded-lg text-sm" style={fieldStyle} /><select value={newClient.mode} onChange={e => setNewClient({ ...newClient, mode: e.target.value as 'immediate' | 'validation_gated' })} className="px-3 py-2 rounded-lg text-sm" style={fieldStyle}><option value="validation_gated">Validation-gated</option><option value="immediate">Immediate processing</option></select><select value={newClient.template} onChange={e => setNewClient({ ...newClient, template: e.target.value })} className="px-3 py-2 rounded-lg text-sm" style={fieldStyle}>{workspace.clients.map(client => <option key={client.id} value={client.id}>Copy {client.name} workflow</option>)}</select></div><button onClick={() => void createClient()} disabled={saving || !newClient.name || !newClient.code} className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: '#2563eb', color: '#fff' }}><Plus size={14} />Add client</button></div>
    </div>
    <div className="grid xl:grid-cols-2 gap-4">
      <div className="rounded-xl p-4" style={panelStyle}><div className="font-semibold text-sm text-white mb-3">Opening backlog</div><div className="text-xs mb-3" style={{ color: '#64748b' }}>Use these values when processing shipments received before the first day recorded in this module.</div><div className="grid sm:grid-cols-2 gap-3">{workspace.clients.filter(client => client.status === 'active').map(client => <label key={client.id} className="text-xs" style={{ color: '#94a3b8' }}>{client.name}<input type="number" min="0" defaultValue={client.opening_unprocessed_units} onBlur={event => void runSetupChange(async () => { await productivityService.updateMailroomClient(client.id, { opening_unprocessed_units: Math.max(0, Math.floor(Number(event.target.value) || 0)) }); await refresh(); }, `Unable to update ${client.name}'s opening backlog.`)} className="mt-1 w-full px-3 py-2 rounded font-mono" style={fieldStyle} /></label>)}<label className="text-xs" style={{ color: '#94a3b8' }}>Returns backlog<input type="number" min="0" defaultValue={workspace.settings.opening_return_backlog} onBlur={event => void savePolicy('opening_return_backlog', Math.max(0, Math.floor(Number(event.target.value) || 0)))} className="mt-1 w-full px-3 py-2 rounded font-mono" style={fieldStyle} /></label></div></div>
      <div className="rounded-xl p-4" style={panelStyle}><div className="font-semibold text-sm text-white mb-3">DSP partners</div><div className="grid grid-cols-2 gap-3"><input value={newPartner.name} onChange={event => setNewPartner(current => ({ ...current, name: event.target.value }))} placeholder="Partner name" className="px-3 py-2 rounded-lg text-sm" style={fieldStyle} /><input value={newPartner.code} onChange={event => setNewPartner(current => ({ ...current, code: event.target.value }))} placeholder="Partner code" className="px-3 py-2 rounded-lg text-sm" style={fieldStyle} /></div><button type="button" onClick={() => void createPartner()} disabled={saving || !newPartner.name.trim() || !newPartner.code.trim()} className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: '#2563eb', color: '#fff' }}><Plus size={14} />Add DSP partner</button><div className="mt-4 space-y-2">{workspace.dspPartners.map(partner => <div key={partner.id} className="flex items-center justify-between p-2 rounded-lg" style={{ background: '#122338' }}><div><div className="text-xs text-white">{partner.name}</div><div className="text-[10px]" style={{ color: '#64748b' }}>{partner.code}</div></div><button type="button" disabled={saving} onClick={() => void runSetupChange(async () => { await productivityService.updateDspPartner(partner.id, { status: partner.status === 'active' ? 'inactive' : 'active' }); await refresh(); }, `Unable to update ${partner.name}.`)} className="text-[10px] uppercase font-semibold disabled:opacity-40" style={{ color: partner.status === 'active' ? '#10b981' : '#64748b' }}>{partner.status}</button></div>)}</div></div>
    </div>
    <div className="rounded-xl overflow-hidden" style={panelStyle}><div className="px-4 py-3 font-semibold text-sm text-white">Activity productivity rates</div><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr style={{ background: '#122338', color: '#64748b' }}><th className="text-left px-3 py-2">Activity</th><th className="text-right px-3 py-2">Shipments / labor-hour</th><th className="text-center px-3 py-2">Status</th></tr></thead><tbody>{workspace.activities.map(activity => <tr key={activity.id} className="border-t" style={{ borderColor: '#1e3a5a' }}><td className="px-3 py-2 text-white">{activity.name}</td><td className="px-3 py-2 text-right"><input type="number" min="0.01" defaultValue={activity.units_per_labor_hour} onBlur={event => void runSetupChange(async () => { const rate = Number(event.target.value); if (!Number.isFinite(rate) || rate <= 0) throw new Error('Productivity rate must be greater than zero.'); await productivityService.updateMailroomActivity(activity.id, { units_per_labor_hour: rate }); await refresh(); }, `Unable to update ${activity.name}.`)} className="w-28 px-2 py-1 rounded text-right font-mono" style={fieldStyle} /></td><td className="px-3 py-2 text-center" style={{ color: activity.status === 'active' ? '#10b981' : '#64748b' }}>{activity.status}</td></tr>)}</tbody></table></div></div>
    <div className="rounded-xl overflow-hidden" style={panelStyle}><div className="px-4 py-3 font-semibold text-sm text-white">Mailroom labor classification & OT rates</div><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr style={{ background: '#122338', color: '#64748b' }}>{['Employee', 'Job title', 'Labor class', 'Source', 'OT eligible', 'OT rate (SAR/h)'].map(h => <th key={h} className="text-left px-3 py-2">{h}</th>)}</tr></thead><tbody>{workspace.employees.map(employee => { const setting = workspace.employeeSettings.find(item => item.employee_id === employee.id); if (!setting) return <tr key={employee.id}><td className="px-3 py-2 text-white">{employee.full_name}</td><td colSpan={5} className="px-3 py-2" style={{ color: '#f59e0b' }}>Re-run initialization to classify this employee.</td></tr>; const defaultRate = setting.employment_source === '3pl' ? (workspace.settings.overtime_hourly_cost_3pl || workspace.settings.overtime_hourly_cost) : (workspace.settings.overtime_hourly_cost_own || workspace.settings.overtime_hourly_cost); const update = async (changes: Record<string, unknown>) => runSetupChange(async () => { if ('overtime_hourly_cost' in changes && typeof window !== 'undefined') { localStorage.setItem(`mailroom_emp_ot_${setting.id}`, String(changes.overtime_hourly_cost ?? '')); setting.overtime_hourly_cost = changes.overtime_hourly_cost as number | null; } await productivityService.updateMailroomEmployee(setting.id, changes); await refresh(); }, `Unable to update ${employee.full_name}'s labor classification.`); return <tr key={employee.id} className="border-t" style={{ borderColor: '#1e3a5a' }}><td className="px-3 py-2 text-white">{employee.full_name}<div style={{ color: '#64748b' }}>{employee.employee_code}</div></td><td className="px-3 py-2" style={{ color: '#94a3b8' }}>{employee.job_title ?? '—'}</td><td className="px-3 py-2"><select disabled={saving} value={setting.labor_class} onChange={e => void update({ labor_class: e.target.value })} style={fieldStyle} className="px-2 py-1 rounded disabled:opacity-40"><option value="dlp">DLP</option><option value="non_dlp">Non-DLP</option></select></td><td className="px-3 py-2"><select disabled={saving} value={setting.employment_source} onChange={e => void update({ employment_source: e.target.value })} style={fieldStyle} className="px-2 py-1 rounded disabled:opacity-40"><option value="own">Own</option><option value="3pl">3PL</option></select></td><td className="px-3 py-2"><input disabled={saving} type="checkbox" checked={setting.overtime_eligible} onChange={e => void update({ overtime_eligible: e.target.checked })} /></td><td className="px-3 py-2"><input disabled={saving} type="number" min="0" step="1" placeholder={`Default (${defaultRate})`} defaultValue={setting.overtime_hourly_cost ?? ''} onBlur={e => void update({ overtime_hourly_cost: e.target.value.trim() === '' ? null : Math.max(0, Number(e.target.value) || 0) })} style={fieldStyle} className="w-28 px-2 py-1 rounded text-right font-mono disabled:opacity-40" /></td></tr>; })}</tbody></table></div></div>
    {setupError && <div className="flex items-center gap-2 p-3 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#fca5a5' }}><AlertCircle size={13} />{setupError}</div>}
    {saving && <div className="text-xs flex items-center gap-2" style={{ color: '#93c5fd' }}><Loader2 size={12} className="animate-spin" />Saving setup changes…</div>}
  </div>;
}

export default function Productivity() {
  const { activeMembership } = useAuth();
  const organizationId = activeMembership?.organization_id ?? '';
  const isAdmin = activeMembership?.role_code === 'administrator';
  const today = riyadhToday();
  const [tab, setTab] = useState<ModuleTab>('dashboard');
  const [period, setPeriod] = useState<DashboardPeriod>('week');
  const [dashboardDay, setDashboardDay] = useState(today);
  const [weekStart, setWeekStart] = useState(startOfSundayWeek(today));
  const [month, setMonth] = useState(today.slice(0, 7));
  const [entryDate, setEntryDate] = useState(today);
  const [workspace, setWorkspace] = useState<MailroomWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fromDate = period === 'day' ? dashboardDay : period === 'week' ? weekStart : `${month}-01`;
  const toDate = period === 'day' ? dashboardDay : period === 'week' ? addDays(weekStart, 6) : monthEnd(month);
  const loadFrom = fromDate < entryDate ? fromDate : entryDate;
  const loadTo = toDate > entryDate ? toDate : entryDate;

  const load = async (): Promise<MailroomWorkspace | null | undefined> => {
    if (!organizationId || !isSupabaseConfigured()) { setLoading(false); return undefined; }
    setLoading(true); setError(null);
    try {
      const nextWorkspace = await productivityService.loadMailroomWorkspace(organizationId, loadFrom, loadTo);
      setWorkspace(nextWorkspace);
      return nextWorkspace;
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load Mailroom productivity.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [organizationId, loadFrom, loadTo]);
  const initialize = async () => { setSaving(true); setError(null); try { await productivityService.initializeMailroom(organizationId); setNotice('Mailroom clients, rates, workflows, and workforce defaults were initialized.'); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to initialize Mailroom productivity.'); } finally { setSaving(false); } };
  const saveDay = async (input: Parameters<typeof productivityService.saveMailroomDay>[1]) => {
    setSaving(true); setError(null); setNotice(null);
    try {
      await productivityService.saveMailroomDay(organizationId, input);
      setNotice(input.status === 'finalized' ? 'Mailroom day finalized. Weekly and monthly staffing dashboards are updated.' : 'Daily draft saved. It will remain outside official dashboard totals until finalized.');
      const refreshed = await load();
      const savedEntryIsVisible = refreshed?.dailyEntries.some(entry => entry.work_date === input.workDate && entry.status === input.status);
      if (!savedEntryIsVisible) {
        await new Promise(resolve => setTimeout(resolve, 250));
        await load();
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save the daily entry.'); }
    finally { setSaving(false); }
  };
  const saveMonths = async (batches: Array<Parameters<typeof productivityService.saveMailroomMonth>[1]>) => {
    setSaving(true); setError(null); setNotice(null);
    try {
      for (const batch of batches) await productivityService.saveMailroomMonth(organizationId, batch);
      await productivityService.saveMailroomTurnaroundMetrics(organizationId, batches.flat());
      const savedDates = batches.reduce((sum, batch) => sum + batch.length, 0);
      setNotice(`Imported Aymakan data saved and finalized for ${savedDates} dates across ${batches.length} monthly batches. Existing unrelated client, return, and DSP values were preserved.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save the validation-client monthly import.'); throw e; }
    finally { setSaving(false); }
  };

  if (loading && !workspace) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin" style={{ color: '#3b82f6' }} /></div>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h1 className="text-xl font-bold text-white">Mailroom Productivity</h1><span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: 'rgba(37,99,235,.15)', color: '#93c5fd', border: '1px solid rgba(37,99,235,.25)' }}>MAILROOM DEPARTMENT</span></div><p className="text-sm mt-0.5" style={{ color: '#4b6a8a' }}>Shipment flow, backlog, labor capacity and overtime planning</p></div>{workspace && tab === 'dashboard' && <div className="flex gap-2 items-center"><div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid #1e3a5a' }}>{(['day', 'week', 'month'] as DashboardPeriod[]).map(value => <button key={value} onClick={() => setPeriod(value)} className="px-3 py-2 text-xs capitalize" style={{ background: period === value ? '#2563eb' : '#0d1b2e', color: period === value ? '#fff' : '#64748b' }}>{value}</button>)}</div>{period === 'day' ? <input type="date" value={dashboardDay} onChange={e => setDashboardDay(e.target.value)} className="px-3 py-2 rounded-lg text-xs" style={fieldStyle} /> : period === 'week' ? <input type="date" value={weekStart} onChange={e => setWeekStart(startOfSundayWeek(e.target.value))} className="px-3 py-2 rounded-lg text-xs" style={fieldStyle} /> : <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="px-3 py-2 rounded-lg text-xs" style={fieldStyle} />}</div>}</div>
    {error && <div className="flex items-center gap-2 p-3 rounded-lg text-sm" style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)', color: '#fca5a5' }}><AlertCircle size={14} />{error}</div>}
    {notice && <div className="p-3 rounded-lg text-sm" style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.2)', color: '#6ee7b7' }}>{notice}</div>}
    {!workspace ? <div className="rounded-xl p-8 text-center" style={panelStyle}><PackageCheck size={34} className="mx-auto mb-3" style={{ color: '#3b82f6' }} /><div className="text-white font-semibold">Mailroom productivity is not initialized</div><div className="text-sm mt-1" style={{ color: '#64748b' }}>{isAdmin ? 'Load the approved clients, hourly rates, workflows and Mailroom workforce defaults.' : 'An administrator must initialize the Mailroom productivity setup.'}</div>{isAdmin && <button onClick={() => void initialize()} disabled={saving} className="mt-4 px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: '#2563eb', color: '#fff' }}>{saving ? 'Initializing…' : 'Initialize Mailroom module'}</button>}</div> : <>
      <div className="flex gap-2 overflow-x-auto pb-1">{[
        ['dashboard', 'Operations Dashboard', <TrendingUp size={14} />], ['entry', 'Daily Entry', <ClipboardList size={14} />], ['employee', 'Employee Performance', <Users size={14} />], ...(isAdmin ? [['setup', 'Setup', <Settings size={14} />] as const] : []),
      ].map(([id, label, icon]) => <button key={String(id)} onClick={() => setTab(id as ModuleTab)} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap" style={{ background: tab === id ? '#2563eb' : '#0d1b2e', color: tab === id ? '#fff' : '#64748b', border: `1px solid ${tab === id ? '#2563eb' : '#1e3a5a'}` }}>{icon}{label}</button>)}</div>
      {tab === 'dashboard' && <OperationsDashboard workspace={workspace} fromDate={fromDate} toDate={toDate} today={today} />}
      {tab === 'entry' && <DailyEntry workspace={workspace} today={today} workDate={entryDate} setWorkDate={setEntryDate} saving={saving} onSave={saveDay} onSaveMonths={saveMonths} onLoadRange={(from, to) => productivityService.loadMailroomWorkspace(organizationId, from, to)} />}
      {tab === 'employee' && <EmployeeProductivity />}
      {tab === 'setup' && isAdmin && <SetupPanel workspace={workspace} refresh={load} />}
    </>}
  </div>;
}
