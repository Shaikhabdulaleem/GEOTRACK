import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Building2,
  Check,
  Clock,
  Copy,
  Edit3,
  History,
  KeyRound,
  Layers3,
  Loader2,
  Lock,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { organizationService } from '../services/organization.service';
import { authService, type ManagerAccountCredentials } from '../services/auth.service';
import { getErrorMessage } from '../lib/errors';
import type { DepartmentRow, ManagerActivityHistoryItem, MembershipStatus, OrganizationManagerItem } from '../types/database';

const inputStyle = {
  width: '100%',
  marginTop: 5,
  padding: '8px 10px',
  borderRadius: 8,
  background: '#122338',
  border: '1px solid #1e3a5a',
  color: '#f0f6ff',
  outline: 'none',
  fontSize: 13,
} as const;

export default function ManagerManagement() {
  const { activeMembership, hasAnyRole } = useAuth();
  const org = activeMembership?.organization_id;
  const isAdministrator = hasAnyRole(['administrator']);

  const [managers, setManagers] = useState<OrganizationManagerItem[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | MembershipStatus>('all');

  // Modals state
  const [createOpen, setCreateOpen] = useState(false);
  const [credentialsModal, setCredentialsModal] = useState<ManagerAccountCredentials | null>(null);
  const [editingDeptManager, setEditingDeptManager] = useState<OrganizationManagerItem | null>(null);
  const [resetModalManager, setResetModalManager] = useState<OrganizationManagerItem | null>(null);
  const [newTempPasswordResult, setNewTempPasswordResult] = useState<{ manager_code: string; temporary_password: string } | null>(null);
  const [historyManager, setHistoryManager] = useState<OrganizationManagerItem | null>(null);
  const [historyLogs, setHistoryLogs] = useState<ManagerActivityHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!org) return;
    setLoading(true);
    setError('');
    try {
      const [mgrList, deptList] = await Promise.all([
        organizationService.listManagers(org),
        organizationService.listDepartments(org),
      ]);
      setManagers(mgrList);
      setDepartments(deptList);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [org]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openHistory = async (manager: OrganizationManagerItem) => {
    if (!org) return;
    setHistoryManager(manager);
    setHistoryLoading(true);
    try {
      const logs = await organizationService.getManagerActivityHistory(org, manager.id);
      setHistoryLogs(logs);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleStatusChange = async (manager: OrganizationManagerItem, newStatus: MembershipStatus) => {
    if (!org) return;
    setActionBusyId(manager.id);
    setError('');
    try {
      await organizationService.updateManagerStatus(org, manager.id, newStatus);
      await loadData();
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setActionBusyId(null);
    }
  };

  const handleResetPassword = async () => {
    if (!resetModalManager) return;
    setActionBusyId(resetModalManager.id);
    setError('');
    try {
      const result = await authService.resetManagerAccount(resetModalManager.id);
      setResetModalManager(null);
      setNewTempPasswordResult(result);
      await loadData();
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setActionBusyId(null);
    }
  };

  const filteredManagers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return managers.filter(m => {
      const matchesSearch =
        !q ||
        m.manager_code.toLowerCase().includes(q) ||
        m.full_name.toLowerCase().includes(q) ||
        (m.email && m.email.toLowerCase().includes(q)) ||
        m.assigned_department_names.some(d => d.toLowerCase().includes(q));

      const matchesStatus = statusFilter === 'all' || m.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [managers, search, statusFilter]);

  const stats = useMemo(() => {
    return {
      total: managers.length,
      active: managers.filter(m => m.status === 'active').length,
      suspended: managers.filter(m => m.status === 'suspended').length,
      removed: managers.filter(m => m.status === 'removed').length,
    };
  }, [managers]);

  if (!isAdministrator) {
    return (
      <div className="p-8 text-center" style={{ color: '#fca5a5' }}>
        Access denied: Manager Management is restricted to administrators.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <UserCheck className="text-blue-500" size={22} /> Manager Management
          </h1>
          <p className="text-xs mt-1" style={{ color: '#4b6a8a' }}>
            Create manager accounts with unique IDs, assign department scopes, and govern permissions.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          style={{ background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', color: '#fff', boxShadow: '0 4px 14px rgba(37,99,235,0.3)' }}
        >
          <Plus size={15} /> Add Manager
        </button>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Managers" count={stats.total} icon={<Users size={16} className="text-blue-400" />} color="#2563eb" />
        <StatCard label="Active" count={stats.active} icon={<ShieldCheck size={16} className="text-emerald-400" />} color="#10b981" />
        <StatCard label="Suspended" count={stats.suspended} icon={<PauseCircle size={16} className="text-amber-400" />} color="#f59e0b" />
        <StatCard label="Deactivated" count={stats.removed} icon={<ShieldAlert size={16} className="text-rose-400" />} color="#ef4444" />
      </div>

      {error && (
        <div className="p-3 rounded-xl text-xs flex items-center gap-2" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.25)' }}>
          <AlertCircle size={15} className="flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filters */}
      <div className="rounded-xl p-3 flex flex-col md:flex-row gap-3 items-center" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
        <div className="relative flex-1 w-full">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#4b6a8a' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by Manager ID, name, email, or department…"
            className="w-full pl-9 pr-3 py-2 rounded-lg text-xs outline-none"
            style={{ background: '#122338', border: '1px solid #1e3a5a', color: '#f0f6ff' }}
          />
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <span className="text-xs" style={{ color: '#4b6a8a' }}>Status:</span>
          {(['all', 'active', 'suspended', 'removed'] as const).map(st => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className="px-3 py-1.5 rounded-lg text-xs capitalize transition-all"
              style={{
                background: statusFilter === st ? '#2563eb' : '#122338',
                color: statusFilter === st ? '#fff' : '#94a3b8',
                border: '1px solid #1e3a5a',
              }}
            >
              {st}
            </button>
          ))}
          <button
            onClick={() => void loadData()}
            className="p-2 rounded-lg ml-auto text-xs"
            style={{ background: '#122338', border: '1px solid #1e3a5a', color: '#94a3b8' }}
            title="Refresh list"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Managers Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
        {loading ? (
          <div className="p-16 text-center">
            <Loader2 className="mx-auto animate-spin" style={{ color: '#3b82f6' }} />
          </div>
        ) : filteredManagers.length === 0 ? (
          <div className="p-12 text-center text-sm" style={{ color: '#4b6a8a' }}>
            {search ? 'No managers match your search criteria.' : 'No manager accounts created yet. Click "Add Manager" above to create one.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead style={{ background: '#091322', color: '#4b6a8a', borderBottom: '1px solid #1e3a5a' }}>
                <tr>
                  <th className="py-3 px-4 font-semibold">Manager ID</th>
                  <th className="py-3 px-4 font-semibold">Name & Contact</th>
                  <th className="py-3 px-4 font-semibold">Assigned Departments</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold">Last Login / Reset</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: '#1e3a5a' }}>
                {filteredManagers.map(m => {
                  const isBusy = actionBusyId === m.id;
                  return (
                    <tr key={m.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4">
                        <span className="font-mono font-semibold px-2 py-1 rounded text-xs" style={{ background: '#122338', color: '#60a5fa', border: '1px solid #1e3a5a' }}>
                          {m.manager_code}
                        </span>
                        {m.must_change_password && (
                          <div className="text-[10px] mt-1 font-medium" style={{ color: '#f59e0b' }}>
                            Must change password
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white">{m.full_name}</div>
                        <div className="text-[11px] mt-0.5" style={{ color: '#4b6a8a' }}>
                          {m.email || 'No email registered'}
                          {m.phone ? ` · ${m.phone}` : ''}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {m.assigned_department_names.length === 0 ? (
                            <span className="text-[11px] italic" style={{ color: '#ef4444' }}>No departments assigned</span>
                          ) : (
                            m.assigned_department_names.map((name, idx) => {
                              const deptId = m.assigned_department_ids[idx];
                              const isPrimary = m.primary_department_id === deptId;
                              return (
                                <span
                                  key={name}
                                  className="px-2 py-0.5 rounded text-[10px] font-medium flex items-center gap-1"
                                  style={{
                                    background: isPrimary ? 'rgba(37,99,235,0.2)' : '#122338',
                                    color: isPrimary ? '#93c5fd' : '#cbd5e1',
                                    border: isPrimary ? '1px solid #2563eb' : '1px solid #1e3a5a',
                                  }}
                                >
                                  {name}
                                  {isPrimary && <span className="text-[9px] text-blue-400 font-bold">(Primary)</span>}
                                </span>
                              );
                            })
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={m.status} />
                      </td>
                      <td className="py-3 px-4" style={{ color: '#4b6a8a' }}>
                        {m.login_last_reset_at ? new Date(m.login_last_reset_at).toLocaleString() : 'Never'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setEditingDeptManager(m)}
                            disabled={isBusy}
                            className="p-1.5 rounded-lg text-xs flex items-center gap-1"
                            style={{ background: '#122338', color: '#93c5fd', border: '1px solid #1e3a5a' }}
                            title="Edit department assignments"
                          >
                            <Layers3 size={13} />
                          </button>
                          <button
                            onClick={() => setResetModalManager(m)}
                            disabled={isBusy}
                            className="p-1.5 rounded-lg text-xs flex items-center gap-1"
                            style={{ background: '#122338', color: '#fcd34d', border: '1px solid #1e3a5a' }}
                            title="Reset password"
                          >
                            <KeyRound size={13} />
                          </button>
                          <button
                            onClick={() => void openHistory(m)}
                            disabled={isBusy}
                            className="p-1.5 rounded-lg text-xs"
                            style={{ background: '#122338', color: '#cbd5e1', border: '1px solid #1e3a5a' }}
                            title="View activity history"
                          >
                            <History size={13} />
                          </button>
                          {m.status === 'active' ? (
                            <button
                              onClick={() => void handleStatusChange(m, 'suspended')}
                              disabled={isBusy}
                              className="p-1.5 rounded-lg text-xs"
                              style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}
                              title="Suspend manager"
                            >
                              <PauseCircle size={13} />
                            </button>
                          ) : (
                            <button
                              onClick={() => void handleStatusChange(m, 'active')}
                              disabled={isBusy}
                              className="p-1.5 rounded-lg text-xs"
                              style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}
                              title="Activate manager"
                            >
                              <PlayCircle size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 1. Create Manager Modal */}
      {createOpen && org && (
        <CreateManagerModal
          organizationId={org}
          departments={departments}
          close={() => setCreateOpen(false)}
          onSuccess={creds => {
            setCreateOpen(false);
            setCredentialsModal(creds);
            void loadData();
          }}
        />
      )}

      {/* 2. Credentials Display Modal (Temporary Password Hand-off) */}
      {credentialsModal && (
        <CredentialsDisplayModal
          credentials={credentialsModal}
          close={() => setCredentialsModal(null)}
        />
      )}

      {/* 3. Edit Department Assignments Modal */}
      {editingDeptManager && org && (
        <EditDepartmentsModal
          organizationId={org}
          manager={editingDeptManager}
          departments={departments}
          close={() => setEditingDeptManager(null)}
          onSaved={() => {
            setEditingDeptManager(null);
            void loadData();
          }}
        />
      )}

      {/* 4. Reset Password Confirmation Modal */}
      {resetModalManager && (
        <Dialog title="Reset Manager Password" close={() => setResetModalManager(null)}>
          <div className="space-y-4">
            <p className="text-xs" style={{ color: '#cbd5e1' }}>
              Are you sure you want to generate a new temporary password for{' '}
              <strong className="text-white">{resetModalManager.full_name}</strong> (ID: {resetModalManager.manager_code})?
            </p>
            <p className="text-xs" style={{ color: '#f59e0b' }}>
              The manager will be required to change this temporary password upon their next login.
            </p>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setResetModalManager(null)}
                className="px-4 py-2 rounded-lg text-xs"
                style={{ background: '#122338', color: '#94a3b8' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleResetPassword()}
                className="px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                style={{ background: '#2563eb', color: '#fff' }}
              >
                {actionBusyId === resetModalManager.id ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
                Generate New Password
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {/* 5. Password Reset Result Modal */}
      {newTempPasswordResult && (
        <Dialog title="Temporary Password Generated" close={() => setNewTempPasswordResult(null)}>
          <div className="space-y-4">
            <p className="text-xs" style={{ color: '#94a3b8' }}>
              A new temporary password has been set for Manager ID{' '}
              <strong className="text-white">{newTempPasswordResult.manager_code}</strong>.
              Deliver this password securely to the manager in person.
            </p>
            <CopyBox label="One-Time Temporary Password" text={newTempPasswordResult.temporary_password} />
            <div className="p-3 rounded-lg text-xs" style={{ background: 'rgba(37,99,235,0.1)', color: '#93c5fd', border: '1px solid rgba(37,99,235,0.25)' }}>
              The manager will be blocked from accessing any department view until they create their own permanent password.
            </div>
            <button
              onClick={() => setNewTempPasswordResult(null)}
              className="w-full py-2 rounded-lg text-xs font-semibold"
              style={{ background: '#2563eb', color: '#fff' }}
            >
              Done
            </button>
          </div>
        </Dialog>
      )}

      {/* 6. Activity History Modal */}
      {historyManager && (
        <Dialog title={`Activity History: ${historyManager.full_name} (${historyManager.manager_code})`} close={() => setHistoryManager(null)}>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {historyLoading ? (
              <div className="p-8 text-center"><Loader2 className="animate-spin mx-auto text-blue-500" /></div>
            ) : historyLogs.length === 0 ? (
              <div className="text-center p-6 text-xs" style={{ color: '#4b6a8a' }}>No recorded activity history yet.</div>
            ) : (
              historyLogs.map(log => (
                <div key={log.id} className="p-3 rounded-lg text-xs" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-white capitalize">{log.action.replace('_', ' ')}</span>
                    <span className="text-[10px]" style={{ color: '#4b6a8a' }}>{new Date(log.created_at).toLocaleString()}</span>
                  </div>
                  <div className="text-[11px]" style={{ color: '#94a3b8' }}>
                    By: {log.actor_name}
                  </div>
                  {log.details && Object.keys(log.details).length > 0 && (
                    <pre className="text-[10px] mt-1.5 p-2 rounded bg-slate-900/60 overflow-x-auto text-slate-300">
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Create Manager Modal
// ----------------------------------------------------------------------------
function CreateManagerModal({
  organizationId,
  departments,
  close,
  onSuccess,
}: {
  organizationId: string;
  departments: DepartmentRow[];
  close: () => void;
  onSuccess: (creds: ManagerAccountCredentials) => void;
}) {
  const [managerCode, setManagerCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [primaryDept, setPrimaryDept] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Auto suggest ID
  const suggestId = () => {
    const num = Math.floor(100 + Math.random() * 900);
    setManagerCode(`MGR-${num}`);
  };

  const toggleDept = (deptId: string) => {
    setSelectedDepts(prev => {
      const next = prev.includes(deptId) ? prev.filter(id => id !== deptId) : [...prev, deptId];
      if (primaryDept === deptId && !next.includes(deptId)) {
        setPrimaryDept(next[0] || '');
      } else if (!primaryDept && next.length > 0) {
        setPrimaryDept(next[0]);
      }
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const code = managerCode.trim().toUpperCase();
    const name = fullName.trim();
    if (!code || !name) {
      setError('Manager ID and Full Name are required.');
      return;
    }
    if (selectedDepts.length === 0) {
      setError('Assign at least one department to the manager.');
      return;
    }

    setSubmitting(true);
    try {
      const creds = await authService.provisionManagerAccount({
        organization_id: organizationId,
        manager_code: code,
        full_name: name,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        department_ids: selectedDepts,
        primary_department_id: primaryDept || selectedDepts[0],
      });
      onSuccess(creds);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog title="Create Manager Account" close={close}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs" style={{ color: '#94a3b8' }}>Manager ID (Unique)</label>
              <button type="button" onClick={suggestId} className="text-[10px] text-blue-400 hover:underline">
                Suggest ID
              </button>
            </div>
            <input
              style={inputStyle}
              value={managerCode}
              onChange={e => setManagerCode(e.target.value.toUpperCase())}
              placeholder="e.g. MGR-101"
              required
            />
          </div>
          <div>
            <label className="text-xs" style={{ color: '#94a3b8' }}>Full Name</label>
            <input
              style={inputStyle}
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="e.g. Tariq Al-Sayed"
              required
            />
          </div>
          <div>
            <label className="text-xs" style={{ color: '#94a3b8' }}>Work Email (Optional)</label>
            <input
              style={inputStyle}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="manager@company.com"
            />
          </div>
          <div>
            <label className="text-xs" style={{ color: '#94a3b8' }}>Mobile Phone (Optional)</label>
            <input
              style={inputStyle}
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+966 5..."
            />
          </div>
        </div>

        <div>
          <label className="text-xs block mb-1 font-semibold text-white">Assign Departments (Scope)</label>
          <p className="text-[11px] mb-2" style={{ color: '#4b6a8a' }}>
            The manager will strictly see data and staff belonging to selected departments.
          </p>
          <div className="max-h-40 overflow-y-auto rounded-lg p-2 space-y-1" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
            {departments.length === 0 ? (
              <div className="text-xs p-2 text-slate-400">No departments configured yet.</div>
            ) : (
              departments.map(d => {
                const checked = selectedDepts.includes(d.id);
                const isPrimary = primaryDept === d.id;
                return (
                  <div key={d.id} className="flex items-center justify-between p-1.5 rounded hover:bg-slate-800/40 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer flex-1">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDept(d.id)}
                        className="rounded"
                      />
                      <span className="text-white">{d.name}</span>
                      <span className="text-[10px]" style={{ color: '#4b6a8a' }}>({d.code})</span>
                    </label>
                    {checked && (
                      <button
                        type="button"
                        onClick={() => setPrimaryDept(d.id)}
                        className="text-[10px] px-2 py-0.5 rounded font-semibold"
                        style={{
                          background: isPrimary ? '#2563eb' : 'transparent',
                          color: isPrimary ? '#fff' : '#4b6a8a',
                          border: '1px solid #1e3a5a',
                        }}
                      >
                        {isPrimary ? 'Primary' : 'Make Primary'}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {error && <div className="text-xs p-2 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}>{error}</div>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2"
          style={{ background: '#2563eb', color: '#fff', opacity: submitting ? 0.7 : 1 }}
        >
          {submitting && <Loader2 size={14} className="animate-spin" />} Create Manager Account
        </button>
      </form>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------
// Edit Departments Modal
// ----------------------------------------------------------------------------
function EditDepartmentsModal({
  organizationId,
  manager,
  departments,
  close,
  onSaved,
}: {
  organizationId: string;
  manager: OrganizationManagerItem;
  departments: DepartmentRow[];
  close: () => void;
  onSaved: () => void;
}) {
  const [selectedDepts, setSelectedDepts] = useState<string[]>(manager.assigned_department_ids);
  const [primaryDept, setPrimaryDept] = useState<string>(manager.primary_department_id || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleDept = (deptId: string) => {
    setSelectedDepts(prev => {
      const next = prev.includes(deptId) ? prev.filter(id => id !== deptId) : [...prev, deptId];
      if (primaryDept === deptId && !next.includes(deptId)) {
        setPrimaryDept(next[0] || '');
      } else if (!primaryDept && next.length > 0) {
        setPrimaryDept(next[0]);
      }
      return next;
    });
  };

  const save = async () => {
    if (!manager.user_id) return;
    setSaving(true);
    setError('');
    try {
      await organizationService.assignManagerDepartments(
        organizationId,
        manager.user_id,
        selectedDepts,
        primaryDept || null,
      );
      onSaved();
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog title={`Edit Scopes: ${manager.full_name} (${manager.manager_code})`} close={close}>
      <div className="space-y-4">
        <p className="text-xs" style={{ color: '#94a3b8' }}>
          Select which departments this manager is permitted to monitor, schedule, and approve.
        </p>

        <div className="max-h-52 overflow-y-auto rounded-lg p-2 space-y-1" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
          {departments.map(d => {
            const checked = selectedDepts.includes(d.id);
            const isPrimary = primaryDept === d.id;
            return (
              <div key={d.id} className="flex items-center justify-between p-1.5 rounded hover:bg-slate-800/40 text-xs">
                <label className="flex items-center gap-2 cursor-pointer flex-1">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleDept(d.id)}
                    className="rounded"
                  />
                  <span className="text-white">{d.name}</span>
                  <span className="text-[10px]" style={{ color: '#4b6a8a' }}>({d.code})</span>
                </label>
                {checked && (
                  <button
                    type="button"
                    onClick={() => setPrimaryDept(d.id)}
                    className="text-[10px] px-2 py-0.5 rounded font-semibold"
                    style={{
                      background: isPrimary ? '#2563eb' : 'transparent',
                      color: isPrimary ? '#fff' : '#4b6a8a',
                      border: '1px solid #1e3a5a',
                    }}
                  >
                    {isPrimary ? 'Primary' : 'Make Primary'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {error && <div className="text-xs p-2 rounded text-red-300 bg-red-950/40">{error}</div>}

        <div className="flex gap-2 justify-end pt-2">
          <button onClick={close} className="px-4 py-2 rounded-lg text-xs" style={{ background: '#122338', color: '#94a3b8' }}>
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5"
            style={{ background: '#2563eb', color: '#fff' }}
          >
            {saving && <Loader2 size={13} className="animate-spin" />} Save Department Scopes
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------
// Credentials Display Modal (Temporary Password Hand-off)
// ----------------------------------------------------------------------------
function CredentialsDisplayModal({
  credentials,
  close,
}: {
  credentials: ManagerAccountCredentials;
  close: () => void;
}) {
  return (
    <Dialog title="Manager Account Credentials" close={close}>
      <div className="space-y-4">
        <div className="p-3 rounded-xl flex items-start gap-2.5" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: '#6ee7b7' }}>
          <ShieldCheck size={18} className="flex-shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed">
            Manager account created successfully. Deliver the credentials below directly to the manager.
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-lg" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
            <span style={{ color: '#4b6a8a' }}>Manager ID:</span>
            <div className="font-mono text-sm font-bold text-blue-400 mt-1">{credentials.manager_code}</div>
          </div>
          <div className="p-3 rounded-lg" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
            <span style={{ color: '#4b6a8a' }}>Account Email:</span>
            <div className="text-sm font-semibold text-white mt-1 truncate">{credentials.email}</div>
          </div>
        </div>

        <CopyBox label="One-Time Temporary Password" text={credentials.temporary_password} />

        <div className="p-3 rounded-xl text-xs space-y-1" style={{ background: 'rgba(245,158,11,0.1)', color: '#fcd34d', border: '1px solid rgba(245,158,11,0.25)' }}>
          <div className="font-semibold flex items-center gap-1.5"><Lock size={13} /> First Login Password Change</div>
          <div className="text-[11px] leading-relaxed text-slate-300">
            The manager can sign in using their <strong>Manager ID ({credentials.manager_code})</strong> and this temporary password. They will be required to choose a new password on first login.
          </div>
        </div>

        <button
          onClick={close}
          className="w-full py-2.5 rounded-xl font-bold text-xs"
          style={{ background: '#2563eb', color: '#fff' }}
        >
          Done
        </button>
      </div>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------
// Small reusable components
// ----------------------------------------------------------------------------
function CopyBox({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div className="text-[11px] mb-1 font-semibold" style={{ color: '#94a3b8' }}>{label}</div>
      <div className="flex items-center justify-between p-3 rounded-lg font-mono text-sm font-bold text-white" style={{ background: '#091322', border: '1px solid #2563eb' }}>
        <span>{text}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="px-2.5 py-1 rounded text-xs flex items-center gap-1 transition-colors"
          style={{ background: copied ? '#10b981' : '#2563eb', color: '#fff' }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: MembershipStatus }) {
  const colors: Record<MembershipStatus, { bg: string; text: string; border: string }> = {
    active: { bg: 'rgba(16,185,129,0.15)', text: '#6ee7b7', border: 'rgba(16,185,129,0.3)' },
    suspended: { bg: 'rgba(245,158,11,0.15)', text: '#fcd34d', border: 'rgba(245,158,11,0.3)' },
    removed: { bg: 'rgba(239,68,68,0.15)', text: '#fca5a5', border: 'rgba(239,68,68,0.3)' },
    invited: { bg: 'rgba(148,163,184,0.15)', text: '#94a3b8', border: 'rgba(148,163,184,0.3)' },
  };
  const c = colors[status] || colors.active;
  return (
    <span className="px-2 py-0.5 rounded text-[10px] font-semibold capitalize" style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
      {status}
    </span>
  );
}

function StatCard({ label, count, icon, color }: { label: string; count: number; icon: ReactNode; color: string }) {
  return (
    <div className="rounded-xl p-3 flex items-center justify-between" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
      <div>
        <div className="text-[11px]" style={{ color: '#4b6a8a' }}>{label}</div>
        <div className="text-xl font-bold text-white mt-0.5">{count}</div>
      </div>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}1a`, border: `1px solid ${color}33` }}>
        {icon}
      </div>
    </div>
  );
}

function Dialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(6,13,26,0.86)' }}>
      <div className="w-full max-w-lg rounded-2xl p-5 space-y-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <button onClick={close} style={{ color: '#4b6a8a' }}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
