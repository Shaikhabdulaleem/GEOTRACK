import { useEffect, useMemo, useState } from 'react';
import { Calculator, Settings, TrendingUp } from 'lucide-react';
import { calculateProductivityScenario } from '../../services/productivity.service';
import type { FcWorkspace } from '../../services/fc-productivity.service';
import { buildFcManpowerDashboard, type FcChannelFilter } from '../../lib/fc-productivity-model';
import type { FcActivityVolumeDriver } from '../../types/database';

const panelStyle = { background: '#0d1b2e', border: '1px solid #1e3a5a' };
const fieldStyle = { background: '#081424', border: '1px solid #1e3a5a', color: '#f0f6ff' };

function num(value: number, digits = 0): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export interface FcCalculatorCardProps {
  workspace: FcWorkspace;
  channelFilter?: FcChannelFilter;
  initialVolume?: number | null;
  onOpenDashboard?: () => void;
}

export default function FcCalculatorCard({
  workspace,
  channelFilter = 'all',
  initialVolume,
  onOpenDashboard,
}: FcCalculatorCardProps) {
  const periodModel = useMemo(() => buildFcManpowerDashboard(workspace, channelFilter), [workspace, channelFilter]);

  const activeClients = useMemo(
    () => (workspace.clients ?? []).filter(c => c.status === 'active'),
    [workspace.clients],
  );

  const activeStandards = useMemo(
    () => workspace.standards.filter(s => {
      if (!s.is_active) return false;
      if (channelFilter === 'b2c') return s.volume_driver === 'outbound_b2c';
      if (channelFilter === 'b2b') return s.volume_driver === 'outbound_b2b';
      return true;
    }),
    [workspace.standards, channelFilter],
  );

  const defaultBlendedRate = useMemo(() => {
    if (periodModel.requiredLaborHours > 0 && periodModel.throughput > 0) {
      return Math.round(periodModel.throughput / periodModel.requiredLaborHours);
    }
    if (activeStandards.length === 0) return 150;
    const avg = activeStandards.reduce((sum, s) => {
      const perHour = s.target_uom === 'hour' ? s.units_per_worker : s.units_per_worker / (workspace.settings?.standard_hours_per_day || 8);
      return sum + perHour;
    }, 0) / activeStandards.length;
    return Math.max(1, Math.round(avg));
  }, [periodModel, activeStandards, workspace.settings]);

  const activeDlpCount = useMemo(() => {
    if (periodModel.scheduledDlpCount > 0) return periodModel.scheduledDlpCount;
    if (periodModel.eligibleDlpCount > 0) return periodModel.eligibleDlpCount;
    return workspace.employees.length > 0 ? workspace.employees.length : 10;
  }, [periodModel, workspace.employees.length]);

  const latestDayVolume = useMemo(() => {
    const last = periodModel.daily.at(-1);
    if (last && last.throughput > 0) return last.throughput;
    if (periodModel.daily.length > 0 && periodModel.throughput > 0) {
      return Math.round(periodModel.throughput / periodModel.daily.length);
    }
    return 5000;
  }, [periodModel]);

  const [selectedClientId, setSelectedClientId] = useState<string>('all');
  const [selectedActivityCode, setSelectedActivityCode] = useState<string>('full_workflow');
  const [targetVolume, setTargetVolume] = useState<number>(initialVolume ?? latestDayVolume);
  const [customRate, setCustomRate] = useState<number | null>(null);
  const [currentEmployees, setCurrentEmployees] = useState<number>(activeDlpCount);
  const [standardHoursPerDay, setStandardHoursPerDay] = useState<number>(workspace.settings?.standard_hours_per_day || 8);
  const [maxOvertimeHoursPerDay, setMaxOvertimeHoursPerDay] = useState<number>(workspace.settings?.max_overtime_hours_per_day || 3);
  const [plannedAbsencePercent] = useState<number>(workspace.settings?.planned_absence_percent ?? 5);
  const [overtimeHourlyCost, setOvertimeHourlyCost] = useState<number>(
    workspace.settings?.overtime_hourly_cost_own || workspace.settings?.overtime_hourly_cost_3pl || 25,
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (initialVolume != null && initialVolume > 0) {
      setTargetVolume(initialVolume);
    }
  }, [initialVolume]);

  useEffect(() => {
    setCurrentEmployees(activeDlpCount);
  }, [activeDlpCount]);

  const selectedClient = useMemo(
    () => activeClients.find(c => c.id === selectedClientId) ?? null,
    [activeClients, selectedClientId],
  );

  const selectedStandard = useMemo(
    () => activeStandards.find(s => s.activity_code === selectedActivityCode) ?? null,
    [activeStandards, selectedActivityCode],
  );

  const unitsPerLaborHour = useMemo(() => {
    if (customRate !== null && customRate > 0) return customRate;

    if (selectedStandard) {
      const driver: FcActivityVolumeDriver = selectedStandard.volume_driver;
      if (selectedClient) {
        if (driver === 'inbound' && selectedClient.inbound_rate_override) return selectedClient.inbound_rate_override;
        if (driver === 'outbound_b2c' && selectedClient.outbound_b2c_rate_override) return selectedClient.outbound_b2c_rate_override;
        if (driver === 'outbound_b2b' && selectedClient.outbound_b2b_rate_override) return selectedClient.outbound_b2b_rate_override;
        if ((driver === 'return_rto' || driver === 'return_cir' || driver === 'returns_total') && selectedClient.returns_rate_override) return selectedClient.returns_rate_override;
        if ((driver === 'vas' || driver === 'gift_wrap') && selectedClient.vas_rate_override) return selectedClient.vas_rate_override;
      }
      return selectedStandard.target_uom === 'hour'
        ? selectedStandard.units_per_worker
        : Math.max(1, selectedStandard.units_per_worker / standardHoursPerDay);
    }

    if (selectedClient) {
      const overrides = [
        selectedClient.inbound_rate_override,
        selectedClient.outbound_b2c_rate_override,
        selectedClient.outbound_b2b_rate_override,
        selectedClient.returns_rate_override,
        selectedClient.vas_rate_override,
      ].filter((v): v is number => v != null && v > 0);
      if (overrides.length > 0) {
        return Math.round(overrides.reduce((s, v) => s + v, 0) / overrides.length);
      }
    }

    return defaultBlendedRate;
  }, [customRate, selectedStandard, selectedClient, standardHoursPerDay, defaultBlendedRate]);

  const calculation = useMemo(() => {
    return calculateProductivityScenario({
      targetVolume,
      unitsPerLaborHour,
      currentEmployees,
      standardHoursPerDay,
      maxOvertimeHoursPerDay,
      plannedAbsencePercent,
      overtimeHourlyCost,
      employeeNamePrefix: 'FC DLP',
    });
  }, [
    targetVolume,
    unitsPerLaborHour,
    currentEmployees,
    standardHoursPerDay,
    maxOvertimeHoursPerDay,
    plannedAbsencePercent,
    overtimeHourlyCost,
  ]);

  const volumePresets = [2000, 5000, 10000, 15000];

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-4 flex flex-wrap items-center justify-between gap-3" style={panelStyle}>
        <div>
          <div className="flex items-center gap-2">
            <Calculator size={18} style={{ color: '#3b82f6' }} />
            <h2 className="text-base font-bold text-white">Productivity & Overtime Calculator</h2>
            <span
              className="px-2 py-0.5 rounded text-[10px] font-bold"
              style={{ background: 'rgba(59,130,246,0.15)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.3)' }}
            >
              LABOR CAPACITY MODEL
            </span>
          </div>
          <p className="text-xs mt-1" style={{ color: '#64748b' }}>
            Select an FC client or activity standard, enter target daily volume, and specify headcount. Calculates units
            achievable in regular hours and overtime required per person.
          </p>
        </div>
        {onOpenDashboard && (
          <button
            type="button"
            onClick={onOpenDashboard}
            className="px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: '#122338', color: '#93c5fd', border: '1px solid #1e3a5a' }}
          >
            View Operations Dashboard →
          </button>
        )}
      </div>

      <div className="grid xl:grid-cols-12 gap-4">
        <div className="xl:col-span-5 rounded-xl p-4 space-y-4" style={panelStyle}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-white">Scenario Configuration</div>
            <button
              type="button"
              onClick={() => setShowAdvanced(prev => !prev)}
              className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg"
              style={{ background: '#122338', color: '#93c5fd', border: '1px solid #1e3a5a' }}
            >
              <Settings size={12} />
              {showAdvanced ? 'Hide Policy' : 'Policy & Rates'}
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#94a3b8' }}>
              Select FC Client / Seller
            </label>
            <select
              value={selectedClientId}
              onChange={e => {
                setSelectedClientId(e.target.value);
                setCustomRate(null);
              }}
              className="w-full px-3 py-2.5 rounded-lg text-sm font-medium"
              style={fieldStyle}
            >
              <option value="all">All FC Clients (Blended Standards — {defaultBlendedRate} u/h)</option>
              {activeClients.map(client => (
                <option key={client.id} value={client.id}>
                  {client.name} ({client.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#94a3b8' }}>
              Activity / Workflow Stage
            </label>
            <select
              value={selectedActivityCode}
              onChange={e => {
                setSelectedActivityCode(e.target.value);
                setCustomRate(null);
              }}
              className="w-full px-3 py-2.5 rounded-lg text-sm font-medium"
              style={fieldStyle}
            >
              <option value="full_workflow">Blended FC Workflow ({defaultBlendedRate} u/h)</option>
              {activeStandards.map(std => (
                <option key={std.id} value={std.activity_code}>
                  {std.activity_name} ({num(std.units_per_worker, 1)} / {std.target_uom})
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium" style={{ color: '#94a3b8' }}>
                Target Daily Volume (Units)
              </label>
              <button
                type="button"
                onClick={() => setTargetVolume(latestDayVolume)}
                className="text-[11px] font-medium hover:underline"
                style={{ color: '#60a5fa' }}
              >
                Reset to Latest ({num(latestDayVolume)})
              </button>
            </div>
            <input
              type="number"
              min="0"
              value={targetVolume}
              onChange={e => setTargetVolume(Math.max(0, Number(e.target.value) || 0))}
              className="w-full px-3 py-2.5 rounded-lg text-base font-mono font-bold"
              style={fieldStyle}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {volumePresets.map(preset => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setTargetVolume(preset)}
                  className="px-2.5 py-1 rounded text-[11px] font-mono"
                  style={{
                    background: targetVolume === preset ? '#1d4ed8' : '#122338',
                    color: targetVolume === preset ? '#fff' : '#94a3b8',
                    border: '1px solid #1e3a5a',
                  }}
                >
                  {num(preset)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#94a3b8' }}>
                Current Headcount (DLP)
              </label>
              <input
                type="number"
                min="1"
                value={currentEmployees}
                onChange={e => setCurrentEmployees(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                className="w-full px-3 py-2 rounded-lg text-sm font-mono font-bold"
                style={fieldStyle}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: '#94a3b8' }}>
                Throughput Rate (u/h)
              </label>
              <input
                type="number"
                min="1"
                value={Math.round(unitsPerLaborHour)}
                onChange={e => setCustomRate(Math.max(1, Number(e.target.value) || 1))}
                className="w-full px-3 py-2 rounded-lg text-sm font-mono font-bold"
                style={fieldStyle}
              />
            </div>
          </div>

          {showAdvanced && (
            <div className="grid grid-cols-3 gap-2 pt-2 border-t" style={{ borderColor: '#1e3a5a' }}>
              <label className="text-[11px]" style={{ color: '#94a3b8' }}>
                Reg. Hours/Day
                <input
                  type="number"
                  min="1"
                  max="24"
                  step="0.5"
                  value={standardHoursPerDay}
                  onChange={e => setStandardHoursPerDay(Math.max(1, Number(e.target.value) || 8))}
                  className="mt-1 w-full px-2 py-1.5 rounded font-mono"
                  style={fieldStyle}
                />
              </label>
              <label className="text-[11px]" style={{ color: '#94a3b8' }}>
                Max OT/Day
                <input
                  type="number"
                  min="0"
                  max="12"
                  step="0.5"
                  value={maxOvertimeHoursPerDay}
                  onChange={e => setMaxOvertimeHoursPerDay(Math.max(0, Number(e.target.value) || 0))}
                  className="mt-1 w-full px-2 py-1.5 rounded font-mono"
                  style={fieldStyle}
                />
              </label>
              <label className="text-[11px]" style={{ color: '#94a3b8' }}>
                OT Rate (SAR/h)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={overtimeHourlyCost}
                  onChange={e => setOvertimeHourlyCost(Math.max(0, Number(e.target.value) || 0))}
                  className="mt-1 w-full px-2 py-1.5 rounded font-mono"
                  style={fieldStyle}
                />
              </label>
            </div>
          )}
        </div>

        <div className="xl:col-span-7 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl p-4" style={panelStyle}>
              <div className="text-[11px] uppercase tracking-wider" style={{ color: '#4b6a8a' }}>Regular Capacity</div>
              <div className="text-xl font-bold font-mono mt-1 text-blue-400">
                {num(calculation.regularCapacityUnits)} u
              </div>
              <div className="text-[11px] mt-1" style={{ color: '#64748b' }}>
                {num(calculation.regularCapacityHours, 1)}h ({num(calculation.regularCoveragePercent)}%)
              </div>
            </div>
            <div className="rounded-xl p-4" style={panelStyle}>
              <div className="text-[11px] uppercase tracking-wider" style={{ color: '#4b6a8a' }}>Unmet (Needs OT)</div>
              <div
                className="text-xl font-bold font-mono mt-1"
                style={{ color: calculation.volumeShortage > 0 ? '#f59e0b' : '#10b981' }}
              >
                {num(calculation.volumeShortage)} u
              </div>
              <div className="text-[11px] mt-1" style={{ color: '#64748b' }}>
                {calculation.volumeShortage > 0 ? 'Exceeds regular hours' : 'Covered in regular shift'}
              </div>
            </div>
            <div className="rounded-xl p-4" style={panelStyle}>
              <div className="text-[11px] uppercase tracking-wider" style={{ color: '#4b6a8a' }}>OT Required</div>
              <div className="text-xl font-bold font-mono mt-1 text-purple-400">
                {num(calculation.totalOvertimeHoursNeeded, 1)}h
              </div>
              <div className="text-[11px] mt-1" style={{ color: '#c4b5fd' }}>
                {num(calculation.otHoursPerPerson, 2)}h / person
              </div>
            </div>
            <div className="rounded-xl p-4" style={panelStyle}>
              <div className="text-[11px] uppercase tracking-wider" style={{ color: '#4b6a8a' }}>Est. OT Cost</div>
              <div className="text-xl font-bold font-mono mt-1 text-amber-400">
                SAR {num(calculation.totalOvertimeCost, 2)}
              </div>
              <div className="text-[11px] mt-1" style={{ color: calculation.additionalHeadcountNeededWithMaxOt > 0 ? '#ef4444' : '#10b981' }}>
                {calculation.additionalHeadcountNeededWithMaxOt > 0
                  ? `+${calculation.additionalHeadcountNeededWithMaxOt} extra 3PL needed`
                  : 'No extra 3PL needed'}
              </div>
            </div>
          </div>

          <div className="rounded-xl p-4" style={panelStyle}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <TrendingUp size={15} style={{ color: '#10b981' }} />
                Capacity & Shift Allocation Breakdown
              </div>
              <div className="text-xs font-mono" style={{ color: '#94a3b8' }}>
                Required Staff: <strong className="text-white">{num(calculation.requiredFte, 1)} DLP</strong>
              </div>
            </div>
            <div className="space-y-2 text-xs">
              {[
                ['Workload hours needed (incl. reserve)', `${num(calculation.totalRequiredLaborHours, 1)}h`, '#f59e0b'],
                ['Available regular hours', `${num(calculation.regularCapacityHours, 1)}h`, '#3b82f6'],
                ['Units per employee (regular shift)', `${num(unitsPerLaborHour * standardHoursPerDay)} units`, '#93c5fd'],
                ['Max OT capacity (team)', `${num(calculation.maxPossibleOvertimeHours, 1)}h (${num(maxOvertimeHoursPerDay, 1)}h/person)`, '#8b5cf6'],
                ['Additional 3PL headcount needed', `${calculation.additionalHeadcountNeededWithMaxOt} employees`, calculation.additionalHeadcountNeededWithMaxOt > 0 ? '#ef4444' : '#10b981'],
              ].map(([label, value, color]) => (
                <div key={label} className="flex justify-between items-center p-2.5 rounded-lg" style={{ background: '#122338' }}>
                  <span style={{ color: '#94a3b8' }}>{label}</span>
                  <span className="font-mono font-bold" style={{ color }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
