import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Building2, Edit3, Layers3, Loader2, MapPin, Plus, Power, Timer, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { organizationService, type SiteInput } from '../services/organization.service';
import { shiftService } from '../services/shift.service';
import { ShiftEditorModal } from '../components/ShiftEditorModal';
import { getErrorMessage } from '../lib/errors';
import type { BranchRow, DepartmentRow, ShiftRow } from '../types/database';

type Tab = 'sites' | 'departments' | 'shifts';
const input = { width: '100%', marginTop: 5, padding: '8px 10px', borderRadius: 8, background: '#122338', border: '1px solid #1e3a5a', color: '#f0f6ff', outline: 'none' } as const;
const emptySite = (org: string): SiteInput => ({ organization_id: org, name: '', code: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', address: '', latitude: null, longitude: null, create_geofence: false, geofence_radius_meters: 30 });

export default function Settings() {
  const { activeMembership, hasAnyRole } = useAuth();
  const org = activeMembership?.organization_id;
  const canManage = hasAnyRole(['administrator', 'manager']);
  const [tab, setTab] = useState<Tab>('sites');
  const [sites, setSites] = useState<BranchRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [siteForm, setSiteForm] = useState<{ data: SiteInput; row: BranchRow | null } | null>(null);
  const [departmentForm, setDepartmentForm] = useState<Partial<DepartmentRow> | null>(null);
  const [shiftForm, setShiftForm] = useState<ShiftRow | null | undefined>(undefined);
  const load = useCallback(async () => {
    if (!org) return;
    setBusy(true); setError('');
    try {
      const result = await Promise.all([organizationService.listSites(org), organizationService.listDepartments(org), shiftService.listShifts(org)]);
      setSites(result[0]); setDepartments(result[1]); setShifts(result[2]);
    } catch (caught) { setError(getErrorMessage(caught)); } finally { setBusy(false); }
  }, [org]);
  useEffect(() => { void load(); }, [load]);
  const siteNames = useMemo(() => new Map(sites.map(row => [row.id, row.name])), [sites]);
  if (!org) return <Empty message="No active organization is available." />;
  const toggle = async (kind: Tab, row: BranchRow | DepartmentRow | ShiftRow) => {
    try {
      if (kind === 'sites') await organizationService.updateSite(row.id, { status: row.status === 'active' ? 'inactive' : 'active' });
      else if (kind === 'departments') await organizationService.updateDepartment(row.id, { status: row.status === 'active' ? 'inactive' : 'active' });
      else await shiftService.deactivateShift(row.id);
      await load();
    } catch (caught) { setError(getErrorMessage(caught)); }
  };
  return <div className="space-y-4">
    <div><h1 className="text-xl font-bold text-white">Organization Setup</h1><p className="text-sm mt-1" style={{ color: '#4b6a8a' }}>Manage sites, site-specific departments, and versioned shift templates.</p></div>
    <div className="flex gap-2">{([['sites','Sites',MapPin],['departments','Departments',Layers3],['shifts','Shift Templates',Timer]] as const).map(([id,label,Icon]) => <button key={id} onClick={() => setTab(id)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm" style={{ background: tab === id ? '#2563eb' : '#0d1b2e', color: tab === id ? '#fff' : '#94a3b8', border: '1px solid #1e3a5a' }}><Icon size={14} />{label}</button>)}</div>
    {error && <div role="alert" className="p-3 rounded-xl text-sm" style={{ color: '#fca5a5', background: 'rgba(239,68,68,.1)' }}>{error}</div>}
    {busy ? <div className="p-16"><Loader2 className="mx-auto animate-spin" style={{ color: '#3b82f6' }} /></div> : tab === 'sites' ? <Panel title="Sites" icon={<Building2 size={16} />} add={canManage ? () => setSiteForm({ data: emptySite(org), row: null }) : undefined}>
      {sites.length ? sites.map(row => <Row key={row.id} title={row.name} detail={`${row.code} · ${row.timezone}${row.address ? ` · ${row.address}` : ''}`} status={row.status} edit={canManage ? () => setSiteForm({ data: { organization_id: row.organization_id, name: row.name, code: row.code, timezone: row.timezone, address: row.address ?? '', latitude: row.latitude ?? null, longitude: row.longitude ?? null }, row }) : undefined} toggle={canManage ? () => void toggle('sites', row) : undefined} />) : <Empty message="No sites yet. Add the first site to organize departments and geofences." />}
    </Panel> : tab === 'departments' ? <Panel title="Departments" icon={<Layers3 size={16} />} add={canManage && sites.some(row => row.status === 'active') ? () => setDepartmentForm({ organization_id: org, branch_id: sites.find(row => row.status === 'active')?.id, name: '', code: '', status: 'active' }) : undefined}>
      {!sites.length ? <Empty message="Create a site before adding departments." /> : departments.length ? departments.map(row => <Row key={row.id} title={row.name} detail={`${row.code} · ${siteNames.get(row.branch_id) ?? 'Unknown site'}`} status={row.status} edit={canManage ? () => setDepartmentForm(row) : undefined} toggle={canManage ? () => void toggle('departments', row) : undefined} />) : <Empty message="No departments yet." />}
    </Panel> : <Panel title="Shift Templates" icon={<Timer size={16} />} add={canManage ? () => setShiftForm(null) : undefined}>
      {shifts.length ? shifts.map(row => <Row key={row.id} title={row.name} detail={`${row.code} · ${row.start_time.slice(0,5)}–${row.end_time.slice(0,5)}${row.crosses_midnight ? ' · overnight' : ''} · v${row.version_number}`} status={row.status} edit={canManage ? () => setShiftForm(row) : undefined} toggle={canManage ? () => void toggle('shifts', row) : undefined} />) : <Empty message="No active shifts. Morning, Afternoon, and Night are naming shortcuts; choose all times manually." />}
    </Panel>}
    {siteForm && <SiteDialog initial={siteForm.data} editing={siteForm.row} close={() => setSiteForm(null)} save={async value => { if (siteForm.row) await organizationService.updateSite(siteForm.row.id, { name: value.name, code: value.code, timezone: value.timezone, address: value.address || null, latitude: value.latitude, longitude: value.longitude, location_point: value.latitude == null ? null : { type: 'Point', coordinates: [value.longitude!, value.latitude] } }); else await organizationService.createSite(value); setSiteForm(null); await load(); }} />}
    {departmentForm && <DepartmentDialog initial={departmentForm} sites={sites.filter(row => row.status === 'active')} close={() => setDepartmentForm(null)} save={async value => { if (value.id) await organizationService.updateDepartment(value.id, { branch_id: value.branch_id, name: value.name, code: value.code }); else await organizationService.createDepartment({ organization_id: org, branch_id: value.branch_id!, name: value.name!, code: value.code! }); setDepartmentForm(null); await load(); }} />}
    {shiftForm !== undefined && <ShiftEditorModal initial={shiftForm} organizationId={org} onClose={() => setShiftForm(undefined)} onSaved={() => { setShiftForm(undefined); void load(); }} />}
  </div>;
}

function Panel({ title, icon, add, children }: { title: string; icon: ReactNode; add?: () => void; children: ReactNode }) { return <section className="rounded-xl overflow-hidden" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}><header className="p-4 flex items-center gap-2" style={{ borderBottom: '1px solid #1e3a5a' }}>{icon}<h2 className="text-sm font-semibold text-white">{title}</h2>{add && <button onClick={add} className="ml-auto flex items-center gap-1 px-3 py-2 rounded-lg text-xs" style={{ color: '#fff', background: '#2563eb' }}><Plus size={13} />Add</button>}</header>{children}</section>; }
function Row({ title, detail, status, edit, toggle }: { title: string; detail: string; status: string; edit?: () => void; toggle?: () => void }) { return <div className="p-4 flex items-center gap-3 border-t" style={{ borderColor: '#1e3a5a' }}><div className="flex-1"><div className="text-sm font-semibold text-white">{title}</div><div className="text-xs mt-1" style={{ color: '#4b6a8a' }}>{detail}</div></div><span className="text-xs capitalize" style={{ color: status === 'active' ? '#6ee7b7' : '#94a3b8' }}>{status}</span>{edit && <button onClick={edit} className="p-2 rounded-lg" style={{ color: '#93c5fd', background: '#122338' }}><Edit3 size={14} /></button>}{toggle && <button onClick={toggle} className="p-2 rounded-lg" style={{ color: status === 'active' ? '#fca5a5' : '#6ee7b7', background: '#122338' }}><Power size={14} /></button>}</div>; }
function Empty({ message }: { message: string }) { return <div className="p-10 text-center text-sm" style={{ color: '#4b6a8a' }}>{message}</div>; }
function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) { return <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(6,13,26,.86)' }}><div className="w-full max-w-lg rounded-2xl p-5 space-y-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}><div className="flex"><h2 className="text-sm font-semibold text-white">{title}</h2><button onClick={close} className="ml-auto" style={{ color: '#4b6a8a' }}><X size={16} /></button></div>{children}</div></div>; }

function SiteDialog({ initial, editing, close, save }: { initial: SiteInput; editing: BranchRow | null; close: () => void; save: (value: SiteInput) => Promise<void> }) { const [form, setForm] = useState(initial); const [error, setError] = useState(''); const set = <K extends keyof SiteInput>(key: K, value: SiteInput[K]) => setForm(current => ({ ...current, [key]: value })); return <Dialog title={editing ? 'Edit site' : 'Add site'} close={close}><div className="grid grid-cols-2 gap-3"><Label text="Name"><input style={input} value={form.name} onChange={e => { set('name', e.target.value); if (!editing) set('code', e.target.value.replace(/[^a-z0-9]/gi,'').slice(0,8).toUpperCase()); }} /></Label><Label text="Editable code"><input style={input} value={form.code} onChange={e => set('code', e.target.value.toUpperCase())} /></Label><Label text="Timezone" wide><input style={input} value={form.timezone} onChange={e => set('timezone', e.target.value)} /></Label><Label text="Address" wide><input style={input} value={form.address} onChange={e => set('address', e.target.value)} /></Label><Label text="Latitude"><input type="number" step="any" style={input} value={form.latitude ?? ''} onChange={e => set('latitude', e.target.value ? Number(e.target.value) : null)} /></Label><Label text="Longitude"><input type="number" step="any" style={input} value={form.longitude ?? ''} onChange={e => set('longitude', e.target.value ? Number(e.target.value) : null)} /></Label>{!editing && <><label className="col-span-2 flex gap-2 text-xs" style={{ color: '#94a3b8' }}><input type="checkbox" checked={form.create_geofence ?? false} onChange={e => set('create_geofence', e.target.checked)} />Create linked geofence</label>{form.create_geofence && <Label text="Radius (metres)"><input type="number" min={5} style={input} value={form.geofence_radius_meters ?? 30} onChange={e => set('geofence_radius_meters', Number(e.target.value))} /></Label>}</>}</div>{error && <div className="text-xs text-red-300">{error}</div>}<button onClick={() => void save(form).catch(caught => setError(getErrorMessage(caught)))} className="w-full py-2 rounded-lg text-sm" style={{ color: '#fff', background: '#2563eb' }}>Save site</button></Dialog>; }
function DepartmentDialog({ initial, sites, close, save }: { initial: Partial<DepartmentRow>; sites: BranchRow[]; close: () => void; save: (value: Partial<DepartmentRow>) => Promise<void> }) { const [form, setForm] = useState(initial); const [error, setError] = useState(''); return <Dialog title={form.id ? 'Edit department' : 'Add department'} close={close}><Label text="Site"><select style={input} value={form.branch_id} onChange={e => setForm({ ...form, branch_id: e.target.value })}>{sites.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Label><Label text="Name"><input style={input} value={form.name ?? ''} onChange={e => setForm({ ...form, name: e.target.value })} /></Label><Label text="Code"><input style={input} value={form.code ?? ''} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} /></Label>{error && <div className="text-xs text-red-300">{error}</div>}<button onClick={() => void save(form).catch(caught => setError(getErrorMessage(caught)))} className="w-full py-2 rounded-lg text-sm" style={{ color: '#fff', background: '#2563eb' }}>Save department</button></Dialog>; }
function Label({ text, wide, children }: { text: string; wide?: boolean; children: ReactNode }) { return <label className={`text-xs ${wide ? 'col-span-2' : ''}`} style={{ color: '#94a3b8' }}>{text}{children}</label>; }
