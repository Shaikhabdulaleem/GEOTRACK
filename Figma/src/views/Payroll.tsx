import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldAlert,
  Trash2,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { getErrorMessage } from '../lib/errors';
import {
  buildPayrollCsv,
  canFinalizePayrollRun,
  dateToMonthInput,
  formatMoney,
  monthInputToDate,
} from '../lib/payroll-model';
import { employeeService } from '../services/employee.service';
import { organizationService } from '../services/organization.service';
import { payrollService } from '../services/payroll.service';
import type {
  BranchRow,
  DepartmentRow,
  EmployeeCompensationRow,
  EmployeePayrollComponentRow,
  EmployeeProfileRow,
  OvertimeRateMode,
  PayrollComponentKind,
  PayrollEntryDetail,
  PayrollEntryRow,
  PayrollReviewStatus,
  PayrollRunRow,
  PayrollSettingsRow,
} from '../types/database';

type Tab = 'register' | 'compensation' | 'settings';

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  background: '#122338',
  border: '1px solid #1e3a5a',
  color: '#f0f6ff',
  outline: 'none',
  fontSize: '13px',
} as const;

const cardStyle = {
  background: '#0d1b2e',
  border: '1px solid #1e3a5a',
} as const;

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function Payroll() {
  const { activeMembership, hasPermission } = useAuth();
  const orgId = activeMembership?.organization_id;
  const canManage = hasPermission('payroll:manage');
  const canExport = hasPermission('payroll:export');
  const canReview = hasPermission('payroll:review:scope');

  const [tab, setTab] = useState<Tab>('register');
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthValue);
  const [runs, setRuns] = useState<PayrollRunRow[]>([]);
  const [entries, setEntries] = useState<PayrollEntryRow[]>([]);
  const [settings, setSettings] = useState<PayrollSettingsRow | null>(null);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeProfileRow[]>([]);
  const [compensations, setCompensations] = useState<EmployeeCompensationRow[]>([]);
  const [components, setComponents] = useState<EmployeePayrollComponentRow[]>([]);

  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [reviewFilter, setReviewFilter] = useState<PayrollReviewStatus | ''>('');

  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [entryDetail, setEntryDetail] = useState<PayrollEntryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  const activeRun = useMemo(
    () => runs.find(r => dateToMonthInput(r.payroll_month) === selectedMonth) ?? null,
    [runs, selectedMonth],
  );

  const loadWorkspace = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError('');
    try {
      const [runRows, settingsRow, branchRows, deptRows, empRows, compRows, compntRows] = await Promise.all([
        payrollService.listRuns(orgId),
        payrollService.getSettings(orgId),
        organizationService.listSites(orgId),
        organizationService.listDepartments(orgId),
        employeeService.list({ organizationId: orgId, pageSize: 100 }),
        payrollService.listCompensations(orgId),
        payrollService.listComponents(orgId),
      ]);
      setRuns(runRows);
      setSettings(settingsRow);
      setBranches(branchRows);
      setDepartments(deptRows);
      setEmployees(empRows.rows);
      setCompensations(compRows);
      setComponents(compntRows);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const loadEntries = useCallback(async () => {
    if (!orgId || !activeRun) {
      setEntries([]);
      return;
    }
    try {
      const rows = await payrollService.listEntries({
        organizationId: orgId,
        payrollRunId: activeRun.id,
        search,
        branchId: branchFilter || undefined,
        departmentId: deptFilter || undefined,
        reviewStatus: reviewFilter,
      });
      setEntries(rows);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }, [orgId, activeRun, search, branchFilter, deptFilter, reviewFilter]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const openEntryDetail = useCallback(
    async (entryId: string) => {
      if (!orgId) return;
      setSelectedEntryId(entryId);
      setDetailLoading(true);
      try {
        const detail = await payrollService.getEntryDetail(orgId, entryId);
        setEntryDetail(detail);
      } catch (caught) {
        setError(getErrorMessage(caught));
      } finally {
        setDetailLoading(false);
      }
    },
    [orgId],
  );

  const refreshAfterMutation = async (entryIdToRefresh?: string | null) => {
    await loadWorkspace();
    await loadEntries();
    if (entryIdToRefresh) {
      await openEntryDetail(entryIdToRefresh);
    }
  };

  const handleGenerate = async () => {
    if (!orgId || !canManage) return;
    setActionBusy(true);
    setError('');
    setNotice('');
    try {
      const run = await payrollService.generateRun(orgId, monthInputToDate(selectedMonth));
      setNotice(`Payroll run for ${selectedMonth} calculated (${run.employee_count} employees).`);
      await refreshAfterMutation(selectedEntryId);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setActionBusy(false);
    }
  };

  const handleSubmitForReview = async () => {
    if (!orgId || !activeRun || !canManage) return;
    setActionBusy(true);
    setError('');
    try {
      await payrollService.submitForReview(orgId, activeRun.id);
      setNotice('Payroll run moved to Under Review.');
      await refreshAfterMutation(selectedEntryId);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setActionBusy(false);
    }
  };

  const handleFinalize = async () => {
    if (!orgId || !activeRun || !canManage) return;
    setActionBusy(true);
    setError('');
    try {
      await payrollService.finalizeRun(orgId, activeRun.id);
      setNotice('Payroll run finalized and locked.');
      await refreshAfterMutation(selectedEntryId);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setActionBusy(false);
    }
  };

  const handleReopen = async () => {
    if (!orgId || !activeRun || !canManage) return;
    if (!reopenReason.trim()) {
      setError('A reason is required to reopen a finalized payroll run.');
      return;
    }
    setActionBusy(true);
    setError('');
    try {
      await payrollService.reopenRun(orgId, activeRun.id, reopenReason.trim());
      setReopenOpen(false);
      setReopenReason('');
      setNotice('Payroll run reopened for review and logged in audit trail.');
      await refreshAfterMutation(selectedEntryId);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setActionBusy(false);
    }
  };

  const handleExportCsv = async () => {
    if (!orgId || !activeRun || !canExport) return;
    setActionBusy(true);
    setError('');
    try {
      const rows = await payrollService.exportRunRows(orgId, activeRun.id);
      const csv = buildPayrollCsv(rows);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `payroll-${selectedMonth}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setNotice(`Exported ${rows.length} payroll row(s) to CSV.`);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setActionBusy(false);
    }
  };

  const scopedSummary = useMemo(() => {
    const gross = entries.reduce((s, e) => s + Number(e.gross_pay), 0);
    const ded = entries.reduce((s, e) => s + Number(e.total_deductions), 0);
    const net = entries.reduce((s, e) => s + Number(e.net_pay), 0);
    const pendingReviews = entries.filter(e => e.review_status !== 'reviewed').length;
    const blockers = entries.reduce((s, e) => s + e.unresolved_exception_count + e.pending_overtime_count, 0);
    return { count: entries.length, gross, ded, net, pendingReviews, blockers };
  }, [entries]);

  const finalizeCheck = useMemo(() => canFinalizePayrollRun(entries), [entries]);
  const currency = activeRun?.currency_code ?? settings?.currency_code ?? 'SAR';

  if (!orgId) {
    return <div className="p-10 text-center text-sm" style={{ color: '#4b6a8a' }}>No active organization is selected.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Wallet size={20} style={{ color: '#3b82f6' }} />
            Payroll Operations
          </h1>
          <p className="text-sm mt-1" style={{ color: '#4b6a8a' }}>
            Calendar-month gross-to-net payroll, attendance exception review, and finalized CSV export.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            aria-label="Payroll month"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            style={{ ...inputStyle, width: 165 }}
          />
          {canManage && (!activeRun || activeRun.status !== 'finalized') && (
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void handleGenerate()}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
              style={{ background: '#2563eb' }}
            >
              <RefreshCw size={13} className={actionBusy ? 'animate-spin' : ''} />
              {activeRun ? 'Recalculate Run' : 'Generate Run'}
            </button>
          )}
          {canManage && activeRun?.status === 'draft' && (
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void handleSubmitForReview()}
              className="px-3.5 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
              style={{ background: '#0891b2' }}
            >
              Start Review
            </button>
          )}
          {canManage && activeRun && activeRun.status !== 'finalized' && (
            <button
              type="button"
              disabled={actionBusy || !finalizeCheck.allowed}
              title={finalizeCheck.reason ?? 'Finalize payroll run'}
              onClick={() => void handleFinalize()}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
              style={{ background: '#059669' }}
            >
              <Lock size={13} />
              Finalize Run
            </button>
          )}
          {canManage && activeRun?.status === 'finalized' && (
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => setReopenOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-amber-200 disabled:opacity-50"
              style={{ background: '#122338', border: '1px solid #d97706' }}
            >
              <RotateCcw size={13} />
              Reopen Run
            </button>
          )}
          {canExport && activeRun?.status === 'finalized' && (
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void handleExportCsv()}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
              style={{ background: '#16a34a' }}
            >
              <Download size={13} />
              Export CSV
            </button>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-xl text-sm flex items-center gap-2" style={{ color: '#fca5a5', background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)' }}>
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="p-3 rounded-xl text-sm flex items-center gap-2" style={{ color: '#6ee7b7', background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.3)' }}>
          <CheckCircle2 size={15} />
          <span>{notice}</span>
        </div>
      )}

      {activeRun && (
        <div className="rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs" style={cardStyle}>
          <div className="flex flex-wrap items-center gap-3">
            <RunStatusBadge status={activeRun.status} />
            <span style={{ color: '#94a3b8' }}>
              Basis: <strong className="text-white">{activeRun.currency_code}</strong> · {activeRun.month_basis_days}d month · {activeRun.daily_hours}h/day · {activeRun.overtime_rate_mode === 'fixed_hourly' ? `${activeRun.overtime_hourly_rate} ${activeRun.currency_code}/hr OT` : `${activeRun.overtime_multiplier}× OT`}
            </span>
            {activeRun.reopen_reason && (
              <span className="text-amber-300">Reopened: {activeRun.reopen_reason}</span>
            )}
          </div>
          {activeRun.status !== 'finalized' && !finalizeCheck.allowed && finalizeCheck.reason && (
            <span className="text-amber-300 flex items-center gap-1">
              <ShieldAlert size={13} />
              {finalizeCheck.reason}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <SummaryCard label="Scoped Employees" value={String(scopedSummary.count)} icon={<Users size={15} />} />
        <SummaryCard label="Gross Pay" value={formatMoney(scopedSummary.gross, currency)} icon={<FileSpreadsheet size={15} />} />
        <SummaryCard label="Deductions" value={formatMoney(scopedSummary.ded, currency)} icon={<AlertTriangle size={15} />} accent="#f87171" />
        <SummaryCard label="Net Pay" value={formatMoney(scopedSummary.net, currency)} icon={<Wallet size={15} />} accent="#34d399" />
        <SummaryCard
          label="Pending / Blockers"
          value={`${scopedSummary.pendingReviews} / ${scopedSummary.blockers}`}
          icon={<ShieldAlert size={15} />}
          accent={scopedSummary.pendingReviews + scopedSummary.blockers > 0 ? '#fbbf24' : '#34d399'}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['register', 'Employee Register', FileSpreadsheet],
            ['compensation', 'Compensation & Components', Wallet],
            ...(canManage ? [['settings', 'Payroll Settings', Settings2] as const] : []),
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
            style={{
              background: tab === id ? '#2563eb' : '#0d1b2e',
              color: tab === id ? '#fff' : '#94a3b8',
              border: '1px solid #1e3a5a',
            }}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-16 text-center">
          <Loader2 className="mx-auto animate-spin" style={{ color: '#3b82f6' }} />
        </div>
      ) : tab === 'register' ? (
        <div className="rounded-xl overflow-hidden" style={cardStyle}>
          <div className="p-4 flex flex-wrap items-center gap-3 border-b" style={{ borderColor: '#1e3a5a' }}>
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-2.5" style={{ color: '#4b6a8a' }} />
              <input
                placeholder="Search employee name or code..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ ...inputStyle, paddingLeft: 32 }}
              />
            </div>
            <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} style={{ ...inputStyle, width: 170 }}>
              <option value="">All Sites</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} style={{ ...inputStyle, width: 180 }}>
              <option value="">All Departments</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select value={reviewFilter} onChange={e => setReviewFilter(e.target.value as PayrollReviewStatus | '')} style={{ ...inputStyle, width: 160 }}>
              <option value="">All Review States</option>
              <option value="pending">Pending Review</option>
              <option value="reviewed">Reviewed</option>
            </select>
          </div>

          {!activeRun ? (
            <div className="p-12 text-center text-sm" style={{ color: '#4b6a8a' }}>
              No payroll run generated for {selectedMonth} yet.{canManage ? ' Click "Generate Run" to calculate.' : ''}
            </div>
          ) : entries.length === 0 ? (
            <div className="p-12 text-center text-sm" style={{ color: '#4b6a8a' }}>
              No scoped payroll entries match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead style={{ background: '#08111f', color: '#94a3b8' }}>
                  <tr>
                    <th className="p-3">Employee</th>
                    <th className="p-3">Department</th>
                    <th className="p-3 text-right">Days</th>
                    <th className="p-3 text-right">Base</th>
                    <th className="p-3 text-right">Allowances</th>
                    <th className="p-3 text-right">Overtime</th>
                    <th className="p-3 text-right">Deductions</th>
                    <th className="p-3 text-right">Net Pay</th>
                    <th className="p-3">Blockers</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => {
                    const hasBlockers = entry.unresolved_exception_count > 0 || entry.pending_overtime_count > 0;
                    return (
                      <tr key={entry.id} className="border-t hover:bg-white/[0.02]" style={{ borderColor: '#1e3a5a', color: '#e2e8f0' }}>
                        <td className="p-3">
                          <div className="font-semibold text-white">{entry.employee_name}</div>
                          <div style={{ color: '#4b6a8a' }}>{entry.employee_code}</div>
                        </td>
                        <td className="p-3">
                          <div>{entry.department_name}</div>
                          <div style={{ color: '#4b6a8a' }}>{entry.branch_name}</div>
                        </td>
                        <td className="p-3 text-right">{entry.payable_days}</td>
                        <td className="p-3 text-right">{Number(entry.base_pay).toFixed(2)}</td>
                        <td className="p-3 text-right">{Number(entry.allowances_pay + entry.manual_additions).toFixed(2)}</td>
                        <td className="p-3 text-right">{Number(entry.overtime_pay).toFixed(2)}</td>
                        <td className="p-3 text-right text-red-300">{Number(entry.total_deductions).toFixed(2)}</td>
                        <td className="p-3 text-right font-semibold text-emerald-300">{formatMoney(Number(entry.net_pay), entry.currency_code)}</td>
                        <td className="p-3">
                          {hasBlockers ? (
                            <span className="px-2 py-0.5 rounded text-[11px] bg-amber-500/20 text-amber-300">
                              {entry.unresolved_exception_count} exc · {entry.pending_overtime_count} OT
                            </span>
                          ) : (
                            <span style={{ color: '#4b6a8a' }}>Clear</span>
                          )}
                        </td>
                        <td className="p-3">
                          <span
                            className="px-2 py-0.5 rounded text-[11px] capitalize"
                            style={{
                              background: entry.review_status === 'reviewed' ? 'rgba(16,185,129,0.18)' : 'rgba(148,163,184,0.15)',
                              color: entry.review_status === 'reviewed' ? '#6ee7b7' : '#cbd5e1',
                            }}
                          >
                            {entry.review_status}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <button
                            type="button"
                            onClick={() => void openEntryDetail(entry.id)}
                            className="px-2.5 py-1 rounded text-xs font-medium text-blue-300"
                            style={{ background: '#122338', border: '1px solid #1e3a5a' }}
                          >
                            Breakdown
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : tab === 'compensation' ? (
        <CompensationPanel
          orgId={orgId}
          canManage={canManage}
          currency={currency}
          employees={employees}
          compensations={compensations}
          components={components}
          onChanged={() => void loadWorkspace()}
          onError={setError}
        />
      ) : (
        <PayrollSettingsPanel
          orgId={orgId}
          settings={settings}
          onSaved={async () => {
            setNotice('Payroll settings saved.');
            await loadWorkspace();
          }}
          onError={setError}
        />
      )}

      {selectedEntryId && (
        <BreakdownDrawer
          orgId={orgId}
          runStatus={activeRun?.status ?? 'draft'}
          detail={entryDetail}
          loading={detailLoading}
          canManage={canManage}
          canReview={canReview}
          onClose={() => {
            setSelectedEntryId(null);
            setEntryDetail(null);
          }}
          onMutated={() => void refreshAfterMutation(selectedEntryId)}
          onError={setError}
        />
      )}

      {reopenOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(6,13,26,0.85)' }}>
          <div className="w-full max-w-md rounded-2xl p-5 space-y-4" style={cardStyle}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Reopen Finalized Payroll Run</h2>
              <button type="button" onClick={() => setReopenOpen(false)} style={{ color: '#4b6a8a' }}><X size={16} /></button>
            </div>
            <p className="text-xs" style={{ color: '#94a3b8' }}>
              Reopening unlocks this run for adjustments and review. This action is recorded in the audit log.
            </p>
            <textarea
              rows={3}
              placeholder="Reason for reopening..."
              value={reopenReason}
              onChange={e => setReopenReason(e.target.value)}
              style={inputStyle}
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReopenOpen(false)} className="px-3 py-2 rounded-lg text-xs" style={{ color: '#94a3b8' }}>Cancel</button>
              <button
                type="button"
                disabled={actionBusy || !reopenReason.trim()}
                onClick={() => void handleReopen()}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: '#d97706' }}
              >
                Confirm Reopen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-xl p-4" style={cardStyle}>
      <div className="flex items-center justify-between text-xs" style={{ color: '#4b6a8a' }}>
        <span>{label}</span>
        {icon}
      </div>
      <div className="text-lg font-bold mt-1.5" style={{ color: accent ?? '#f0f6ff' }}>{value}</div>
    </div>
  );
}

function RunStatusBadge({ status }: { status: PayrollRunRow['status'] }) {
  const styles: Record<PayrollRunRow['status'], { bg: string; color: string; label: string }> = {
    draft: { bg: 'rgba(148,163,184,0.18)', color: '#cbd5e1', label: 'Draft' },
    under_review: { bg: 'rgba(245,158,11,0.18)', color: '#fbbf24', label: 'Under Review' },
    finalized: { bg: 'rgba(16,185,129,0.18)', color: '#6ee7b7', label: 'Finalized' },
  };
  const s = styles[status];
  return <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
}

function PayrollSettingsPanel({
  orgId,
  settings,
  onSaved,
  onError,
}: {
  orgId: string;
  settings: PayrollSettingsRow | null;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [currencyCode, setCurrencyCode] = useState(settings?.currency_code ?? 'SAR');
  const [monthBasisDays, setMonthBasisDays] = useState(settings?.month_basis_days ?? 30);
  const [dailyHours, setDailyHours] = useState(settings?.daily_hours ?? 8);
  const [otRateMode, setOtRateMode] = useState<OvertimeRateMode>(settings?.overtime_rate_mode ?? 'multiplier');
  const [otMultiplier, setOtMultiplier] = useState(settings?.overtime_multiplier ?? 1.5);
  const [otHourlyRate, setOtHourlyRate] = useState(settings?.overtime_hourly_rate ?? 12);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setCurrencyCode(settings.currency_code);
    setMonthBasisDays(settings.month_basis_days);
    setDailyHours(settings.daily_hours);
    setOtRateMode(settings.overtime_rate_mode ?? 'multiplier');
    setOtMultiplier(settings.overtime_multiplier);
    setOtHourlyRate(settings.overtime_hourly_rate ?? 0);
  }, [settings]);

  const save = async () => {
    setSaving(true);
    onError('');
    try {
      await payrollService.upsertSettings({
        organizationId: orgId,
        currencyCode,
        monthBasisDays,
        dailyHours,
        overtimeMultiplier: otMultiplier,
        overtimeRateMode: otRateMode,
        overtimeHourlyRate: otHourlyRate,
      });
      await onSaved();
    } catch (caught) {
      onError(getErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl p-5 max-w-xl space-y-4" style={cardStyle}>
      <div>
        <h2 className="text-sm font-semibold text-white">Organization Payroll Settings</h2>
        <p className="text-xs mt-1" style={{ color: '#94a3b8' }}>
          Snapshotted into each new, draft, or recalculated payroll run. Existing finalized runs keep their original snapshot.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs" style={{ color: '#94a3b8' }}>
          Currency (ISO 3-letter)
          <input value={currencyCode} maxLength={3} onChange={e => setCurrencyCode(e.target.value.toUpperCase())} style={{ ...inputStyle, marginTop: 4 }} />
        </label>
        <label className="text-xs" style={{ color: '#94a3b8' }}>
          Month Divisor (days)
          <input type="number" min={1} max={31} value={monthBasisDays} onChange={e => setMonthBasisDays(Number(e.target.value))} style={{ ...inputStyle, marginTop: 4 }} />
        </label>
        <label className="text-xs" style={{ color: '#94a3b8' }}>
          Daily Hours
          <input type="number" min={1} max={24} step={0.5} value={dailyHours} onChange={e => setDailyHours(Number(e.target.value))} style={{ ...inputStyle, marginTop: 4 }} />
        </label>
        <label className="text-xs" style={{ color: '#94a3b8' }}>
          Overtime Calculation Mode
          <select value={otRateMode} onChange={e => setOtRateMode(e.target.value as OvertimeRateMode)} style={{ ...inputStyle, marginTop: 4 }}>
            <option value="multiplier">Multiplier of hourly base salary (e.g. 1.5×)</option>
            <option value="fixed_hourly">Fixed hourly rate ({currencyCode || 'SAR'}/hr)</option>
          </select>
        </label>
        {otRateMode === 'fixed_hourly' ? (
          <label className="text-xs col-span-2" style={{ color: '#94a3b8' }}>
            Fixed Overtime Rate ({currencyCode || 'SAR'} / hour)
            <input type="number" min={0} max={10000} step={0.5} value={otHourlyRate} onChange={e => setOtHourlyRate(Number(e.target.value))} style={{ ...inputStyle, marginTop: 4 }} />
            <div className="mt-1" style={{ color: '#4b6a8a' }}>
              Pays a flat {otHourlyRate || 0} {currencyCode || 'SAR'} per approved OT hour for every employee. Editable anytime before finalizing a run.
            </div>
          </label>
        ) : (
          <label className="text-xs col-span-2" style={{ color: '#94a3b8' }}>
            Overtime Multiplier
            <input type="number" min={1} max={10} step={0.1} value={otMultiplier} onChange={e => setOtMultiplier(Number(e.target.value))} style={{ ...inputStyle, marginTop: 4 }} />
            <div className="mt-1" style={{ color: '#4b6a8a' }}>
              Multiplies each employee&apos;s hourly base salary (e.g. 1.5×).
            </div>
          </label>
        )}
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
        style={{ background: '#2563eb' }}
      >
        {saving ? 'Saving…' : 'Save Settings'}
      </button>
    </div>
  );
}

function CompensationPanel({
  orgId,
  canManage,
  currency,
  employees,
  compensations,
  components,
  onChanged,
  onError,
}: {
  orgId: string;
  canManage: boolean;
  currency: string;
  employees: EmployeeProfileRow[];
  compensations: EmployeeCompensationRow[];
  components: EmployeePayrollComponentRow[];
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [selectedEmpId, setSelectedEmpId] = useState<string>(employees[0]?.id ?? '');
  const [salaryAmount, setSalaryAmount] = useState('');
  const [salaryFrom, setSalaryFrom] = useState(`${currentMonthValue()}-01`);
  const [salaryTo, setSalaryTo] = useState('');
  const [compKind, setCompKind] = useState<PayrollComponentKind>('allowance');
  const [compCode, setCompCode] = useState('');
  const [compName, setCompName] = useState('');
  const [compAmount, setCompAmount] = useState('');
  const [compFrom, setCompFrom] = useState(`${currentMonthValue()}-01`);
  const [compTo, setCompTo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selectedEmpId && employees[0]?.id) {
      setSelectedEmpId(employees[0].id);
    }
  }, [employees, selectedEmpId]);

  const empCompensations = useMemo(
    () => compensations.filter(c => !selectedEmpId || c.employee_id === selectedEmpId),
    [compensations, selectedEmpId],
  );
  const empComponents = useMemo(
    () => components.filter(c => !selectedEmpId || c.employee_id === selectedEmpId),
    [components, selectedEmpId],
  );

  const addSalary = async () => {
    if (!selectedEmpId || !salaryAmount) return;
    setBusy(true);
    onError('');
    try {
      await payrollService.upsertCompensation({
        organizationId: orgId,
        employeeId: selectedEmpId,
        monthlyBaseSalary: Number(salaryAmount),
        currencyCode: currency,
        effectiveFrom: salaryFrom,
        effectiveTo: salaryTo || null,
      });
      setSalaryAmount('');
      setSalaryTo('');
      onChanged();
    } catch (caught) {
      onError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const addComponent = async () => {
    if (!selectedEmpId || !compCode.trim() || !compName.trim() || !compAmount) return;
    setBusy(true);
    onError('');
    try {
      await payrollService.upsertComponent({
        organizationId: orgId,
        employeeId: selectedEmpId,
        componentKind: compKind,
        code: compCode.trim().toUpperCase(),
        name: compName.trim(),
        amount: Number(compAmount),
        effectiveFrom: compFrom,
        effectiveTo: compTo || null,
      });
      setCompCode('');
      setCompName('');
      setCompAmount('');
      setCompTo('');
      onChanged();
    } catch (caught) {
      onError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const employeeNameMap = useMemo(() => new Map(employees.map(e => [e.id, `${e.employee_code} · ${e.full_name}`])), [employees]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-4 flex flex-wrap items-center gap-3" style={cardStyle}>
        <label className="text-xs font-medium text-white">Employee:</label>
        <select value={selectedEmpId} onChange={e => setSelectedEmpId(e.target.value)} style={{ ...inputStyle, width: 280 }}>
          {employees.map(e => (
            <option key={e.id} value={e.id}>{e.employee_code} · {e.full_name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl p-4 space-y-3" style={cardStyle}>
          <h3 className="text-sm font-semibold text-white">Effective-Dated Base Salary</h3>
          {canManage && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <input type="number" min={0} step="0.01" placeholder={`Salary (${currency})`} value={salaryAmount} onChange={e => setSalaryAmount(e.target.value)} style={inputStyle} />
              <input type="date" aria-label="Effective from" value={salaryFrom} onChange={e => setSalaryFrom(e.target.value)} style={inputStyle} />
              <input type="date" aria-label="Effective to" value={salaryTo} onChange={e => setSalaryTo(e.target.value)} style={inputStyle} />
              <button
                type="button"
                disabled={busy || !salaryAmount}
                onClick={() => void addSalary()}
                className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: '#2563eb' }}
              >
                <Plus size={13} /> Add Salary
              </button>
            </div>
          )}
          <div className="space-y-2">
            {empCompensations.length === 0 ? (
              <div className="text-xs py-4 text-center" style={{ color: '#4b6a8a' }}>No salary records for this employee.</div>
            ) : empCompensations.map(c => (
              <div key={c.id} className="p-3 rounded-lg flex items-center justify-between text-xs" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
                <div>
                  <div className="font-semibold text-white">{formatMoney(Number(c.monthly_base_salary), c.currency_code)} / month</div>
                  <div style={{ color: '#94a3b8' }}>
                    {employeeNameMap.get(c.employee_id) ?? c.employee_id} · {c.effective_from} → {c.effective_to ?? 'Ongoing'}
                  </div>
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => void payrollService.deleteCompensation(orgId, c.id).then(onChanged).catch(e => onError(getErrorMessage(e)))}
                    className="p-1.5 rounded text-red-300"
                    title="Delete compensation"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl p-4 space-y-3" style={cardStyle}>
          <h3 className="text-sm font-semibold text-white">Recurring Allowances & Deductions</h3>
          {canManage && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <select value={compKind} onChange={e => setCompKind(e.target.value as PayrollComponentKind)} style={inputStyle}>
                <option value="allowance">Allowance</option>
                <option value="deduction">Deduction</option>
              </select>
              <input placeholder="Code (e.g. HOUS)" value={compCode} onChange={e => setCompCode(e.target.value)} style={inputStyle} />
              <input placeholder="Name (e.g. Housing)" value={compName} onChange={e => setCompName(e.target.value)} style={inputStyle} />
              <input type="number" min={0} step="0.01" placeholder="Amount" value={compAmount} onChange={e => setCompAmount(e.target.value)} style={inputStyle} />
              <input type="date" value={compFrom} onChange={e => setCompFrom(e.target.value)} style={inputStyle} />
              <div className="flex gap-1">
                <input type="date" value={compTo} onChange={e => setCompTo(e.target.value)} style={inputStyle} />
                <button
                  type="button"
                  disabled={busy || !compCode.trim() || !compName.trim() || !compAmount}
                  onClick={() => void addComponent()}
                  className="px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                  style={{ background: '#2563eb' }}
                >
                  <Plus size={13} />
                </button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {empComponents.length === 0 ? (
              <div className="text-xs py-4 text-center" style={{ color: '#4b6a8a' }}>No recurring components configured.</div>
            ) : empComponents.map(c => (
              <div key={c.id} className="p-3 rounded-lg flex items-center justify-between text-xs" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
                <div>
                  <div className="font-semibold text-white">
                    <span className={c.component_kind === 'allowance' ? 'text-emerald-300' : 'text-red-300'}>
                      [{c.component_kind.toUpperCase()}]
                    </span>{' '}
                    {c.name} ({c.code}) · {formatMoney(Number(c.amount), currency)}
                  </div>
                  <div style={{ color: '#94a3b8' }}>
                    {c.effective_from} → {c.effective_to ?? 'Ongoing'}
                  </div>
                </div>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => void payrollService.deleteComponent(orgId, c.id).then(onChanged).catch(e => onError(getErrorMessage(e)))}
                    className="p-1.5 rounded text-red-300"
                    title="Delete component"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BreakdownDrawer({
  orgId,
  runStatus,
  detail,
  loading,
  canManage,
  canReview,
  onClose,
  onMutated,
  onError,
}: {
  orgId: string;
  runStatus: PayrollRunRow['status'];
  detail: PayrollEntryDetail | null;
  loading: boolean;
  canManage: boolean;
  canReview: boolean;
  onClose: () => void;
  onMutated: () => void;
  onError: (msg: string) => void;
}) {
  const [waiveTargetId, setWaiveTargetId] = useState<string | null>(null);
  const [waiveReason, setWaiveReason] = useState('');
  const [adjDir, setAdjDir] = useState<'earning' | 'deduction'>('earning');
  const [adjCode, setAdjCode] = useState('BONUS');
  const [adjLabel, setAdjLabel] = useState('');
  const [adjAmount, setAdjAmount] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [busy, setBusy] = useState(false);

  const isLocked = runStatus === 'finalized';
  const entry = detail?.entry;

  const handleWaive = async (exceptionId: string) => {
    if (!waiveReason.trim()) return;
    setBusy(true);
    onError('');
    try {
      await payrollService.waiveException(orgId, exceptionId, waiveReason.trim());
      setWaiveTargetId(null);
      setWaiveReason('');
      onMutated();
    } catch (caught) {
      onError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleAddManual = async () => {
    if (!entry || !adjLabel.trim() || !adjAmount) return;
    setBusy(true);
    onError('');
    try {
      await payrollService.addManualAdjustment({
        organizationId: orgId,
        payrollEntryId: entry.id,
        direction: adjDir,
        code: adjCode.trim() || 'ADJ',
        label: adjLabel.trim(),
        amount: Number(adjAmount),
      });
      setAdjLabel('');
      setAdjAmount('');
      onMutated();
    } catch (caught) {
      onError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleReview = async (status: PayrollReviewStatus) => {
    if (!entry) return;
    setBusy(true);
    onError('');
    try {
      await payrollService.reviewEntry(orgId, entry.id, status, reviewNote || null);
      onMutated();
    } catch (caught) {
      onError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(6,13,26,0.75)' }}>
      <div className="w-full max-w-2xl h-full overflow-y-auto p-6 space-y-5" style={{ background: '#08111f', borderLeft: '1px solid #1e3a5a' }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">{entry?.employee_name ?? 'Payroll Breakdown'}</h2>
            {entry && (
              <p className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>
                {entry.employee_code} · {entry.branch_name} / {entry.department_name}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg" style={{ color: '#94a3b8' }}>
            <X size={18} />
          </button>
        </div>

        {loading || !entry ? (
          <div className="p-16 text-center"><Loader2 className="mx-auto animate-spin" style={{ color: '#3b82f6' }} /></div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-xl" style={cardStyle}>
                <div style={{ color: '#4b6a8a' }}>Gross Pay</div>
                <div className="text-sm font-bold text-white mt-1">{formatMoney(Number(entry.gross_pay), entry.currency_code)}</div>
              </div>
              <div className="p-3 rounded-xl" style={cardStyle}>
                <div style={{ color: '#4b6a8a' }}>Deductions</div>
                <div className="text-sm font-bold text-red-300 mt-1">{formatMoney(Number(entry.total_deductions), entry.currency_code)}</div>
              </div>
              <div className="p-3 rounded-xl" style={cardStyle}>
                <div style={{ color: '#4b6a8a' }}>Net Pay</div>
                <div className="text-sm font-bold text-emerald-300 mt-1">{formatMoney(Number(entry.net_pay), entry.currency_code)}</div>
              </div>
            </div>

            <div className="p-3 rounded-xl text-xs flex flex-wrap gap-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: '#94a3b8' }}>
              <span>Active Days: <strong className="text-white">{entry.active_days}</strong></span>
              <span>Payable Days: <strong className="text-white">{entry.payable_days}</strong></span>
              <span>Worked Days: <strong className="text-white">{entry.worked_days}</strong></span>
              <span>Absent Days: <strong className="text-red-300">{entry.absent_days}</strong></span>
              <span>Unpaid Leave: <strong className="text-red-300">{entry.unpaid_leave_days}</strong></span>
              <span>Pending OT: <strong className="text-amber-300">{entry.pending_overtime_count}</strong></span>
            </div>

            <div className="rounded-xl p-4 space-y-2" style={cardStyle}>
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>Line Items</h3>
              {detail.line_items.map(item => (
                <div key={item.id} className="flex items-center justify-between py-2 border-t text-xs" style={{ borderColor: '#1e3a5a' }}>
                  <div>
                    <div className="text-white font-medium">{item.label}</div>
                    <div style={{ color: '#4b6a8a' }}>
                      {item.code} {item.quantity != null ? `· ${item.quantity} ${item.unit ?? ''}` : ''} {item.is_manual ? '· Manual' : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={item.direction === 'earning' ? 'text-emerald-300 font-semibold' : 'text-red-300 font-semibold'}>
                      {item.direction === 'earning' ? '+' : '-'}{Number(item.amount).toFixed(2)}
                    </span>
                    {canManage && !isLocked && item.is_manual && (
                      <button
                        type="button"
                        onClick={() => void payrollService.deleteManualAdjustment(orgId, item.id).then(onMutated).catch(e => onError(getErrorMessage(e)))}
                        className="text-red-300 p-1"
                        title="Remove manual adjustment"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {canManage && !isLocked && (
                <div className="pt-3 border-t grid grid-cols-2 sm:grid-cols-5 gap-2" style={{ borderColor: '#1e3a5a' }}>
                  <select value={adjDir} onChange={e => setAdjDir(e.target.value as 'earning' | 'deduction')} style={inputStyle}>
                    <option value="earning">+ Earning</option>
                    <option value="deduction">- Deduction</option>
                  </select>
                  <input placeholder="Code" value={adjCode} onChange={e => setAdjCode(e.target.value)} style={inputStyle} />
                  <input placeholder="Description" value={adjLabel} onChange={e => setAdjLabel(e.target.value)} style={inputStyle} />
                  <input type="number" min={0} step="0.01" placeholder="Amount" value={adjAmount} onChange={e => setAdjAmount(e.target.value)} style={inputStyle} />
                  <button
                    type="button"
                    disabled={busy || !adjLabel.trim() || !adjAmount}
                    onClick={() => void handleAddManual()}
                    className="px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                    style={{ background: '#2563eb' }}
                  >
                    Add
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-xl p-4 space-y-2" style={cardStyle}>
              <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>
                Attendance Exceptions ({detail.exceptions.length})
              </h3>
              {detail.exceptions.length === 0 ? (
                <div className="text-xs py-2" style={{ color: '#4b6a8a' }}>No attendance exceptions for this month.</div>
              ) : detail.exceptions.map(ex => (
                <div key={ex.id} className="p-3 rounded-lg space-y-2 text-xs" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-white">{ex.work_date}</span> ·{' '}
                      <span className="capitalize text-amber-300">{ex.exception_type.replace(/_/g, ' ')}</span> ({ex.minutes}m)
                    </div>
                    <span className="capitalize px-2 py-0.5 rounded text-[11px]" style={{
                      background: ex.status === 'open' ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)',
                      color: ex.status === 'open' ? '#fbbf24' : '#6ee7b7',
                    }}>
                      {ex.status}
                    </span>
                  </div>
                  {ex.waive_reason && (
                    <div style={{ color: '#94a3b8' }}>Waived: {ex.waive_reason}</div>
                  )}
                  {canReview && !isLocked && ex.status === 'open' && (
                    waiveTargetId === ex.id ? (
                      <div className="flex gap-2">
                        <input placeholder="Reason to waive..." value={waiveReason} onChange={e => setWaiveReason(e.target.value)} style={inputStyle} />
                        <button
                          type="button"
                          disabled={busy || !waiveReason.trim()}
                          onClick={() => void handleWaive(ex.id)}
                          className="px-3 py-1.5 rounded text-xs font-semibold text-white disabled:opacity-50"
                          style={{ background: '#d97706' }}
                        >
                          Waive
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setWaiveTargetId(ex.id); setWaiveReason(''); }}
                        className="text-amber-300 underline text-xs"
                      >
                        Waive with reason
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>

            {canReview && !isLocked && (
              <div className="rounded-xl p-4 space-y-3" style={cardStyle}>
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#94a3b8' }}>Review Decision</h3>
                <input
                  placeholder="Optional review note..."
                  value={reviewNote}
                  onChange={e => setReviewNote(e.target.value)}
                  style={inputStyle}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy || entry.unresolved_exception_count > 0 || entry.pending_overtime_count > 0}
                    onClick={() => void handleReview('reviewed')}
                    className="flex-1 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
                    style={{ background: '#059669' }}
                  >
                    Mark Reviewed
                  </button>
                  {entry.review_status === 'reviewed' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleReview('pending')}
                      className="px-4 py-2 rounded-lg text-xs font-semibold"
                      style={{ background: '#122338', color: '#cbd5e1', border: '1px solid #1e3a5a' }}
                    >
                      Reset to Pending
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
