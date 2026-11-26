import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, Plus, Trash2 } from 'lucide-react';
import { fcProductivityService, type FcWorkspace } from '../../services/fc-productivity.service';
import type { FcActivityStandardRow, FcClientRow, FcEmployeeSettingsRow } from '../../types/database';

const panel = { background: '#0d1b2e', border: '1px solid #1e3a5a' };
const field = { background: '#081424', border: '1px solid #1e3a5a', color: '#f0f6ff' };

export interface FcSetupPanelProps {
  organizationId: string;
  workspace: FcWorkspace;
  refresh: () => Promise<void>;
}

export default function FcSetupPanel({ organizationId, workspace, refresh }: FcSetupPanelProps) {
  const [saving, setSaving] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [standards, setStandards] = useState<FcActivityStandardRow[]>(workspace.standards);
  const [policyDrafts, setPolicyDrafts] = useState<Record<string, string>>({});
  const [clientRateDrafts, setClientRateDrafts] = useState<Record<string, string>>({});
  const [empOtDrafts, setEmpOtDrafts] = useState<Record<string, string>>({});
  const [newClient, setNewClient] = useState({
    name: '',
    code: '',
    templateClientId: '',
    inboundRate: '',
    outboundB2cRate: '',
    outboundB2bRate: '',
    returnsRate: '',
    vasRate: '',
  });

  useEffect(() => {
    setStandards(workspace.standards);
    setPolicyDrafts({
      standard_hours_per_day: String(workspace.settings?.standard_hours_per_day ?? 8),
      planned_absence_percent: String(workspace.settings?.planned_absence_percent ?? 5),
      max_overtime_hours_per_day: String(workspace.settings?.max_overtime_hours_per_day ?? 3),
      overtime_hourly_cost_own: String(workspace.settings?.overtime_hourly_cost_own ?? 0),
      overtime_hourly_cost_3pl: String(workspace.settings?.overtime_hourly_cost_3pl ?? 0),
    });
    const nextRates: Record<string, string> = {};
    (workspace.clients ?? []).forEach(c => {
      (['inbound_rate_override', 'outbound_b2c_rate_override', 'outbound_b2b_rate_override', 'returns_rate_override', 'vas_rate_override'] as const).forEach(k => {
        nextRates[`${c.id}:${k}`] = c[k] != null ? String(c[k]) : '';
      });
    });
    setClientRateDrafts(nextRates);
    const nextEmpOt: Record<string, string> = {};
    (workspace.employeeSettings ?? []).forEach(s => {
      nextEmpOt[s.employee_id] = s.overtime_hourly_cost != null ? String(s.overtime_hourly_cost) : '';
    });
    setEmpOtDrafts(nextEmpOt);
  }, [workspace.standards, workspace.settings, workspace.clients, workspace.employeeSettings]);

  const settings = workspace.settings;
  const employeeSettings = workspace.employeeSettings ?? [];
  const clients = workspace.clients ?? [];

  const normalizeCode = (name: string) =>
    name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'CLIENT';

  const existingClientKeys = new Set(
    clients.flatMap(c => [c.name.trim().toUpperCase(), c.code.trim().toUpperCase()]),
  );
  const unregisteredSellers = [...new Set([
    ...(workspace.clientDailyVolumes ?? []).map(v => v.client_name.trim()),
    ...(workspace.sellers ?? []).map(s => s.seller_name.trim()),
  ].filter(name => name.length > 0 && !existingClientKeys.has(name.toUpperCase()) && !existingClientKeys.has(normalizeCode(name))))].sort();

  const runSetupChange = async (operation: () => Promise<void>, fallback: string, okMsg?: string) => {
    setSaving(true);
    setSetupError(null);
    setMessage(null);
    try {
      await operation();
      if (okMsg) setMessage(okMsg);
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : fallback);
    } finally {
      setSaving(false);
    }
  };

  const initializeAll = async () => {
    await runSetupChange(async () => {
      await fcProductivityService.initializeStandards(organizationId);
      await fcProductivityService.initializeWorkspaceSettings(organizationId).catch(() => undefined);
      await refresh();
    }, 'Unable to initialize FC setup.', 'FC standards and workforce settings initialized.');
  };

  const savePolicy = async (
    key: 'standard_hours_per_day' | 'planned_absence_percent' | 'max_overtime_hours_per_day' | 'overtime_hourly_cost_own' | 'overtime_hourly_cost_3pl',
    value: number,
  ) => {
    const limits: Record<string, [number, number]> = {
      standard_hours_per_day: [0.25, 24],
      planned_absence_percent: [0, 99],
      max_overtime_hours_per_day: [0, 12],
      overtime_hourly_cost_own: [0, 10000],
      overtime_hourly_cost_3pl: [0, 10000],
    };
    const [minimum, maximum] = limits[key];
    const validValue = Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum;
    setPolicyDrafts(current => ({ ...current, [key]: String(validValue) }));
    await runSetupChange(async () => {
      if (typeof window !== 'undefined') {
        if (key === 'overtime_hourly_cost_own') localStorage.setItem(`fc_ot_rate_own_${organizationId}`, String(validValue));
        if (key === 'overtime_hourly_cost_3pl') localStorage.setItem(`fc_ot_rate_3pl_${organizationId}`, String(validValue));
      }
      await fcProductivityService.saveSettings(organizationId, { [key]: validValue });
      await refresh();
    }, 'Unable to update FC planning policy.');
  };

  const createClient = async () => {
    if (!newClient.name.trim() || !newClient.code.trim()) return;
    const numOrNull = (val: string) => {
      const parsed = Number(val);
      return val.trim() !== '' && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };
    await runSetupChange(async () => {
      await fcProductivityService.createClient(organizationId, {
        code: newClient.code,
        name: newClient.name,
        templateClientId: newClient.templateClientId || null,
        inbound_rate_override: numOrNull(newClient.inboundRate),
        outbound_b2c_rate_override: numOrNull(newClient.outboundB2cRate),
        outbound_b2b_rate_override: numOrNull(newClient.outboundB2bRate),
        returns_rate_override: numOrNull(newClient.returnsRate),
        vas_rate_override: numOrNull(newClient.vasRate),
      });
      setNewClient({
        name: '',
        code: '',
        templateClientId: '',
        inboundRate: '',
        outboundB2cRate: '',
        outboundB2bRate: '',
        returnsRate: '',
        vasRate: '',
      });
      await refresh();
    }, 'Unable to add FC client.', 'FC client added.');
  };

  const toggleClientStatus = async (client: FcClientRow) => {
    await runSetupChange(async () => {
      await fcProductivityService.updateClient(organizationId, client.id, {
        status: client.status === 'active' ? 'inactive' : 'active',
      });
      await refresh();
    }, `Unable to update ${client.name}.`);
  };

  const deleteClient = async (client: FcClientRow) => {
    if (!window.confirm(`Delete FC client "${client.name}" (${client.code})?`)) return;
    await runSetupChange(async () => {
      await fcProductivityService.deleteClient(organizationId, client.id);
      await refresh();
    }, `Unable to delete ${client.name}.`, `FC client "${client.name}" deleted.`);
  };

  const syncOperationalSellers = async () => {
    if (unregisteredSellers.length === 0) return;
    await runSetupChange(async () => {
      const usedCodes = new Set(clients.map(c => c.code.trim().toUpperCase()));
      let createdCount = 0;
      for (const sellerName of unregisteredSellers) {
        const base = normalizeCode(sellerName);
        let code = base;
        let suffix = 2;
        while (usedCodes.has(code)) {
          code = `${base}_${suffix++}`;
        }
        usedCodes.add(code);
        await fcProductivityService.createClient(organizationId, {
          code,
          name: sellerName,
        });
        createdCount += 1;
      }
      await refresh();
      setMessage(`${createdCount} operational seller${createdCount === 1 ? '' : 's'} registered in FC Setup.`);
    }, 'Unable to sync operational sellers into FC Setup.');
  };

  const updateEmployeeSetting = async (
    employeeId: string,
    changes: Partial<Pick<FcEmployeeSettingsRow, 'labor_class' | 'employment_source' | 'overtime_eligible' | 'overtime_hourly_cost'>>,
  ) => {
    await runSetupChange(async () => {
      if ('overtime_hourly_cost' in changes && typeof window !== 'undefined') {
        localStorage.setItem(`fc_emp_ot_${employeeId}`, String(changes.overtime_hourly_cost ?? ''));
      }
      await fcProductivityService.saveEmployeeSetting(organizationId, employeeId, changes);
      await refresh();
    }, 'Unable to update employee labor classification.');
  };

  const saveStandard = async (row: FcActivityStandardRow) => {
    await runSetupChange(async () => {
      await fcProductivityService.saveStandard(organizationId, row);
      await refresh();
    }, 'Unable to save activity standard.', `${row.activity_name} saved.`);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-4 flex flex-wrap items-center justify-between gap-3" style={panel}>
        <div>
          <div className="font-semibold text-white">FC productivity setup</div>
          <div className="text-xs mt-1" style={{ color: '#64748b' }}>
            Administrator-only planning policy, client onboarding, activity targets, and FC workforce OT rates.
          </div>
        </div>
        {!standards.length && (
          <button
            type="button"
            onClick={() => void initializeAll()}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-xs font-semibold"
            style={{ background: '#2563eb', color: '#fff' }}
          >
            Initialize approved standards
          </button>
        )}
      </div>

      {setupError && (
        <div className="flex items-center gap-2 p-3 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#fca5a5' }}>
          <AlertCircle size={13} />
          {setupError}
        </div>
      )}
      {message && (
        <div className="p-3 rounded-lg text-xs" style={{ background: '#122338', color: '#93c5fd' }}>
          {message}
        </div>
      )}
      {saving && (
        <div className="text-xs flex items-center gap-2" style={{ color: '#93c5fd' }}>
          <Loader2 size={12} className="animate-spin" />
          Saving setup changes…
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="rounded-xl p-4" style={panel}>
          <div className="font-semibold text-sm text-white mb-3">Planning policy</div>
          <div className="space-y-3">
            {[
              ['Standard productive hours/day', 'standard_hours_per_day', 0.25, 24],
              ['Planned absence %', 'planned_absence_percent', 0, 99],
              ['Maximum OT hours/day', 'max_overtime_hours_per_day', 0, 12],
              ['Own OT rate (SAR/h)', 'overtime_hourly_cost_own', 0, 10000],
              ['3PL / Contract OT rate (SAR/h)', 'overtime_hourly_cost_3pl', 0, 10000],
            ].map(([label, key, minimum, maximum]) => (
              <label key={String(key)} className="block text-xs" style={{ color: '#94a3b8' }}>
                {label}
                <input
                  type="number"
                  min={Number(minimum)}
                  max={Number(maximum)}
                  step="0.5"
                  value={policyDrafts[String(key)] ?? ''}
                  onChange={e => setPolicyDrafts(current => ({ ...current, [String(key)]: e.target.value }))}
                  onBlur={e => void savePolicy(key as 'standard_hours_per_day', Number(e.target.value))}
                  className="mt-1 w-full px-3 py-2 rounded-lg font-mono"
                  style={field}
                />
              </label>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2 rounded-xl p-4 space-y-4" style={panel}>
          <div>
            <div className="font-semibold text-sm text-white">Add FC client / seller</div>
            <div className="text-xs mt-0.5" style={{ color: '#64748b' }}>
              Onboard a new FC seller using default FC standards, copy an existing client&apos;s overrides, or set custom SLA rates (units/hr).
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <input
              value={newClient.name}
              onChange={e => setNewClient({ ...newClient, name: e.target.value })}
              placeholder="Client / Seller name"
              className="px-3 py-2 rounded-lg text-sm"
              style={field}
            />
            <input
              value={newClient.code}
              onChange={e => setNewClient({ ...newClient, code: e.target.value })}
              placeholder="Client code (e.g. ACME)"
              className="px-3 py-2 rounded-lg text-sm"
              style={field}
            />
            <select
              value={newClient.templateClientId}
              onChange={e => setNewClient({ ...newClient, templateClientId: e.target.value })}
              className="px-3 py-2 rounded-lg text-sm"
              style={field}
            >
              <option value="">Use default FC standards</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>
                  Copy {c.name} overrides
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              ['Inbound u/h', 'inboundRate'],
              ['B2C Outbound u/h', 'outboundB2cRate'],
              ['B2B Outbound u/h', 'outboundB2bRate'],
              ['Returns u/h', 'returnsRate'],
              ['VAS u/h', 'vasRate'],
            ].map(([label, key]) => (
              <label key={key} className="text-[11px]" style={{ color: '#94a3b8' }}>
                {label}
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Default"
                  value={newClient[key as keyof typeof newClient]}
                  onChange={e => setNewClient({ ...newClient, [key]: e.target.value })}
                  className="mt-1 w-full px-2 py-1.5 rounded font-mono text-xs"
                  style={field}
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void createClient()}
            disabled={saving || !newClient.name.trim() || !newClient.code.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-40"
            style={{ background: '#2563eb', color: '#fff' }}
          >
            <Plus size={14} />
            Add FC client
          </button>

          {unregisteredSellers.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg text-xs" style={{ background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(59,130,246,0.3)', color: '#bfdbfe' }}>
              <div>
                <span className="font-semibold text-white">{unregisteredSellers.length}</span> operational seller{unregisteredSellers.length === 1 ? '' : 's'} from imported FC data not yet registered in Setup
                <span className="ml-1" style={{ color: '#93c5fd' }}>
                  ({unregisteredSellers.slice(0, 3).join(', ')}{unregisteredSellers.length > 3 ? `, +${unregisteredSellers.length - 3} more` : ''})
                </span>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => void syncOperationalSellers()}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                style={{ background: '#2563eb', color: '#fff' }}
              >
                Sync {unregisteredSellers.length} seller{unregisteredSellers.length === 1 ? '' : 's'}
              </button>
            </div>
          )}

          {clients.length === 0 ? (
            <div className="pt-3 border-t text-xs" style={{ borderColor: '#1e3a5a', color: '#64748b' }}>
              No FC clients registered in Setup yet. Add one above or sync imported operational sellers.
            </div>
          ) : (
            <div className="pt-3 border-t space-y-2" style={{ borderColor: '#1e3a5a' }}>
              <div className="text-xs font-semibold text-white">Configured FC clients & SLA rate overrides ({clients.length})</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: '#122338', color: '#64748b' }}>
                      <th className="text-left px-2 py-1.5">Client</th>
                      <th className="text-right px-2 py-1.5">Inbound u/h</th>
                      <th className="text-right px-2 py-1.5">B2C u/h</th>
                      <th className="text-right px-2 py-1.5">B2B u/h</th>
                      <th className="text-right px-2 py-1.5">Returns u/h</th>
                      <th className="text-right px-2 py-1.5">VAS u/h</th>
                      <th className="text-center px-2 py-1.5">Status</th>
                      <th className="text-right px-2 py-1.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map(client => {
                      const saveClientRate = (
                        rateKey: 'inbound_rate_override' | 'outbound_b2c_rate_override' | 'outbound_b2b_rate_override' | 'returns_rate_override' | 'vas_rate_override',
                        raw: string,
                      ) => {
                        const trimmed = raw.trim();
                        const nextVal = trimmed === '' ? null : Math.max(0.01, Number(trimmed) || 0.01);
                        setClientRateDrafts(current => ({ ...current, [`${client.id}:${rateKey}`]: nextVal != null ? String(nextVal) : '' }));
                        if (client[rateKey] === nextVal) return;
                        void runSetupChange(async () => {
                          await fcProductivityService.updateClient(organizationId, client.id, { [rateKey]: nextVal });
                          await refresh();
                        }, `Unable to update ${client.name} rates.`, `${client.name} SLA rate updated.`);
                      };
                      return (
                        <tr key={client.id} className="border-t" style={{ borderColor: '#1e3a5a' }}>
                          <td className="px-2 py-2 text-white">
                            <div className="font-medium">{client.name}</div>
                            <div className="text-[10px]" style={{ color: '#64748b' }}>{client.code}</div>
                          </td>
                          {(['inbound_rate_override', 'outbound_b2c_rate_override', 'outbound_b2b_rate_override', 'returns_rate_override', 'vas_rate_override'] as const).map(rateKey => (
                            <td key={rateKey} className="px-2 py-1.5 text-right">
                              <input
                                type="number"
                                min="0.01"
                                step="1"
                                placeholder="Default"
                                value={clientRateDrafts[`${client.id}:${rateKey}`] ?? ''}
                                onChange={e => setClientRateDrafts(current => ({ ...current, [`${client.id}:${rateKey}`]: e.target.value }))}
                                onBlur={e => saveClientRate(rateKey, e.target.value)}
                                className="w-20 px-2 py-1 rounded text-right font-mono text-[11px]"
                                style={field}
                              />
                            </td>
                          ))}
                          <td className="px-2 py-1.5 text-center">
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void toggleClientStatus(client)}
                              className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded"
                              style={{
                                color: client.status === 'active' ? '#10b981' : '#64748b',
                                background: client.status === 'active' ? 'rgba(16,185,129,0.12)' : 'rgba(100,116,139,0.12)',
                              }}
                            >
                              {client.status}
                            </button>
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <button
                              type="button"
                              disabled={saving}
                              title={`Delete ${client.name}`}
                              aria-label={`Delete ${client.name}`}
                              onClick={() => void deleteClient(client)}
                              className="p-1.5 rounded text-slate-400 hover:text-red-400 disabled:opacity-40"
                              style={{ background: '#0d1b2e' }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={panel}>
        <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold text-sm text-white">FC labor classification & OT rates</div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void initializeAll()}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
            style={{
              background: workspace.employees.some(emp => !employeeSettings.some(s => s.employee_id === emp.id)) ? '#2563eb' : '#122338',
              color: '#fff',
              border: '1px solid #1e3a5a',
            }}
          >
            {workspace.employees.some(emp => !employeeSettings.some(s => s.employee_id === emp.id))
              ? 'Re-run initialization (sync new employees)'
              : 'Sync FC defaults'}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: '#122338', color: '#64748b' }}>
                {['Employee', 'Job title', 'Labor class', 'Source', 'OT eligible', 'OT rate (SAR/h)'].map(h => (
                  <th key={h} className="text-left px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workspace.employees.map(employee => {
                const setting = employeeSettings.find(s => s.employee_id === employee.id);
                const defaultRate = setting?.employment_source === '3pl'
                  ? (settings?.overtime_hourly_cost_3pl || 0)
                  : (settings?.overtime_hourly_cost_own || 0);
                return (
                  <tr key={employee.id} className="border-t" style={{ borderColor: '#1e3a5a' }}>
                    <td className="px-3 py-2 text-white">
                      {employee.full_name}
                      <div style={{ color: '#64748b' }}>{employee.employee_code}</div>
                    </td>
                    <td className="px-3 py-2" style={{ color: '#94a3b8' }}>{employee.job_title ?? '—'}</td>
                    <td className="px-3 py-2">
                      <select
                        disabled={saving}
                        value={setting?.labor_class ?? 'dlp'}
                        onChange={e => void updateEmployeeSetting(employee.id, { labor_class: e.target.value as 'dlp' | 'non_dlp' })}
                        style={field}
                        className="px-2 py-1 rounded disabled:opacity-40"
                      >
                        <option value="dlp">DLP</option>
                        <option value="non_dlp">Non-DLP</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        disabled={saving}
                        value={setting?.employment_source ?? 'own'}
                        onChange={e => void updateEmployeeSetting(employee.id, { employment_source: e.target.value as 'own' | '3pl' })}
                        style={field}
                        className="px-2 py-1 rounded disabled:opacity-40"
                      >
                        <option value="own">Own</option>
                        <option value="3pl">3PL / Contract</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        disabled={saving}
                        type="checkbox"
                        checked={setting?.overtime_eligible ?? true}
                        onChange={e => void updateEmployeeSetting(employee.id, { overtime_eligible: e.target.checked })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        disabled={saving}
                        type="number"
                        min="0"
                        step="1"
                        placeholder={`Default (${defaultRate})`}
                        value={empOtDrafts[employee.id] ?? ''}
                        onChange={e => setEmpOtDrafts(current => ({ ...current, [employee.id]: e.target.value }))}
                        onBlur={e =>
                          void updateEmployeeSetting(employee.id, {
                            overtime_hourly_cost: e.target.value.trim() === '' ? null : Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        style={field}
                        className="w-28 px-2 py-1 rounded text-right font-mono disabled:opacity-40"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={panel}>
        <div className="px-4 py-3 font-semibold text-sm text-white">FC activity standards</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[850px]">
            <thead>
              <tr style={{ background: '#122338', color: '#64748b' }}>
                {['Activity', 'Volume Driver', 'Units / Worker', 'Target UOM', 'Active', ''].map(header => (
                  <th key={header} className="px-4 py-2 text-left">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {standards.map((row, index) => (
                <tr key={row.id} className="border-t" style={{ borderColor: '#1e3a5a' }}>
                  <td className="px-4 py-2 text-white">
                    {row.activity_name}
                    <div className="text-[10px]" style={{ color: '#64748b' }}>{row.activity_code}</div>
                  </td>
                  <td className="px-4 py-2">{row.volume_driver.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={row.units_per_worker}
                      onChange={event =>
                        setStandards(current =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, units_per_worker: Math.max(0.01, Number(event.target.value) || 0.01) } : item,
                          ),
                        )
                      }
                      className="w-32 px-2 py-1 rounded"
                      style={field}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={row.target_uom}
                      onChange={event =>
                        setStandards(current =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, target_uom: event.target.value as 'hour' | 'day' } : item,
                          ),
                        )
                      }
                      className="px-2 py-1 rounded"
                      style={field}
                    >
                      <option value="hour">Per hour</option>
                      <option value="day">Per day</option>
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={row.is_active}
                      onChange={event =>
                        setStandards(current =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, is_active: event.target.checked } : item,
                          ),
                        )
                      }
                    />
                  </td>
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      onClick={() => void saveStandard(row)}
                      disabled={saving}
                      className="px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40"
                      style={{ background: '#2563eb', color: '#fff' }}
                    >
                      Save
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
