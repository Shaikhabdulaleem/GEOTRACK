import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeftRight, Calculator, CheckCircle2, Copy, Download, FileSpreadsheet, Info, Loader2, Save, Upload, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { parseFcOrdersFile, type FcImportPreview } from '../../lib/fc-orders-import';
import { parseFcOperationalFiles, type FcOperationalImportPreview } from '../../lib/fc-operational-import';
import { fcProductivityService, type FcAdhocTaskInput, type FcCapacityMetricInput, type FcSellerSupplementInput, type FcWorkspace } from '../../services/fc-productivity.service';
import { buildFcDashboard, buildFcDayPreview, buildFcManpowerDashboard, type FcChannelFilter } from '../../lib/fc-productivity-model';
import { getEffectiveApprovedOvertimeMinutes, getOffDayOvertimeHours } from '../../lib/employee-status';
import type { FcDailyManpowerProductivityRow } from '../../types/database';
import FcCalculatorCard from './FcCalculatorCard';
import FcSetupPanel from './FcSetupPanel';

type FcTab = 'dashboard' | 'calculator' | 'entry' | 'activity' | 'setup';
type FcPeriod = 'day' | 'week' | 'month';
const panel = { background: '#0d1b2e', border: '1px solid #1e3a5a' };
const field = { background: '#081424', border: '1px solid #1e3a5a', color: '#f0f6ff' };

function addDays(value: string, days: number) { const [y, m, d] = value.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10); }
function sunday(value: string) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - date.getUTCDay()); return date.toISOString().slice(0, 10); }
function monthStart(value: string) { return `${value.slice(0, 7)}-01`; }
function monthEnd(value: string) { const [year, month] = value.split('-').map(Number); return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10); }
function shortDay(value: string) { return new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
function n(value: number, digits = 0) { return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }); }
function pct(value: number, denominator: number) { return denominator > 0 ? `${n((value / denominator) * 100, 1)}%` : 'n.a.'; }
function duration(minutes: number | null) { return minutes == null ? 'n.a.' : `${n(minutes / 60, 2)} h`; }

function Metric({ label, value, detail, color = '#f0f6ff' }: { label: string; value: string; detail?: string; color?: string }) {
  return <div className="rounded-xl p-4" style={panel}><div className="text-[11px] uppercase tracking-wider" style={{ color: '#4b6a8a' }}>{label}</div><div className="text-2xl font-bold font-mono mt-1" style={{ color }}>{value}</div>{detail && <div className="text-xs mt-1" style={{ color: '#64748b' }}>{detail}</div>}</div>;
}

