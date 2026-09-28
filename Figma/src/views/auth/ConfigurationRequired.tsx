import { AlertTriangle, MapPin } from 'lucide-react';

export default function ConfigurationRequired() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#060d1a' }}>
      <div
        className="w-full max-w-md rounded-3xl p-7"
        style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}
      >
        <div className="flex items-center gap-3 mb-5">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #2563eb, #06b6d4)' }}
          >
            <MapPin size={20} className="text-white" />
          </div>
          <div>
            <div className="font-bold text-white">GEOTRACK</div>
            <div className="text-xs" style={{ color: '#4b6a8a' }}>Authentication setup required</div>
          </div>
        </div>

        <div
          className="rounded-xl p-4 flex gap-3"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}
        >
          <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
          <div>
            <div className="text-sm font-semibold" style={{ color: '#f59e0b' }}>Supabase is not configured</div>
            <p className="text-xs mt-1 leading-5" style={{ color: '#94a3b8' }}>
              Add the public project URL and publishable key to <code>.env.local</code>, then restart the Vite server.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
