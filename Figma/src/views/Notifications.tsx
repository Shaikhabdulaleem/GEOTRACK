import { useCallback, useEffect, useState } from 'react';
import { Clock, MapPin, AlertTriangle, Timer, Smartphone, TrendingDown, Bell, CheckCircle, RefreshCw, Loader2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { notificationService } from '../services/notification.service';
import type { NotificationRow } from '../types/database';
import { isSupabaseConfigured } from '../lib/supabase';
import { alerts as mockAlerts } from '../data/mockData';
import { logger } from '../lib/logger';

const ICONS: Record<string, any> = {
  late: Clock, missing: AlertTriangle, geofence: MapPin,
  overtime: Timer, phone: Smartphone, productivity: TrendingDown,
  shift_change: Clock, correction: AlertTriangle
};

const COLORS: Record<string, { color: string; bg: string; border: string }> = {
  error:   { color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)' },
  warning: { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)' },
  info:    { color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.2)' },
};

const INITIAL_POLICY = {
  gracePeriod: '15',
  supervisorDelay: '30',
  checkoutTimeout: '15',
  otThreshold: '15',
};

export default function Notifications() {
  const { user, activeMembership } = useAuth();
  const supabaseReady = isSupabaseConfigured();
  
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [policy, setPolicy] = useState<typeof INITIAL_POLICY>(INITIAL_POLICY);

  const loadData = useCallback(async () => {
    if (!supabaseReady || !user || !activeMembership) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await notificationService.listMine(activeMembership.organization_id, user.id);
      setNotifications(data);
    } catch (e) {
      logger.error('Unable to load notifications.', e);
    } finally {
      setLoading(false);
    }
  }, [supabaseReady, user, activeMembership]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const visible = supabaseReady 
    ? notifications.filter(a => !a.read_at && !dismissed.includes(a.id))
    : mockAlerts.filter(a => !dismissed.includes(a.id.toString())).map(a => ({
        id: a.id.toString(),
        organization_id: '',
        recipient_user_id: '',
        notification_type: a.type,
        severity: a.severity as 'info' | 'warning' | 'error',
        title: a.title,
        body: a.desc,
        entity_type: null,
        entity_id: null,
        read_at: null,
        acknowledged_at: null,
        created_at: new Date().toISOString()
      }));

  const handleDismissAll = async () => {
    if (supabaseReady) {
      // Optimistically dismiss
      const toDismiss = visible.map(v => v.id);
      setDismissed(prev => [...prev, ...toDismiss]);
      // Actually mark in DB
      await Promise.allSettled(toDismiss.map(id => notificationService.markRead(id)));
    } else {
      setDismissed(visible.map(v => v.id));
    }
  };

  const setP = (key: keyof typeof INITIAL_POLICY, val: string) => {
    setPolicy(p => ({ ...p, [key]: val }));
  };

  const dismissOne = async (id: string) => {
    setDismissed(prev => [...prev, id]);
    if (supabaseReady) {
      try {
        await notificationService.markRead(id);
      } catch (e) {
        logger.error('Unable to mark notification as read.', e);
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            Alert Center
            <span className="text-sm px-2 py-0.5 rounded-full font-mono" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>
              {visible.length}
            </span>
          </h1>
          <p className="text-sm mt-0.5" style={{ color: '#4b6a8a' }}>Real-time operational alerts requiring supervisor attention</p>
        </div>
        <div className="flex gap-2">
          {supabaseReady && (
            <button 
              onClick={() => void loadData()}
              disabled={loading}
              className="p-2 rounded-lg hover:bg-white/5 transition-colors"
              style={{ border: '1px solid #1e3a5a', color: '#4b6a8a' }}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          )}
          <button
            onClick={handleDismissAll}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors hover:bg-white/5"
            style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: '#4b6a8a' }}
          >
            <CheckCircle size={14} />
            Dismiss All
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Action Required', count: visible.filter(a=>a.severity === 'error').length, color: '#ef4444' },
          { label: 'Informational', count: visible.filter(a=>a.severity !== 'error').length, color: '#3b82f6' },
          { label: 'Dismissed Today', count: dismissed.length, color: '#4b6a8a' },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-3 flex items-center gap-3" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
            <div className="text-2xl font-bold font-mono" style={{ color: s.color }}>{s.count}</div>
            <div className="text-xs" style={{ color: '#4b6a8a' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="rounded-xl p-10 flex justify-center" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
          <Loader2 size={24} className="animate-spin" style={{ color: '#3b82f6' }} />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl p-12 text-center" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
          <Bell size={32} className="mx-auto mb-3" style={{ color: '#1e3a5a' }} />
          <div className="text-white font-semibold">All clear</div>
          <div className="text-sm mt-1" style={{ color: '#4b6a8a' }}>No active alerts</div>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(alert => {
            const Icon = ICONS[alert.notification_type] ?? Bell;
            const c = COLORS[alert.severity] ?? COLORS.info;
            return (
              <div key={alert.id} className="rounded-xl p-4 flex gap-4" style={{ background: c.bg, border: `1px solid ${c.border}` }}>
                <div className="flex items-start gap-3 flex-1">
                  <div className="p-2 rounded-lg flex-shrink-0 mt-0.5" style={{ background: `${c.color}18` }}>
                    <Icon size={14} style={{ color: c.color }} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-semibold text-sm text-white">{alert.title}</span>
                      {alert.severity === 'error' && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>Action Required</span>
                      )}
                    </div>
                    <p className="text-sm" style={{ color: '#94a3b8' }}>{alert.body}</p>
                    <div className="text-xs mt-1" style={{ color: '#4b6a8a' }}>{new Date(alert.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} today</div>
                  </div>
                </div>
                <button 
                  onClick={() => dismissOne(alert.id)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium self-start transition-opacity hover:opacity-80"
                  style={{ background: 'rgba(255,255,255,0.05)', color: '#94a3b8' }}
                >
                  Dismiss
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Alert Policies... [truncated mock implementation omitted for brevity, keeping only visual parts] */}
      <div className="mt-8">
        <h2 className="text-sm font-semibold text-white mb-3">Alert Policies</h2>
        <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
          <p className="text-xs mb-3" style={{ color: '#f59e0b' }} role="status">
            Draft values only: alert policy persistence is not connected and does not change server-side notification generation.
          </p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            {[
              { k: 'gracePeriod', l: 'Late Arrival Grace Period (mins)', v: policy.gracePeriod },
              { k: 'supervisorDelay', l: 'Supervisor Escalation Delay (mins)', v: policy.supervisorDelay },
              { k: 'checkoutTimeout', l: 'Auto Check-Out Timeout (hrs)', v: policy.checkoutTimeout },
              { k: 'otThreshold', l: 'Overtime Alert Threshold (mins)', v: policy.otThreshold },
            ].map(f => (
              <div key={f.k}>
                <label className="block text-xs mb-1.5" style={{ color: '#4b6a8a' }}>{f.l}</label>
                <input 
                  type="number"
                  value={f.v}
                  onChange={e => setP(f.k as any, e.target.value)}
                  className="w-full bg-transparent px-3 py-1.5 rounded text-sm text-white"
                  style={{ border: '1px solid #1e3a5a' }}
                />
              </div>
            ))}
          </div>
          <button type="button" disabled title="Alert policy storage is not configured"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ background: '#1e3a5a', color: '#94a3b8', cursor: 'not-allowed' }}
          >
            Save unavailable
          </button>
        </div>
      </div>
    </div>
  );
}
