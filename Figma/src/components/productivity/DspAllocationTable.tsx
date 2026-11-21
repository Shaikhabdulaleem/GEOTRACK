import React from 'react';
import type { MailroomWorkspace, MailroomDailyClientInput } from '../../services/productivity.service';

const panelStyle = { background: '#0d1b2e', border: '1px solid #1e3a5a' };
const fieldStyle = { background: '#081424', border: '1px solid #1e3a5a', color: '#f0f6ff' };

function number(value: number, digits = 0): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function dspCellKey(clientId: string, partnerId: string): string {
  return `${clientId}:${partnerId}`;
}

export interface DspAllocationSummaryProps {
  mode: 'summary';
  partners: Array<{ id: string; name: string }>;
  rows: Array<{
    id: string;
    name: string;
    byPartner: Record<string, number>;
    total: number;
  }>;
}

export interface DspAllocationEntryProps {
  mode: 'entry';
  activeClients: Array<{ id: string; name: string }>;
  activePartners: Array<{ id: string; name: string }>;
  clientValues: Record<string, MailroomDailyClientInput>;
  dspValues: Record<string, number>;
  onDspValueChange: (clientId: string, partnerId: string, value: number) => void;
  overAllocatedClients: Array<{ id: string; name: string }>;
}

export type DspAllocationTableProps = DspAllocationSummaryProps | DspAllocationEntryProps;

export default function DspAllocationTable(props: DspAllocationTableProps) {
  if (props.mode === 'summary') {
    const { partners, rows } = props;
    if (partners.length === 0) return null;

    return (
      <div className="rounded-xl overflow-hidden" style={panelStyle}>
        <div className="px-4 py-3">
          <div className="font-semibold text-sm text-white">DSP allocation by client</div>
          <div className="text-xs mt-1" style={{ color: '#64748b' }}>
            Finalized last-mile volume for the selected period.
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: '#122338', color: '#64748b' }}>
                <th className="text-left px-3 py-2">Client</th>
                {partners.map(partner => (
                  <th key={partner.id} className="text-right px-3 py-2">
                    {partner.name}
                  </th>
                ))}
                <th className="text-right px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-t" style={{ borderColor: '#1e3a5a' }}>
                  <td className="px-3 py-2 text-white font-medium">{row.name}</td>
                  {partners.map(partner => (
                    <td key={partner.id} className="px-3 py-2 text-right font-mono" style={{ color: '#94a3b8' }}>
                      {number(row.byPartner[partner.id] ?? 0)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-mono font-semibold text-white">
                    {number(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Entry Mode ─────────────────────────────────────────────────────────────
  const {
    activeClients,
    activePartners,
    clientValues,
    dspValues,
    onDspValueChange,
    overAllocatedClients,
  } = props;

  const clientDspTotals = Object.fromEntries(
    activeClients.map(client => [
      client.id,
      activePartners.reduce(
        (sum, partner) => sum + (dspValues[dspCellKey(client.id, partner.id)] ?? 0),
        0
      ),
    ])
  ) as Record<string, number>;

  return (
    <div className="rounded-xl overflow-hidden" style={panelStyle}>
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-sm text-white">DSP partner allocation — client-wise</div>
          <div className="text-xs mt-1" style={{ color: '#64748b' }}>
            Only shipments assigned to a 3PL provider belong here. Aymakan imports JNT volume only.
          </div>
        </div>
        <span
          className="text-xs font-mono"
          style={{ color: overAllocatedClients.length === 0 ? '#10b981' : '#ef4444' }}
        >
          {overAllocatedClients.length === 0
            ? 'Allocations within processed totals'
            : `${overAllocatedClients.length} over-allocated client${overAllocatedClients.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {activePartners.length === 0 ? (
        <div className="px-4 pb-4 text-xs" style={{ color: '#64748b' }}>
          No active DSP partner. Non-DSP processed volume can still be finalized.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: '#122338', color: '#64748b' }}>
                <th className="text-left px-3 py-2">Client</th>
                <th className="text-right px-3 py-2">Processed</th>
                {activePartners.map(partner => (
                  <th key={partner.id} className="text-right px-3 py-2 min-w-28">
                    {partner.name}
                  </th>
                ))}
                <th className="text-right px-3 py-2">Allocated</th>
                <th className="text-right px-3 py-2">Non-DSP</th>
              </tr>
            </thead>
            <tbody>
              {activeClients.map(client => {
                const processed = clientValues[client.id]?.processed_units ?? 0;
                const allocated = clientDspTotals[client.id] ?? 0;
                const remaining = processed - allocated;

                return (
                  <tr key={client.id} className="border-t" style={{ borderColor: '#1e3a5a' }}>
                    <td className="px-3 py-3 text-white font-medium">{client.name}</td>
                    <td className="px-3 py-3 text-right font-mono">{number(processed)}</td>
                    {activePartners.map(partner => {
                      const key = dspCellKey(client.id, partner.id);
                      return (
                        <td key={partner.id} className="px-3 py-2 text-right">
                          <input
                            aria-label={`${client.name} to ${partner.name}`}
                            type="number"
                            min="0"
                            value={dspValues[key] ?? 0}
                            onChange={event =>
                              onDspValueChange(
                                client.id,
                                partner.id,
                                Math.max(0, Math.floor(Number(event.target.value) || 0))
                              )
                            }
                            className="w-24 px-2 py-2 rounded text-right font-mono"
                            style={fieldStyle}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-3 text-right font-mono text-white">{number(allocated)}</td>
                    <td
                      className="px-3 py-3 text-right font-mono"
                      style={{ color: remaining < 0 ? '#ef4444' : '#94a3b8' }}
                    >
                      {number(remaining)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