function ManpowerDashboard({ workspace, channelFilter = 'all', onOpenCalculator }: { workspace: FcWorkspace; channelFilter?: FcChannelFilter; onOpenCalculator?: (volume?: number) => void }) {
  const model = useMemo(() => buildFcManpowerDashboard(workspace, channelFilter), [workspace, channelFilter]);
  if (!workspace.standards.length) return <div className="rounded-xl p-5" style={panel}><div className="font-semibold text-white">Daily manpower productivity</div><div className="text-xs mt-1" style={{ color: '#f59e0b' }}>Activity standards are not initialized. Open Daily FC Entry or Setup to load the approved FC standards.</div></div>;
  if (!workspace.manpowerDays.length) return <div className="rounded-xl p-5" style={panel}><div className="font-semibold text-white">Daily manpower productivity</div><div className="text-xs mt-1" style={{ color: '#64748b' }}>No operational volume has been entered for this period.</div></div>;

  const activeDays = model.daily.length || 1;
  const averageRequired = model.totalRequiredDlp / activeDays;
  const averageActual = model.actualDlp / activeDays;
  const peakRequired = Math.max(...model.daily.map(day => day.totalRequiredDlp), 0);
  const shortageHours = Math.max(0, model.requiredLaborHours - model.availableLaborHours);
  const surplusHours = Math.max(0, model.availableLaborHours - model.requiredLaborHours);
  const utilization = model.availableLaborHours > 0 ? (model.requiredLaborHours / model.availableLaborHours) * 100 : null;
  const ownRate = workspace.settings?.overtime_hourly_cost_own ?? 0;
  const threePlRate = workspace.settings?.overtime_hourly_cost_3pl ?? 0;
  const maxOtPerDay = workspace.settings?.max_overtime_hours_per_day ?? 3;
  const absencePercent = workspace.settings?.planned_absence_percent ?? 5;

  const flowRows = [
    ['Inbound', model.inbound, null],
    ['Outbound B2C', model.outboundB2c, model.b2cUpt],
    ['Outbound B2B', model.outboundB2b, model.b2bUpt],
    ['Returns', model.returns, null],
    ['VAS', model.vas, null],
  ] as const;

  return <div className="space-y-4">
    {model.draftDates.length > 0 && (
      <div className="p-3 rounded-lg text-xs" style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)', color: '#fbbf24' }}>
        {model.draftDates.length} draft day{model.draftDates.length === 1 ? '' : 's'} in this period: {model.draftDates.join(', ')}
      </div>
    )}

    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      <Metric label="Total Throughput" value={n(model.throughput)} detail={`Inbound ${n(model.inbound)} · Outbound ${n(model.outboundB2c + model.outboundB2b)}`} color="#3b82f6" />
      <Metric
        label="Regular Hours Capacity"
        value={`${n(model.totalRegularUnitsCapacity)} units`}
        detail={`Can do with regular hours (${model.throughput > 0 ? Math.round((model.totalRegularUnitsCapacity / model.throughput) * 100) : 100}% of throughput) · ${n(model.availableLaborHours, 1)}h labor`}
        color="#3b82f6"
      />
      <Metric
        label="Unmet Volume (Needs OT)"
        value={`${n(model.totalUnmetUnits)} units`}
        detail={model.totalUnmetUnits > 0 ? `${n(model.overtimeRecommendedHours, 1)}h overtime required to clear` : 'Fully covered within regular hours'}
        color={model.totalUnmetUnits > 0 ? '#f59e0b' : '#10b981'}
      />
      <Metric label="Outbound / Handover" value={n(model.outboundB2c + model.outboundB2b)} detail={`Returns ${n(model.returns)} · VAS ${n(model.vas)}`} color="#10b981" />
      <Metric label="Labor Hours Needed" value={`${n(model.requiredLaborHours, 1)}h`} detail={`${n(averageActual, 1)} avg connected FC DLP`} color="#f59e0b" />
      <Metric label="Employees Required" value={n(averageRequired, 1)} detail={`Peak ${n(peakRequired, 1)} · includes ${n(absencePercent)}% reserve`} color="#f59e0b" />
      <Metric
        label="OT Required"
        value={`${n(model.overtimeRecommendedHours, 1)}h`}
        detail={`Est: SAR ${n(model.overtimeRecommendedCost, 2)}${model.uncoveredHours ? ` · ${n(model.uncoveredHours, 1)}h uncovered` : ''}`}
        color={model.uncoveredHours ? '#ef4444' : '#8b5cf6'}
      />
      <Metric
        label="OT Required / Person"
        value={`${n(model.averageOtRequiredPerPerson, 1)}h / person`}
        detail={`Across ${model.scheduledDlpCount || model.eligibleDlpCount} DLP employees · ${n(model.overtimeRecommendedHours, 1)}h total`}
        color={model.averageOtRequiredPerPerson > maxOtPerDay ? '#ef4444' : '#8b5cf6'}
      />
      <Metric
        label="Actual OT (Done)"
        value={`${n(model.actualOvertimeHours, 1)}h`}
        detail={`Approved cost: SAR ${n(model.actualOvertimeCost, 2)}`}
        color="#10b981"
      />
      <Metric
        label="Approved OT Cost"
        value={`SAR ${n(model.actualOvertimeCost, 2)}`}
        detail={(ownRate > 0 || threePlRate > 0) ? `Own: SAR ${n(ownRate, 2)}/h · 3PL: SAR ${n(threePlRate, 2)}/h` : 'Set OT hourly cost in Setup'}
        color="#f59e0b"
      />
      <Metric label="OT Cost Saved" value={`SAR ${n(model.overtimeCostSaved, 2)}`} detail="Unused recommended OT" color="#10b981" />
      <Metric label="Additional 3PL" value={n(model.peakAdditional3pl)} detail="After available OT" color={model.peakAdditional3pl ? '#ef4444' : '#10b981'} />
    </div>

    <div className="grid xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 rounded-xl p-4" style={panel}>
        <div className="flex items-center justify-between mb-3"><div className="font-semibold text-sm text-white">Daily FC operational flow</div><div className="text-xs" style={{ color: '#4b6a8a' }}>{model.daily[0]?.date} to {model.daily.at(-1)?.date}</div></div>
        <ResponsiveContainer width="100%" height={250}><BarChart data={model.daily}><CartesianGrid stroke="#1e3a5a" strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} /><YAxis tick={{ fill: '#64748b', fontSize: 10 }} /><Tooltip contentStyle={{ background: '#122338', border: '1px solid #1e3a5a', borderRadius: 8 }} /><Legend /><Bar dataKey="inbound" name="Inbound" stackId="v" fill="#3b82f6" /><Bar dataKey="outbound" name="Outbound" stackId="v" fill="#10b981" /><Bar dataKey="returns" name="Returns" stackId="v" fill="#f59e0b" /><Bar dataKey="vas" name="VAS" stackId="v" fill="#8b5cf6" /></BarChart></ResponsiveContainer>
      </div>
      <div className="rounded-xl p-4" style={panel}>
        <div className="font-semibold text-sm text-white mb-3">FC workforce</div>
        <div className="space-y-2">{[
          ['Own DLP', `${model.rosterOwnDlpCount} (${n(model.ownDlp, 1)} DLP-days)`, '#3b82f6'],
          ['3PL / Contract DLP', `${model.rosterContractDlpCount} (${n(model.contractDlp, 1)} DLP-days)`, '#8b5cf6'],
          ['Present vs Scheduled (DLP-days)', `${n(model.totalPresentDlp)} present · ${n(model.totalAbsentDlp)} absent`, model.totalAbsentDlp > 0 ? '#f59e0b' : '#10b981'],
          ['Managers / Non-DLP (Indirect)', `${model.rosterNonDlpCount} (${(model.indirectToDirectRatio * 100).toFixed(0)}% of DLP)`, '#64748b'],
          ['Transfers (In / Out)', `+${n(model.totalTransferredInHours, 1)}h / -${n(model.totalTransferredOutHours, 1)}h`, model.totalTransferredInHours - model.totalTransferredOutHours >= 0 ? '#10b981' : '#f59e0b'],
          ['Regular capacity (volume)', `${n(model.totalRegularUnitsCapacity)} units (${model.throughput > 0 ? Math.round((model.totalRegularUnitsCapacity / model.throughput) * 100) : 100}%)`, '#3b82f6'],
          ['Workload utilization', utilization == null ? 'n.a.' : `${n(utilization)}%`, utilization != null && utilization > 100 ? '#ef4444' : '#10b981'],
          [shortageHours > 0 ? 'Capacity shortage' : 'Surplus capacity', `${n(shortageHours || surplusHours, 1)}h`, shortageHours > 0 ? '#ef4444' : '#10b981'],
        ].map(([label, value, color]) => <div key={label} className="flex justify-between items-center p-2 rounded-lg" style={{ background: '#122338' }}><span className="text-xs" style={{ color: '#94a3b8' }}>{label}</span><span className="font-mono font-bold text-xs" style={{ color }}>{value}</span></div>)}</div>
      </div>
    </div>

    <div className="grid xl:grid-cols-2 gap-4">
      <div className="rounded-xl overflow-hidden" style={panel}><div className="px-4 py-3 font-semibold text-sm text-white">FC flow and storage</div><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr style={{ background: '#122338', color: '#64748b' }}>{['Flow', 'Volume', 'Share of throughput', 'UPT'].map(header => <th key={header} className="text-right first:text-left px-3 py-2">{header}</th>)}</tr></thead><tbody>{flowRows.map(([label, volume, upt]) => <tr key={label} className="border-t" style={{ borderColor: '#1e3a5a' }}><td className="px-3 py-2 font-medium text-white">{label}</td><td className="px-3 py-2 text-right font-mono">{n(volume)}</td><td className="px-3 py-2 text-right font-mono">{pct(volume, model.throughput)}</td><td className="px-3 py-2 text-right font-mono">{upt == null ? '—' : n(upt, 2)}</td></tr>)}</tbody></table></div><div className="grid grid-cols-3 gap-2 p-3 border-t" style={{ borderColor: '#1e3a5a' }}><div className="text-xs" style={{ color: '#64748b' }}>B2C UPT<strong className="block text-white font-mono">{model.b2cUpt == null ? 'n.a.' : n(model.b2cUpt, 2)}</strong></div><div className="text-xs" style={{ color: '#64748b' }}>B2B UPT<strong className="block text-white font-mono">{model.b2bUpt == null ? 'n.a.' : n(model.b2bUpt, 2)}</strong></div><div className="text-xs" style={{ color: '#64748b' }}>Closing storage<strong className="block text-white font-mono">{n(model.closingStorage)}</strong></div></div></div>
      <div className="rounded-xl overflow-hidden" style={panel}><div className="px-4 py-3 font-semibold text-white text-sm">Activity manpower requirement</div><div className="max-h-[390px] overflow-auto"><table className="w-full text-xs min-w-[650px]"><thead className="sticky top-0"><tr style={{ background: '#122338', color: '#64748b' }}>{['Activity', 'Volume', 'Target', 'Hours', 'Required DLP'].map(x => <th key={x} className="px-3 py-2 text-right first:text-left">{x}</th>)}</tr></thead><tbody>{model.activities.map(row => <tr key={row.code} className="border-t" style={{ borderColor: '#1e3a5a' }}><td className="px-3 py-2 text-white">{row.name}</td><td className="px-3 py-2 text-right font-mono">{n(row.volume)}</td><td className="px-3 py-2 text-right font-mono">{n(row.target, 1)} / {row.uom}</td><td className="px-3 py-2 text-right font-mono">{n(row.laborHours, 1)}</td><td className="px-3 py-2 text-right font-mono" style={{ color: '#f59e0b' }}>{n(row.requiredDlp, 2)}</td></tr>)}<tr className="border-t-2 font-semibold" style={{ borderColor: '#3b82f6' }}><td className="px-3 py-2 text-white">DLP workload requirement</td><td colSpan={2}></td><td className="px-3 py-2 text-right font-mono text-white">{n(model.requiredLaborHours, 1)}</td><td className="px-3 py-2 text-right font-mono text-white">{n(model.requiredDlp, 2)}</td></tr><tr><td className="px-3 py-2" style={{ color: '#94a3b8' }}>Planned absence reserve ({n(absencePercent)}%)</td><td colSpan={3}></td><td className="px-3 py-2 text-right font-mono">{n(model.absenteeismBuffer, 2)}</td></tr><tr className="font-semibold" style={{ background: '#122338' }}><td className="px-3 py-2 text-white">Total planned staff requirement</td><td colSpan={3}></td><td className="px-3 py-2 text-right font-mono text-white">{n(model.totalRequiredDlp, 2)}</td></tr></tbody></table></div></div>
    </div>

    {model.clientBreakdown.length > 0 && (
      <div className="rounded-xl overflow-hidden" style={panel}>
        <div className="px-4 py-3 font-semibold text-sm text-white border-b" style={{ borderColor: '#1e3a5a' }}>
          Client-wise FC operational flow
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: '#122338', color: '#64748b' }}>
                {['Client / Seller', 'Inbound', 'Outbound B2C', 'Outbound B2B', 'Returns', 'VAS', 'Total Throughput', 'B2C UPT', 'B2B UPT'].map(h => (
                  <th key={h} className="text-right first:text-left px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.clientBreakdown.map(c => (
                <tr key={c.clientName} className="border-t" style={{ borderColor: '#1e3a5a' }}>
                  <td className="px-3 py-2 font-medium text-white">{c.clientName}</td>
                  <td className="px-3 py-2 text-right font-mono">{n(c.inbound)}</td>
                  <td className="px-3 py-2 text-right font-mono">{n(c.outboundB2c)}</td>
                  <td className="px-3 py-2 text-right font-mono">{n(c.outboundB2b)}</td>
                  <td className="px-3 py-2 text-right font-mono">{n(c.returns)}</td>
                  <td className="px-3 py-2 text-right font-mono">{n(c.vas)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-blue-300">{n(c.totalThroughput)}</td>
                  <td className="px-3 py-2 text-right font-mono">{c.b2cUpt == null ? '—' : n(c.b2cUpt, 2)}</td>
                  <td className="px-3 py-2 text-right font-mono">{c.b2bUpt == null ? '—' : n(c.b2bUpt, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}

    <div className="rounded-xl p-4" style={panel}>
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold text-sm text-white">Daily Overtime Required vs Done (Approved)</div>
        <div className="text-xs" style={{ color: '#64748b' }}>Hours per day</div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={model.daily}>
          <CartesianGrid stroke="#1e3a5a" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} />
          <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
          <Tooltip contentStyle={{ background: '#122338', border: '1px solid #1e3a5a', borderRadius: 8 }} />
          <Legend />
          <Bar dataKey="overtimeRecommendedHours" name="OT Required (h)" fill="#8b5cf6" />
          <Bar dataKey="actualOvertimeHours" name="OT Done Approved (h)" fill="#10b981" />
        </BarChart>
      </ResponsiveContainer>
    </div>

    <div className="rounded-xl overflow-hidden" style={panel}>
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b" style={{ borderColor: '#1e3a5a' }}>
        <div className="flex items-center gap-3">
          <div className="font-semibold text-sm text-white">Overtime tracking — Required vs Done (Approved)</div>
          <button
            type="button"
            onClick={() => {
              const header = ['Date', 'Status', 'Scheduled DLP', 'Present DLP', 'Throughput', 'Regular Capacity', 'Workload Hours', 'OT Required (h)', 'OT / Person (h)', 'Req Cost (SAR)', 'OT Done (h)', 'Done Cost (SAR)', 'Variance (h)'];
              const csvRows = model.daily.map(d => [
                d.date, d.status, d.actualDlp, d.presentDlp, d.throughput, d.regularUnitsCapacity,
                d.requiredLaborHours.toFixed(1), d.overtimeRecommendedHours.toFixed(1), d.otRequiredPerPerson.toFixed(1),
                d.overtimeRecommendedCost.toFixed(2), d.actualOvertimeHours.toFixed(1), d.actualOvertimeCost.toFixed(2),
                (d.actualOvertimeHours - d.overtimeRecommendedHours).toFixed(1),
              ]);
              const csv = [header, ...csvRows].map(r => r.join(',')).join('\n');
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `fc-overtime-tracking-${model.daily[0]?.date ?? 'period'}.csv`;
              link.click();
              URL.revokeObjectURL(url);
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium"
            style={{ background: '#122338', color: '#93c5fd', border: '1px solid #1e3a5a' }}
          >
            <Download size={12} />
            Export CSV
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="px-3 py-1.5 rounded-lg group relative cursor-help" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
            <span style={{ color: '#94a3b8' }}>Active DLP: </span>
            <strong className="font-mono text-white">{model.eligibleDlpCount} employees</strong>
            <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:flex flex-col items-center z-30 whitespace-nowrap">
              <div className="px-2.5 py-1.5 rounded-lg shadow-xl text-[11px] font-sans font-medium text-white flex items-center gap-2 border" style={{ background: '#0b1623', borderColor: '#3b82f6' }}>
                <span>Own: <strong className="font-mono text-blue-300">{model.rosterOwnDlpCount}</strong></span>
                <span style={{ color: '#475569' }}>·</span>
                <span>3PL: <strong className="font-mono text-amber-300">{model.rosterContractDlpCount}</strong></span>
              </div>
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-lg" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
            <span style={{ color: '#94a3b8' }}>Regular Capacity: </span>
            <strong className="font-mono text-white">{n(model.totalRegularUnitsCapacity)} units</strong>
            <span className="text-[10px] font-mono ml-1" style={{ color: '#93c5fd' }}>({n(model.availableLaborHours, 1)}h)</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
            <span style={{ color: '#94a3b8' }}>OT Required: </span>
            <strong className="font-mono text-white">{n(model.overtimeRecommendedHours, 1)}h</strong>
            <span className="text-[10px] font-mono ml-1" style={{ color: '#c4b5fd' }}>(SAR {n(model.overtimeRecommendedCost, 2)})</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
            <span style={{ color: '#94a3b8' }}>OT / Person: </span>
            <strong className="font-mono" style={{ color: model.averageOtRequiredPerPerson > 0 ? '#c4b5fd' : '#10b981' }}>{n(model.averageOtRequiredPerPerson, 1)}h</strong>
          </div>
          <div className="px-3 py-1.5 rounded-lg" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
            <span style={{ color: '#94a3b8' }}>OT Done (Approved): </span>
            <strong className="font-mono" style={{ color: '#10b981' }}>{n(model.actualOvertimeHours, 1)}h</strong>
            <span className="text-[10px] font-mono ml-1 font-semibold" style={{ color: '#6ee7b7' }}>({model.totalApprovedOtEmployees} {model.totalApprovedOtEmployees === 1 ? 'employee' : 'employees'})</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
            <span style={{ color: '#94a3b8' }}>Total Approved Cost: </span>
            <strong className="font-mono" style={{ color: '#f59e0b' }}>SAR {n(model.actualOvertimeCost, 2)}</strong>
          </div>
          <div className="px-3 py-1.5 rounded-lg font-mono text-[11px] font-bold" style={{
            background: model.actualOvertimeHours >= model.overtimeRecommendedHours ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
            color: model.actualOvertimeHours >= model.overtimeRecommendedHours ? '#10b981' : '#f59e0b',
            border: `1px solid ${model.actualOvertimeHours >= model.overtimeRecommendedHours ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}`,
          }}>
            {model.actualOvertimeHours >= model.overtimeRecommendedHours
              ? `+${n(model.actualOvertimeHours - model.overtimeRecommendedHours, 1)}h covered`
              : `${n(model.actualOvertimeHours - model.overtimeRecommendedHours, 1)}h shortage`}
          </div>
        </div>
      </div>

      <div className="px-4 py-2.5 border-b flex items-start sm:items-center gap-2.5 text-xs" style={{ background: 'rgba(30, 58, 90, 0.3)', borderColor: '#1e3a5a' }}>
        <Info size={14} className="text-blue-400 shrink-0 mt-0.5 sm:mt-0" />
        <div className="text-slate-300 leading-relaxed">
          <strong className="text-white">How FC Labor & Overtime Works:</strong> Scheduled FC employees and Shift Scheduler hours define regular capacity. Volume exceeding regular capacity requires overtime, compared directly against approved OT records.
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[1150px]">
          <thead>
            <tr style={{ background: '#122338', color: '#64748b' }}>
              <th className="text-left px-3 py-2">Date</th>
              <th className="text-center px-3 py-2">Status</th>
              <th className="text-center px-3 py-2">Employees</th>
              <th className="text-right px-3 py-2">Throughput</th>
              <th className="text-right px-3 py-2">Regular Capacity</th>
              <th className="text-right px-3 py-2">Workload Demand</th>
              <th className="text-right px-3 py-2">OT Required</th>
              <th className="text-right px-3 py-2">OT / Person</th>
              <th className="text-right px-3 py-2">Req. Cost</th>
              <th className="text-right px-3 py-2">OT Done (Approved)</th>
              <th className="text-right px-3 py-2">Done Cost</th>
              <th className="text-right px-3 py-2">Variance</th>
              <th className="text-center px-3 py-2">Fulfillment</th>
            </tr>
          </thead>
          <tbody>
            {model.daily.map(day => {
              const variance = day.actualOvertimeHours - day.overtimeRecommendedHours;
              const fulfillmentPercent = day.overtimeRecommendedHours > 0
                ? Math.min(100, Math.round((day.actualOvertimeHours / day.overtimeRecommendedHours) * 100))
                : (day.actualOvertimeHours > 0 ? 100 : null);
              return (
                <tr key={day.date} className="border-t" style={{ borderColor: '#1e3a5a' }}>
                  <td className="px-3 py-2 text-white font-medium">
                    <div className="flex items-center justify-between gap-1">
                      <span>{shortDay(day.date)} <span style={{ color: '#64748b' }}>({day.date})</span></span>
                      {onOpenCalculator && day.throughput > 0 && (
                        <button
                          type="button"
                          onClick={() => onOpenCalculator(day.throughput)}
                          className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-blue-400"
                          title={`Calculate labor & OT for ${day.date} (${n(day.throughput)} units)`}
                        >
                          <Calculator size={12} />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center uppercase text-[10px] font-semibold" style={{ color: day.status === 'finalized' ? '#10b981' : '#f59e0b' }}>
                    {day.status}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono" style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.25)', color: '#93c5fd' }}>
                      {day.actualDlp} ({day.ownDlp} Own · {day.contractDlp} 3PL)
                    </span>
                    <div className="text-[10px] font-mono mt-0.5" style={{ color: day.absentDlp > 0 ? '#f59e0b' : '#10b981' }}>
                      {day.presentDlp} present · {day.absentDlp} absent
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-white">{n(day.throughput)}</td>
                  <td className="px-3 py-2 text-right font-mono" style={{ color: '#93c5fd' }}>
                    {n(day.regularUnitsCapacity)} <span className="text-[10px]" style={{ color: '#64748b' }}>({n(day.availableLaborHours, 1)}h)</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{n(day.requiredLaborHours, 1)}h</td>
                  <td className="px-3 py-2 text-right font-mono" style={{ color: '#8b5cf6' }}>{n(day.overtimeRecommendedHours, 1)}h</td>
                  <td className="px-3 py-2 text-right font-mono" style={{ color: day.otRequiredPerPerson > maxOtPerDay ? '#ef4444' : '#c4b5fd' }}>{n(day.otRequiredPerPerson, 1)}h</td>
                  <td className="px-3 py-2 text-right font-mono" style={{ color: '#94a3b8' }}>SAR {n(day.overtimeRecommendedCost, 2)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold" style={{ color: '#10b981' }}>
                    {n(day.actualOvertimeHours, 1)}h
                    {day.approvedOtEmployees > 0 && <span className="text-[10px] ml-1" style={{ color: '#6ee7b7' }}>({day.approvedOtEmployees})</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono" style={{ color: '#f59e0b' }}>SAR {n(day.actualOvertimeCost, 2)}</td>
                  <td className="px-3 py-2 text-right font-mono" style={{ color: variance >= 0 ? '#10b981' : '#f59e0b' }}>
                    {variance >= 0 ? '+' : ''}{n(variance, 1)}h
                  </td>
                  <td className="px-3 py-2 text-center font-mono">
                    {fulfillmentPercent == null ? (
                      <span style={{ color: '#64748b' }}>—</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{
                        background: fulfillmentPercent >= 100 ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
                        color: fulfillmentPercent >= 100 ? '#10b981' : '#f59e0b',
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
              <td colSpan={3} className="px-3 py-2.5 text-white">Period Totals</td>
              <td className="px-3 py-2.5 text-right font-mono text-white">{n(model.throughput)}</td>
              <td className="px-3 py-2.5 text-right font-mono" style={{ color: '#93c5fd' }}>{n(model.totalRegularUnitsCapacity)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-white">{n(model.requiredLaborHours, 1)}h</td>
              <td className="px-3 py-2.5 text-right font-mono" style={{ color: '#8b5cf6' }}>{n(model.overtimeRecommendedHours, 1)}h</td>
              <td className="px-3 py-2.5 text-right font-mono" style={{ color: '#c4b5fd' }}>{n(model.averageOtRequiredPerPerson, 1)}h</td>
              <td className="px-3 py-2.5 text-right font-mono">SAR {n(model.overtimeRecommendedCost, 2)}</td>
              <td className="px-3 py-2.5 text-right font-mono" style={{ color: '#10b981' }}>{n(model.actualOvertimeHours, 1)}h</td>
              <td className="px-3 py-2.5 text-right font-mono" style={{ color: '#f59e0b' }}>SAR {n(model.actualOvertimeCost, 2)}</td>
              <td className="px-3 py-2.5 text-right font-mono" style={{ color: model.actualOvertimeHours >= model.overtimeRecommendedHours ? '#10b981' : '#f59e0b' }}>
                {model.actualOvertimeHours >= model.overtimeRecommendedHours ? '+' : ''}{n(model.actualOvertimeHours - model.overtimeRecommendedHours, 1)}h
              </td>
              <td className="px-3 py-2.5 text-center font-mono text-white">
                {model.overtimeRecommendedHours > 0 ? `${Math.min(100, Math.round((model.actualOvertimeHours / model.overtimeRecommendedHours) * 100))}%` : '100%'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {model.approvedOvertimeByEmployee.length > 0 && (
        <div className="border-t p-4" style={{ borderColor: '#1e3a5a' }}>
          <div className="text-xs font-semibold text-white mb-2">Approved overtime by FC employee</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: '#122338', color: '#64748b' }}>
                  <th className="text-left px-3 py-2">Employee</th>
                  <th className="text-left px-3 py-2">Source</th>
                  <th className="text-right px-3 py-2">Approved OT Hours</th>
                  <th className="text-right px-3 py-2">OT Rate</th>
                  <th className="text-right px-3 py-2">Approved Cost</th>
                </tr>
              </thead>
              <tbody>
                {model.approvedOvertimeByEmployee.map(emp => (
                  <tr key={emp.employeeId} className="border-t" style={{ borderColor: '#1e3a5a' }}>
                    <td className="px-3 py-2 text-white">{emp.employeeName} <span style={{ color: '#64748b' }}>({emp.employeeCode})</span></td>
                    <td className="px-3 py-2 uppercase text-[10px] font-semibold" style={{ color: emp.employmentSource === '3pl' ? '#c4b5fd' : '#93c5fd' }}>{emp.employmentSource}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-400">{n(emp.approvedOvertimeHours, 2)}h</td>
                    <td className="px-3 py-2 text-right font-mono">SAR {n(emp.otRate, 2)}/h</td>
                    <td className="px-3 py-2 text-right font-mono text-amber-400">SAR {n(emp.approvedOvertimeCost, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  </div>;
}

function Dashboard({ workspace, channelFilter = 'all', onOpenCalculator }: { workspace: FcWorkspace; channelFilter?: FcChannelFilter; onOpenCalculator?: (volume?: number) => void }) {
  const model = useMemo(() => buildFcDashboard(workspace, channelFilter), [workspace, channelFilter]);
  if (!workspace.week) return <div className="space-y-4"><ManpowerDashboard workspace={workspace} channelFilter={channelFilter} onOpenCalculator={onOpenCalculator} /><div className="rounded-xl p-6 text-center" style={panel}><FileSpreadsheet className="mx-auto" style={{ color: '#3b82f6' }} /><div className="text-white font-semibold mt-3">No packed-order import for this week</div><div className="text-xs mt-1" style={{ color: '#64748b' }}>Packed-order employee and seller metrics remain available as supporting detail after an Orders import.</div></div></div>;
  const capacity = workspace.capacity;
  return <div className="space-y-4"><ManpowerDashboard workspace={workspace} channelFilter={channelFilter} onOpenCalculator={onOpenCalculator} />
    <div className="rounded-xl p-4 flex flex-wrap justify-between gap-3" style={panel}><div><div className="text-white font-semibold">Week of {workspace.week.week_start}</div><div className="text-xs mt-1" style={{ color: '#64748b' }}>{workspace.week.source_file_name} · revision {workspace.week.revision} · {workspace.week.valid_rows.toLocaleString()} accepted rows</div></div><span className="px-3 py-1 rounded-full text-xs font-semibold uppercase" style={{ background: workspace.week.status === 'finalized' ? 'rgba(16,185,129,.12)' : 'rgba(245,158,11,.12)', color: workspace.week.status === 'finalized' ? '#6ee7b7' : '#fcd34d' }}>{workspace.week.status}</span></div>
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-3"><Metric label="Packed Orders" value={n(model.packedOrders)} color="#3b82f6" /><Metric label="Packed Quantity" value={n(model.packedQuantity)} /><Metric label="Additional Items" value={n(model.additionalItems)} /><Metric label="Active FC Employees" value={n(model.activePackers)} color="#10b981" /><Metric label="Mapped Orders" value={n(model.mappedOrders)} detail={pct(model.mappedOrders, model.packedOrders)} /><Metric label="Unassigned Orders" value={n(model.unassignedOrders)} color={model.unassignedOrders ? '#f59e0b' : '#10b981'} /></div>
    <div className="grid lg:grid-cols-2 gap-4"><div className="rounded-xl p-4" style={panel}><div className="font-semibold text-white text-sm mb-3">Daily packed output</div><ResponsiveContainer width="100%" height={240}><BarChart data={model.daily}><CartesianGrid stroke="#1e3a5a" strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} /><YAxis tick={{ fill: '#64748b', fontSize: 10 }} /><Tooltip contentStyle={{ background: '#122338', border: '1px solid #1e3a5a' }} /><Legend /><Bar dataKey="packedOrders" name="Orders" fill="#2563eb" /><Bar dataKey="packedQuantity" name="Quantity" fill="#06b6d4" /></BarChart></ResponsiveContainer></div><div className="rounded-xl overflow-hidden" style={panel}><div className="px-4 py-3 font-semibold text-white text-sm">Employee packing leaderboard</div><div className="overflow-auto max-h-72"><table className="w-full text-xs"><thead><tr style={{ background: '#122338', color: '#64748b' }}>{['Employee','Days','Orders','Qty','Additional','UPT','Orders / Day','Share'].map(x=><th key={x} className="px-3 py-2 text-right first:text-left">{x}</th>)}</tr></thead><tbody>{model.employees.map(row=><tr key={row.key} className="border-t" style={{ borderColor: '#1e3a5a' }}><td className="px-3 py-2 text-white"><div>{row.employeeName}</div><div className="text-[10px]" style={{ color: '#64748b' }}>{row.packerLabels.join(', ')}</div></td><td className="px-3 py-2 text-right">{row.activeDays}</td><td className="px-3 py-2 text-right">{n(row.packedOrders)}</td><td className="px-3 py-2 text-right">{n(row.packedQuantity)}</td><td className="px-3 py-2 text-right">{n(row.additionalItems)}</td><td className="px-3 py-2 text-right">{n(row.unitsPerOrder,2)}</td><td className="px-3 py-2 text-right">{n(row.ordersPerActiveDay,1)}</td><td className="px-3 py-2 text-right">{n(row.shareOfOrders*100,1)}%</td></tr>)}</tbody></table></div></div></div>
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">{(['a2p','p2p','o2p','p2s','o2s'] as const).map(key=><Metric key={key} label={key.toUpperCase()} value={duration(model.cycleTimes[key].minutes)} detail={`${model.cycleTimes[key].samples.toLocaleString()} samples`} />)}</div>
    <div className="rounded-xl overflow-auto" style={panel}><div className="px-4 py-3 font-semibold text-white text-sm">Seller packed orders and UPT</div><table className="w-full text-xs min-w-[1050px]"><thead><tr style={{ background: '#122338', color: '#64748b' }}>{['Seller','B2B Orders','B2B Qty','B2B UPT','B2C Orders','B2C Qty','B2C UPT','Other Orders','Other Qty','Other UPT','Total Orders','Total Qty','Total UPT'].map(x=><th key={x} className="px-3 py-2 text-right first:text-left">{x}</th>)}</tr></thead><tbody>{model.sellers.map(row=><tr key={row.sellerName} className="border-t" style={{ borderColor: '#1e3a5a' }}><td className="px-3 py-2 text-white">{row.sellerName}</td><td className="px-3 py-2 text-right">{row.b2bOrders}</td><td className="px-3 py-2 text-right">{n(row.b2bQuantity)}</td><td className="px-3 py-2 text-right">{row.b2bOrders ? n(row.b2bQuantity/row.b2bOrders,2) : 'n.a.'}</td><td className="px-3 py-2 text-right">{row.b2cOrders}</td><td className="px-3 py-2 text-right">{n(row.b2cQuantity)}</td><td className="px-3 py-2 text-right">{row.b2cOrders ? n(row.b2cQuantity/row.b2cOrders,2) : 'n.a.'}</td><td className="px-3 py-2 text-right">{row.otherOrders}</td><td className="px-3 py-2 text-right">{n(row.otherQuantity)}</td><td className="px-3 py-2 text-right">{row.otherOrders ? n(row.otherQuantity/row.otherOrders,2) : 'n.a.'}</td><td className="px-3 py-2 text-right">{n(row.totalOrders)}</td><td className="px-3 py-2 text-right">{n(row.totalQuantity)}</td><td className="px-3 py-2 text-right">{row.totalOrders ? n(row.totalQuantity/row.totalOrders,2) : 'n.a.'}</td></tr>)}</tbody></table></div>
    <div className="grid lg:grid-cols-3 gap-4"><div className="rounded-xl overflow-hidden" style={panel}><div className="px-4 py-3 font-semibold text-white text-sm">Purchase orders and returns</div>{workspace.sellerSupplements.length ? workspace.sellerSupplements.map(row=><div key={row.id} className="grid grid-cols-4 gap-2 px-4 py-2 border-t text-xs" style={{ borderColor: '#1e3a5a' }}><span className="text-white">{row.seller_name}</span><span className="text-right">PO {n(row.purchase_order_units)}</span><span className="text-right">Return qty {n(row.return_order_units)}</span><span className="text-right">Orders {n(row.return_orders)}</span></div>) : <div className="p-4 text-xs" style={{ color: '#64748b' }}>No seller supplements entered.</div>}</div><div className="rounded-xl p-4" style={panel}><div className="font-semibold text-white text-sm mb-3">Capacity utilization</div>{capacity ? <div className="space-y-2 text-xs">{[['Bins',capacity.utilized_bins,capacity.capacity_bins],['Pallets',capacity.utilized_pallets,capacity.capacity_pallets],['Units',capacity.utilized_units,capacity.capacity_units],['CBM',capacity.utilized_cbm,capacity.capacity_cbm]].map(([label,used,total])=><div key={String(label)} className="flex justify-between"><span style={{ color: '#94a3b8' }}>{label}</span><span className="font-mono text-white">{n(Number(used))} / {n(Number(total))} · {pct(Number(used),Number(total))}</span></div>)}</div> : <div className="text-xs" style={{ color: '#64748b' }}>No capacity values entered.</div>}</div><div className="rounded-xl overflow-hidden" style={panel}><div className="px-4 py-3 font-semibold text-white text-sm">Ad-hoc task usage</div>{workspace.adhocTasks.length ? workspace.adhocTasks.map(row=><div key={row.id} className="flex justify-between px-4 py-2 border-t text-xs" style={{ borderColor: '#1e3a5a' }}><span className="text-white">{row.seller_name} · {row.task_name}</span><span className="font-mono">{n(row.usage,2)}</span></div>) : <div className="p-4 text-xs" style={{ color: '#64748b' }}>No ad-hoc tasks recorded.</div>}</div></div>
    {model.transfers && model.transfers.records.length > 0 && (
      <div className="rounded-xl overflow-hidden" style={panel}>
        <div className="px-4 py-3 flex items-center justify-between border-b" style={{ borderColor: '#1e3a5a' }}>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-400">
              <ArrowLeftRight size={14} />
            </span>
            <div>
              <div className="font-semibold text-white text-sm">FC Workforce Inter-Department Transfers</div>
              <div className="text-xs" style={{ color: '#64748b' }}>
                FC employees transferred to support Mailroom or other operations during this week
              </div>
            </div>
          </div>
          <div className="text-xs">
            <span style={{ color: '#94a3b8' }}>Transferred Out: </span>
            <strong className="text-cyan-400 font-mono">{model.transfers.transfersOutHours}h</strong>
            <span className="text-[10px] ml-1" style={{ color: '#64748b' }}>({model.transfers.transfersOutCount} workers)</span>
          </div>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ background: '#122338', color: '#64748b' }}>
              <th className="text-left px-4 py-2">FC Employee</th>
              <th className="text-left px-4 py-2">Assigned Department</th>
              <th className="text-left px-4 py-2">Date</th>
              <th className="text-right px-4 py-2">Transferred Hours</th>
              <th className="text-right px-4 py-2">Overtime</th>
              <th className="text-center px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {model.transfers.records.map(row => (
              <tr key={row.id} className="border-t" style={{ borderColor: '#1e3a5a' }}>
                <td className="px-4 py-2 text-white font-medium">{row.employeeName} ({row.employeeCode})</td>
                <td className="px-4 py-2 font-semibold text-emerald-300">{row.toDepartment}</td>
                <td className="px-4 py-2 font-mono text-slate-300">{row.date}</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-white">{row.hours}h</td>
                <td className="px-4 py-2 text-right font-mono text-amber-300">{row.otHours > 0 ? `+${row.otHours}h OT` : '—'}</td>
                <td className="px-4 py-2 text-center">
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase" style={{ background: 'rgba(6,182,212,.15)', color: '#67e8f9' }}>
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>;
}

function ActivityRequirement({ workspace, channelFilter = 'all' }: { workspace: FcWorkspace; channelFilter?: FcChannelFilter }) {
  const model = useMemo(() => buildFcManpowerDashboard(workspace, channelFilter), [workspace, channelFilter]);
  if (!workspace.standards.length) return <div className="rounded-xl p-6 text-center" style={panel}><div className="text-white font-semibold">FC activity standards are not initialized</div><div className="text-xs mt-1" style={{ color: '#64748b' }}>Open Setup to initialize the approved standards.</div></div>;
  return <div className="space-y-4">
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3"><Metric label="Activities" value={n(model.activities.length)} /><Metric label="Workload DLP" value={n(model.requiredDlp, 2)} color="#f59e0b" /><Metric label="Absence Reserve" value={n(model.absenteeismBuffer, 2)} /><Metric label="Total Planned DLP" value={n(model.totalRequiredDlp, 2)} color="#3b82f6" /></div>
    <div className="rounded-xl overflow-hidden" style={panel}><div className="px-4 py-3 border-b" style={{ borderColor: '#1e3a5a' }}><div className="font-semibold text-white">Activity manpower requirement</div><div className="text-xs mt-1" style={{ color: '#64748b' }}>FC-specific volume drivers and approved hourly or daily activity standards.</div></div><div className="overflow-auto"><table className="w-full text-xs min-w-[800px]"><thead><tr style={{ background: '#122338', color: '#64748b' }}>{['Activity', 'Volume Driver', 'Volume Total', 'Approved Target', 'Target UOM', 'Required DLP'].map(header => <th key={header} className="px-3 py-2 text-right first:text-left">{header}</th>)}</tr></thead><tbody>{model.activities.map(row => { const standard = workspace.standards.find(item => item.activity_code === row.code); return <tr key={row.code} className="border-t" style={{ borderColor: '#1e3a5a' }}><td className="px-3 py-2 text-white">{row.name}</td><td className="px-3 py-2 text-right">{standard?.volume_driver.replace(/_/g, ' ')}</td><td className="px-3 py-2 text-right font-mono">{n(row.volume)}</td><td className="px-3 py-2 text-right font-mono">{n(row.target, 2)}</td><td className="px-3 py-2 text-right">units / worker / {row.uom}</td><td className="px-3 py-2 text-right font-mono" style={{ color: '#f59e0b' }}>{n(row.requiredDlp, 2)}</td></tr>; })}</tbody><tfoot><tr className="border-t-2 font-semibold" style={{ borderColor: '#3b82f6', background: '#122338' }}><td colSpan={5} className="px-3 py-2 text-white">Total planned staff requirement including reserve</td><td className="px-3 py-2 text-right font-mono text-white">{n(model.totalRequiredDlp, 2)}</td></tr></tfoot></table></div></div>
  </div>;
}

function ManpowerEntry({ organizationId, weekStart, fromDate, toDate, workspace, refresh, busy, setBusy }: { organizationId: string; weekStart: string; fromDate: string; toDate: string; workspace: FcWorkspace; refresh: () => Promise<void>; busy: boolean; setBusy: (v: boolean) => void }) {
  const [operationalPreview, setOperationalPreview] = useState<FcOperationalImportPreview | null>(null);
  const [pairedOrdersPreview, setPairedOrdersPreview] = useState<FcImportPreview | null>(null);
  const [syncPackerStats, setSyncPackerStats] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workDate, setWorkDate] = useState(weekStart);
  const defaultHours = workspace.settings?.standard_hours_per_day ?? 8;
  const blank: Partial<FcDailyManpowerProductivityRow> = { available_hours: defaultHours, inbound_quantity: 0, return_rto_quantity: 0, return_cir_quantity: 0, outbound_b2c_quantity: 0, outbound_b2b_quantity: 0, vas_quantity: 0, gift_wrap_quantity: 0, other_activity_quantity: 0, b2c_orders: 0, b2b_orders: 0, closing_storage_quantity: 0, actual_own_dlp: 0, actual_contract_dlp: 0 };
  const [day, setDay] = useState<Partial<FcDailyManpowerProductivityRow>>(blank);
  useEffect(() => { const existing = workspace.manpowerDays.find(x => x.work_date === workDate); setDay(existing ?? blank); }, [workspace.manpowerDays, workDate]);

  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const preview = useMemo(() => buildFcDayPreview(workspace, workDate, day), [workspace, workDate, day]);

  const dayApprovedOt = useMemo(() => {
    const settingByEmp = new Map((workspace.employeeSettings ?? []).map(s => [s.employee_id, s]));
    const ownRate = workspace.settings?.overtime_hourly_cost_own ?? 0;
    const threePlRate = workspace.settings?.overtime_hourly_cost_3pl ?? 0;
    const attendance = workspace.attendance ?? [];
    const overtimeRecords = workspace.overtimeRecords ?? [];
    const offDayComps = workspace.offDayCompensations ?? [];
    const rows: Array<{ id: string; name: string; code: string; hours: number; rate: number; cost: number; source: string }> = [];
    workspace.employees.forEach(emp => {
      const s = settingByEmp.get(emp.id);
      const rate = s?.overtime_hourly_cost ?? (s?.employment_source === '3pl' ? threePlRate : ownRate);
      const otRes = getEffectiveApprovedOvertimeMinutes(emp.id, workDate, attendance, overtimeRecords);
      if (otRes.effectiveMinutes > 0) {
        const hours = otRes.effectiveMinutes / 60;
        rows.push({ id: `${emp.id}-ot`, name: emp.full_name, code: emp.employee_code, hours, rate, cost: hours * rate, source: s?.employment_source ?? 'own' });
        return;
      }
      const offHrs = getOffDayOvertimeHours(emp.id, workDate, offDayComps);
      if (offHrs > 0) {
        rows.push({ id: `${emp.id}-off`, name: emp.full_name, code: emp.employee_code, hours: offHrs, rate, cost: offHrs * rate, source: s?.employment_source ?? 'own' });
      }
    });
    return {
      rows,
      totalHours: rows.reduce((s, r) => s + r.hours, 0),
      totalCost: rows.reduce((s, r) => s + r.cost, 0),
    };
  }, [workspace, workDate]);

  const fields: Array<[keyof FcDailyManpowerProductivityRow, string]> = [['inbound_quantity', 'Inbound quantity'], ['return_rto_quantity', 'Return RTO'], ['return_cir_quantity', 'Return CIR'], ['outbound_b2c_quantity', 'Outbound B2C'], ['outbound_b2b_quantity', 'Outbound B2B'], ['vas_quantity', 'VAS quantity'], ['gift_wrap_quantity', 'Gift wrapping'], ['other_activity_quantity', 'Other activity'], ['b2c_orders', 'B2C orders'], ['b2b_orders', 'B2B orders'], ['closing_storage_quantity', 'Closing storage']];
  const workforce = workspace.workforceDays.find(item => item.workDate === workDate);

  const copyPreviousDay = () => {
    const prevDate = addDays(workDate, -1);
    const prev = workspace.manpowerDays.find(x => x.work_date === prevDate);
    if (prev) {
      setDay({ ...prev, work_date: workDate });
      setError(null);
    } else {
      setError(`No saved entry found for ${prevDate} to copy.`);
    }
  };

  const readOperational = async (files?: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    setPairedOrdersPreview(null);
    try {
      const fileList = [...files];
      const opPreview = await parseFcOperationalFiles(fileList, fromDate, toDate);
      setOperationalPreview(opPreview);
      if (opPreview.sources.includes('orders')) {
        for (const f of fileList) {
          try {
            const ordersPreview = await parseFcOrdersFile(f, weekStart);
            if (ordersPreview.packedOrders > 0) {
              setPairedOrdersPreview(ordersPreview);
              break;
            }
          } catch {
            // Non-orders CSV or missing packer columns; ignore silently
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to read FC operational CSV files.');
    } finally {
      setBusy(false);
    }
  };
  const importOperational = async () => {
    if (!operationalPreview) return;
    setBusy(true);
    setError(null);
    try {
      await fcProductivityService.importOperationalMetrics(organizationId, operationalPreview);
      if (pairedOrdersPreview && syncPackerStats) {
        await fcProductivityService.saveImport(organizationId, weekStart, pairedOrdersPreview).catch(() => undefined);
      }
      setOperationalPreview(null);
      setPairedOrdersPreview(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to import FC operational CSV files.');
    } finally {
      setBusy(false);
    }
  };
  const initialize = async () => { setBusy(true); setError(null); try { await fcProductivityService.initializeStandards(organizationId); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to initialize standards.'); } finally { setBusy(false); } };
  const saveDay = async (status: 'draft' | 'finalized') => {
    setBusy(true);
    setError(null);
    try {
      await fcProductivityService.saveManpowerDay(organizationId, workDate, { ...day, status });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save daily manpower productivity.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-white">Daily FC entry</div>
          <div className="text-xs mt-1" style={{ color: '#64748b' }}>Upload daily/weekly exports or enter operational volumes, preview live staffing impact, and finalize.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="FC entry date" type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} className="px-3 py-2 rounded-lg text-xs" style={field} />
          <button type="button" onClick={copyPreviousDay} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ ...field, color: '#94a3b8' }}><Copy size={13} />Copy previous day</button>
          {!workspace.standards.length && <button onClick={() => void initialize()} disabled={busy} className="px-3 py-2 rounded-lg text-xs font-semibold" style={{ background: '#2563eb', color: '#fff' }}>Initialize FC standards</button>}
        </div>
      </div>

      {error && <div className="p-3 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#fca5a5' }}>{error}</div>}

      <div className="grid grid-cols-7 gap-1">
        {weekDates.map(date => {
          const entry = workspace.manpowerDays.find(d => d.work_date === date);
          const status = entry ? (entry.status ?? 'finalized') : 'missing';
          return (
            <button key={date} type="button" onClick={() => setWorkDate(date)} className="p-2 rounded-lg text-center" style={{ background: date === workDate ? '#1d4ed8' : '#0d1b2e', border: '1px solid #1e3a5a' }}>
              <div className="text-[10px]" style={{ color: date === workDate ? '#fff' : '#64748b' }}>{shortDay(date)}</div>
              <div className="text-[9px] mt-1 uppercase" style={{ color: status === 'finalized' ? '#10b981' : status === 'draft' ? '#f59e0b' : '#475569' }}>{status}</div>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl p-4" style={panel}>
        <div className="rounded-lg p-4" style={{ background: '#081424', border: '1px solid #2563eb' }}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm text-white font-semibold">Daily / weekly operational CSV import</div>
              <div className="text-xs mt-1" style={{ color: '#64748b' }}>Upload Orders, VAS, and GRN - Returns exports. The system detects each format, groups rows by operational date, and calculates FC manpower volumes automatically.</div>
              <div className="text-[11px] mt-1" style={{ color: '#93c5fd' }}>Import period: {fromDate} through {toDate}. Partial uploads replace only their matching source metrics and preserve staffing.</div>
            </div>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer" style={{ background: '#2563eb', color: '#fff' }}>
              <Upload size={14} />{busy ? 'Reading…' : 'Choose CSV exports'}
              <input type="file" accept=".csv,.tsv" multiple disabled={busy} className="hidden" onChange={e => void readOperational(e.target.files)} />
            </label>
          </div>
          {operationalPreview && (
            <div className="mt-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <Metric label="Days" value={n(operationalPreview.days.length)} />
                <Metric label="Inbound" value={n(operationalPreview.totals.inbound_quantity)} />
                <Metric label="Returns" value={n(operationalPreview.totals.return_rto_quantity + operationalPreview.totals.return_cir_quantity)} />
                <Metric label="Outbound" value={n(operationalPreview.totals.outbound_b2c_quantity + operationalPreview.totals.outbound_b2b_quantity)} />
                <Metric label="VAS" value={n(operationalPreview.totals.vas_quantity + operationalPreview.totals.gift_wrap_quantity)} />
              </div>
              <div className="text-xs mt-3" style={{ color: '#94a3b8' }}>{operationalPreview.sourceFileNames.join(' · ')} · {operationalPreview.acceptedRows.toLocaleString()} accepted of {operationalPreview.sourceRows.toLocaleString()} rows</div>
              <div className="text-xs mt-1" style={{ color: '#93c5fd' }}>Detected: {operationalPreview.sources.join(', ')}</div>
              {operationalPreview.warnings.map(warning => <div key={warning} className="text-xs mt-1" style={{ color: '#fcd34d' }}>{warning}</div>)}
              {pairedOrdersPreview && (
                <label className="flex items-center gap-2 mt-2 text-xs" style={{ color: '#93c5fd' }}>
                  <input type="checkbox" checked={syncPackerStats} onChange={e => setSyncPackerStats(e.target.checked)} />
                  Also update Packer Leaderboard & Cycle Times ({n(pairedOrdersPreview.packedOrders)} orders) in one step
                </label>
              )}
              <button onClick={() => void importOperational()} disabled={busy || !operationalPreview.days.length} className="mt-3 px-4 py-2 rounded text-xs font-semibold disabled:opacity-40" style={{ background: '#10b981', color: '#052e23' }}><Save size={13} className="inline mr-1" />Process and save operational data</button>
            </div>
          )}
        </div>

        <div className="mt-4 rounded-lg p-4" style={{ background: '#081424', border: '1px solid #10b981' }}>
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <div className="text-sm text-white font-semibold">Connected FC manpower — {workDate}</div>
              <div className="text-xs mt-1" style={{ color: '#64748b' }}>Read automatically from active FC employees and the Shift Scheduler.</div>
            </div>
            <span className="px-2 py-1 rounded text-[10px] font-semibold uppercase" style={{ background: 'rgba(16,185,129,.12)', color: '#6ee7b7' }}>{workforce?.source === 'shift_schedule' ? 'Shift schedule' : 'Active roster fallback'}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
            <Metric label="Own DLP" value={n(workforce?.ownDlp ?? 0, 1)} />
            <Metric label="Contract DLP" value={n(workforce?.contractDlp ?? 0, 1)} />
            <Metric label="Available labor" value={`${n(workforce?.availableLaborHours ?? 0, 1)}h`} />
            <Metric label="Active FC roster" value={n(workforce?.activeRosterDlp ?? 0)} />
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-end gap-3">
            <label className="text-xs" style={{ color: '#94a3b8' }}>Available hours<input type="number" min="1" max="24" step="0.5" value={day.available_hours ?? defaultHours} onChange={e => setDay(x => ({ ...x, available_hours: Number(e.target.value) || defaultHours }))} className="block mt-1 w-28 px-2 py-1.5 rounded" style={field} /></label>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
            {fields.map(([key, label]) => <label key={key} className="text-xs" style={{ color: '#94a3b8' }}>{label}<input type="number" min="0" step="1" value={Number(day[key] ?? 0)} onChange={e => setDay(x => ({ ...x, [key]: Math.max(0, Number(e.target.value) || 0) }))} className="block w-full mt-1 px-2 py-1.5 rounded font-mono" style={field} /></label>)}
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <button type="button" onClick={() => void saveDay('draft')} disabled={busy || !workspace.standards.length} className="px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: '#334155', color: '#fff' }}>Save draft</button>
            <button type="button" onClick={() => void saveDay('finalized')} disabled={busy || !workspace.standards.length} className="px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: '#2563eb', color: '#fff' }}><CheckCircle2 size={13} className="inline mr-1" />Save & finalize day</button>
          </div>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={panel}>
        <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-semibold text-sm text-white">Live staffing impact</div>
            <div className="text-xs" style={{ color: '#64748b' }}>Calculated before saving from the values above.</div>
          </div>
          <div className="flex flex-wrap gap-4 text-right">
            <div><div className="text-[10px]" style={{ color: '#64748b' }}>THROUGHPUT</div><div className="font-mono font-bold text-white">{n(preview.totalThroughput)}</div></div>
            <div><div className="text-[10px]" style={{ color: '#64748b' }}>REGULAR CAPACITY</div><div className="font-mono font-bold" style={{ color: '#93c5fd' }}>{n(preview.regularUnitsCapacity)}</div><div className="text-[10px] font-mono" style={{ color: '#64748b' }}>{n(preview.regularCapacityHours, 1)}h regular</div></div>
            <div><div className="text-[10px]" style={{ color: '#64748b' }}>UNMET (NEEDS OT)</div><div className="font-mono font-bold" style={{ color: preview.unmetUnits > 0 ? '#f59e0b' : '#10b981' }}>{n(preview.unmetUnits)}</div></div>
            <div><div className="text-[10px]" style={{ color: '#64748b' }}>HOURS NEEDED</div><div className="font-mono font-bold text-white">{n(preview.requiredHours, 1)}h</div></div>
            <div><div className="text-[10px]" style={{ color: '#64748b' }}>EMPLOYEES</div><div className="font-mono font-bold" style={{ color: '#f59e0b' }}>{n(preview.requiredEmployees, 1)}</div></div>
            <div><div className="text-[10px]" style={{ color: '#64748b' }}>OT REQUIRED</div><div className="font-mono font-bold" style={{ color: '#8b5cf6' }}>{n(preview.overtimeHours, 1)}h</div><div className="text-[10px] font-mono" style={{ color: '#c4b5fd' }}>SAR {n(preview.overtimeCost, 2)}</div></div>
            <div><div className="text-[10px]" style={{ color: '#64748b' }}>OT / PERSON</div><div className="font-mono font-bold" style={{ color: preview.otRequiredPerPerson > 0 ? '#c4b5fd' : '#10b981' }}>{n(preview.otRequiredPerPerson, 1)}h</div><div className="text-[10px] font-mono" style={{ color: '#64748b' }}>{preview.scheduledDlp} DLP</div></div>
            <div><div className="text-[10px]" style={{ color: '#64748b' }}>OT DONE (APPROVED)</div><div className="font-mono font-bold" style={{ color: dayApprovedOt.totalHours >= preview.overtimeHours ? '#10b981' : '#f59e0b' }}>{n(dayApprovedOt.totalHours, 1)}h</div><div className="text-[10px] font-mono" style={{ color: '#10b981' }}>SAR {n(dayApprovedOt.totalCost, 2)}</div></div>
            <div><div className="text-[10px]" style={{ color: '#64748b' }}>EXTRA 3PL</div><div className="font-mono font-bold" style={{ color: preview.additional3pl ? '#ef4444' : '#10b981' }}>{preview.additional3pl}</div></div>
          </div>
        </div>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: '#122338', color: '#64748b' }}>
                {['Activity', 'Volume', 'Target', 'Hours', 'Employees required'].map(header => <th key={header} className="text-right first:text-left px-3 py-2">{header}</th>)}
              </tr>
            </thead>
            <tbody>
              {preview.activities.map(activity => (
                <tr key={activity.code} className="border-t" style={{ borderColor: '#1e3a5a' }}>
                  <td className="px-3 py-2 text-white">{activity.name}</td>
                  <td className="px-3 py-2 text-right font-mono">{n(activity.volume)}</td>
                  <td className="px-3 py-2 text-right font-mono">{n(activity.target, 1)} / {activity.uom}</td>
                  <td className="px-3 py-2 text-right font-mono">{n(activity.laborHours, 1)}</td>
                  <td className="px-3 py-2 text-right font-mono" style={{ color: '#f59e0b' }}>{n(activity.requiredDlp, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={panel}>
        <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b" style={{ borderColor: '#1e3a5a' }}>
          <div>
            <div className="font-semibold text-sm text-white">Approved employee overtime — {workDate}</div>
            <div className="text-xs mt-1" style={{ color: '#64748b' }}>Overtime hours and calculated cost (Hours × OT Rate/h) for the FC workforce.</div>
          </div>
          <div className="text-xs font-mono text-emerald-400">
            Total: {n(dayApprovedOt.totalHours, 1)}h · SAR {n(dayApprovedOt.totalCost, 2)}
          </div>
        </div>
        {dayApprovedOt.rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: '#122338', color: '#64748b' }}>
                  <th className="text-left px-3 py-2">Employee</th>
                  <th className="text-left px-3 py-2">Source</th>
                  <th className="text-right px-3 py-2">Approved Hours</th>
                  <th className="text-right px-3 py-2">OT Rate</th>
                  <th className="text-right px-3 py-2">Cost</th>
                </tr>
              </thead>
              <tbody>
                {dayApprovedOt.rows.map(row => (
                  <tr key={row.id} className="border-t" style={{ borderColor: '#1e3a5a' }}>
                    <td className="px-3 py-2 text-white">{row.name} <span style={{ color: '#64748b' }}>({row.code})</span></td>
                    <td className="px-3 py-2 uppercase text-[10px]">{row.source}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-400">{n(row.hours, 2)}h</td>
                    <td className="px-3 py-2 text-right font-mono">SAR {n(row.rate, 2)}/h</td>
                    <td className="px-3 py-2 text-right font-mono text-amber-400">SAR {n(row.cost, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 text-xs" style={{ color: '#64748b' }}>No approved overtime records for FC employees on {workDate}.</div>
        )}
      </div>
    </div>
  );
}

function ImportEntry({ organizationId, weekStart, fromDate = weekStart, toDate = addDays(weekStart, 6), workspace, refresh, busy, setBusy }: { organizationId: string; weekStart: string; fromDate?: string; toDate?: string; workspace: FcWorkspace; refresh: () => Promise<void>; busy: boolean; setBusy: (v: boolean) => void }) {
  const [preview, setPreview] = useState<FcImportPreview | null>(null); const [error, setError] = useState<string | null>(null); const [replace, setReplace] = useState(false);
  const current = useMemo(() => buildFcDashboard(workspace), [workspace]);
  const knownLabels = useMemo(() => {
    const set = new Set(workspace.mappings.map(x => x.normalized_packer_label));
    workspace.employees.forEach(emp => {
      if (emp.full_name) set.add(emp.full_name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en'));
      if (emp.employee_code) set.add(emp.employee_code.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en'));
    });
    return set;
  }, [workspace.mappings, workspace.employees]);
  const sellerNames = useMemo(() => [...new Set(workspace.sellers.map(x => x.seller_name))].sort(), [workspace.sellers]);
  const [sellerRows, setSellerRows] = useState<FcSellerSupplementInput[]>([]); const [sellerReviewed, setSellerReviewed] = useState(false);
  const emptyCapacity: FcCapacityMetricInput = { capacity_bins: 0, utilized_bins: 0, capacity_pallets: 0, utilized_pallets: 0, capacity_units: 0, utilized_units: 0, capacity_cbm: 0, utilized_cbm: 0 };
  const [capacity, setCapacity] = useState<FcCapacityMetricInput>(emptyCapacity); const [capacityReviewed, setCapacityReviewed] = useState(false);
  const [adhoc, setAdhoc] = useState<FcAdhocTaskInput[]>([]); const [adhocReviewed, setAdhocReviewed] = useState(false);
  useEffect(() => { setSellerRows(sellerNames.map(name => { const row = workspace.sellerSupplements.find(x => x.seller_name === name); return { seller_name: name, purchase_order_units: row?.purchase_order_units ?? 0, return_order_units: row?.return_order_units ?? 0, return_orders: row?.return_orders ?? 0 }; })); setSellerReviewed(workspace.week?.seller_supplements_reviewed ?? false); setCapacity(workspace.capacity ?? emptyCapacity); setCapacityReviewed(workspace.week?.capacity_reviewed ?? false); setAdhoc(workspace.adhocTasks.map(x => ({ seller_name: x.seller_name, task_name: x.task_name, usage: x.usage }))); setAdhocReviewed(workspace.week?.adhoc_reviewed ?? false); }, [workspace, sellerNames.join('|')]);
  const choose = async (file?: File) => { if (!file) return; setBusy(true); setError(null); try { setPreview(await parseFcOrdersFile(file, weekStart)); setReplace(false); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to parse FC Orders file.'); } finally { setBusy(false); } };
  const saveImport = async () => { if (!preview) return; setBusy(true); setError(null); try { await fcProductivityService.saveImport(organizationId, weekStart, preview); setPreview(null); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save FC import.'); } finally { setBusy(false); } };
  const saveSection = async (section: 'seller' | 'capacity' | 'adhoc') => { setBusy(true); setError(null); try { const rows = section === 'seller' ? sellerRows : section === 'capacity' ? [capacity] : adhoc; const reviewed = section === 'seller' ? sellerReviewed : section === 'capacity' ? capacityReviewed : adhocReviewed; await fcProductivityService.saveSupplements(organizationId, weekStart, section, rows, reviewed); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save FC supplements.'); } finally { setBusy(false); } };
  const finalize = async () => { setBusy(true); setError(null); try { await fcProductivityService.finalizeWeek(organizationId, weekStart); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to finalize FC week.'); } finally { setBusy(false); } };
  return <div className="space-y-4"><ManpowerEntry organizationId={organizationId} weekStart={weekStart} fromDate={fromDate} toDate={toDate} workspace={workspace} refresh={refresh} busy={busy} setBusy={setBusy} />{error && <div className="p-3 rounded-lg flex gap-2 text-sm" style={{ background: 'rgba(239,68,68,.1)', color: '#fca5a5' }}><AlertCircle size={15} />{error}</div>}<div className="rounded-xl p-4" style={panel}><div className="font-semibold text-white">Packed Orders import</div><div className="text-xs mt-1" style={{ color: '#64748b' }}>Supporting employee and seller output detail. Accepts XLSX or CSV up to 10 MB and stores aggregates only.</div><label className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer" style={{ background: '#2563eb', color: '#fff' }}><Upload size={14} />{busy ? 'Reading…' : 'Choose Orders file'}<input type="file" accept=".xlsx,.csv" disabled={busy} className="hidden" onChange={e => void choose(e.target.files?.[0])} /></label>{preview && <div className="mt-4 rounded-xl p-4" style={{ background: '#081424', border: '1px solid #1e3a5a' }}><div className="grid grid-cols-2 md:grid-cols-5 gap-3"><Metric label="Accepted Orders" value={n(preview.packedOrders)} detail={`Change ${preview.packedOrders - current.packedOrders >= 0 ? '+' : ''}${n(preview.packedOrders - current.packedOrders)}`} /><Metric label="Packed Quantity" value={n(preview.packedQuantity)} detail={`Change ${preview.packedQuantity - current.packedQuantity >= 0 ? '+' : ''}${n(preview.packedQuantity - current.packedQuantity)}`} /><Metric label="Additional Items" value={n(preview.additionalItems)} detail={`Change ${preview.additionalItems - current.additionalItems >= 0 ? '+' : ''}${n(preview.additionalItems - current.additionalItems)}`} /><Metric label="Ignored Rows" value={n(preview.ignoredRows)} /><Metric label="Blank Packers" value={n(preview.blankPackerRows)} detail={`${preview.packerLabels.filter(label => label !== 'Unassigned' && !knownLabels.has(label.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en'))).length} unmatched labels`} /></div><div className="mt-3 text-xs" style={{ color: '#94a3b8' }}>{preview.sourceFileName} · {preview.dateFrom} to {preview.dateTo}</div>{preview.warnings.map(x => <div key={x} className="text-xs mt-1" style={{ color: '#fcd34d' }}>{x}</div>)}{workspace.week && <label className="flex items-center gap-2 mt-3 text-xs" style={{ color: '#fcd34d' }}><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />Replace revision {workspace.week.revision}; keep manual values and reset their review status.</label>}<button disabled={busy || (!!workspace.week && !replace)} onClick={() => void saveImport()} className="mt-3 px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: '#10b981', color: '#052e23' }}><Save size={13} className="inline mr-1" />Save weekly draft</button></div>}</div>
    {workspace.week && workspace.week.status === 'draft' && <><div className="rounded-xl p-4 overflow-auto" style={panel}><div className="flex justify-between"><div className="font-semibold text-white">Purchase orders and returns</div><label className="text-xs" style={{ color: '#94a3b8' }}><input type="checkbox" checked={sellerReviewed} onChange={e => setSellerReviewed(e.target.checked)} /> Reviewed</label></div><table className="w-full text-xs mt-3 min-w-[650px]"><thead><tr style={{ color: '#64748b' }}>{['Seller', 'Purchase Order Units', 'Return Order Units', 'Return Orders'].map(x => <th key={x} className="text-left py-2">{x}</th>)}</tr></thead><tbody>{sellerRows.map((row, i) => <tr key={row.seller_name}><td className="py-1 text-white">{row.seller_name}</td>{(['purchase_order_units', 'return_order_units', 'return_orders'] as const).map(key => <td key={key}><input type="number" min="0" value={row[key]} onChange={e => setSellerRows(rows => rows.map((x, j) => j === i ? { ...x, [key]: Math.max(0, Number(e.target.value) || 0) } : x))} className="w-28 px-2 py-1 rounded" style={field} /></td>)}</tr>)}</tbody></table><button onClick={() => void saveSection('seller')} disabled={busy} className="mt-3 px-3 py-2 rounded text-xs font-semibold" style={{ background: '#334155', color: '#fff' }}>Save seller section</button></div>
      <div className="rounded-xl p-4" style={panel}><div className="flex justify-between"><div className="font-semibold text-white">Capacity</div><label className="text-xs" style={{ color: '#94a3b8' }}><input type="checkbox" checked={capacityReviewed} onChange={e => setCapacityReviewed(e.target.checked)} /> Reviewed</label></div><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">{(['bins', 'pallets', 'units', 'cbm'] as const).flatMap(metric => (['capacity', 'utilized'] as const).map(kind => { const key = `${kind}_${metric}` as keyof FcCapacityMetricInput; return <label key={key} className="text-xs" style={{ color: '#94a3b8' }}>{kind === 'capacity' ? 'Capacity' : 'Utilized'} {metric.toUpperCase()}<input type="number" min="0" value={capacity[key]} onChange={e => setCapacity(x => ({ ...x, [key]: Math.max(0, Number(e.target.value) || 0) }))} className="block w-full mt-1 px-2 py-1 rounded" style={field} /></label>; }))}</div><button onClick={() => void saveSection('capacity')} disabled={busy} className="mt-3 px-3 py-2 rounded text-xs font-semibold" style={{ background: '#334155', color: '#fff' }}>Save capacity section</button></div>
      <div className="rounded-xl p-4" style={panel}><div className="flex justify-between"><div className="font-semibold text-white">Ad-hoc task usage</div><label className="text-xs" style={{ color: '#94a3b8' }}><input type="checkbox" checked={adhocReviewed} onChange={e => setAdhocReviewed(e.target.checked)} /> Reviewed, including no tasks</label></div>{adhoc.map((row, i) => <div key={i} className="grid sm:grid-cols-[1fr_1fr_140px_auto] gap-2 mt-2"><input placeholder="Seller" value={row.seller_name} onChange={e => setAdhoc(x => x.map((v, j) => j === i ? { ...v, seller_name: e.target.value } : v))} className="px-2 py-1 rounded" style={field} /><input placeholder="Task name" value={row.task_name} onChange={e => setAdhoc(x => x.map((v, j) => j === i ? { ...v, task_name: e.target.value } : v))} className="px-2 py-1 rounded" style={field} /><input type="number" min="0" value={row.usage} onChange={e => setAdhoc(x => x.map((v, j) => j === i ? { ...v, usage: Math.max(0, Number(e.target.value) || 0) } : v))} className="px-2 py-1 rounded" style={field} /><button onClick={() => setAdhoc(x => x.filter((_, j) => j !== i))} className="text-xs" style={{ color: '#fca5a5' }}>Remove</button></div>)}<div className="flex gap-2 mt-3"><button onClick={() => setAdhoc(x => [...x, { seller_name: '', task_name: '', usage: 0 }])} className="px-3 py-2 rounded text-xs" style={{ background: '#122338', color: '#93c5fd' }}>Add task</button><button onClick={() => void saveSection('adhoc')} disabled={busy} className="px-3 py-2 rounded text-xs font-semibold" style={{ background: '#334155', color: '#fff' }}>Save ad-hoc section</button></div></div>
      <div className="rounded-xl p-4 flex justify-between items-center" style={panel}><div><div className="text-white font-semibold">Finalize FC week</div><div className="text-xs mt-1" style={{ color: '#64748b' }}>All three supplemental sections must be saved as reviewed.</div></div><button onClick={() => void finalize()} disabled={busy || !workspace.week.seller_supplements_reviewed || !workspace.week.capacity_reviewed || !workspace.week.adhoc_reviewed} className="px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-40" style={{ background: '#2563eb', color: '#fff' }}><CheckCircle2 size={14} className="inline mr-1" />Finalize</button></div></>}</div>;
}

export default function FcProductivity({ organizationId, isAdmin }: { organizationId: string; isAdmin: boolean }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [period, setPeriod] = useState<FcPeriod>('week');
  const [channelFilter, setChannelFilter] = useState<FcChannelFilter>('all');
  const [workspace, setWorkspace] = useState<FcWorkspace | null>(null);
  const [tab, setTab] = useState<FcTab>('dashboard');
  const [calculatorVolume, setCalculatorVolume] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const weekStart = sunday(selectedDate);
  const fromDate = period === 'day' ? selectedDate : period === 'week' ? weekStart : monthStart(selectedDate);
  const toDate = period === 'day' ? selectedDate : period === 'week' ? addDays(weekStart, 6) : monthEnd(selectedDate);
  const load = async () => { setBusy(true); setError(null); try { setWorkspace(await fcProductivityService.loadWeek(organizationId, weekStart, fromDate, toDate)); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load FC productivity.'); } finally { setBusy(false); } };
  useEffect(() => { void load(); }, [organizationId, weekStart, fromDate, toDate]);
  const openCalculator = (volume?: number) => {
    if (volume != null) setCalculatorVolume(volume);
    setTab('calculator');
  };
  const tabs: Array<[FcTab, string]> = [['dashboard', 'Operations Dashboard'], ['calculator', 'Productivity & Overtime Calculator'], ['entry', 'Daily FC Entry'], ['activity', 'Activity Manpower Requirement'], ...(isAdmin ? [['setup', 'Setup'] as [FcTab, string]] : [])];
  return <div className="space-y-4">
    <div className="flex flex-wrap justify-between gap-3"><div><div className="flex items-center gap-2"><h1 className="text-xl font-bold text-white">FC Productivity</h1><span className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: 'rgba(6,182,212,.15)', color: '#67e8f9' }}>FC DEPARTMENT</span></div><p className="text-sm mt-0.5" style={{ color: '#4b6a8a' }}>Inbound, outbound, labor capacity and workforce planning</p></div><div className="flex flex-wrap items-end gap-3"><div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid #1e3a5a' }}>{([['all', 'All'], ['b2c', 'B2C'], ['b2b', 'B2B']] as const).map(([value, label]) => <button key={value} onClick={() => setChannelFilter(value)} className="px-3 py-2 text-xs font-semibold" style={{ background: channelFilter === value ? '#0891b2' : '#0d1b2e', color: channelFilter === value ? '#fff' : '#64748b' }}>{label}</button>)}</div><div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid #1e3a5a' }}>{(['day', 'week', 'month'] as FcPeriod[]).map(value => <button key={value} onClick={() => setPeriod(value)} className="px-3 py-2 text-xs font-semibold capitalize" style={{ background: period === value ? '#2563eb' : '#0d1b2e', color: period === value ? '#fff' : '#64748b' }}>{value}</button>)}</div><label className="text-xs" style={{ color: '#94a3b8' }}>{period === 'day' ? 'Work date' : period === 'week' ? 'Week containing' : 'Month'}<input type={period === 'month' ? 'month' : 'date'} value={period === 'month' ? selectedDate.slice(0, 7) : selectedDate} onChange={event => setSelectedDate(period === 'month' ? `${event.target.value}-01` : event.target.value)} className="block mt-1 px-3 py-2 rounded" style={field} /><span className="block mt-1" style={{ color: '#64748b' }}>{fromDate}{fromDate !== toDate ? ` through ${toDate}` : ''}</span></label></div></div>
    {error && <div className="p-3 rounded flex gap-2 text-sm" style={{ background: 'rgba(239,68,68,.1)', color: '#fca5a5' }}><AlertCircle size={15} />{error}</div>}
    {busy && !workspace ? <div className="py-20"><Loader2 className="animate-spin mx-auto" style={{ color: '#3b82f6' }} /></div> : !workspace ? <div className="p-10 rounded-xl text-center" style={panel}><Users className="mx-auto" style={{ color: '#f59e0b' }} /><div className="text-white font-semibold mt-3">FC department not found or access restricted</div><div className="text-xs mt-1" style={{ color: '#64748b' }}>Create an active department named or coded FC and assign the manager to it.</div></div> : <><div className="flex flex-wrap gap-2">{tabs.map(([id, label]) => <button key={id} onClick={() => setTab(id)} className="px-3 py-2 rounded-lg text-xs font-semibold" style={{ background: tab === id ? '#2563eb' : '#0d1b2e', color: tab === id ? '#fff' : '#64748b', border: '1px solid #1e3a5a' }}>{label}</button>)}</div>{tab === 'dashboard' && <Dashboard workspace={workspace} channelFilter={channelFilter} onOpenCalculator={openCalculator} />}{tab === 'calculator' && <FcCalculatorCard workspace={workspace} channelFilter={channelFilter} initialVolume={calculatorVolume} onOpenDashboard={() => setTab('dashboard')} />}{tab === 'entry' && <ImportEntry organizationId={organizationId} weekStart={weekStart} fromDate={fromDate} toDate={toDate} workspace={workspace} refresh={load} busy={busy} setBusy={setBusy} />}{tab === 'activity' && <ActivityRequirement workspace={workspace} channelFilter={channelFilter} />}{tab === 'setup' && isAdmin && <FcSetupPanel organizationId={organizationId} workspace={workspace} refresh={load} />}</>}
  </div>;
}
