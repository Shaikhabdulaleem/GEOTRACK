import { ShieldAlert, MapPin, CheckCircle } from 'lucide-react';
import type { GeofenceBreach } from '../services/dashboard.service';

/**
 * Dashboard panel listing employees who are currently checked in but have been
 * continuously outside their assigned geofence past the organization threshold.
 * This is the surface that "catches" sustained mid-shift departures — the live
 * map shows a snapshot, this shows duration and ranks by who has been out
 * longest. Backed by dashboardService.getActiveGeofenceBreaches.
 */
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function sinceLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Riyadh' });
}

export default function GeofenceBreachPanel({
  breaches,
  onNav,
}: {
  breaches: GeofenceBreach[];
  onNav?: (id: string) => void;
}) {
  const count = breaches.length;
  // Longest-out first — the most urgent cases surface at the top.
  const sorted = [...breaches].sort((a, b) => b.minutesOutside - a.minutesOutside);

  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: '#0d1b2e', border: `1px solid ${count > 0 ? 'rgba(239,68,68,0.45)' : '#1e3a5a'}` }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldAlert size={18} style={{ color: count > 0 ? '#ef4444' : '#64748b' }} />
          <div>
            <h3 className="text-sm font-semibold" style={{ color: '#f0f6ff' }}>Out of Geofence Now</h3>
            <p className="text-xs" style={{ color: '#7d93b2' }}>
              On-shift employees away from their site past the alert threshold
            </p>
          </div>
        </div>
        {count > 0 && (
          <span
            className="text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
          >
            {count} active
          </span>
        )}
      </div>

      {count === 0 ? (
        <div className="flex items-center gap-2 py-6 justify-center text-sm" style={{ color: '#64748b' }}>
          <CheckCircle size={16} style={{ color: '#22c55e' }} />
          Everyone on shift is on-site.
        </div>
      ) : (
        <ul className="space-y-2">
          {sorted.map(b => (
            <li
              key={b.breachId}
              className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              <div className="min-w-0">
                <button
                  onClick={() => onNav?.('live')}
                  className="text-sm font-medium truncate text-left hover:underline"
                  style={{ color: '#f0f6ff' }}
                >
                  {b.employeeName}
                </button>
                <div className="flex items-center gap-1.5 text-xs mt-0.5" style={{ color: '#7d93b2' }}>
                  <MapPin size={11} />
                  <span className="truncate">{b.geofenceName ?? 'Assigned geofence'}</span>
                  <span>·</span>
                  <span>since {sinceLabel(b.startedAt)}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold" style={{ color: '#ef4444' }}>
                  {formatDuration(b.minutesOutside)}
                </div>
                <div className="text-[10px] uppercase tracking-wide" style={{ color: '#7d93b2' }}>outside</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
