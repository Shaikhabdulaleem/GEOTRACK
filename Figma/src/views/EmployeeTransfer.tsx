import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  ArrowRight,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Filter,
  Layers,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  StopCircle,
  Timer,
  User,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { transferService, calculateTransferDuration, type TransferDurationCalculation } from '../services/transfer.service';
import { employeeService } from '../services/employee.service';
import { organizationService } from '../services/organization.service';
import { getErrorMessage } from '../lib/errors';
import { logger } from '../lib/logger';
import { todayInTimezone } from '../lib/dates';
import type {
  DepartmentRow,
  EmployeeProfileRow,
  EmployeeTransferItem,
  TransferStatus,
  TransferType,
} from '../types/database';

const panelStyle = {
  background: '#0d1b2e',
  border: '1px solid #1e3a5a',
} as const;

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  background: '#122338',
  border: '1px solid #1e3a5a',
  color: '#f0f6ff',
  outline: 'none',
  fontSize: 13,
} as const;

export default function EmployeeTransfer() {
  const { activeMembership, roles, assignedDepartmentIds, profile, user } = useAuth();
  const org = activeMembership?.organization_id;
  const isAdministrator = roles.includes('administrator');
  const isManager = roles.includes('manager') && !isAdministrator;

  const today = useMemo(() => todayInTimezone('Asia/Riyadh'), []);

  // Data state
  const [transfers, setTransfers] = useState<EmployeeTransferItem[]>([]);
  const [employees, setEmployees] = useState<EmployeeProfileRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Filters
  const [datePreset, setDatePreset] = useState<'today' | 'week' | 'month' | 'all'>('today');
  const [statusFilter, setStatusFilter] = useState<TransferStatus | 'all'>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [completeModalItem, setCompleteModalItem] = useState<EmployeeTransferItem | null>(null);
  const [cancelModalItem, setCancelModalItem] = useState<EmployeeTransferItem | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Live timer tick for active transfers (updates every second)
  const [, setTimerTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setTimerTick(t => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Compute date range from preset
  const dateRange = useMemo(() => {
    if (datePreset === 'all') return { from: undefined, to: undefined };
    const now = new Date();
    const to = today;
    if (datePreset === 'today') return { from: today, to: today };
    if (datePreset === 'week') {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return { from: d.toISOString().slice(0, 10), to };
    }
    // month
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return { from: d.toISOString().slice(0, 10), to };
  }, [datePreset, today]);

  const loadData = useCallback(async () => {
    if (!org) return;
    setLoading(true);
    setError('');
    try {
      const [transferResult, empResult, deptResult] = await Promise.allSettled([
        transferService.listTransfers({
          organizationId: org,
          fromDate: dateRange.from,
          toDate: dateRange.to,
        }),
        employeeService.listAll({ organizationId: org, status: 'active' }),
        organizationService.listDepartments(org),
      ]);

      if (transferResult.status === 'fulfilled') {
        setTransfers(transferResult.value);
      } else {
        logger.error('Failed to load transfers', transferResult.reason);
        setError(getErrorMessage(transferResult.reason));
      }

      if (empResult.status === 'fulfilled') {
        setEmployees(empResult.value);
      } else {
        logger.error('Failed to load employees', empResult.reason);
        if (transferResult.status === 'fulfilled') {
          setError(getErrorMessage(empResult.reason));
        }
      }

      if (deptResult.status === 'fulfilled') {
        setDepartments(deptResult.value);
      } else {
        logger.error('Failed to load departments', deptResult.reason);
        if (transferResult.status === 'fulfilled' && empResult.status === 'fulfilled') {
          setError(getErrorMessage(deptResult.reason));
        }
      }
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [org, dateRange.from, dateRange.to]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Department name map
  const deptMap = useMemo(() => {
    return new Map(departments.map(d => [d.id, d]));
  }, [departments]);

  // Computed manager department IDs (merging manager_scopes and departments.manager_user_id)
  const managerDeptIds = useMemo(() => {
    const ids = new Set<string>(assignedDepartmentIds);
    if (user?.id) {
      departments.forEach(d => {
        if (d.manager_user_id === user.id) ids.add(d.id);
      });
    }
    return Array.from(ids);
  }, [assignedDepartmentIds, departments, user?.id]);

  // Eligible employees for manager: if manager, restricted to their assigned departments
  const availableEmployees = useMemo(() => {
    if (isAdministrator) return employees;
    if (isManager && managerDeptIds.length > 0) {
      return employees.filter(e => e.department_id && managerDeptIds.includes(e.department_id));
    }
    return employees;
  }, [employees, isAdministrator, isManager, managerDeptIds]);

  // Filtered transfers
  const filteredTransfers = useMemo(() => {
    return transfers.filter(t => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (deptFilter !== 'all') {
        if (t.from_department_id !== deptFilter && t.to_department_id !== deptFilter) return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const empName = t.employee?.full_name?.toLowerCase() ?? '';
        const empCode = t.employee?.employee_code?.toLowerCase() ?? '';
        const fromName = t.from_department?.name?.toLowerCase() ?? '';
        const toName = t.to_department?.name?.toLowerCase() ?? '';
        const reason = t.reason?.toLowerCase() ?? '';
        if (!empName.includes(q) && !empCode.includes(q) && !fromName.includes(q) && !toName.includes(q) && !reason.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [transfers, statusFilter, deptFilter, search]);

  // Metrics
  const metrics = useMemo(() => {
    const active = transfers.filter(t => t.status === 'active');
    const todayTransfers = transfers.filter(t => t.transfer_date === today && t.status !== 'cancelled');

    let totalHoursToday = 0;
    let totalOtHoursToday = 0;

    todayTransfers.forEach(t => {
      const duration = t.status === 'completed'
        ? t.transferred_minutes
        : calculateTransferDuration(t.start_time, null, t.break_minutes).netMinutes;
      const ot = t.overtime_minutes || 0;
      totalHoursToday += duration / 60;
      totalOtHoursToday += ot / 60;
    });

    return {
      activeCount: active.length,
      todayCount: todayTransfers.length,
      totalHoursToday: Math.round(totalHoursToday * 10) / 10,
      totalOtHoursToday: Math.round(totalOtHoursToday * 10) / 10,
      totalFiltered: filteredTransfers.length,
    };
  }, [transfers, today, filteredTransfers.length]);

  // Active transfers list
  const activeTransfers = useMemo(() => {
    return transfers.filter(t => t.status === 'active');
  }, [transfers]);

  // Handle Complete Transfer
  const handleCompleteSubmit = async (params: {
    endTime: string;
    breakMinutes: number;
    overtimeMinutes: number;
    notes?: string;
  }) => {
    if (!org || !completeModalItem) return;
    setActionBusy(true);
    setError('');
    try {
      await transferService.completeTransfer({
        organizationId: org,
        transferId: completeModalItem.id,
        endTime: params.endTime,
        breakMinutes: params.breakMinutes,
        overtimeMinutes: params.overtimeMinutes,
        notes: params.notes,
      });
      setSuccessMessage(`Transfer completed for ${completeModalItem.employee?.full_name ?? 'employee'}.`);
      setCompleteModalItem(null);
      await loadData();
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setActionBusy(false);
    }
  };

  // Handle Cancel Transfer
  const handleCancelSubmit = async (reason: string) => {
    if (!org || !cancelModalItem) return;
    setActionBusy(true);
    setError('');
    try {
      await transferService.cancelTransfer({
        organizationId: org,
        transferId: cancelModalItem.id,
        reason,
      });
      setSuccessMessage(`Transfer cancelled for ${cancelModalItem.employee?.full_name ?? 'employee'}.`);
      setCancelModalItem(null);
      await loadData();
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <ArrowLeftRight size={22} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">Employee Transfer</h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Assign and transfer employees across departments, track live working hours, and manage cross-department productivity
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white transition-colors"
            style={{ background: '#122338', border: '1px solid #1e3a5a' }}
            title="Refresh transfer records"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => setCreateModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors shadow-lg shadow-blue-500/20"
          >
            <Plus size={15} />
            <span>New Transfer</span>
          </button>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-red-950/40 border border-red-500/30 text-red-200 text-xs">
          <div className="flex items-center gap-2.5">
            <AlertCircle size={16} className="text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError('')} className="text-red-400 hover:text-red-300">
            <X size={14} />
          </button>
        </div>
      )}

      {successMessage && (
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 text-xs">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button type="button" onClick={() => setSuccessMessage('')} className="text-emerald-400 hover:text-emerald-300">
            <X size={14} />
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="rounded-xl p-4" style={panelStyle}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Active Transfers Now</span>
            {metrics.activeCount > 0 ? (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </span>
            ) : (
              <span className="text-[10px] text-slate-500">None</span>
            )}
          </div>
          <div className="text-2xl font-bold font-mono text-white mt-2">{metrics.activeCount}</div>
          <p className="text-[11px] text-slate-400 mt-1">Working in other departments</p>
        </div>

        <div className="rounded-xl p-4" style={panelStyle}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Transferred Hours Today</span>
            <Clock size={16} className="text-blue-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-blue-400 mt-2">{metrics.totalHoursToday}h</div>
          <p className="text-[11px] text-slate-400 mt-1">{metrics.todayCount} transfers logged today</p>
        </div>

        <div className="rounded-xl p-4" style={panelStyle}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Transferred OT Today</span>
            <Timer size={16} className="text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-400 mt-2">{metrics.totalOtHoursToday}h</div>
          <p className="text-[11px] text-slate-400 mt-1">Cross-department overtime</p>
        </div>

        <div className="rounded-xl p-4" style={panelStyle}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Total Filtered</span>
            <Layers size={16} className="text-purple-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white mt-2">{metrics.totalFiltered}</div>
          <p className="text-[11px] text-slate-400 mt-1">In selected period</p>
        </div>
      </div>

      {/* Operational Productivity Info Banner */}
      <div className="rounded-xl p-3.5 flex items-start gap-3 bg-blue-950/30 border border-blue-500/20 text-xs text-blue-200">
        <Zap size={16} className="text-blue-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-white">How Productivity Counts Transfers:</span> When an employee (e.g. Al Amin)
          is transferred from <span className="font-semibold text-blue-300">FC</span> to <span className="font-semibold text-emerald-300">Mailroom</span>,
          the hours worked in Mailroom (e.g. 1:00 PM – 5:00 PM = 4.0 hrs) are credited directly to Mailroom’s regular capacity and workload coverage,
          and any overtime is attributed to the destination department.
        </div>
      </div>

      {/* Active Live Transfers Section */}
      {activeTransfers.length > 0 && (
        <div className="rounded-xl p-4 space-y-3.5" style={{ background: '#0a1628', border: '1px solid #1e40af' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </span>
              <h2 className="text-sm font-semibold text-white">Active Live Transfers ({activeTransfers.length})</h2>
            </div>
            <span className="text-[11px] text-emerald-400 font-mono">Count running in real time</span>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeTransfers.map(item => {
              const duration = calculateTransferDuration(item.start_time, null, item.break_minutes);
              const startTimeFormatted = new Date(item.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

              return (
                <div
                  key={item.id}
                  className="rounded-lg p-3.5 space-y-3 bg-[#0d1f36] border border-blue-500/30 hover:border-blue-400/50 transition-colors shadow-md"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-sm text-white">{item.employee?.full_name ?? 'Employee'}</div>
                      <div className="text-[11px] font-mono text-slate-400">{item.employee?.employee_code ?? 'EMP'}</div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      Active
                    </span>
                  </div>

                  {/* Route */}
                  <div className="flex items-center gap-2 text-xs py-1 px-2.5 rounded bg-[#122338] border border-slate-700/50">
                    <span className="font-semibold text-blue-300">{item.from_department?.name ?? 'Source'}</span>
                    <ArrowRight size={13} className="text-slate-400" />
                    <span className="font-semibold text-emerald-300">{item.to_department?.name ?? 'Target'}</span>
                  </div>

                  {/* Live Counter */}
                  <div className="p-2.5 rounded-lg bg-[#081220] border border-emerald-500/20 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-400 block">Started at {startTimeFormatted}</span>
                      <span className="text-xs text-slate-300">Elapsed Working Time</span>
                    </div>
                    <div className="text-right">
                      <span className="text-base font-bold font-mono text-emerald-400">{duration.display}</span>
                      {item.break_minutes > 0 && (
                        <span className="block text-[10px] text-slate-500">(-{item.break_minutes}m break)</span>
                      )}
                    </div>
                  </div>

                  {item.reason && (
                    <p className="text-[11px] text-slate-400 italic line-clamp-1">"{item.reason}"</p>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setCompleteModalItem(item)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                    >
                      <StopCircle size={14} />
                      <span>Complete Transfer</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCancelModalItem(item)}
                      className="px-2 py-1.5 rounded-md text-xs font-medium text-slate-400 hover:text-red-400 bg-[#122338] border border-slate-700 hover:border-red-500/40 transition-colors"
                      title="Cancel transfer"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="rounded-xl p-3.5 space-y-3" style={panelStyle}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Preset Buttons */}
          <div className="flex items-center gap-1.5">
            {(['today', 'week', 'month', 'all'] as const).map(preset => (
              <button
                key={preset}
                type="button"
                onClick={() => setDatePreset(preset)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  datePreset === preset
                    ? 'bg-blue-600 text-white font-semibold'
                    : 'bg-[#122338] text-slate-400 hover:text-white border border-[#1e3a5a]'
                }`}
              >
                {preset === 'today' ? 'Today' : preset === 'week' ? 'Past 7 Days' : preset === 'month' ? 'This Month' : 'All Time'}
              </button>
            ))}
          </div>

          {/* Department Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Department:</span>
            <select
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-[#122338] text-slate-200 border border-[#1e3a5a] outline-none"
            >
              <option value="all">All Departments</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Status:</span>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as TransferStatus | 'all')}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-[#122338] text-slate-200 border border-[#1e3a5a] outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Only</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Search Box */}
          <div className="relative min-w-[200px] flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search employee or department..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs bg-[#122338] text-white border border-[#1e3a5a] placeholder-slate-500 outline-none"
            />
          </div>
        </div>
      </div>

      {/* Transfers History Table */}
      <div className="rounded-xl overflow-hidden" style={panelStyle}>
        <div className="px-4 py-3 border-b border-[#1e3a5a] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-blue-400" />
            <span className="font-semibold text-sm text-white">Transfer History & Records</span>
          </div>
          <span className="text-xs text-slate-400 font-mono">{filteredTransfers.length} records</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: '#122338', color: '#64748b' }}>
                <th className="text-left px-3.5 py-2.5">Employee</th>
                <th className="text-left px-3.5 py-2.5">Date</th>
                <th className="text-left px-3.5 py-2.5">Transfer Route</th>
                <th className="text-left px-3.5 py-2.5">Time Window</th>
                <th className="text-right px-3.5 py-2.5">Break</th>
                <th className="text-right px-3.5 py-2.5">Regular Hrs</th>
                <th className="text-right px-3.5 py-2.5">OT Hrs</th>
                <th className="text-right px-3.5 py-2.5">Total Hrs</th>
                <th className="text-center px-3.5 py-2.5">Status</th>
                <th className="text-left px-3.5 py-2.5">Reason / Notes</th>
                <th className="text-center px-3.5 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransfers.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-10 text-slate-500">
                    {loading ? (
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 size={16} className="animate-spin text-blue-400" />
                        <span>Loading transfers...</span>
                      </div>
                    ) : (
                      'No employee transfer records match the selected filters.'
                    )}
                  </td>
                </tr>
              ) : (
                filteredTransfers.map(item => {
                  const duration = item.status === 'completed'
                    ? item.transferred_minutes
                    : calculateTransferDuration(item.start_time, null, item.break_minutes).netMinutes;

                  const regMin = Math.max(0, duration - (item.overtime_minutes || 0));
                  const regHours = Math.round((regMin / 60) * 10) / 10;
                  const otHours = Math.round(((item.overtime_minutes || 0) / 60) * 10) / 10;
                  const totalHours = Math.round((duration / 60) * 10) / 10;

                  const startFmt = new Date(item.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const endFmt = item.end_time
                    ? new Date(item.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : 'Ongoing';

                  return (
                    <tr key={item.id} className="border-t border-[#1e3a5a] hover:bg-[#122338]/50 transition-colors">
                      <td className="px-3.5 py-2.5">
                        <div className="font-semibold text-white">{item.employee?.full_name ?? 'Employee'}</div>
                        <div className="text-[11px] font-mono text-slate-400">{item.employee?.employee_code ?? 'EMP'}</div>
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-slate-300">{item.transfer_date}</td>
                      <td className="px-3.5 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-blue-400">{item.from_department?.name ?? 'Source'}</span>
                          <ArrowRight size={12} className="text-slate-500" />
                          <span className="font-semibold text-emerald-400">{item.to_department?.name ?? 'Target'}</span>
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-slate-300">
                        {startFmt} – {endFmt}
                      </td>
                      <td className="px-3.5 py-2.5 text-right font-mono text-slate-400">
                        {item.break_minutes > 0 ? `${item.break_minutes}m` : '—'}
                      </td>
                      <td className="px-3.5 py-2.5 text-right font-mono font-semibold text-white">
                        {regHours}h
                      </td>
                      <td className="px-3.5 py-2.5 text-right font-mono">
                        {otHours > 0 ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            +{otHours}h OT
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-right font-mono font-bold text-emerald-400">
                        {totalHours}h
                      </td>
                      <td className="px-3.5 py-2.5 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                            item.status === 'active'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : item.status === 'completed'
                              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                              : 'bg-slate-700/50 text-slate-400'
                          }`}
                        >
                          {item.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 text-slate-400 max-w-xs truncate" title={item.reason ?? ''}>
                        {item.reason || <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-3.5 py-2.5 text-center">
                        {item.status === 'active' ? (
                          <button
                            type="button"
                            onClick={() => setCompleteModalItem(item)}
                            className="px-2 py-1 rounded text-[11px] font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                          >
                            End Transfer
                          </button>
                        ) : (
                          <span className="text-slate-600 text-[11px]">Logged</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Initiate New Transfer */}
      {createModalOpen && (
        <CreateTransferModal
          organizationId={org ?? ''}
          departments={departments}
          employees={availableEmployees}
          today={today}
          onClose={() => setCreateModalOpen(false)}
          onSuccess={async msg => {
            setCreateModalOpen(false);
            setSuccessMessage(msg);
            await loadData();
          }}
        />
      )}

      {/* Modal: Complete Transfer */}
      {completeModalItem && (
        <CompleteTransferModal
          item={completeModalItem}
          busy={actionBusy}
          onClose={() => setCompleteModalItem(null)}
          onConfirm={handleCompleteSubmit}
        />
      )}

      {/* Modal: Cancel Transfer */}
      {cancelModalItem && (
        <CancelTransferModal
          item={cancelModalItem}
          busy={actionBusy}
          onClose={() => setCancelModalItem(null)}
          onConfirm={handleCancelSubmit}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Create Transfer Modal
// ----------------------------------------------------------------------------
function CreateTransferModal({
  organizationId,
  departments,
  employees,
  today,
  onClose,
  onSuccess,
}: {
  organizationId: string;
  departments: DepartmentRow[];
  employees: EmployeeProfileRow[];
  today: string;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [selectedEmpId, setSelectedEmpId] = useState(employees[0]?.id ?? '');
  const [targetDeptId, setTargetDeptId] = useState('');
  const [transferDate, setTransferDate] = useState(today);
  const [mode, setMode] = useState<'live' | 'window'>('live');

  // Time window fields
  const [startTime, setStartTime] = useState('13:00');
  const [endTime, setEndTime] = useState('17:00');
  const [breakMinutes, setBreakMinutes] = useState(0);

  // Overtime fields
  const [isOt, setIsOt] = useState(false);
  const [otMinutes, setOtMinutes] = useState(0);

  const [transferType, setTransferType] = useState<TransferType>('temporary');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Selected employee
  const selectedEmp = useMemo(() => {
    return employees.find(e => e.id === selectedEmpId);
  }, [employees, selectedEmpId]);

  // Source department name
  const sourceDept = useMemo(() => {
    return departments.find(d => d.id === selectedEmp?.department_id);
  }, [departments, selectedEmp]);

  // Target departments: all except current department
  const availableTargetDepts = useMemo(() => {
    return departments.filter(d => d.id !== selectedEmp?.department_id);
  }, [departments, selectedEmp]);

  useEffect(() => {
    if (!selectedEmpId && employees.length > 0) {
      setSelectedEmpId(employees[0].id);
    }
  }, [employees, selectedEmpId]);

  useEffect(() => {
    if (availableTargetDepts.length > 0 && !availableTargetDepts.some(d => d.id === targetDeptId)) {
      setTargetDeptId(availableTargetDepts[0].id);
    }
  }, [availableTargetDepts, targetDeptId]);

  // Calculated duration for window mode
  const windowCalculation = useMemo(() => {
    if (mode === 'live') return null;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const startM = (sh || 0) * 60 + (sm || 0);
    const endM = (eh || 0) * 60 + (em || 0);
    const rawDiff = Math.max(0, endM - startM);
    const netM = Math.max(0, rawDiff - (breakMinutes || 0));
    const hours = Math.round((netM / 60) * 10) / 10;
    return {
      rawMinutes: rawDiff,
      netMinutes: netM,
      hours,
    };
  }, [mode, startTime, endTime, breakMinutes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmpId || !targetDeptId) {
      setError('Please select an employee and target department.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      let isoStart: string;
      let isoEnd: string | null = null;
      let finalBreak = breakMinutes;
      let finalOt = isOt ? otMinutes : 0;

      if (mode === 'live') {
        isoStart = new Date().toISOString();
        isoEnd = null;
      } else {
        isoStart = new Date(`${transferDate}T${startTime}:00`).toISOString();
        isoEnd = new Date(`${transferDate}T${endTime}:00`).toISOString();
      }

      await transferService.startTransfer({
        organizationId,
        employeeId: selectedEmpId,
        toDepartmentId: targetDeptId,
        transferDate,
        startTime: isoStart,
        endTime: isoEnd,
        breakMinutes: finalBreak,
        overtimeMinutes: finalOt,
        transferType,
        reason: reason.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      const targetDeptName = departments.find(d => d.id === targetDeptId)?.name ?? 'target department';
      onSuccess(
        mode === 'live'
          ? `Transfer started! ${selectedEmp?.full_name ?? 'Employee'} is now actively working in ${targetDeptName}.`
          : `Transfer logged: ${selectedEmp?.full_name ?? 'Employee'} assigned to ${targetDeptName} for ${windowCalculation?.hours}h.`,
      );
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        className="relative w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl border"
        style={{ background: '#0a1628', borderColor: '#1e3a5a' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e3a5a]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <ArrowLeftRight size={18} />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Assign Employee to Another Department</h3>
              <p className="text-[11px] text-slate-400">Transfer workforce and start tracking department productivity</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-3 rounded-lg bg-red-950/40 border border-red-500/30 text-red-200 text-xs flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Employee Picker */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Select Employee to Transfer *</label>
            <select
              value={selectedEmpId}
              onChange={e => setSelectedEmpId(e.target.value)}
              style={inputStyle}
              required
            >
              {employees.length === 0 ? (
                <option value="" disabled>
                  No eligible employees in your department
                </option>
              ) : (
                <>
                  {!selectedEmpId && <option value="">Select an employee...</option>}
                  {employees.map(e => {
                    const dName = departments.find(d => d.id === e.department_id)?.name ?? 'No dept';
                    return (
                      <option key={e.id} value={e.id}>
                        {e.full_name} ({e.employee_code}) — {dName}
                      </option>
                    );
                  })}
                </>
              )}
            </select>
          </div>

          {/* Department Route Visualizer */}
          <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-[#122338] border border-[#1e3a5a]">
            <div>
              <span className="text-[10px] text-slate-400 block font-semibold uppercase">Source (Current Dept)</span>
              <div className="text-sm font-bold text-blue-400 mt-1">
                {sourceDept?.name ?? (selectedEmp ? 'No department assigned' : 'Select an employee above')}
              </div>
              <span className="text-[10px] text-slate-500 font-mono">{sourceDept?.code}</span>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 block font-semibold uppercase">Destination Dept *</span>
              <select
                value={targetDeptId}
                onChange={e => setTargetDeptId(e.target.value)}
                className="mt-1 w-full text-xs p-1.5 rounded bg-[#0a1628] text-emerald-300 border border-emerald-500/40 font-semibold outline-none"
                required
              >
                {availableTargetDepts.length === 0 ? (
                  <option value="" disabled>
                    No other departments available
                  </option>
                ) : (
                  availableTargetDepts.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Transfer Timing Mode */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Timing & Duration Mode</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode('live')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  mode === 'live'
                    ? 'bg-blue-600/20 border-blue-500 text-white'
                    : 'bg-[#122338] border-[#1e3a5a] text-slate-400 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-xs">
                  <Play size={13} className="text-emerald-400" />
                  <span>Transfer Now (Live Clock)</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Count starts immediately when initiated. End whenever shift ends.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setMode('window')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  mode === 'window'
                    ? 'bg-blue-600/20 border-blue-500 text-white'
                    : 'bg-[#122338] border-[#1e3a5a] text-slate-400 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold text-xs">
                  <Calendar size={13} className="text-blue-400" />
                  <span>Specific Time Window</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Specify exact hours (e.g. 1:00 PM – 5:00 PM) and deduct break.
                </p>
              </button>
            </div>
          </div>

          {/* Time Window Fields if window mode */}
          {mode === 'window' && (
            <div className="space-y-3 p-3.5 rounded-xl bg-[#122338] border border-[#1e3a5a]">
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Transfer Date</label>
                  <input
                    type="date"
                    value={transferDate}
                    onChange={e => setTransferDate(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">End Time</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={e => setEndTime(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Break deduction:</span>
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={breakMinutes}
                    onChange={e => setBreakMinutes(Number(e.target.value))}
                    className="w-16 px-2 py-1 rounded bg-[#0a1628] text-white border border-[#1e3a5a] text-right text-xs"
                  />
                  <span className="text-slate-500">min</span>
                </div>

                <div className="text-right">
                  <span className="text-slate-400">Calculated Working Time:</span>{' '}
                  <strong className="text-emerald-400 font-mono text-sm">{windowCalculation?.hours}h</strong>
                </div>
              </div>
            </div>
          )}

          {/* Overtime Options */}
          <div className="p-3.5 rounded-xl bg-[#122338] border border-[#1e3a5a] space-y-2.5">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={isOt}
                onChange={e => setIsOt(e.target.checked)}
                className="rounded border-[#1e3a5a] text-amber-500 focus:ring-0"
              />
              <span className="text-xs font-semibold text-slate-200">
                Transferred work includes Overtime in destination department
              </span>
            </label>

            {isOt && (
              <div className="flex items-center gap-3 pt-1 text-xs">
                <span className="text-slate-400">Overtime minutes:</span>
                <input
                  type="number"
                  min="0"
                  step="15"
                  value={otMinutes}
                  onChange={e => setOtMinutes(Number(e.target.value))}
                  className="w-20 px-2 py-1 rounded bg-[#0a1628] text-amber-400 font-mono font-bold border border-amber-500/40 text-right text-xs"
                />
                <span className="text-slate-500 font-mono">({Math.round((otMinutes / 60) * 10) / 10}h OT)</span>
              </div>
            )}
          </div>

          {/* Reason / Quick Tags */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Reason / Task</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {[
                'Mailroom Peak Sorting',
                'FC Packing Support',
                'Backlog Clearance',
                'Cross-Department Coverage',
                'Overtime Coverage',
              ].map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setReason(tag)}
                  className="px-2 py-0.5 rounded text-[10px] bg-[#122338] text-slate-300 hover:bg-blue-600/30 hover:text-white border border-[#1e3a5a] transition-colors"
                >
                  {tag}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Afternoon sorting assistance in Mailroom"
              style={inputStyle}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#1e3a5a]">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white bg-[#122338] border border-[#1e3a5a] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors shadow-lg shadow-blue-500/20 disabled:opacity-50"
            >
              {submitting && <Loader2 size={13} className="animate-spin" />}
              <span>{mode === 'live' ? 'Start Transfer Now' : 'Save Transfer Record'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Complete Transfer Modal
// ----------------------------------------------------------------------------
function CompleteTransferModal({
  item,
  busy,
  onClose,
  onConfirm,
}: {
  item: EmployeeTransferItem;
  busy: boolean;
  onClose: () => void;
  onConfirm: (params: { endTime: string; breakMinutes: number; overtimeMinutes: number; notes?: string }) => Promise<void>;
}) {
  const [endTime, setEndTime] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [breakMinutes, setBreakMinutes] = useState(item.break_minutes || 0);
  const [overtimeMinutes, setOvertimeMinutes] = useState(item.overtime_minutes || 0);
  const [notes, setNotes] = useState('');

  const startTimeFmt = new Date(item.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Live calculation
  const durationCalc = useMemo(() => {
    const start = new Date(item.start_time);
    const end = new Date(item.start_time);
    const [h, m] = endTime.split(':').map(Number);
    end.setHours(h || 0, m || 0, 0, 0);

    const calc = calculateTransferDuration(start, end, breakMinutes);
    const otM = overtimeMinutes || 0;
    const regM = Math.max(0, calc.netMinutes - otM);
    return {
      totalDisplay: calc.display,
      totalHours: calc.hours,
      regHours: Math.round((regM / 60) * 10) / 10,
      otHours: Math.round((otM / 60) * 10) / 10,
    };
  }, [item.start_time, endTime, breakMinutes, overtimeMinutes]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const endIso = new Date(`${item.transfer_date}T${endTime}:00`).toISOString();
    onConfirm({
      endTime: endIso,
      breakMinutes,
      overtimeMinutes,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-2xl overflow-hidden shadow-2xl border" style={{ background: '#0a1628', borderColor: '#1e3a5a' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e3a5a]">
          <div>
            <h3 className="font-bold text-white text-sm">Complete Transfer & Record Hours</h3>
            <p className="text-[11px] text-slate-400">Finalize working duration in {item.to_department?.name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="p-3 rounded-xl bg-[#122338] border border-[#1e3a5a] space-y-1">
            <div className="font-semibold text-white text-xs">{item.employee?.full_name} ({item.employee?.employee_code})</div>
            <div className="text-[11px] text-slate-400">
              Transferred from <span className="text-blue-300 font-semibold">{item.from_department?.name}</span> to{' '}
              <span className="text-emerald-300 font-semibold">{item.to_department?.name}</span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono">Started at: {startTimeFmt}</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">End Time</label>
              <input
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                style={inputStyle}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Break (Minutes)</label>
              <input
                type="number"
                min="0"
                step="5"
                value={breakMinutes}
                onChange={e => setBreakMinutes(Number(e.target.value))}
                style={inputStyle}
              />
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#081220] border border-[#1e3a5a] flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 block">Total Working Duration</span>
              <span className="text-[11px] text-slate-500 font-mono">
                Reg: {durationCalc.regHours}h {durationCalc.otHours > 0 ? `| OT: ${durationCalc.otHours}h` : ''}
              </span>
            </div>
            <span className="text-base font-bold font-mono text-emerald-400">{durationCalc.totalDisplay}</span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Overtime Minutes</label>
            <input
              type="number"
              min="0"
              step="15"
              value={overtimeMinutes}
              onChange={e => setOvertimeMinutes(Number(e.target.value))}
              style={inputStyle}
              placeholder="e.g. 60 for 1 hr OT"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Completion Notes</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Finished mailroom sorting backlog"
              style={inputStyle}
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#1e3a5a]">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white bg-[#122338] border border-[#1e3a5a] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors shadow-lg shadow-emerald-500/20 disabled:opacity-50"
            >
              {busy && <Loader2 size={13} className="animate-spin" />}
              <span>Confirm & Record</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Cancel Transfer Modal
// ----------------------------------------------------------------------------
function CancelTransferModal({
  item,
  busy,
  onClose,
  onConfirm,
}: {
  item: EmployeeTransferItem;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('Initiated in error');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl border" style={{ background: '#0a1628', borderColor: '#1e3a5a' }}>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20">
              <AlertCircle size={20} />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Cancel Transfer</h3>
              <p className="text-xs text-slate-400">Cancel active transfer for {item.employee?.full_name}</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Reason for cancellation</label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white bg-[#122338] border border-[#1e3a5a] transition-colors"
            >
              Go Back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm(reason)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 transition-colors shadow-lg shadow-red-500/20 disabled:opacity-50"
            >
              {busy && <Loader2 size={13} className="animate-spin" />}
              <span>Cancel Transfer</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
