import { useState, useMemo, useEffect } from 'react';
import { Calculator, Settings, TrendingUp } from 'lucide-react';
import {
  calculateProductivityScenario,
  getClientProductivityProfiles,
  type MailroomWorkspace,
} from '../../services/productivity.service';

const panelStyle = { background: '#0d1b2e', border: '1px solid #1e3a5a' };
const fieldStyle = { background: '#081424', border: '1px solid #1e3a5a', color: '#f0f6ff' };

function number(value: number, digits = 0): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export interface ProductivityCalculatorCardProps {
  workspace: MailroomWorkspace;
  initialVolume?: number | null;
  onOpenDashboard?: () => void;
}

export default function ProductivityCalculatorCard({
  workspace,
  initialVolume,
  onOpenDashboard,
}: ProductivityCalculatorCardProps) {
  const clientProfiles = useMemo(() => getClientProductivityProfiles(workspace), [workspace]);

  // Overall department blended throughput rate across all active clients
  const defaultBlendedRate = useMemo(() => {
    if (clientProfiles.length === 0) return 150;
    const totalEffective = clientProfiles.reduce((sum, p) => sum + p.effectiveUnitsPerHour, 0);
    return Math.round(totalEffective / clientProfiles.length);
  }, [clientProfiles]);

  const activeDlpCount = useMemo(() => {
    const dlpEmployees = workspace.employees.filter(emp => {
      const s = workspace.employeeSettings.find(item => item.employee_id === emp.id);
      return s?.labor_class === 'dlp';
    });
    return dlpEmployees.length > 0 ? dlpEmployees.length : 10;
  }, [workspace]);

  // Overall recent shipment volume across all clients
  const overallRecentVolume = useMemo(() => {
    if (workspace.shipments.length > 0) {
      const dates = [...new Set(workspace.shipments.map(s => s.work_date))].sort();
      const lastDate = dates[dates.length - 1];
      const sum = workspace.shipments
        .filter(s => s.work_date === lastDate)
        .reduce((acc, row) => acc + (row.received_units || 0), 0);
      if (sum > 0) return sum;
    }
    return 14178;
  }, [workspace]);

  const [selectedClientId, setSelectedClientId] = useState<string>('all');
  const [selectedWorkflowStage, setSelectedWorkflowStage] = useState<string>('full_workflow');
  const [targetVolume, setTargetVolume] = useState<number>(initialVolume ?? overallRecentVolume);
  const [customRate, setCustomRate] = useState<number | null>(null);
  const [currentEmployees, setCurrentEmployees] = useState<number>(activeDlpCount);
  const [standardHoursPerDay, setStandardHoursPerDay] = useState<number>(workspace.settings.standard_hours_per_day || 8);
  const [maxOvertimeHoursPerDay, setMaxOvertimeHoursPerDay] = useState<number>(workspace.settings.max_overtime_hours_per_day || 3);
  const [plannedAbsencePercent, setPlannedAbsencePercent] = useState<number>(workspace.settings.planned_absence_percent || 0);
  const [overtimeHourlyCost, setOvertimeHourlyCost] = useState<number>(
    workspace.settings.overtime_hourly_cost_own || workspace.settings.overtime_hourly_cost || 25
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    setCurrentEmployees(activeDlpCount);
  }, [activeDlpCount]);

  useEffect(() => {
    setStandardHoursPerDay(workspace.settings.standard_hours_per_day || 8);
    setMaxOvertimeHoursPerDay(workspace.settings.max_overtime_hours_per_day || 3);
    setPlannedAbsencePercent(workspace.settings.planned_absence_percent || 0);
    setOvertimeHourlyCost(workspace.settings.overtime_hourly_cost_own || workspace.settings.overtime_hourly_cost || 25);
  }, [
    workspace.settings.standard_hours_per_day,
    workspace.settings.max_overtime_hours_per_day,
    workspace.settings.planned_absence_percent,
    workspace.settings.overtime_hourly_cost_own,
    workspace.settings.overtime_hourly_cost,
  ]);

  // The active client object if a specific client is selected
  const activeClientProfile = useMemo(() => {
    return clientProfiles.find(p => p.clientId === selectedClientId) ?? null;
  }, [clientProfiles, selectedClientId]);

  // Determine current active throughput rate
  const unitsPerLaborHour = useMemo(() => {
    if (customRate !== null && customRate > 0) return customRate;
    if (activeClientProfile) {
      if (selectedWorkflowStage !== 'full_workflow') {
        const stage = activeClientProfile.activities.find(a => a.activityId === selectedWorkflowStage);
        if (stage && stage.unitsPerHour > 0) return stage.unitsPerHour;
      }
      return activeClientProfile.effectiveUnitsPerHour > 0 ? activeClientProfile.effectiveUnitsPerHour : 150;
    }
    return defaultBlendedRate > 0 ? defaultBlendedRate : 150;
  }, [customRate, activeClientProfile, selectedWorkflowStage, defaultBlendedRate]);

  // Handle client selection change
  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);
    setSelectedWorkflowStage('full_workflow');
    setCustomRate(null);
    if (clientId === 'all') {
      setTargetVolume(overallRecentVolume);
    } else {
      const profile = clientProfiles.find(p => p.clientId === clientId);
      if (profile && profile.recentShipmentVolume > 0) {
        setTargetVolume(profile.recentShipmentVolume);
      }
    }
  };

  useEffect(() => {
    if (initialVolume != null && initialVolume > 0) {
      setTargetVolume(initialVolume);
    }
  }, [initialVolume]);

  const calculation = useMemo(() => {
    return calculateProductivityScenario({
      targetVolume,
      unitsPerLaborHour,
      currentEmployees,
      standardHoursPerDay,
      maxOvertimeHoursPerDay,
      plannedAbsencePercent,
      overtimeHourlyCost,
      employeeNamePrefix: 'Mailroom DLP',
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

  const recentVolumeForClient = activeClientProfile?.recentShipmentVolume || overallRecentVolume;
  const volumePresets = [5000, 10000, 14178, 20000];

  return (
    <div className="space-y-4">
      {/* Header Banner */}
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
            Select a client, enter shipment volume, and specify current headcount. Calculates exact volume achievable in
            regular hours and overtime required per person.
          </p>
        </div>
        {onOpenDashboard && (
          <button
            type="button"
            onClick={onOpenDashboard}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: '#122338', border: '1px solid #1e3a5a', color: '#93c5fd' }}
          >
            <TrendingUp size={13} />
            View Operations Dashboard
          </button>
        )}
      </div>

      {/* 3 Main Interactive Inputs (Client, Volume, Labour) */}
      <div className="rounded-xl p-5 space-y-4" style={panelStyle}>
        <div className="grid lg:grid-cols-3 gap-5">
          {/* 1. SELECT CLIENT */}
          <div>
            <label className="text-xs font-bold text-white flex items-center justify-between mb-1.5">
              <span className="flex items-center gap-1.5 text-blue-400">
                <span className="w-5 h-5 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center text-[11px] font-bold">
                  1
                </span>
                Select Client
              </span>
              <span className="text-[10px] font-mono text-slate-400">Workflow & rate</span>
            </label>
            <select
              value={selectedClientId}
              onChange={e => handleClientChange(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm font-semibold text-white transition-all cursor-pointer"
              style={fieldStyle}
            >
              <option value="all">All Clients / Blended Average (~{defaultBlendedRate} units/h)</option>
              {clientProfiles.map(p => (
                <option key={p.clientId} value={p.clientId}>
                  {p.clientName} ({p.effectiveUnitsPerHour} units/labor-hour)
                </option>
              ))}
            </select>

            {/* Workflow Stage / Throughput Selector */}
            <div className="mt-2 text-xs">
              {activeClientProfile && activeClientProfile.activities.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium" style={{ color: '#94a3b8' }}>
                    Workflow Rate:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedWorkflowStage('full_workflow');
                        setCustomRate(null);
                      }}
                      className="px-2.5 py-1 rounded text-[11px] font-mono font-semibold transition-colors"
                      style={{
                        background:
                          selectedWorkflowStage === 'full_workflow' && customRate === null ? '#2563eb' : '#122338',
                        color: selectedWorkflowStage === 'full_workflow' && customRate === null ? '#fff' : '#94a3b8',
                        border: `1px solid ${selectedWorkflowStage === 'full_workflow' && customRate === null ? '#3b82f6' : '#1e3a5a'}`,
                      }}
                      title="Full end-to-end processing across all workflow stages"
                    >
                      Full Workflow: {activeClientProfile.effectiveUnitsPerHour}/h
                    </button>
                    {activeClientProfile.activities.map(act => (
                      <button
                        key={act.activityId}
                        type="button"
                        onClick={() => {
                          setSelectedWorkflowStage(act.activityId);
                          setCustomRate(null);
                        }}
                        className="px-2 py-1 rounded text-[10px] font-mono transition-colors"
                        style={{
                          background:
                            selectedWorkflowStage === act.activityId && customRate === null ? '#2563eb' : '#122338',
                          color: selectedWorkflowStage === act.activityId && customRate === null ? '#fff' : '#94a3b8',
                          border: `1px solid ${selectedWorkflowStage === act.activityId && customRate === null ? '#3b82f6' : '#1e3a5a'}`,
                        }}
                        title={act.activityName}
                      >
                        {act.activityName.slice(0, 16)}: {act.unitsPerHour}/h
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-[11px]" style={{ color: '#64748b' }}>
                  Standard throughput:{' '}
                  <strong className="text-blue-400 font-mono">{unitsPerLaborHour} units / labor-hour</strong>
                </div>
              )}
            </div>
          </div>

          {/* 2. TARGET VOLUME */}
          <div>
            <label className="text-xs font-bold text-white flex items-center justify-between mb-1.5">
              <span className="flex items-center gap-1.5 text-blue-400">
                <span className="w-5 h-5 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center text-[11px] font-bold">
                  2
                </span>
                Enter Shipment Volume
              </span>
              <span className="text-[10px] font-mono text-slate-400">Total units</span>
            </label>
            <input
              type="number"
              min="0"
              step="100"
              value={targetVolume}
              onChange={e => setTargetVolume(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              className="w-full px-3 py-2 rounded-lg text-base font-mono font-bold"
              style={fieldStyle}
              placeholder="e.g. 14,178"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {recentVolumeForClient > 0 && (
                <button
                  type="button"
                  onClick={() => setTargetVolume(recentVolumeForClient)}
                  className="px-2.5 py-1 rounded text-[10px] font-mono font-bold transition-colors"
                  style={{
                    background: targetVolume === recentVolumeForClient ? '#2563eb' : '#122338',
                    color: targetVolume === recentVolumeForClient ? '#fff' : '#60a5fa',
                    border: `1px solid ${targetVolume === recentVolumeForClient ? '#3b82f6' : '#2563eb'}`,
                  }}
                >
                  Yesterday ({number(recentVolumeForClient)})
                </button>
              )}
              {volumePresets
                .filter(p => p !== recentVolumeForClient)
                .map(preset => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setTargetVolume(preset)}
                    className="px-2 py-1 rounded text-[10px] font-mono transition-colors"
                    style={{
                      background: targetVolume === preset ? '#2563eb' : '#122338',
                      color: targetVolume === preset ? '#fff' : '#94a3b8',
                      border: `1px solid ${targetVolume === preset ? '#3b82f6' : '#1e3a5a'}`,
                    }}
                  >
                    {preset.toLocaleString()}
                  </button>
                ))}
            </div>
          </div>

          {/* 3. CURRENT LABOUR AVAILABLE */}
          <div>
            <label className="text-xs font-bold text-white flex items-center justify-between mb-1.5">
              <span className="flex items-center gap-1.5 text-blue-400">
                <span className="w-5 h-5 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center text-[11px] font-bold">
                  3
                </span>
                Current Labour We Have
              </span>
              <span className="text-[10px] font-mono text-emerald-400 font-semibold">{activeDlpCount} DLP active</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentEmployees(c => Math.max(1, c - 1))}
                className="w-10 h-10 rounded-lg font-bold text-lg flex items-center justify-center transition-colors"
                style={{ background: '#122338', border: '1px solid #1e3a5a', color: '#fff' }}
              >
                -
              </button>
              <input
                type="number"
                min="1"
                value={currentEmployees}
                onChange={e => setCurrentEmployees(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                className="flex-1 h-10 px-3 rounded-lg text-base font-mono font-bold text-center"
                style={fieldStyle}
              />
              <button
                type="button"
                onClick={() => setCurrentEmployees(c => c + 1)}
                className="w-10 h-10 rounded-lg font-bold text-lg flex items-center justify-center transition-colors"
                style={{ background: '#122338', border: '1px solid #1e3a5a', color: '#fff' }}
              >
                +
              </button>
            </div>
            <div className="flex items-center justify-between mt-2">
              <button
                type="button"
                onClick={() => setCurrentEmployees(activeDlpCount)}
                className="text-[10px] font-mono px-2 py-1 rounded"
                style={{ background: '#122338', border: '1px solid #1e3a5a', color: '#93c5fd' }}
              >
                Reset to Active Team ({activeDlpCount})
              </button>
              <span className="text-[10px] font-mono" style={{ color: '#64748b' }}>
                {standardHoursPerDay}h standard shift
              </span>
            </div>
          </div>
        </div>

        {/* Expandable Parameters */}
        <div className="pt-2 border-t" style={{ borderColor: '#1e3a5a' }}>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs flex items-center gap-1 font-semibold"
            style={{ color: '#93c5fd' }}
          >
            <Settings size={12} />
            {showAdvanced
              ? 'Hide Fine-Tuning & Shift Parameters'
              : `Fine-Tune Parameters (Rate: ${unitsPerLaborHour}/h · Standard: ${standardHoursPerDay}h · Max OT: ${maxOvertimeHoursPerDay}h)`}
          </button>

          {showAdvanced && (
            <div
              className="mt-3 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3.5 rounded-lg"
              style={{ background: '#081424', border: '1px solid #1e3a5a' }}
            >
              <div>
                <label className="text-[11px] text-white block font-medium">Throughput Rate Override (units/h)</label>
                <input
                  type="number"
                  min="1"
                  value={unitsPerLaborHour}
                  onChange={e => setCustomRate(Math.max(1, Number(e.target.value) || 150))}
                  className="mt-1 w-full px-2.5 py-1.5 rounded text-xs font-mono font-bold"
                  style={fieldStyle}
                />
              </div>
              <div>
                <label className="text-[11px] text-white block font-medium">Standard Shift Hours</label>
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={standardHoursPerDay}
                  onChange={e => setStandardHoursPerDay(Math.max(1, Number(e.target.value) || 8))}
                  className="mt-1 w-full px-2.5 py-1.5 rounded text-xs font-mono"
                  style={fieldStyle}
                />
              </div>
              <div>
                <label className="text-[11px] text-white block font-medium">Max Daily OT Limit (hours)</label>
                <input
                  type="number"
                  min="0"
                  max="8"
                  value={maxOvertimeHoursPerDay}
                  onChange={e => setMaxOvertimeHoursPerDay(Math.max(0, Number(e.target.value) || 3))}
                  className="mt-1 w-full px-2.5 py-1.5 rounded text-xs font-mono"
                  style={fieldStyle}
                />
              </div>
              <div>
                <label className="text-[11px] text-white block font-medium">Overtime Cost (SAR/h)</label>
                <input
                  type="number"
                  min="0"
                  value={overtimeHourlyCost}
                  onChange={e => setOvertimeHourlyCost(Math.max(0, Number(e.target.value) || 25))}
                  className="mt-1 w-full px-2.5 py-1.5 rounded text-xs font-mono"
                  style={fieldStyle}
                />
              </div>
              <div>
                <label className="text-[11px] text-white block font-medium">Planned Absence %</label>
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={plannedAbsencePercent}
                  onChange={e => setPlannedAbsencePercent(Math.min(99, Math.max(0, Number(e.target.value) || 0)))}
                  className="mt-1 w-full px-2.5 py-1.5 rounded text-xs font-mono"
                  style={fieldStyle}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2 MAIN HERO RESULTS */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* HERO CARD 1: REGULAR HOURS CAPACITY */}
        <div
          className="rounded-xl p-5 flex flex-col justify-between"
          style={{ background: '#0a192f', border: '1px solid #10b981' }}
        >
          <div>
            <div className="flex items-center justify-between mb-2">
              <span
                className="px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider"
                style={{
                  background: 'rgba(16,185,129,0.15)',
                  color: '#6ee7b7',
                  border: '1px solid rgba(16,185,129,0.3)',
                }}
              >
                REGULAR 8-HOUR SHIFT
              </span>
              <span className="text-xs font-mono text-emerald-400 font-bold">
                {calculation.regularCoveragePercent}% Covered
              </span>
            </div>

            <div className="text-xs" style={{ color: '#94a3b8' }}>
              With currently <strong>{calculation.currentEmployees} employees</strong> in regular hours (
              {calculation.standardHoursPerDay}h):
            </div>

            <div className="mt-2 text-3xl sm:text-4xl font-extrabold font-mono text-emerald-400">
              {number(calculation.regularCapacityUnits)}{' '}
              <span className="text-lg font-sans font-bold text-emerald-200">units</span>
            </div>

            {/* Visual progress bar */}
            <div className="mt-3 h-2.5 rounded-full overflow-hidden" style={{ background: '#122338' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, calculation.regularCoveragePercent)}%`,
                  background: calculation.regularCoveragePercent >= 100 ? '#10b981' : '#3b82f6',
                }}
              />
            </div>

            <div className="mt-3.5 space-y-1.5 text-xs font-mono">
              <div className="flex justify-between py-1 border-b" style={{ borderColor: 'rgba(16,185,129,0.15)' }}>
                <span style={{ color: '#94a3b8' }}>Regular Labor Hours Available:</span>
                <strong className="text-white">
                  {number(calculation.regularCapacityHours, 1)}h ({calculation.currentEmployees} staff ×{' '}
                  {calculation.standardHoursPerDay}h)
                </strong>
              </div>
              <div className="flex justify-between py-1 border-b" style={{ borderColor: 'rgba(16,185,129,0.15)' }}>
                <span style={{ color: '#94a3b8' }}>Throughput Speed Applied:</span>
                <strong className="text-white">{calculation.unitsPerLaborHour} units / labor-hour</strong>
              </div>
              <div className="flex justify-between py-1" style={{ borderColor: 'rgba(16,185,129,0.15)' }}>
                <span style={{ color: '#94a3b8' }}>Remaining Shortage Gap:</span>
                <strong style={{ color: calculation.volumeShortage > 0 ? '#f59e0b' : '#10b981' }}>
                  {calculation.volumeShortage > 0
                    ? `-${number(calculation.volumeShortage)} units (${number(calculation.hoursShortage, 1)}h labor)`
                    : '0 units (100% Covered!)'}
                </strong>
              </div>
            </div>
          </div>

          <div
            className="mt-4 pt-3 border-t text-xs font-semibold"
            style={{
              borderColor: 'rgba(16,185,129,0.2)',
              color: calculation.volumeShortage === 0 ? '#6ee7b7' : '#93c5fd',
            }}
          >
            {calculation.volumeShortage === 0
              ? '✓ Current staff completes 100% of the volume in regular hours with zero overtime!'
              : `Current staff covers ${number(calculation.regularCapacityUnits)} units; the remaining ${number(calculation.volumeShortage)} units require overtime.`}
          </div>
        </div>

        {/* HERO CARD 2: OVERTIME REQUIRED PER PERSON */}
        <div
          className="rounded-xl p-5 flex flex-col justify-between"
          style={{
            background: '#0d1b2e',
            border:
              calculation.otHoursPerPerson === 0
                ? '1px solid #10b981'
                : calculation.isOvertimeFeasible
                  ? '1px solid #8b5cf6'
                  : '1px solid #ef4444',
          }}
        >
          <div>
            <div className="flex items-center justify-between mb-2">
              <span
                className="px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider"
                style={{
                  background:
                    calculation.otHoursPerPerson === 0
                      ? 'rgba(16,185,129,0.15)'
                      : calculation.isOvertimeFeasible
                        ? 'rgba(139,92,246,0.15)'
                        : 'rgba(239,68,68,0.15)',
                  color:
                    calculation.otHoursPerPerson === 0
                      ? '#6ee7b7'
                      : calculation.isOvertimeFeasible
                        ? '#c4b5fd'
                        : '#fca5a5',
                  border: `1px solid ${
                    calculation.otHoursPerPerson === 0
                      ? 'rgba(16,185,129,0.3)'
                      : calculation.isOvertimeFeasible
                        ? 'rgba(139,92,246,0.3)'
                        : 'rgba(239,68,68,0.3)'
                  }`,
                }}
              >
                OVERTIME (OT) ANALYSIS
              </span>
              <span
                className="text-xs font-mono font-bold"
                style={{ color: calculation.isOvertimeFeasible ? '#c4b5fd' : '#f87171' }}
              >
                Cap: {calculation.maxOvertimeHoursPerDay}h/day
              </span>
            </div>

            <div className="text-xs" style={{ color: '#94a3b8' }}>
              Overtime required to complete remaining {number(calculation.volumeShortage)} units:
            </div>

            <div
              className="mt-2 text-3xl sm:text-4xl font-extrabold font-mono"
              style={{
                color:
                  calculation.otHoursPerPerson === 0
                    ? '#10b981'
                    : calculation.isOvertimeFeasible
                      ? '#c4b5fd'
                      : '#ef4444',
              }}
            >
              {calculation.otHoursPerPerson === 0 ? '0' : number(calculation.otHoursPerPerson, 1)}{' '}
              <span className="text-lg font-sans font-bold" style={{ color: '#94a3b8' }}>
                Hours / Person
              </span>
            </div>

            <div className="mt-3.5 space-y-1.5 text-xs font-mono">
              <div className="flex justify-between py-1 border-b" style={{ borderColor: '#1e3a5a' }}>
                <span style={{ color: '#94a3b8' }}>Total Shift Length:</span>
                <strong className="text-white">
                  {number(calculation.shiftHoursPerPerson, 1)} Hours ({calculation.standardHoursPerDay}h regular +{' '}
                  {number(calculation.otHoursPerPerson, 1)}h OT)
                </strong>
              </div>
              <div className="flex justify-between py-1 border-b" style={{ borderColor: '#1e3a5a' }}>
                <span style={{ color: '#94a3b8' }}>Total Team OT Needed:</span>
                <strong className="text-white">
                  {number(calculation.totalOvertimeHoursNeeded, 1)} Hours (across all {calculation.currentEmployees}{' '}
                  staff)
                </strong>
              </div>
              <div className="flex justify-between py-1" style={{ borderColor: '#1e3a5a' }}>
                <span style={{ color: '#94a3b8' }}>Estimated Overtime Cost:</span>
                <strong className="text-amber-300">
                  SAR {number(calculation.totalOvertimeCost, 2)} (SAR {number(calculation.otCostPerPerson, 2)}/person)
                </strong>
              </div>
            </div>
          </div>

          {/* Feasibility Alert Message */}
          <div className="mt-4 pt-3 border-t text-xs font-semibold" style={{ borderColor: '#1e3a5a' }}>
            {calculation.otHoursPerPerson === 0 ? (
              <span className="text-emerald-400">✓ No overtime required — 100% completed in standard regular hours!</span>
            ) : calculation.isOvertimeFeasible ? (
              <span className="text-purple-300">
                ✓ Feasible: Within the daily OT cap of {calculation.maxOvertimeHoursPerDay}h. Each worker does{' '}
                {number(calculation.otHoursPerPerson, 1)}h OT (shift: {number(calculation.shiftHoursPerPerson, 1)}h).
              </span>
            ) : (
              <span className="text-red-400">
                ⚠ Exceeds daily cap ({calculation.maxOvertimeHoursPerDay}h/day)! At max{' '}
                {calculation.maxOvertimeHoursPerDay}h OT, an unmet deficit of {number(calculation.uncoveredUnits)} units (
                {number(calculation.uncoveredHours, 1)}h) remains. Needs +
                {calculation.additionalHeadcountNeededWithMaxOt} extra 3PL worker(s).
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Headcount Comparison & Labor Requirements Summary */}
      <div
        className="rounded-xl p-4 flex flex-wrap items-center justify-between gap-4"
        style={{ background: '#081424', border: '1px solid #1e3a5a' }}
      >
        <div className="flex flex-wrap items-center gap-6 text-xs font-mono">
          <div>
            <span style={{ color: '#64748b' }}>TOTAL LABOR REQUIRED: </span>
            <strong className="text-blue-400 text-sm font-bold">
              {number(calculation.totalRequiredLaborHours, 1)} Hours
            </strong>
          </div>
          <div>
            <span style={{ color: '#64748b' }}>STAFF NEEDED (ZERO OT): </span>
            <strong className="text-amber-300 text-sm font-bold">{number(calculation.requiredFte, 1)} Employees</strong>
          </div>
          <div>
            <span style={{ color: '#64748b' }}>STAFF WE CURRENTLY HAVE: </span>
            <strong className="text-emerald-400 text-sm font-bold">{calculation.currentEmployees} Employees</strong>
          </div>
          {calculation.additionalHeadcountNeededWithoutOt > 0 && (
            <div>
              <span style={{ color: '#64748b' }}>HEADCOUNT GAP: </span>
              <strong className="text-red-400 text-sm font-bold">
                +{calculation.additionalHeadcountNeededWithoutOt} Workers
              </strong>
            </div>
          )}
        </div>
      </div>

      {/* Simulated Per-Worker Roster Table */}
      <div className="rounded-xl overflow-hidden" style={panelStyle}>
        <div
          className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b"
          style={{ borderColor: '#1e3a5a' }}
        >
          <div>
            <div className="font-semibold text-sm text-white">Simulated Per-Employee Shift & Overtime Roster</div>
            <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>
              Schedule simulation for {calculation.currentEmployees} employees processing{' '}
              {number(calculation.targetVolume)} units @ {calculation.unitsPerLaborHour} units/h.
            </div>
          </div>
          <div className="text-xs font-mono" style={{ color: '#93c5fd' }}>
            {calculation.currentEmployees} employees · {number(calculation.regularCapacityUnits)} regular units ·{' '}
            {number(calculation.effectiveOvertimeHours, 1)}h total OT
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: '#122338', color: '#64748b' }}>
                <th className="text-left px-3 py-2">Worker</th>
                <th className="text-right px-3 py-2">Regular Shift</th>
                <th className="text-right px-3 py-2">Regular Capacity</th>
                <th className="text-right px-3 py-2">Required OT</th>
                <th className="text-right px-3 py-2">Total Shift Length</th>
                <th className="text-right px-3 py-2">Max Allowed OT</th>
                <th className="text-right px-3 py-2">OT Cost</th>
                <th className="text-center px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {calculation.employeeSimulations.map(sim => (
                <tr key={sim.workerIndex} className="border-t" style={{ borderColor: '#1e3a5a' }}>
                  <td className="px-3 py-2.5 text-white font-medium">{sim.workerName}</td>
                  <td className="px-3 py-2.5 text-right font-mono" style={{ color: '#93c5fd' }}>
                    {number(sim.regularHours, 1)}h
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-white">
                    {number(sim.regularCapacityUnits)} units
                  </td>
                  <td
                    className="px-3 py-2.5 text-right font-mono font-bold"
                    style={{ color: sim.otHoursRequired > 0 ? '#c4b5fd' : '#64748b' }}
                  >
                    {sim.otHoursRequired > 0 ? `${number(sim.otHoursRequired, 1)}h` : '0h'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono font-bold text-white">
                    {number(sim.totalShiftHours, 1)}h
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono" style={{ color: '#94a3b8' }}>
                    {calculation.maxOvertimeHoursPerDay}h
                  </td>
                  <td
                    className="px-3 py-2.5 text-right font-mono"
                    style={{ color: sim.otCost > 0 ? '#f59e0b' : '#64748b' }}
                  >
                    {sim.otCost > 0 ? `SAR ${number(sim.otCost, 2)}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className="px-2 py-0.5 rounded text-[10px] font-semibold font-mono"
                      style={{
                        background: sim.isCapped
                          ? 'rgba(239,68,68,0.12)'
                          : sim.otHoursRequired > 0
                            ? 'rgba(139,92,246,0.12)'
                            : 'rgba(16,185,129,0.12)',
                        color: sim.isCapped ? '#fca5a5' : sim.otHoursRequired > 0 ? '#c4b5fd' : '#6ee7b7',
                        border: `1px solid ${
                          sim.isCapped
                            ? 'rgba(239,68,68,0.25)'
                            : sim.otHoursRequired > 0
                              ? 'rgba(139,92,246,0.25)'
                              : 'rgba(16,185,129,0.25)'
                        }`,
                      }}
                    >
                      {sim.isCapped ? 'Capped at 3h' : sim.otHoursRequired > 0 ? 'OT Active' : 'Regular Shift'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 font-semibold" style={{ borderColor: '#3b82f6', background: '#122338' }}>
                <td className="px-3 py-2.5 text-white">Simulated Team Total ({calculation.currentEmployees})</td>
                <td className="px-3 py-2.5 text-right font-mono text-white">
                  {number(calculation.regularCapacityHours, 1)}h
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-white">
                  {number(calculation.regularCapacityUnits)} units
                </td>
                <td className="px-3 py-2.5 text-right font-mono font-bold" style={{ color: '#c4b5fd' }}>
                  {number(calculation.effectiveOvertimeHours, 1)}h
                </td>
                <td className="px-3 py-2.5 text-right font-mono font-bold text-white">
                  {number(calculation.regularCapacityHours + calculation.effectiveOvertimeHours, 1)}h
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-white">{calculation.maxPossibleOvertimeHours}h</td>
                <td className="px-3 py-2.5 text-right font-mono font-bold text-amber-300">
                  SAR {number(calculation.totalOvertimeCost, 2)}
                </td>
                <td
                  className="px-3 py-2.5 text-center text-[10px]"
                  style={{ color: calculation.isOvertimeFeasible ? '#6ee7b7' : '#fca5a5' }}
                >
                  {calculation.isOvertimeFeasible
                    ? '100% Workload Completed'
                    : `+${number(calculation.uncoveredHours, 1)}h Deficit Remaining`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
