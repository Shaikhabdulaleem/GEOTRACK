import { useState } from 'react';
import { Shield, Bell, MapPin, Clock, Database } from 'lucide-react';

type SettingValue = string | boolean;

const INITIAL_SETTINGS = {
  dayStart: '09:00',
  dayEnd: '17:00',
  nightStart: '21:00',
  nightEnd: '05:00',
  breakDuration: '30',
  checkinMode: 'confirmation',
  gpsAccuracy: '50',
  autoCheckoutTimeout: '15',
  gracePeriod: '5',
  empMissingReminder: '10',
  supervisorAlert: '30',
  otThreshold: '15',
  phoneHighThreshold: '60',
  serverTimestamp: true,
  mockLocation: true,
  rapidCheckin: '3',
  deviceRegistration: true,
};

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="relative flex-shrink-0 transition-colors"
      style={{ width: 36, height: 20, borderRadius: 10, background: value ? '#2563eb' : '#1e3a5a' }}
      aria-checked={value}
      role="switch"
    >
      <span
        className="absolute top-0.5 transition-all"
        style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', left: value ? 18 : 2 }}
      />
    </button>
  );
}

const inputCls = "px-2.5 py-1.5 rounded-lg text-xs font-mono text-right outline-none w-20";
const inputStyle = { background: '#122338', border: '1px solid #1e3a5a', color: '#f0f6ff' };
const selectStyle = { background: '#122338', border: '1px solid #1e3a5a', color: '#f0f6ff', borderRadius: 8, padding: '6px 10px', fontSize: 12 };

export default function Settings() {
  const [s, setS] = useState(INITIAL_SETTINGS);

  const set = (key: keyof typeof INITIAL_SETTINGS, val: SettingValue) => {
    setS(prev => ({ ...prev, [key]: val }));
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white">Settings</h1>
        <p className="text-sm mt-0.5" style={{ color: '#4b6a8a' }}>Configure attendance policy, geofencing, notifications, and security</p>
        <p className="text-xs mt-2" style={{ color: '#f59e0b' }} role="status">
          These values are draft-only until organization policy storage is connected; attendance enforcement remains server-side.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Shift Configuration */}
        <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 rounded-lg" style={{ background: 'rgba(37,99,235,0.15)' }}>
              <Clock size={14} style={{ color: '#3b82f6' }} />
            </div>
            <div className="font-semibold text-sm text-white">Shift Configuration</div>
          </div>
          <div className="space-y-3">
            {[
              { label: 'Day Shift Start', key: 'dayStart', type: 'time' },
              { label: 'Day Shift End', key: 'dayEnd', type: 'time' },
              { label: 'Night Shift Start', key: 'nightStart', type: 'time' },
              { label: 'Night Shift End', key: 'nightEnd', type: 'time' },
              { label: 'Break Duration (min)', key: 'breakDuration', type: 'number' },
            ].map(f => (
              <div key={f.key} className="flex items-center justify-between">
                <label className="text-xs" style={{ color: '#94a3b8' }}>{f.label}</label>
                <input
                  type={f.type}
                  className={inputCls}
                  style={inputStyle}
                  value={s[f.key as keyof typeof s] as string}
                  onChange={e => set(f.key as any, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Geofence & Check-In */}
        <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 rounded-lg" style={{ background: 'rgba(16,185,129,0.15)' }}>
              <MapPin size={14} style={{ color: '#10b981' }} />
            </div>
            <div className="font-semibold text-sm text-white">Geofence & Check-In</div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs" style={{ color: '#94a3b8' }}>Check-In Mode</label>
              <select style={selectStyle} value={s.checkinMode} onChange={e => set('checkinMode', e.target.value)}>
                <option value="automatic">Automatic</option>
                <option value="confirmation">Confirmation</option>
              </select>
            </div>
            {[
              { label: 'GPS Accuracy Threshold (m)', key: 'gpsAccuracy' },
              { label: 'Auto Check-Out Timeout (min)', key: 'autoCheckoutTimeout' },
              { label: 'Grace Period for Late (min)', key: 'gracePeriod' },
            ].map(f => (
              <div key={f.key} className="flex items-center justify-between">
                <label className="text-xs" style={{ color: '#94a3b8' }}>{f.label}</label>
                <input
                  type="number"
                  className={inputCls}
                  style={inputStyle}
                  value={s[f.key as keyof typeof s] as string}
                  onChange={e => set(f.key as any, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Notification Policy */}
        <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 rounded-lg" style={{ background: 'rgba(245,158,11,0.15)' }}>
              <Bell size={14} style={{ color: '#f59e0b' }} />
            </div>
            <div className="font-semibold text-sm text-white">Notification Policy</div>
          </div>
          <div className="space-y-3">
            {[
              { label: 'Employee missing reminder (min after shift)', key: 'empMissingReminder' },
              { label: 'Supervisor alert delay (min after shift)', key: 'supervisorAlert' },
              { label: 'OT notification threshold (min)', key: 'otThreshold' },
              { label: 'Phone usage high threshold (min)', key: 'phoneHighThreshold' },
            ].map(f => (
              <div key={f.key} className="flex items-center justify-between">
                <label className="text-xs" style={{ color: '#94a3b8' }}>{f.label}</label>
                <input
                  type="number"
                  className={inputCls}
                  style={inputStyle}
                  value={s[f.key as keyof typeof s] as string}
                  onChange={e => set(f.key as any, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Anti-Fraud */}
        <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.15)' }}>
              <Shield size={14} style={{ color: '#ef4444' }} />
            </div>
            <div className="font-semibold text-sm text-white">Anti-Fraud & Security</div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs" style={{ color: '#94a3b8' }}>Require server-side timestamp</label>
              <Toggle value={s.serverTimestamp} onChange={v => set('serverTimestamp', v)} />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-xs" style={{ color: '#94a3b8' }}>Detect mock/fake location (Android)</label>
              <Toggle value={s.mockLocation} onChange={v => set('mockLocation', v)} />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-xs" style={{ color: '#94a3b8' }}>Max rapid check-in count</label>
              <input
                type="number"
                className={inputCls}
                style={inputStyle}
                value={s.rapidCheckin}
                onChange={e => set('rapidCheckin', e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-xs" style={{ color: '#94a3b8' }}>Require device registration</label>
              <Toggle value={s.deviceRegistration} onChange={v => set('deviceRegistration', v)} />
            </div>
          </div>
        </div>
      </div>

      {/* Integrations */}
      <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-lg" style={{ background: 'rgba(139,92,246,0.15)' }}>
            <Database size={14} style={{ color: '#8b5cf6' }} />
          </div>
          <div className="font-semibold text-sm text-white">Future Integrations</div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {['HRMS', 'Payroll / ERP', 'Power BI', 'Microsoft Dynamics', 'Odoo', 'SAP', 'WhatsApp Business', 'Biometrics', 'MDM Platform', 'Google Sheets', 'SMS Gateway', 'Email'].map(int => (
            <div key={int} className="flex items-center justify-between p-2.5 rounded-lg" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
              <span className="text-xs" style={{ color: '#94a3b8' }}>{int}</span>
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(148,163,184,0.08)', color: '#4b6a8a' }}>Soon</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          disabled
          title="Organization policy storage is not configured"
          className="px-6 py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ background: '#1e3a5a', color: '#94a3b8', cursor: 'not-allowed' }}
        >
          Save unavailable
        </button>
      </div>
    </div>
  );
}
