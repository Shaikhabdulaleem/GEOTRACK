const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  'Present': { bg: 'rgba(16,185,129,0.12)', color: '#10b981' },
  'Present — On Time': { bg: 'rgba(16,185,129,0.12)', color: '#10b981' },
  'Late': { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' },
  'Present — Late': { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' },
  'Absent': { bg: 'rgba(239,68,68,0.12)', color: '#ef4444' },
  'Missing': { bg: 'rgba(249,115,22,0.12)', color: '#f97316' },
  'Missing Check-In': { bg: 'rgba(249,115,22,0.12)', color: '#f97316' },
  'Missing Check-Out': { bg: 'rgba(249,115,22,0.12)', color: '#f97316' },
  'Early Check-Out': { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' },
  'Overtime': { bg: 'rgba(139,92,246,0.12)', color: '#8b5cf6' },
  'Pending': { bg: 'rgba(249,115,22,0.12)', color: '#f97316' },
  'Approved': { bg: 'rgba(16,185,129,0.12)', color: '#10b981' },
  'Rejected': { bg: 'rgba(239,68,68,0.12)', color: '#ef4444' },
  'OFF': { bg: 'rgba(148,163,184,0.08)', color: '#64748b' },
  'Day': { bg: 'rgba(37,99,235,0.12)', color: '#3b82f6' },
  'Night': { bg: 'rgba(139,92,246,0.12)', color: '#8b5cf6' },
  'Active': { bg: 'rgba(16,185,129,0.12)', color: '#10b981' },
  'Inside Geofence': { bg: 'rgba(16,185,129,0.12)', color: '#10b981' },
  'Outside Geofence': { bg: 'rgba(239,68,68,0.12)', color: '#ef4444' },
};

export default function StatusBadge({ status }: { status: string }) {
  const s = STATUS_COLORS[status] ?? { bg: 'rgba(148,163,184,0.08)', color: '#94a3b8' };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium" style={{ background: s.bg, color: s.color }}>
      {status}
    </span>
  );
}
