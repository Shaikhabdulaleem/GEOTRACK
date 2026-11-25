import { useMemo, useState } from 'react';
import { CheckCircle2, Clock, MapPin, Moon, PackageCheck, Sun, Target, TrendingDown, Users } from 'lucide-react';
import { buildMailroomOperationalModel, isEmployeeActiveOnDate, type MailroomWorkspace } from '../../services/productivity.service';

const panelStyle = { background: '#0d1b2e', border: '1px solid #1e3a5a' };
const fieldStyle = { background: '#081424', border: '1px solid #1e3a5a', color: '#f0f6ff' };

type ShiftFilter = 'all' | 'day' | 'night';

const DESTINATION_BUCKETS = ['RUH', 'JED', 'DMM', 'Makanex', 'Other cities'] as const;
type DestinationBucket = (typeof DESTINATION_BUCKETS)[number];

function normalizeDestinationBucket(warehouseCode: string): DestinationBucket {
  const upper = warehouseCode.trim().toUpperCase();
  if (upper === 'RUH' || upper === 'JED' || upper === 'DMM') return upper;
  if (upper === 'MAKANEX') return 'Makanex';
  return 'Other cities';
}

function formatDuration(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const totalMins = Math.round(minutes);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs === 0) return `${mins}m`;
  return `${hrs}h ${String(mins).padStart(2, '0')}m`;
}

function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function classifyScheduleShift(shiftName: string | null | undefined, crossesMidnight: boolean): 'day' | 'night' | 'unassigned' {
  if (!shiftName && !crossesMidnight) return 'unassigned';
  const lower = (shiftName ?? '').toLowerCase();
  if (crossesMidnight || lower.includes('night')) return 'night';
  if (lower.includes('day') || shiftName) return 'day';
  return 'unassigned';
}

function shiftScheduleHours(startTime: string | null | undefined, endTime: string | null | undefined, breakMinutes: number | null | undefined, fallbackHours: number): number {
  if (!startTime || !endTime) return fallbackHours;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  if ([sh, sm, eh, em].some(Number.isNaN)) return fallbackHours;
  const start = sh * 60 + sm;
  let end = eh * 60 + em;
  if (end <= start) end += 24 * 60;
  const net = Math.max(0, end - start - (breakMinutes ?? 0));
  return net > 0 ? net / 60 : fallbackHours;
}

export interface ShiftEmployeePerformanceProps {
  workspace: MailroomWorkspace;
  fromDate: string;
  toDate: string;
}

