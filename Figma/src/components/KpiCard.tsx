import { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: string | number;
  sub?: string;
  icon: LucideIcon;
  color?: string;
  trend?: number;
}

export default function KpiCard({ title, value, sub, icon: Icon, color = '#2563eb', trend }: KpiCardProps) {
  return (
    <div className="rounded-xl p-4 card-glow transition-all" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: '#4b6a8a', letterSpacing: '0.08em' }}>{title}</div>
          <div className="text-2xl font-bold text-white font-mono" style={{ lineHeight: 1.1 }}>{value}</div>
          {sub && <div className="text-xs mt-1" style={{ color: '#94a3b8' }}>{sub}</div>}
          {trend !== undefined && (
            <div className="text-xs mt-1" style={{ color: trend >= 0 ? '#10b981' : '#ef4444' }}>
              {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}% vs yesterday
            </div>
          )}
        </div>
        <div className="rounded-lg p-2" style={{ background: `${color}18` }}>
          <Icon size={18} style={{ color }} />
        </div>
      </div>
    </div>
  );
}
