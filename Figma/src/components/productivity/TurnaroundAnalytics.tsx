import { useState, useMemo } from 'react';
import type { MailroomWorkspace } from '../../services/productivity.service';

const panelStyle = { background: '#0d1b2e', border: '1px solid #1e3a5a' };
const fieldStyle = { background: '#081424', border: '1px solid #1e3a5a', color: '#f0f6ff' };

function number(value: number, digits = 0): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export interface TurnaroundAnalyticsProps {
  workspace: MailroomWorkspace;
}

export default function TurnaroundAnalytics({ workspace }: TurnaroundAnalyticsProps) {
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [shiftFilter, setShiftFilter] = useState<'all' | 'day' | 'night'>('all');

  const turnaround = useMemo(() => {
    const branches = [...new Set(workspace.turnaroundMetrics.map(row => row.warehouse_code))].sort();
    const selected = workspace.turnaroundMetrics.filter(row => {
      if (warehouseFilter !== 'all' && row.warehouse_code !== warehouseFilter) return false;
      if (shiftFilter !== 'all' && row.shift_type !== shiftFilter) return false;
      return true;
    });
    const rows = workspace.clients
      .filter(client => client.status === 'active')
      .map(client => {
        const metrics = selected.filter(row => row.client_id === client.id);
        const minutes = metrics.reduce((sum, row) => sum + Number(row.total_minutes), 0);
        const shipments = metrics.reduce((sum, row) => sum + Number(row.shipment_count), 0);
        return {
          id: client.id,
          name: client.name,
          minutes,
          shipments,
          averageHours: shipments > 0 ? minutes / shipments / 60 : null,
        };
      })
      .filter(row => row.shipments > 0);

    const totalMinutes = rows.reduce((sum, row) => sum + row.minutes, 0);
    const totalShipments = rows.reduce((sum, row) => sum + row.shipments, 0);

    return {
      branches,
      rows,
      averageHours: totalShipments > 0 ? totalMinutes / totalShipments / 60 : null,
      totalShipments,
    };
  }, [workspace, warehouseFilter, shiftFilter]);

  return (
    <div className="rounded-xl overflow-hidden" style={panelStyle}>
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-sm text-white">Average time to LMD handover</div>
          <div className="text-xs mt-1" style={{ color: '#64748b' }}>
            Barq/ELM: Receiving to LMD handover. Validation clients: Validation to LMD handover.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Shift filter"
            value={shiftFilter}
            onChange={event => setShiftFilter(event.target.value as 'all' | 'day' | 'night')}
            className="px-3 py-2 rounded-lg text-xs"
            style={fieldStyle}
          >
            <option value="all">All shifts</option>
            <option value="day">Day shift</option>
            <option value="night">Night shift</option>
          </select>
          <select
            aria-label="Destination branch filter"
            value={warehouseFilter}
            onChange={event => setWarehouseFilter(event.target.value)}
            className="px-3 py-2 rounded-lg text-xs"
            style={fieldStyle}
          >
            <option value="all">All destination branches</option>
            {turnaround.branches.map(branch => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 p-4 border-t" style={{ borderColor: '#1e3a5a' }}>
        <div className="rounded-lg p-3" style={{ background: '#122338' }}>
          <div className="text-[10px] uppercase" style={{ color: '#64748b' }}>Overall average</div>
          <div className="font-mono font-bold text-xl mt-1 text-white">
            {turnaround.averageHours == null ? '—' : `${number(turnaround.averageHours, 2)}h`}
          </div>
          <div className="text-xs mt-1" style={{ color: '#64748b' }}>
            {number(turnaround.totalShipments)} handed-over shipments
          </div>
        </div>

        {turnaround.rows.map(row => (
          <div key={row.id} className="rounded-lg p-3" style={{ background: '#122338' }}>
            <div className="text-xs font-medium text-white">{row.name}</div>
            <div className="font-mono font-bold text-lg mt-1" style={{ color: '#93c5fd' }}>
              {row.averageHours == null ? '—' : `${number(row.averageHours, 2)}h`}
            </div>
            <div className="text-xs" style={{ color: '#64748b' }}>
              {number(row.shipments)} shipments
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