export default function ShiftEmployeePerformance({ workspace, fromDate, toDate }: ShiftEmployeePerformanceProps) {
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>('all');
  const [warehouseFilter, setWarehouseFilter] = useState<'all' | DestinationBucket>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [hoveredShift, setHoveredShift] = useState<'day' | 'night' | null>(null);

  const periodMetrics = useMemo(() => {
    return workspace.turnaroundMetrics.filter(row => {
      if (row.work_date < fromDate || row.work_date > toDate) return false;
      if (clientFilter !== 'all' && row.client_id !== clientFilter) return false;
      const bucket = normalizeDestinationBucket(row.warehouse_code);
      if (warehouseFilter !== 'all' && bucket !== warehouseFilter) return false;
      return true;
    });
  }, [workspace.turnaroundMetrics, fromDate, toDate, clientFilter, warehouseFilter]);

  const activeClients = useMemo(
    () => workspace.clients.filter(c => c.status === 'active'),
    [workspace.clients],
  );

  // Compute Day & Night Shift capacity (target units) from DLP schedules & Mailroom hourly productivity rate
  const shiftCapacity = useMemo(() => {
    const riyadhToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const model = buildMailroomOperationalModel(workspace, fromDate, toDate, riyadhToday);
    const activeActivities = workspace.activities.filter(a => a.status === 'active' && a.units_per_labor_hour > 0);
    const modelRate = model.totalRequiredHours > 0 && (model.totalProcessed || model.totalReceived) > 0
      ? (model.totalProcessed || model.totalReceived) / model.totalRequiredHours
      : null;
    const fallbackRate = activeActivities.length > 0
      ? activeActivities.reduce((s, a) => s + Number(a.units_per_labor_hour), 0) / activeActivities.length
      : 150;
    const unitsPerHour = modelRate ?? fallbackRate;

    const settingByEmp = new Map(workspace.employeeSettings.map(s => [s.employee_id, s]));
    const standardHours = workspace.settings.standard_hours_per_day || 8;

    let dayHours = 0;
    let nightHours = 0;
    workspace.employees.forEach(emp => {
      const setting = settingByEmp.get(emp.id);
      if (setting && setting.labor_class !== 'dlp') return;
      const schedules = workspace.schedules[emp.id] ?? [];
      schedules.forEach(s => {
        if (s.work_date < fromDate || s.work_date > toDate || s.state !== 'working') return;
        if (!isEmployeeActiveOnDate(emp, s.work_date)) return;
        const kind = classifyScheduleShift(s.shift_name, s.crosses_midnight);
        const hrs = shiftScheduleHours(s.start_time, s.end_time, s.break_minutes, standardHours);
        if (kind === 'day') dayHours += hrs;
        else if (kind === 'night') nightHours += hrs;
      });
    });

    const dayTarget = Math.round(dayHours * unitsPerHour);
    const nightTarget = Math.round(nightHours * unitsPerHour);
    return {
      unitsPerHour,
      dayHours,
      nightHours,
      dayTarget,
      nightTarget,
      totalTarget: dayTarget + nightTarget,
    };
  }, [workspace, fromDate, toDate]);

  const shiftStats = useMemo(() => {
    const buildSummary = (targetShift: 'day' | 'night', targetCapacity: number) => {
      const rows = periodMetrics.filter(r => r.shift_type === targetShift);
      const shipments = rows.reduce((sum, r) => sum + Number(r.shipment_count), 0);
      const totalMinutes = rows.reduce((sum, r) => sum + Number(r.total_minutes), 0);
      const byDest = new Map<DestinationBucket, { shipments: number; totalMinutes: number }>();
      rows.forEach(r => {
        const bucket = normalizeDestinationBucket(r.warehouse_code);
        const cur = byDest.get(bucket) ?? { shipments: 0, totalMinutes: 0 };
        cur.shipments += Number(r.shipment_count);
        cur.totalMinutes += Number(r.total_minutes);
        byDest.set(bucket, cur);
      });
      const destinations = [...byDest.entries()]
        .map(([warehouse, data]) => ({
          warehouse,
          shipments: data.shipments,
          avgMinutes: data.shipments > 0 ? data.totalMinutes / data.shipments : null,
          sharePct: shipments > 0 ? (data.shipments / shipments) * 100 : 0,
        }))
        .sort((a, b) => b.shipments - a.shipments);

      const achievementPct = targetCapacity > 0 ? (shipments / targetCapacity) * 100 : null;
      const variance = targetCapacity > 0 ? shipments - targetCapacity : null;
      const achieved = targetCapacity > 0 ? shipments >= targetCapacity : null;

      return {
        shipments,
        totalMinutes,
        avgMinutes: shipments > 0 ? totalMinutes / shipments : null,
        destinations,
        targetCapacity,
        achievementPct,
        variance,
        achieved,
      };
    };

    const day = buildSummary('day', shiftCapacity.dayTarget);
    const night = buildSummary('night', shiftCapacity.nightTarget);

    const filteredRows = periodMetrics.filter(r => shiftFilter === 'all' || r.shift_type === shiftFilter);
    const totalShipments = filteredRows.reduce((sum, r) => sum + Number(r.shipment_count), 0);
    const totalMinutes = filteredRows.reduce((sum, r) => sum + Number(r.total_minutes), 0);
    const overallAvgMinutes = totalShipments > 0 ? totalMinutes / totalShipments : null;
    const totalCapacity = shiftFilter === 'day'
      ? shiftCapacity.dayTarget
      : shiftFilter === 'night'
        ? shiftCapacity.nightTarget
        : shiftCapacity.totalTarget;
    const totalAchievementPct = totalCapacity > 0 ? (totalShipments / totalCapacity) * 100 : null;
    const totalVariance = totalCapacity > 0 ? totalShipments - totalCapacity : null;

    const destMap = new Map<DestinationBucket, {
      warehouse: DestinationBucket;
      dayShipments: number;
      dayMinutes: number;
      nightShipments: number;
      nightMinutes: number;
      totalShipments: number;
      totalMinutes: number;
    }>();

    const bucketsToRender = warehouseFilter === 'all' ? DESTINATION_BUCKETS : [warehouseFilter];
    bucketsToRender.forEach(bucket => {
      destMap.set(bucket, {
        warehouse: bucket,
        dayShipments: 0,
        dayMinutes: 0,
        nightShipments: 0,
        nightMinutes: 0,
        totalShipments: 0,
        totalMinutes: 0,
      });
    });

    filteredRows.forEach(r => {
      const bucket = normalizeDestinationBucket(r.warehouse_code);
      const entry = destMap.get(bucket);
      if (!entry) return;
      const count = Number(r.shipment_count);
      const mins = Number(r.total_minutes);
      entry.totalShipments += count;
      entry.totalMinutes += mins;
      if (r.shift_type === 'day') {
        entry.dayShipments += count;
        entry.dayMinutes += mins;
      } else if (r.shift_type === 'night') {
        entry.nightShipments += count;
        entry.nightMinutes += mins;
      }
    });

    const destinationRows = [...destMap.values()];
    const hasLegacyOnly = totalShipments > 0 && day.shipments === 0 && night.shipments === 0;

    return {
      day,
      night,
      totalShipments,
      totalCapacity,
      totalAchievementPct,
      totalVariance,
      overallAvgMinutes,
      destinationRows,
      hasLegacyOnly,
    };
  }, [periodMetrics, shiftFilter, warehouseFilter, shiftCapacity]);

  const employeeRoster = useMemo(() => {
    const attendanceByEmp = new Map<string, { daysPresent: number; workedMinutes: number }>();
    workspace.attendance.forEach(record => {
      if (record.attendance_date < fromDate || record.attendance_date > toDate) return;
      const cur = attendanceByEmp.get(record.employee_id) ?? { daysPresent: 0, workedMinutes: 0 };
      const isPresent = Boolean(record.check_in_at) || ['present', 'late', 'completed'].includes(record.status);
      if (isPresent) cur.daysPresent += 1;
      cur.workedMinutes += record.worked_minutes ?? 0;
      attendanceByEmp.set(record.employee_id, cur);
    });

    const rows = workspace.employees
      .filter(emp => isEmployeeActiveOnDate(emp, toDate) || isEmployeeActiveOnDate(emp, fromDate))
      .map(emp => {
        const schedules = (workspace.schedules[emp.id] ?? []).filter(
          s => s.work_date >= fromDate && s.work_date <= toDate && s.state === 'working',
        );
        let dayCount = 0;
        let nightCount = 0;
        let latestShiftName = 'Unassigned';
        schedules.forEach(s => {
          const kind = classifyScheduleShift(s.shift_name, s.crosses_midnight);
          if (kind === 'day') dayCount += 1;
          else if (kind === 'night') nightCount += 1;
          if (s.shift_name) latestShiftName = s.shift_name;
        });

        let assignedShift: 'day' | 'night' | 'unassigned' = 'unassigned';
        if (dayCount > 0 || nightCount > 0) {
          assignedShift = nightCount > dayCount ? 'night' : 'day';
        }

        const att = attendanceByEmp.get(emp.id) ?? { daysPresent: 0, workedMinutes: 0 };
        return {
          id: emp.id,
          name: emp.full_name,
          code: emp.employee_code,
          jobTitle: emp.job_title ?? '—',
          assignedShift,
          shiftLabel: latestShiftName,
          scheduledDays: schedules.length,
          daysPresent: att.daysPresent,
          workedHours: att.workedMinutes / 60,
        };
      });

    const dayPresentCount = rows.filter(r => r.assignedShift === 'day' && r.daysPresent > 0).length;
    const nightPresentCount = rows.filter(r => r.assignedShift === 'night' && r.daysPresent > 0).length;
    const dayScheduledCount = rows.filter(r => r.assignedShift === 'day' && r.scheduledDays > 0).length;
    const nightScheduledCount = rows.filter(r => r.assignedShift === 'night' && r.scheduledDays > 0).length;

    const filtered = rows
      .filter(r => shiftFilter === 'all' || r.assignedShift === shiftFilter)
      .map(r => {
        const shiftData = r.assignedShift === 'day' ? shiftStats.day : r.assignedShift === 'night' ? shiftStats.night : null;
        const activeDivisor = r.assignedShift === 'day'
          ? (dayPresentCount || dayScheduledCount)
          : r.assignedShift === 'night'
            ? (nightPresentCount || nightScheduledCount)
            : 0;
        const perEmployeeAvg = shiftData && activeDivisor > 0 && r.daysPresent > 0
          ? shiftData.shipments / activeDivisor
          : null;

        return {
          ...r,
          shiftShipments: shiftData?.shipments ?? 0,
          shiftAvgMinutes: shiftData?.avgMinutes ?? null,
          perEmployeeAvg,
        };
      })
      .sort((a, b) => {
        if (a.assignedShift !== b.assignedShift) {
          const order = { day: 0, night: 1, unassigned: 2 };
          return order[a.assignedShift] - order[b.assignedShift];
        }
        return b.workedHours - a.workedHours || a.name.localeCompare(b.name);
      });

    return {
      rows: filtered,
      dayPresentCount,
      nightPresentCount,
      dayScheduledCount,
      nightScheduledCount,
    };
  }, [workspace.employees, workspace.schedules, workspace.attendance, fromDate, toDate, shiftFilter, shiftStats]);

  return (
    <div className="space-y-4">
      {/* Header & Filters */}
      <div className="rounded-xl p-4 flex flex-wrap items-center justify-between gap-3" style={panelStyle}>
        <div>
          <h2 className="text-base font-bold text-white">Shift Performance & Target Achievement</h2>
          <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>
            Day & Night shift LMD handovers vs shift capacity ({fromDate} to {toDate} · {formatNumber(shiftCapacity.unitsPerHour, 0)} units/hr)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'day', 'night'] as ShiftFilter[]).map(value => (
            <button
              key={value}
              type="button"
              onClick={() => setShiftFilter(value)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer"
              style={{
                background: shiftFilter === value ? '#2563eb' : '#081424',
                color: shiftFilter === value ? '#fff' : '#94a3b8',
                border: `1px solid ${shiftFilter === value ? '#2563eb' : '#1e3a5a'}`,
              }}
            >
              {value === 'all' ? 'All Shifts' : value === 'day' ? 'Day Shift' : 'Night Shift'}
            </button>
          ))}

          <select
            aria-label="Destination warehouse filter"
            value={warehouseFilter}
            onChange={e => setWarehouseFilter(e.target.value as 'all' | DestinationBucket)}
            className="px-3 py-1.5 rounded-lg text-xs"
            style={fieldStyle}
          >
            <option value="all">All Destinations</option>
            {DESTINATION_BUCKETS.map(wh => (
              <option key={wh} value={wh}>{wh}</option>
            ))}
          </select>

          <select
            aria-label="Client filter"
            value={clientFilter}
            onChange={e => setClientFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs"
            style={fieldStyle}
          >
            <option value="all">All Clients</option>
            {activeClients.map(client => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
        </div>
      </div>

      {shiftStats.hasLegacyOnly && (
        <div className="rounded-xl p-3 text-xs" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', color: '#fcd34d' }}>
          Existing turnaround records for this period were imported before Day/Night shift & Makanex bucketing was enabled. Re-import the Aymakan CSV in Daily Entry to populate the updated shift & destination splits.
        </div>
      )}

      {/* Top KPI Summary */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="rounded-xl p-4" style={panelStyle}>
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider" style={{ color: '#64748b' }}>
            <span>Total Handed Over</span>
            <PackageCheck size={14} style={{ color: '#3b82f6' }} />
          </div>
          <div className="text-2xl font-bold font-mono text-white mt-1">{formatNumber(shiftStats.totalShipments)}</div>
          <div className="text-xs mt-1" style={{ color: '#94a3b8' }}>
            Capacity Target: <span className="font-mono text-white">{shiftStats.totalCapacity > 0 ? formatNumber(shiftStats.totalCapacity) : '—'}</span>
          </div>
        </div>

        <div className="rounded-xl p-4" style={panelStyle}>
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider" style={{ color: '#64748b' }}>
            <span>Target Achievement</span>
            <Target size={14} style={{ color: (shiftStats.totalAchievementPct ?? 0) >= 100 ? '#10b981' : '#f59e0b' }} />
          </div>
          <div
            className="text-2xl font-bold font-mono mt-1"
            style={{ color: shiftStats.totalAchievementPct == null ? '#94a3b8' : shiftStats.totalAchievementPct >= 100 ? '#10b981' : '#f59e0b' }}
          >
            {shiftStats.totalAchievementPct == null ? '—' : `${formatNumber(shiftStats.totalAchievementPct, 1)}%`}
          </div>
          <div className="text-xs mt-1" style={{ color: (shiftStats.totalVariance ?? 0) >= 0 ? '#6ee7b7' : '#fca5a5' }}>
            {shiftStats.totalVariance == null
              ? 'No shift schedule hours'
              : shiftStats.totalVariance >= 0
                ? `+${formatNumber(shiftStats.totalVariance)} above target`
                : `${formatNumber(shiftStats.totalVariance)} short of target`}
          </div>
        </div>

        <div className="rounded-xl p-4" style={panelStyle}>
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider" style={{ color: '#64748b' }}>
            <span>Day vs Night Split</span>
            <Sun size={14} style={{ color: '#f59e0b' }} />
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-xl font-bold font-mono" style={{ color: '#93c5fd' }}>{formatNumber(shiftStats.day.shipments)}</span>
            <span className="text-xs" style={{ color: '#64748b' }}>/</span>
            <span className="text-xl font-bold font-mono" style={{ color: '#c4b5fd' }}>{formatNumber(shiftStats.night.shipments)}</span>
          </div>
          <div className="text-xs mt-1" style={{ color: '#64748b' }}>
            Day ({shiftStats.day.achievementPct != null ? `${formatNumber(shiftStats.day.achievementPct, 0)}%` : '—'}) · Night ({shiftStats.night.achievementPct != null ? `${formatNumber(shiftStats.night.achievementPct, 0)}%` : '—'})
          </div>
        </div>

        <div className="rounded-xl p-4" style={panelStyle}>
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider" style={{ color: '#64748b' }}>
            <span>Overall Avg Handover Time</span>
            <Clock size={14} style={{ color: '#10b981' }} />
          </div>
          <div className="text-2xl font-bold font-mono mt-1" style={{ color: '#6ee7b7' }}>
            {formatDuration(shiftStats.overallAvgMinutes)}
          </div>
          <div className="text-xs mt-1" style={{ color: '#64748b' }}>
            Day {formatDuration(shiftStats.day.avgMinutes)} · Night {formatDuration(shiftStats.night.avgMinutes)}
          </div>
        </div>
      </div>

      {/* Shift Cards: Day vs Night with Capacity Target & Hover-only Top Destinations */}
      <div className="grid lg:grid-cols-2 gap-4">
        {([
          {
            key: 'day' as const,
            label: 'Day Shift',
            icon: <Sun size={16} style={{ color: '#f59e0b' }} />,
            accent: '#3b82f6',
            badgeBg: 'rgba(37,99,235,0.14)',
            data: shiftStats.day,
            present: employeeRoster.dayPresentCount,
            scheduled: employeeRoster.dayScheduledCount,
            hours: shiftCapacity.dayHours,
          },
          {
            key: 'night' as const,
            label: 'Night Shift',
            icon: <Moon size={16} style={{ color: '#a78bfa' }} />,
            accent: '#8b5cf6',
            badgeBg: 'rgba(139,92,246,0.14)',
            data: shiftStats.night,
            present: employeeRoster.nightPresentCount,
            scheduled: employeeRoster.nightScheduledCount,
            hours: shiftCapacity.nightHours,
          },
        ])
          .filter(card => shiftFilter === 'all' || shiftFilter === card.key)
          .map(card => {
            const pct = card.data.achievementPct ?? 0;
            const hasTarget = card.data.targetCapacity > 0;
            const isAchieved = Boolean(card.data.achieved);
            const barWidth = Math.min(100, Math.max(0, pct));
            const isHovered = hoveredShift === card.key;

            return (
              <div
                key={card.key}
                className="rounded-xl p-4 space-y-3 relative transition-all"
                style={{
                  ...panelStyle,
                  borderColor: isAchieved ? 'rgba(16,185,129,0.35)' : `${card.accent}55`,
                }}
              >
                {/* Card Header */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: card.badgeBg }}>
                      {card.icon}
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-white">{card.label}</div>
                      <div className="text-[11px]" style={{ color: '#64748b' }}>
                        {card.present} present / {card.scheduled} scheduled · {formatNumber(card.hours, 0)}h capacity
                      </div>
                    </div>
                  </div>

                  {hasTarget ? (
                    <span
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
                      style={{
                        background: isAchieved ? 'rgba(16,185,129,0.14)' : 'rgba(245,158,11,0.14)',
                        color: isAchieved ? '#6ee7b7' : '#fcd34d',
                        border: `1px solid ${isAchieved ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.35)'}`,
                      }}
                    >
                      {isAchieved ? <CheckCircle2 size={12} /> : <TrendingDown size={12} />}
                      {isAchieved ? 'Target Achieved' : 'Target Not Achieved'}
                    </span>
                  ) : (
                    <span className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: '#122338', color: '#94a3b8' }}>
                      No schedule capacity
                    </span>
                  )}
                </div>

                {/* Progress Bar: Done vs Capacity */}
                <div className="rounded-lg p-3 space-y-2" style={{ background: '#081424', border: '1px solid #1e3a5a' }}>
                  <div className="flex items-baseline justify-between text-xs">
                    <div>
                      <span className="text-lg font-bold font-mono text-white">{formatNumber(card.data.shipments)}</span>
                      <span className="ml-1.5" style={{ color: '#64748b' }}>
                        / {hasTarget ? `${formatNumber(card.data.targetCapacity)} target` : '—'}
                      </span>
                    </div>
                    <div className="font-mono font-bold text-sm" style={{ color: !hasTarget ? '#94a3b8' : isAchieved ? '#10b981' : '#f59e0b' }}>
                      {hasTarget ? `${formatNumber(pct, 1)}%` : '—'}
                    </div>
                  </div>

                  <div className="h-2.5 rounded-full overflow-hidden" style={{ background: '#122338' }}>
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${barWidth}%`,
                        background: !hasTarget ? card.accent : isAchieved ? '#10b981' : '#f59e0b',
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px]" style={{ color: '#94a3b8' }}>
                    <span>
                      {card.data.variance == null
                        ? 'Assign shift schedules to compute capacity'
                        : card.data.variance >= 0
                          ? `+${formatNumber(card.data.variance)} shipments above capacity`
                          : `${formatNumber(Math.abs(card.data.variance))} shipments remaining to target`}
                    </span>
                    <span className="font-mono">Avg Time: <strong className="text-white">{formatDuration(card.data.avgMinutes)}</strong></span>
                  </div>
                </div>

                {/* Hover-only Top Handed-Over Destinations */}
                <div
                  className="relative"
                  onMouseEnter={() => setHoveredShift(card.key)}
                  onMouseLeave={() => setHoveredShift(null)}
                >
                  <div
                    className="flex items-center justify-between px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors"
                    style={{
                      background: isHovered ? '#122338' : '#081424',
                      border: `1px dashed ${isHovered ? card.accent : '#1e3a5a'}`,
                      color: '#94a3b8',
                    }}
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      <MapPin size={13} style={{ color: card.accent }} />
                      Top Handed-Over Destinations
                    </span>
                    <span className="text-[11px] font-mono" style={{ color: '#64748b' }}>
                      {card.data.destinations.length > 0 ? `Hover to view (${card.data.destinations.length})` : 'No data'}
                    </span>
                  </div>

                  {isHovered && card.data.destinations.length > 0 && (
                    <div
                      className="mt-2 rounded-lg p-3 shadow-xl z-20"
                      style={{ background: '#0b192c', border: `1px solid ${card.accent}66` }}
                    >
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {card.data.destinations.map(dest => (
                          <div
                            key={dest.warehouse}
                            className="rounded-md px-2.5 py-1.5 flex items-center justify-between text-[11px] font-mono"
                            style={{ background: '#122338', color: '#e2e8f0' }}
                          >
                            <span className="font-semibold text-white">{dest.warehouse}</span>
                            <span style={{ color: '#93c5fd' }}>
                              {formatNumber(dest.shipments)} · {formatDuration(dest.avgMinutes)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {/* Destination Breakdown Table: Strictly RUH, JED, DMM, Makanex, Other cities */}
      <div className="rounded-xl overflow-hidden" style={panelStyle}>
        <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2" style={{ borderColor: '#1e3a5a' }}>
          <div>
            <div className="font-semibold text-sm text-white">Destination Breakdown by Shift</div>
            <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>
              RUH, JED, DMM, Makanex (3PL JNT), and Other cities
            </div>
          </div>
          <span className="text-xs font-mono" style={{ color: '#64748b' }}>
            {shiftStats.destinationRows.length} destination groups
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: '#122338', color: '#64748b' }}>
                <th className="text-left px-4 py-2.5">Destination WH</th>
                <th className="text-right px-3 py-2.5">Day Shift</th>
                <th className="text-right px-3 py-2.5">Day Avg Time</th>
                <th className="text-right px-3 py-2.5">Night Shift</th>
                <th className="text-right px-3 py-2.5">Night Avg Time</th>
                <th className="text-right px-3 py-2.5">Total Handed Over</th>
                <th className="text-right px-4 py-2.5">Overall Avg Time</th>
              </tr>
            </thead>
            <tbody>
              {shiftStats.destinationRows.map(row => (
                <tr key={row.warehouse} className="border-t" style={{ borderColor: '#1e3a5a' }}>
                  <td className="px-4 py-2.5 font-mono font-semibold text-white">
                    {row.warehouse}
                    {row.warehouse === 'Makanex' && (
                      <span className="ml-2 text-[10px] font-normal px-1.5 py-0.5 rounded" style={{ background: 'rgba(139,92,246,0.14)', color: '#c4b5fd' }}>
                        3PL JNT
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono" style={{ color: '#93c5fd' }}>
                    {row.dayShipments > 0 ? formatNumber(row.dayShipments) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono" style={{ color: '#94a3b8' }}>
                    {row.dayShipments > 0 ? formatDuration(row.dayMinutes / row.dayShipments) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono" style={{ color: '#c4b5fd' }}>
                    {row.nightShipments > 0 ? formatNumber(row.nightShipments) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono" style={{ color: '#94a3b8' }}>
                    {row.nightShipments > 0 ? formatDuration(row.nightMinutes / row.nightShipments) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono font-semibold text-white">
                    {formatNumber(row.totalShipments)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold" style={{ color: '#6ee7b7' }}>
                    {row.totalShipments > 0 ? formatDuration(row.totalMinutes / row.totalShipments) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Shift Employee Roster */}
      <div className="rounded-xl overflow-hidden" style={panelStyle}>
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: '#1e3a5a' }}>
          <div className="flex items-center gap-2">
            <Users size={15} style={{ color: '#3b82f6' }} />
            <div>
              <div className="font-semibold text-sm text-white">Shift Employees Roster</div>
              <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>
                Employees grouped by Day/Night shift schedule with attendance hours and shift handover output
              </div>
            </div>
          </div>
          <span className="text-xs font-mono" style={{ color: '#64748b' }}>
            {employeeRoster.rows.length} employees
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: '#122338', color: '#64748b' }}>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-left px-3 py-2.5">Shift</th>
                <th className="text-right px-3 py-2.5">Days Present</th>
                <th className="text-right px-3 py-2.5">Worked Hours</th>
                <th className="text-right px-3 py-2.5">Shift Shipments</th>
                <th className="text-right px-3 py-2.5">Est. Per-Staff</th>
                <th className="text-right px-4 py-2.5">Shift Avg Time</th>
              </tr>
            </thead>
            <tbody>
              {employeeRoster.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-xs" style={{ color: '#64748b' }}>
                    No Mailroom employees found for the selected shift filter.
                  </td>
                </tr>
              ) : (
                employeeRoster.rows.map(emp => (
                  <tr key={emp.id} className="border-t" style={{ borderColor: '#1e3a5a' }}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-white">{emp.name}</div>
                      <div className="text-[10px]" style={{ color: '#64748b' }}>{emp.code} · {emp.jobTitle}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase"
                        style={{
                          background: emp.assignedShift === 'day'
                            ? 'rgba(37,99,235,0.15)'
                            : emp.assignedShift === 'night'
                              ? 'rgba(139,92,246,0.15)'
                              : 'rgba(100,116,139,0.15)',
                          color: emp.assignedShift === 'day'
                            ? '#93c5fd'
                            : emp.assignedShift === 'night'
                              ? '#c4b5fd'
                              : '#94a3b8',
                        }}
                      >
                        {emp.shiftLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-white">
                      {emp.daysPresent} / {emp.scheduledDays}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono" style={{ color: '#93c5fd' }}>
                      {formatNumber(emp.workedHours, 1)}h
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-white">
                      {emp.shiftShipments > 0 ? formatNumber(emp.shiftShipments) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono" style={{ color: '#6ee7b7' }}>
                      {emp.perEmployeeAvg == null ? '—' : formatNumber(emp.perEmployeeAvg, 1)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold" style={{ color: '#93c5fd' }}>
                      {formatDuration(emp.shiftAvgMinutes)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
