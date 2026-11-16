import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck, Smartphone, X, XCircle } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { deviceService, type DeviceApprovalItem, type DeviceReviewRecord } from '../services/device.service';
import { getErrorMessage } from '../lib/errors';

const panelStyle = { background: '#0d1b2e', border: '1px solid #1e3a5a' } as const;
const fieldStyle = { background: '#081424', border: '1px solid #1e3a5a', color: '#f0f6ff' } as const;

function formatDate(value: string | null) {
  if (!value) return 'Not reported';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function deviceName(device: DeviceReviewRecord | null) {
  if (!device) return 'No previous device';
  return device.model || `${device.platform.charAt(0).toUpperCase()}${device.platform.slice(1)} phone`;
}

function fingerprint(device: DeviceReviewRecord | null) {
  return device ? `•••• ${device.device_identifier_hash.slice(-8).toUpperCase()}` : '—';
}

function DeviceCard({ title, device, tone }: { title: string; device: DeviceReviewRecord | null; tone: 'previous' | 'current' }) {
  const color = tone === 'current' ? '#f59e0b' : '#3b82f6';
  return <section className="rounded-xl p-4" style={{ background: '#0a1728', border: `1px solid ${color}45` }}>
    <div className="flex items-center gap-2"><Smartphone size={16} style={{ color }} /><h3 className="text-sm font-semibold text-white">{title}</h3></div>
    <div className="mt-4 space-y-3 text-xs">
      {[['Mobile', deviceName(device)], ['OS', device?.os_version || 'Not reported'], ['App version', device?.app_version || 'Not reported'], ['Device fingerprint', fingerprint(device)], [tone === 'current' ? 'Detected' : 'Last seen', formatDate(device?.last_seen_at ?? null)]].map(([label, value]) => <div key={label} className="flex items-start justify-between gap-4"><span style={{ color: '#4b6a8a' }}>{label}</span><span className="text-right text-white">{value}</span></div>)}
    </div>
  </section>;
}

function ReviewDialog({ item, onClose, onReviewed }: { item: DeviceApprovalItem; onClose: () => void; onReviewed: (message: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [verified, setVerified] = useState(false);
  const [saving, setSaving] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState('');

  const decide = async (decision: 'approve' | 'reject') => {
    if (decision === 'approve' && !verified) { setError('Confirm that you verified the new phone with the employee.'); return; }
    if (decision === 'reject' && !reason.trim()) { setError('A reason is required when rejecting a device.'); return; }
    setSaving(decision); setError('');
    try {
      await deviceService.reviewEnrollment(item.currentDevice.id, decision, reason.trim() || null);
      await onReviewed(decision === 'approve' ? `${item.employeeName}'s new phone was approved. The previous phone has been revoked.` : `${item.employeeName}'s new phone was rejected and remains blocked.`);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setSaving(null);
    }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(3,8,18,.86)', backdropFilter: 'blur(5px)' }} role="dialog" aria-modal="true" aria-labelledby="device-review-title">
    <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl" style={panelStyle}>
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 p-5" style={{ background: '#0d1b2e', borderBottom: '1px solid #1e3a5a' }}>
        <div className="flex gap-3"><div className="rounded-xl p-2.5" style={{ background: 'rgba(245,158,11,.12)', color: '#f59e0b' }}><AlertTriangle size={20} /></div><div><h2 id="device-review-title" className="font-bold text-white">New attendance device detected</h2><p className="text-xs mt-1" style={{ color: '#94a3b8' }}>{item.employeeName} · {item.employeeCode}</p></div></div>
        <button onClick={onClose} aria-label="Close device review" className="p-2 rounded-lg" style={{ color: '#94a3b8', background: '#122338' }}><X size={16} /></button>
      </header>
      <div className="p-5 space-y-4">
        <div className="rounded-xl p-3 flex gap-2 text-xs" style={{ background: 'rgba(245,158,11,.09)', border: '1px solid rgba(245,158,11,.25)', color: '#fcd34d' }}><AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /><span>Attendance is blocked on the new phone until an administrator reviews it. Compare the previous and current mobile details before deciding.</span></div>
        <div className="grid md:grid-cols-2 gap-4"><DeviceCard title="Last approved mobile" device={item.previousDevice} tone="previous" /><DeviceCard title="Current mobile requesting access" device={item.currentDevice} tone="current" /></div>
        <label className="block"><span className="text-xs font-medium" style={{ color: '#94a3b8' }}>Review note (required for rejection)</span><textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} rows={3} placeholder="How did you verify the phone, or why are you rejecting it?" className="w-full mt-2 rounded-lg p-3 text-sm outline-none resize-none" style={fieldStyle} /></label>
        <label className="flex items-start gap-2 rounded-xl p-3 text-xs cursor-pointer" style={{ background: '#081424', color: '#cbd5e1' }}><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} className="mt-0.5" /><span>I verified with the employee that the current phone belongs to them. Approving will revoke the previously approved phone.</span></label>
        {error && <div className="rounded-lg p-3 text-xs" role="alert" style={{ background: 'rgba(239,68,68,.1)', color: '#fca5a5' }}>{error}</div>}
      </div>
      <footer className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 p-5" style={{ borderTop: '1px solid #1e3a5a', background: '#081424' }}>
        <button disabled={!!saving} onClick={() => void decide('reject')} className="px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50" style={{ background: 'rgba(239,68,68,.12)', color: '#fca5a5' }}>{saving === 'reject' ? <Loader2 size={15} className="animate-spin" /> : <XCircle size={15} />} Reject device</button>
        <button disabled={!!saving || !verified} onClick={() => void decide('approve')} className="px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50" style={{ background: '#2563eb', color: '#fff' }}>{saving === 'approve' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Approve current mobile</button>
      </footer>
    </div>
  </div>;
}

export default function DeviceApprovals() {
  const { activeMembership } = useAuth();
  const organizationId = activeMembership?.organization_id;
  const [items, setItems] = useState<DeviceApprovalItem[]>([]);
  const [selected, setSelected] = useState<DeviceApprovalItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const alerted = useRef(false);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true); setError('');
    try {
      const result = await deviceService.listApprovalQueue(organizationId);
      setItems(result);
      if (!alerted.current && result.length > 0) { setSelected(result[0]); alerted.current = true; }
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  const reviewed = async (successMessage: string) => {
    setSelected(null); setMessage(successMessage); await load();
  };

  return <div className="space-y-4">
    <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"><div><h1 className="text-xl font-bold text-white">Device Approvals</h1><p className="text-sm mt-0.5" style={{ color: '#4b6a8a' }}>Review new attendance phones before granting access</p></div><button onClick={() => void load()} disabled={loading} className="self-start flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50" style={{ ...panelStyle, color: '#93c5fd' }}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button></header>
    {items.length > 0 && <button onClick={() => setSelected(items[0])} className="w-full rounded-xl p-4 flex items-start gap-3 text-left" style={{ background: 'rgba(245,158,11,.09)', border: '1px solid rgba(245,158,11,.28)' }}><AlertTriangle size={20} className="flex-shrink-0" style={{ color: '#f59e0b' }} /><div><div className="text-sm font-semibold" style={{ color: '#fcd34d' }}>{items.length} device approval{items.length === 1 ? '' : 's'} waiting</div><div className="text-xs mt-1" style={{ color: '#d6a64f' }}>Attendance remains blocked on these phones. Open the review alert to approve or reject.</div></div></button>}
    {message && <div className="rounded-xl p-3 flex items-center gap-2 text-xs" role="status" style={{ background: 'rgba(16,185,129,.1)', color: '#6ee7b7' }}><CheckCircle2 size={15} />{message}<button onClick={() => setMessage('')} className="ml-auto" aria-label="Dismiss message"><X size={14} /></button></div>}
    {error && <div className="rounded-xl p-3 text-xs" role="alert" style={{ background: 'rgba(239,68,68,.1)', color: '#fca5a5' }}>{error}</div>}
    <section className="rounded-xl overflow-hidden" style={panelStyle}>
      <div className="p-4 flex items-center gap-2" style={{ borderBottom: '1px solid #1e3a5a' }}><ShieldCheck size={17} style={{ color: '#3b82f6' }} /><h2 className="text-sm font-semibold text-white">Pending reviews</h2><span className="ml-auto text-xs px-2 py-1 rounded-full" style={{ background: '#122338', color: '#93c5fd' }}>{items.length}</span></div>
      {loading ? <div className="py-16"><Loader2 className="animate-spin mx-auto" style={{ color: '#3b82f6' }} /></div> : items.length === 0 ? <div className="py-16 text-center"><CheckCircle2 size={30} className="mx-auto" style={{ color: '#10b981' }} /><div className="text-white font-semibold mt-3">All devices reviewed</div><p className="text-xs mt-1" style={{ color: '#4b6a8a' }}>There are no unrecognized attendance phones waiting for approval.</p></div> : <div className="divide-y" style={{ borderColor: '#1e3a5a' }}>{items.map(item => <button key={item.currentDevice.id} onClick={() => setSelected(item)} className="w-full p-4 grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr_auto] gap-3 items-center text-left hover:bg-white/[.025]" style={{ borderColor: '#1e3a5a' }}><div><div className="text-sm font-semibold text-white">{item.employeeName}</div><div className="text-xs font-mono mt-0.5" style={{ color: '#4b6a8a' }}>{item.employeeCode}</div></div><div><div className="text-xs" style={{ color: '#4b6a8a' }}>Previous</div><div className="text-xs text-white mt-1">{deviceName(item.previousDevice)}</div></div><div><div className="text-xs" style={{ color: '#4b6a8a' }}>Current</div><div className="text-xs mt-1" style={{ color: '#fcd34d' }}>{deviceName(item.currentDevice)}</div></div><span className="justify-self-start md:justify-self-end px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: '#2563eb', color: '#fff' }}>Review</span></button>)}</div>}
    </section>
    {selected && <ReviewDialog item={selected} onClose={() => setSelected(null)} onReviewed={reviewed} />}
  </div>;
}
