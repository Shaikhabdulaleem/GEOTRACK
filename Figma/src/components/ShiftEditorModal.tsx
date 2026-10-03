import { useState } from 'react';
import { CheckCircle, Moon, RefreshCw, Save, X } from 'lucide-react';
import { detectCrossesMidnight, formatTime12, shiftDurationMinutes, shiftService } from '../services/shift.service';
import type { ShiftRow } from '../types/database';

export interface ShiftEditorModalProps {
  initial?: ShiftRow | null;
  organizationId: string;
  onSaved: (shift: ShiftRow) => void;
  onClose: () => void;
}

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

export function ShiftEditorModal({ initial, organizationId, onSaved, onClose }: ShiftEditorModalProps) {
  const [name, setName] = useState(initial?.name ?? 'Morning');
  const [code, setCode] = useState(initial?.code ?? 'MORNING');
  const [start, setStart] = useState(initial?.start_time?.slice(0, 5) ?? '09:00');
  const [end, setEnd] = useState(initial?.end_time?.slice(0, 5) ?? '17:00');
  const [breakMins, setBreakMins] = useState(String(initial?.break_minutes ?? 30));
  const [color, setColor] = useState(initial?.color ?? '#2563eb');
  const [effectiveFrom, setEffectiveFrom] = useState(initial ? tomorrow() : new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const overnight = detectCrossesMidnight(start, end);
  const duration = shiftDurationMinutes(start, end) - Number(breakMins || 0);

  const chooseName = (quickName: string) => {
    setName(quickName);
    if (!initial) setCode(quickName.toUpperCase());
  };

  const save = async () => {
    if (!name.trim() || !code.trim()) return setError('Shift name and code are required.');
    setSaving(true); setError('');
    try {
      const payload = { name, code, start_time: start, end_time: end, break_minutes: Number(breakMins) || 0, color, effective_from: effectiveFrom };
      const result = initial
        ? await shiftService.updateShift(initial.id, payload)
        : await shiftService.createShift({ organization_id: organizationId, ...payload });
      setSaved(true);
      window.setTimeout(() => { onSaved(result); onClose(); }, 500);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to save shift.');
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(6,13,26,.86)' }}>
    <div className="rounded-2xl w-full max-w-md" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #1e3a5a' }}>
        <div className="font-semibold text-sm text-white">{initial ? 'Edit shift template' : 'New shift template'}</div>
        <button onClick={onClose} aria-label="Close shift editor" style={{ color: '#4b6a8a' }}><X size={15} /></button>
      </div>
      {saved ? <div className="flex flex-col items-center py-10 gap-2"><CheckCircle size={28} style={{ color: '#10b981' }} /><span className="text-white text-sm">Shift saved</span></div> : <div className="p-5 space-y-4">
        <div><div className="text-xs mb-2" style={{ color: '#4b6a8a' }}>Quick-start name</div><div className="flex gap-2">{['Morning','Afternoon','Night'].map(item => <button key={item} type="button" onClick={() => chooseName(item)} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: name === item ? '#2563eb' : '#122338', color: '#fff' }}>{item}</button>)}</div></div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs" style={{ color: '#94a3b8' }}>Name<input value={name} onChange={e => setName(e.target.value)} style={inputStyle} /></label>
          <label className="text-xs" style={{ color: '#94a3b8' }}>Code<input value={code} onChange={e => setCode(e.target.value.toUpperCase())} style={inputStyle} /></label>
          <label className="text-xs" style={{ color: '#94a3b8' }}>Start time<input type="time" value={start} onChange={e => setStart(e.target.value)} style={inputStyle} /></label>
          <label className="text-xs" style={{ color: '#94a3b8' }}>End time<input type="time" value={end} onChange={e => setEnd(e.target.value)} style={inputStyle} /></label>
          <label className="text-xs" style={{ color: '#94a3b8' }}>Break (minutes)<input type="number" min={0} max={240} value={breakMins} onChange={e => setBreakMins(e.target.value)} style={inputStyle} /></label>
          <label className="text-xs" style={{ color: '#94a3b8' }}>Colour<div className="flex items-center gap-2 mt-1"><input type="color" value={color} onChange={e => setColor(e.target.value)} /><span>{color}</span></div></label>
        </div>
        <label className="text-xs block" style={{ color: '#94a3b8' }}>{initial ? 'New version effective from' : 'Effective from'}<input type="date" min={initial ? tomorrow() : undefined} value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} style={inputStyle} /></label>
        {overnight && <div className="flex gap-2 p-3 rounded-lg text-xs" style={{ color: '#c4b5fd', background: 'rgba(139,92,246,.12)' }}><Moon size={14} />Overnight shift detected: {formatTime12(start)} to {formatTime12(end)} next day.</div>}
        {duration > 0 && <div className="text-xs" style={{ color: '#4b6a8a' }}>Net working time: <span className="text-white">{Math.floor(duration / 60)}h {duration % 60 || ''}</span></div>}
        {error && <div role="alert" className="text-xs rounded-lg p-3" style={{ color: '#fca5a5', background: 'rgba(239,68,68,.1)' }}>{error}</div>}
        <div className="flex gap-2"><button onClick={onClose} className="flex-1 py-2 rounded-lg text-sm" style={{ background: '#122338', color: '#94a3b8' }}>Cancel</button><button onClick={() => void save()} disabled={saving} className="flex-1 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2" style={{ background: '#2563eb', color: '#fff' }}>{saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}Save shift</button></div>
      </div>}
    </div>
  </div>;
}

const inputStyle = { display: 'block', width: '100%', marginTop: 5, padding: '8px 10px', borderRadius: 8, background: '#122338', border: '1px solid #1e3a5a', color: '#f0f6ff', outline: 'none' } as const;
