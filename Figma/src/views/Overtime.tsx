import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertCircle, Clock } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import { overtimeService } from '../services/overtime.service';
import { useAuth } from '../auth/AuthContext';
import { toAppError } from '../lib/errors';
import { logger } from '../lib/logger';
import type { EmployeeProfileRow, OvertimeRecordRow } from '../types/database';

const INITIAL_POLICY = { minThreshold: '15', autoApprove: '30', defaultApprover: 'Sarah Johnson (Admin)' };

interface ExtendedOvertimeRecord extends OvertimeRecordRow {
  employee_name?: string;
}

export default function Overtime() {
  const { activeMembership, session } = useAuth();
  const [records, setRecords] = useState<ExtendedOvertimeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [policy, setPolicy] = useState(INITIAL_POLICY);

  useEffect(() => {
    if (!activeMembership) return;
    
    let mounted = true;
    setLoading(true);
    
    overtimeService.list({ organizationId: activeMembership.organization_id })
      .then(async (data) => {
        if (!mounted) return;
        const { getSupabaseClient } = await import('../lib/supabase');
        const empIds = [...new Set(data.map(d => d.employee_id))];
        let profiles: Pick<EmployeeProfileRow, 'id' | 'full_name'>[] = [];
        if (empIds.length > 0) {
          const { data: pData } = await getSupabaseClient()
            .from('employee_profiles')
            .select('id, full_name')
            .in('id', empIds);
          profiles = pData || [];
        }
        
        const nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name]));
        
        setRecords(data.map(d => ({ ...d, employee_name: nameMap[d.employee_id] || 'Unknown' })));
      })
      .catch(err => {
        if (mounted) setError(toAppError(err).message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
      
    return () => { mounted = false; };
  }, [activeMembership]);

  const approve = async (id: string, requestedMinutes: number) => {
    if (!session?.user.id) return;
    try {
      await overtimeService.reviewOvertime(id, 'approved', requestedMinutes, session.user.id);
      setRecords(r => r.map(rec => rec.id === id ? { ...rec, status: 'approved', approved_minutes: requestedMinutes } : rec));
    } catch (e) {
      logger.error('Failed to approve overtime.', e);
    }
  };
  
  const reject = async (id: string) => {
    if (!session?.user.id) return;
    try {
      await overtimeService.reviewOvertime(id, 'rejected', 0, session.user.id);
      setRecords(r => r.map(rec => rec.id === id ? { ...rec, status: 'rejected', approved_minutes: 0 } : rec));
    } catch (e) {
      logger.error('Failed to reject overtime.', e);
    }
  };

  const setP = (key: keyof typeof INITIAL_POLICY, val: string) => {
    setPolicy(p => ({ ...p, [key]: val }));
  };

  const pending = records.filter(r => r.status === 'pending').length;

  if (loading) return <div className="p-4 text-white">Loading...</div>;
  if (error) return <div className="p-4 text-red-500">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Overtime Management</h1>
          <p className="text-sm mt-0.5" style={{ color: '#4b6a8a' }}>Review and approve overtime requests</p>
        </div>
      </div>

      {pending > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg text-sm" style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', color: '#c4b5fd' }}>
          <AlertCircle size={14} />
          {pending} overtime request(s) awaiting approval
        </div>
      )}

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total OT Today', value: '0h', color: '#8b5cf6' },
          { label: 'Pending Approval', value: pending, color: '#f97316' },
          { label: 'Approved This Week', value: records.filter(r=>r.status==='approved').length, color: '#10b981' },
          { label: 'Avg OT per Employee', value: '0h', color: '#3b82f6' },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
            <div className="text-xs" style={{ color: '#4b6a8a' }}>{s.label}</div>
            <div className="text-2xl font-bold font-mono mt-1" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3a5a' }}>
        <table className="w-full">
          <thead>
            <tr style={{ background: '#122338' }}>
              {['Employee', 'Date', 'OT Requested', 'OT Approved', 'Status', 'Actions'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: '#4b6a8a' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
               <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">No overtime records found.</td></tr>
            ) : records.map((rec) => (
              <tr key={rec.id} className="border-t hover:bg-white/5" style={{ borderColor: '#1e3a5a' }}>
                <td className="px-4 py-3 text-xs font-medium text-white">{rec.employee_name}</td>
                <td className="px-4 py-3 font-mono text-xs" style={{ color: '#94a3b8' }}>{new Date(rec.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 font-mono text-xs" style={{ color: '#8b5cf6' }}>{rec.requested_minutes}m</td>
                <td className="px-4 py-3 font-mono text-xs" style={{ color: rec.approved_minutes ? '#10b981' : '#4b6a8a' }}>{rec.approved_minutes ? `${rec.approved_minutes}m` : '—'}</td>
                <td className="px-4 py-3"><StatusBadge status={rec.status.charAt(0).toUpperCase() + rec.status.slice(1)} /></td>
                <td className="px-4 py-3">
                  {rec.status === 'pending' && (
                    <div className="flex gap-1.5">
                      <button onClick={() => approve(rec.id, rec.requested_minutes)} className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>
                        <CheckCircle size={11} /> Approve
                      </button>
                      <button onClick={() => reject(rec.id)} className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                        <XCircle size={11} /> Reject
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
        <div className="font-semibold text-sm text-white mb-3 flex items-center gap-2">
          <Clock size={14} style={{ color: '#8b5cf6' }} />
          Overtime Policy Configuration
        </div>
        <p className="text-xs mb-3" style={{ color: '#f59e0b' }} role="status">
          Draft values only: policy persistence is not connected, so these settings do not change server-side overtime calculations.
        </p>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs mb-1.5" style={{ color: '#4b6a8a' }}>Minimum OT Threshold</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                className="w-16 px-2 py-1.5 rounded text-xs text-center font-mono outline-none"
                style={{ background: '#122338', border: '1px solid #1e3a5a', color: '#f0f6ff' }}
                value={policy.minThreshold}
                onChange={e => setP('minThreshold', e.target.value)}
              />
              <span className="text-xs" style={{ color: '#4b6a8a' }}>minutes</span>
            </div>
          </div>
          <div>
            <div className="text-xs mb-1.5" style={{ color: '#4b6a8a' }}>Auto-Approve Below</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                className="w-16 px-2 py-1.5 rounded text-xs text-center font-mono outline-none"
                style={{ background: '#122338', border: '1px solid #1e3a5a', color: '#f0f6ff' }}
                value={policy.autoApprove}
                onChange={e => setP('autoApprove', e.target.value)}
              />
              <span className="text-xs" style={{ color: '#4b6a8a' }}>minutes</span>
            </div>
          </div>
          <div>
            <div className="text-xs mb-1.5" style={{ color: '#4b6a8a' }}>Default Approver</div>
            <select
              className="px-2 py-1.5 rounded text-xs outline-none"
              style={{ background: '#122338', border: '1px solid #1e3a5a', color: '#f0f6ff' }}
              value={policy.defaultApprover}
              onChange={e => setP('defaultApprover', e.target.value)}
            >
              <option>Sarah Johnson (Admin)</option>
              <option>Mohammed Al-Rashid (Supervisor)</option>
            </select>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 mt-3">
          <button type="button" disabled title="Overtime policy storage is not configured"
            className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90"
            style={{ background: '#1e3a5a', color: '#94a3b8', cursor: 'not-allowed' }}>
            Save unavailable
          </button>
        </div>
      </div>
    </div>
  );
}
