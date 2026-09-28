import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Bell, CheckCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { notificationService } from '../services/notification.service';
import { getErrorMessage } from '../lib/errors';
import type { NotificationRow } from '../types/database';

const severityColor = {
  info: '#3b82f6',
  warning: '#f59e0b',
  error: '#ef4444',
} as const;

export default function MyNotifications() {
  const { user, activeMembership } = useAuth();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!user || !activeMembership) return;
    setLoading(true);
    setError('');
    try {
      setNotifications(await notificationService.listMine(activeMembership.organization_id, user.id));
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [activeMembership, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (id: string) => {
    try {
      const updated = await notificationService.markRead(id);
      setNotifications(items => items.map(item => item.id === id ? updated : item));
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2"><Bell size={20} style={{ color: '#3b82f6' }} /> My Notifications</h1>
        <p className="text-sm mt-0.5" style={{ color: '#4b6a8a' }}>Updates sent to your authenticated account</p>
      </div>

      {error && <div className="rounded-xl p-3 flex gap-2 text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }} role="alert"><AlertCircle size={15} /> {error}</div>}

      {loading ? (
        <div className="rounded-xl p-10 flex justify-center" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}><Loader2 size={20} className="animate-spin" style={{ color: '#3b82f6' }} /></div>
      ) : notifications.length === 0 ? (
        <div className="rounded-xl p-12 text-center" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
          <Bell size={32} className="mx-auto mb-3" style={{ color: '#1e3a5a' }} />
          <div className="text-white font-semibold">All clear</div>
          <div className="text-sm mt-1" style={{ color: '#4b6a8a' }}>You have no notifications.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map(item => {
            const color = severityColor[item.severity];
            return (
              <div key={item.id} className="rounded-xl p-4 flex items-start gap-3" style={{ background: '#0d1b2e', border: `1px solid ${item.read_at ? '#1e3a5a' : `${color}55`}` }}>
                <div className="p-2 rounded-lg" style={{ background: `${color}18` }}><Bell size={14} style={{ color }} /></div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-white">{item.title}</div>
                  <p className="text-sm mt-0.5" style={{ color: '#94a3b8' }}>{item.body}</p>
                  <div className="text-xs mt-1" style={{ color: '#4b6a8a' }}>{new Date(item.created_at).toLocaleString()}</div>
                </div>
                {!item.read_at && <button onClick={() => void markRead(item.id)} className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5" style={{ background: 'rgba(37,99,235,0.12)', color: '#93c5fd' }}><CheckCircle size={13} /> Mark read</button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
