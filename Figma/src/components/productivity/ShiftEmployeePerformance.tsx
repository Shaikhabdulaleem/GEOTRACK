import { useMemo, useState } from 'react';
import { Clock, MapPin, Moon, PackageCheck, Sun, Users } from 'lucide-react';
import { isEmployeeActiveOnDate, type MailroomWorkspace } from '../../services/productivity.service';

const panelStyle = { background: '#0d1b2e', border: '1px solid #1e3a5a' };
const fieldStyle = { background: '#081424', border: '1px solid #1e3a5a', color: '#f0f6ff' };

type ShiftFilter = 'all' | 'day' | 'night';

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

export interface ShiftEmployeePerformanceProps {
  workspace: MailroomWorkspace;
  fromDate: string;
  toDate: string;
}

export default function ShiftEmployeePerformance({ workspace, fromDate, toDate }: ShiftEmployeePerformanceProps) {
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>('all');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');

  const periodMetrics = useMemo(() => {
    return workspace.turnaroundMetrics.filter(row => {
      if (row.work_date < fromDate || row.work_date > toDate) return false;
      if (clientFilter !== 'all' && row.client_id !== clientFilter) return false;
      if (warehouseFilter !== 'all' && row.warehouse_code !== warehouseFilter) return false;
      return true;
    });
  }, [workspace.turnaroundMetrics, fromDate, toDate, clientFilter, warehouseFilter]);

  const availableWarehouses = useMemo(() => {
    const set = new Set<string>();
    workspace.turnaroundMetrics.forEach(row => {
      if (row.work_date >= fromDate && row.work_date <= toDate) {
        set.add(row.warehouse_code);
      }
    });
    return [...set].sort();
  }, [workspace.turnaroundMetrics, fromDate, toDate]);

  const activeClients = useMemo(
    () => workspace.clients.filter(c => c.status === 'active'),
    [workspace.clients],
  );

  const shiftStats = useMemo(() => {
    const buildSummary = (targetShift: 'day' | 'night') => {
      const rows = periodMetrics.filter(r => r.shift_type === targetShift);
      const shipments = rows.reduce((sum, r) => sum + Number(r.shipment_count), 0);
      const totalMinutes = rows.reduce((sum, r) => sum + Number(r.total_minutes), 0);
      const byDest = new Map<string, { shipments: number; totalMinutes: number }>();
      rows.forEach(r => {
        const cur = byDest.get(r.warehouse_code) ?? { shipments: 0, totalMinutes: 0 };
        cur.shipments += Number(r.shipment_count);
        cur.totalMinutes += Number(r.total_minutes);
        byDest.set(r.warehouse_code, cur);
      });
      const destinations = [...byDest.entries()]
        .map(([warehouse, data]) => ({
          warehouse,
          shipments: data.shipments,
          avgMinutes: data.shipments > 0 ? data.totalMinutes / data.shipments : null,
          sharePct: shipments > 0 ? (data.shipments / shipments) * 100 : 0,
        }))
        .sort((a, b) => b.shipments - a.shipments);

      return {
        shipments,
        totalMinutes,
        avgMinutes: shipments > 0 ? totalMinutes / shipments : null,
        destinations,
      };
    };

    const day = buildSummary('day');
    const night = buildSummary('night');

    const filteredRows = periodMetrics.filter(r => shiftFilter === 'all' || r.shift_type === shiftFilter);
    const totalShipments = filteredRows.reduce((sum, r) => sum + Number(r.shipment_count), 0);
    const totalMinutes = filteredRows.reduce((sum, r) => sum + Number(r.total_minutes), 0);
    const overallAvgMinutes = totalShipments > 0 ? totalMinutes / totalShipments : null;

    const destMap = new Map<string, {
      warehouse: string;
      dayShipments: number;
      dayMinutes: number;
      nightShipments: number;
      nightMinutes: number;
      totalShipments: number;
      totalMinutes: number;
    }>();

    filteredRows.forEach(r => {
      const entry = destMap.get(r.warehouse_code) ?? {
        warehouse: r.warehouse_code,
        dayShipments: 0,
        dayMinutes: 0,
        nightShipments: 0,
        nightMinutes: 0,
        totalShipments: 0,
        totalMinutes: 0,
      };
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
      destMap.set(r.warehouse_code, entry);
    });

    const destinationRows = [...destMap.values()].sort((a, b) => b.totalShipments - a.totalShipments);
    const hasLegacyOnly = totalShipments > 0 && day.shipments === 0 && night.shipments === 0;

    return {
      day,
      night,
      totalShipments,
      overallAvgMinutes,
      destinationRows,
      hasLegacyOnly,
    };
  }, [periodMetrics, shiftFilter]);

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
        const topDestinations = shiftData
          ? shiftData.destinations.slice(0, 4).map(d => `${d.warehouse} (${d.shipments})`).join(', ')
          : '—';

        return {
          ...r,
          shiftShipments: shiftData?.shipments ?? 0,
          shiftAvgMinutes: shiftData?.avgMinutes ?? null,
          perEmployeeAvg,
          topDestinations: topDestinations || '—',
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
          <h2 className="text-base font-bold text-white">Shift & Employee Handover Performance</h2>
          <p className="text-xs mt-0.5" style={{ color: '#64748b' }}>
            LMD handover volume, destination branches, and average turnaround detected by Day & Night shift ({fromDate} to {toDate})
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
            onChange={e => setWarehouseFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs"
            style={fieldStyle}
          >
            <option value="all">All Destinations</option>
            {availableWarehouses.map(wh => (
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
          Existing turnaround records for this period were imported before Day/Night shift detection was enabled. Re-import the Aymakan CSV in Daily Entry to populate Day Shift and Night Shift splits.
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
          <div className="text-xs mt-1" style={{ color: '#64748b' }}>
            {shiftStats.destinationRows.length} destination{shiftStats.destinationRows.length === 1 ? '' : 's'} covered
          </div>
        </div>

        <div className="rounded-xl p-4" style={panelStyle}>
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider" style={{ color: '#64748b' }}>
            <span>Day Shift Handed Over</span>
            <Sun size={14} style={{ color: '#f59e0b' }} />
          </div>
          <div className="text-2xl font-bold font-mono mt-1" style={{ color: '#93c5fd' }}>{formatNumber(shiftStats.day.shipments)}</div>
          <div className="text-xs mt-1" style={{ color: '#94a3b8' }}>
            Avg: <span className="font-mono font-semibold text-white">{formatDuration(shiftStats.day.avgMinutes)}</span> · {employeeRoster.dayPresentCount || employeeRoster.dayScheduledCount} staff
          </div>
        </div>

        <div className="rounded-xl p-4" style={panelStyle}>
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider" style={{ color: '#64748b' }}>
            <span>Night Shift Handed Over</span>
            <Moon size={14} style={{ color: '#a78bfa' }} />
          </div>
          <div className="text-2xl font-bold font-mono mt-1" style={{ color: '#c4b5fd' }}>{formatNumber(shiftStats.night.shipments)}</div>
          <div className="text-xs mt-1" style={{ color: '#94a3b8' }}>
            Avg: <span className="font-mono font-semibold text-white">{formatDuration(shiftStats.night.avgMinutes)}</span> · {employeeRoster.nightPresentCount || employeeRoster.nightScheduledCount} staff
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
            Receiving / Validation → LMD Handover
          </div>
        </div>
      </div>

      {/* Shift Cards: Day vs Night */}
      <div className="grid lg:grid-cols-2 gap-4">
        {([
          { key: 'day' as const, label: 'Day Shift', icon: <Sun size={15} style={{ color: '#f59e0b' }} />, accent: '#3b82f6', data: shiftStats.day, present: employeeRoster.dayPresentCount, scheduled: employeeRoster.dayScheduledCount },
          { key: 'night' as const, label: 'Night Shift', icon: <Moon size={15} style={{ color: '#a78bfa' }} />, accent: '#8b5cf6', data: shiftStats.night, present: employeeRoster.nightPresentCount, scheduled: employeeRoster.nightScheduledCount },
        ])
          .filter(card => shiftFilter === 'all' || shiftFilter === card.key)
          .map(card => {
            const divisor = card.present || card.scheduled;
            const perStaff = divisor > 0 && card.data.shipments > 0 ? card.data.shipments / divisor : null;
            return (
              <div key={card.key} className="rounded-xl p-4 space-y-3" style={panelStyle}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {card.icon}
                    <span className="font-semibold text-sm text-white">{card.label}</span>
                  </div>
                  <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background: '#122338', color: '#94a3b8' }}>
                    {card.present} present / {card.scheduled} scheduled
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg p-2.5" style={{ background: '#122338' }}>
                    <div className="text-[10px] uppercase" style={{ color: '#64748b' }}>Shipments</div>
                    <div className="text-lg font-bold font-mono text-white mt-0.5">{formatNumber(card.data.shipments)}</div>
                  </div>
                  <div className="rounded-lg p-2.5" style={{ background: '#122338' }}>
                    <div className="text-[10px] uppercase" style={{ color: '#64748b' }}>Avg Time</div>
                    <div className="text-lg font-bold font-mono mt-0.5" style={{ color: '#93c5fd' }}>
                      {formatDuration(card.data.avgMinutes)}
                    </div>
                  </div>
                  <div className="rounded-lg p-2.5" style={{ background: '#122338' }}>
                    <div className="text-[10px] uppercase" style={{ color: '#64748b' }}>Avg / Staff</div>
                    <div className="text-lg font-bold font-mono mt-0.5" style={{ color: '#6ee7b7' }}>
                      {perStaff == null ? '—' : formatNumber(perStaff, 1)}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-semibold mb-1.5 flex items-center gap-1" style={{ color: '#94a3b8' }}>
                    <MapPin size={12} /> Top Handed-Over Destinations
                  </div>
                  {card.data.destinations.length === 0 ? (
                    <div className="text-xs py-2" style={{ color: '#64748b' }}>No handover data recorded for this shift.</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {card.data.destinations.slice(0, 8).map(dest => (
                        <span
                          key={dest.warehouse}
                          className="text-[11px] font-mono px-2 py-1 rounded-md"
                          style={{ background: '#081424', border: `1px solid ${card.accent}44`, color: '#e2e8f0' }}
                        >
                          {dest.warehouse}: {formatNumber(dest.shipments)} ({formatDuration(dest.avgMinutes)})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {/* Destination Breakdown Table */}
      <div className="rounded-xl overflow-hidden" style={panelStyle}>
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: '#1e3a5a' }}>
          <div>
            <div className="font-semibold text-sm text-white">Destination Breakdown by Shift</div>
            <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>
              Shipments handed over and average time per Destination WH
            </div>
          </div>
          <span className="text-xs font-mono" style={{ color: '#64748b' }}>
            {shiftStats.destinationRows.length} destinations
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
              {shiftStats.destinationRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-xs" style={{ color: '#64748b' }}>
                    No handed-over shipment metrics found for this period. Import an Aymakan CSV in Daily Entry.
                  </td>
                </tr>
              ) : (
                shiftStats.destinationRows.map(row => (
                  <tr key={row.warehouse} className="border-t" style={{ borderColor: '#1e3a5a' }}>
                    <td className="px-4 py-2.5 font-mono font-semibold text-white">{row.warehouse}</td>
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
                ))
              )}
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
              <div className="font-semibold text-sm text-white">Shift Employees Performance Roster</div>
              <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>
                Employees grouped by resolved Day/Night shift schedule with attendance hours and shift handover output
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
                <th className="text-left px-3 py-2.5">Top Destinations</th>
                <th className="text-right px-4 py-2.5">Shift Avg Time</th>
              </tr>
            </thead>
            <tbody>
              {employeeRoster.rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-xs" style={{ color: '#64748b' }}>
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
                    <td className="px-3 py-2.5 font-mono text-[11px]" style={{ color: '#94a3b8' }}>
                      {emp.topDestinations}
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
