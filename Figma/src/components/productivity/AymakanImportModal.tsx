import React from 'react';
import { Upload, AlertCircle, Save } from 'lucide-react';
import type { AymakanImportResult } from '../../lib/aymakan-import';

const fieldStyle = { background: '#081424', border: '1px solid #1e3a5a', color: '#f0f6ff' };

export interface AymakanImportControlsProps {
  saving: boolean;
  importError: string | null;
  importSummary: AymakanImportResult | null;
  pendingImportDayCount: number;
  onImportFiles: (files: File[], group: 'receiving' | 'validation') => void;
  onSaveImportedData: () => Promise<void>;
}

export default function AymakanImportModal({
  saving,
  importError,
  importSummary,
  pendingImportDayCount,
  onImportFiles,
  onSaveImportedData,
}: AymakanImportControlsProps) {
  return (
    <div className="space-y-3">
      {/* Import Trigger Buttons */}
      <div className="flex flex-wrap gap-2">
        <label
          title="Daily or overall Receiving Date export: Barq, ELM and Elm - Express"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs cursor-pointer"
          style={{ ...fieldStyle, color: '#93c5fd', opacity: saving ? 0.5 : 1 }}
        >
          <Upload size={13} />
          Import Barq / ELM
          <input
            type="file"
            multiple
            accept="text/csv,.csv,application/json,.json"
            disabled={saving}
            className="hidden"
            onChange={event => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (files.length > 0) void onImportFiles(files, 'receiving');
            }}
          />
        </label>

        <label
          title="Full export: stages Urpay, Neoleap and Al Mawarid for one-click finalization"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs cursor-pointer"
          style={{ ...fieldStyle, color: '#c4b5fd', opacity: saving ? 0.5 : 1 }}
        >
          <Upload size={13} />
          Import Validation Clients
          <input
            type="file"
            multiple
            accept="text/csv,.csv,application/json,.json"
            disabled={saving}
            className="hidden"
            onChange={event => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (files.length > 0) void onImportFiles(files, 'validation');
            }}
          />
        </label>
      </div>

      {/* Error Alert */}
      {importError && (
        <div
          className="flex items-center gap-2 p-3 rounded-lg text-xs"
          style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#fca5a5' }}
        >
          <AlertCircle size={13} />
          {importError}
        </div>
      )}

      {/* Import Preview Banner */}
      {importSummary && (
        <div
          className="rounded-lg p-3 text-xs"
          style={{ background: 'rgba(37,99,235,.08)', border: '1px solid rgba(37,99,235,.25)', color: '#bfdbfe' }}
        >
          <div className="font-semibold">Aymakan preview loaded — review before saving</div>
          <div className="mt-1">
            {importSummary.uniqueShipments.toLocaleString()} shipments received or validated on {importSummary.workDate} ·{' '}
            {importSummary.duplicateShipments.toLocaleString()} duplicates excluded ·{' '}
            {importSummary.ignoredShipments.toLocaleString()} unmatched rows ignored
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {importSummary.clients.map(client => (
              <span key={client.client_id} className="px-2 py-1 rounded font-mono" style={{ background: '#122338' }}>
                {client.client_name}: {client.received_units} received / {client.processed_units} processed /{' '}
                {client.return_units} returns / {client.jnt_units} JNT
              </span>
            ))}
          </div>
          {importSummary.unmatchedCustomers.length > 0 && (
            <div className="mt-2" style={{ color: '#fbbf24' }}>
              Unmatched customers: {importSummary.unmatchedCustomers.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Staged Dates Banner with One-Click Finalization */}
      {pendingImportDayCount > 0 && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg p-3"
          style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.25)' }}
        >
          <div>
            <div className="text-sm font-semibold" style={{ color: '#6ee7b7' }}>
              {pendingImportDayCount} imported date{pendingImportDayCount === 1 ? '' : 's'} ready
            </div>
            <div className="text-xs mt-1" style={{ color: '#94a3b8' }}>
              One click will save, finalize, and update all staged dates.
            </div>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void onSaveImportedData()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 cursor-pointer"
            style={{ background: '#059669', color: '#fff' }}
          >
            <Save size={14} />
            {saving ? 'Saving imported data…' : 'Save & finalize imported data'}
          </button>
        </div>
      )}
    </div>
  );
}
