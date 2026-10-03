import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit2,
  Moon,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Sun,
  Trash2,
  User,
  X,
  ZapOff,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  shiftService,
  formatTime12,
  getMondayOfWeek,
  getWeekDates,
  toISODate,
  detectCrossesMidnight,
  shiftDurationMinutes,
  type ConflictResult,
  type ShiftSummary,
} from '../services/shift.service';
import { employeeService } from '../services/employee.service';
import type { ShiftRow, ShiftAssignmentRow, EmployeeProfileRow } from '../types/database';
import { scheduleData } from '../data/mockData';
import { ShiftEditorModal as ShiftModal } from '../components/ShiftEditorModal';

// ─────────────────────────────────────────────
// Constants / colour map
// ─────────────────────────────────────────────

const SHIFT_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  Day: { bg: 'rgba(37,99,235,0.2)', color: '#93c5fd', border: '#2563eb' },
  Night: { bg: 'rgba(139,92,246,0.2)', color: '#c4b5fd', border: '#8b5cf6' },
  OFF: { bg: 'rgba(30,58,90,0.3)', color: '#4b6a8a', border: '#1e3a5a' },
  Leave: { bg: 'rgba(245,158,11,0.15)', color: '#fcd34d', border: '#f59e0b' },
};

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ─────────────────────────────────────────────
// Helper utilities
// ─────────────────────────────────────────────

function shiftLabel(shift: ShiftRow): string {
  return `${formatTime12(shift.start_time)} – ${formatTime12(shift.end_time)}`;
}

function shiftBadgeColor(shift: ShiftRow | null): { bg: string; color: string; border: string } {
  if (!shift) return SHIFT_COLORS.OFF;
  if (shift.color) {
    return {
      bg: `${shift.color}33`,
      color: shift.color,
      border: shift.color,
    };
  }
  if (shift.crosses_midnight) return SHIFT_COLORS.Night;
  return SHIFT_COLORS.Day;
}

function formatWeekLabel(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${monday.toLocaleDateString('en-US', opts)} – ${sunday.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
}

function formatDateHeader(iso: string): { day: string; num: string; isToday: boolean } {
  const d = new Date(iso + 'T00:00:00');
  const today = toISODate(new Date());
  return {
    day: WEEKDAY_LABELS[d.getDay() === 0 ? 6 : d.getDay() - 1],
    num: String(d.getDate()),
    isToday: iso === today,
  };
}

// ─────────────────────────────────────────────
// Mock fallback data (used when Supabase not configured)
// ─────────────────────────────────────────────

const MOCK_SHIFTS: ShiftRow[] = [
  {
    id: 'S1',
    organization_id: 'mock',
    code: 'DAY',
    name: 'Day Shift',
    start_time: '09:00',
    end_time: '17:00',
    crosses_midnight: false,
    break_minutes: 60,
    color: '#2563eb',
    status: 'active',
    template_key: 'S1',
    version_number: 1,
    effective_from: '2020-01-01',
    effective_to: null,
    created_by: null,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'S2',
    organization_id: 'mock',
    code: 'NIGHT',
    name: 'Night Shift',
    start_time: '21:00',
    end_time: '05:00',
    crosses_midnight: true, // 21:00→05:00 is ONE shift crossing midnight
    break_minutes: 60,
    color: '#8b5cf6',
    status: 'active',
    template_key: 'S2',
    version_number: 1,
    effective_from: '2020-01-01',
    effective_to: null,
    created_by: null,
    created_at: '',
    updated_at: '',
  },
];

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}
    >
      <AlertTriangle size={16} />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="flex items-center gap-1 text-xs hover:opacity-80">
          <RefreshCw size={12} /> Retry
        </button>
      )}
    </div>
  );
}

// ─── Shift Template Card ─────────────────────
function ShiftTemplateCard({
  shift,
  onEdit,
  onDelete,
}: {
  shift: ShiftRow;
  onEdit: (s: ShiftRow) => void;
  onDelete: (id: string) => void;
}) {
  const dur = shiftDurationMinutes(shift.start_time, shift.end_time) - shift.break_minutes;
  const hours = Math.floor(dur / 60);
  const mins = dur % 60;
  const c = shiftBadgeColor(shift);

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl"
      style={{ background: '#122338', border: '1px solid #1e3a5a' }}
    >
      <div className="w-3 h-8 rounded-sm flex-shrink-0" style={{ background: c.bg, border: `1px solid ${c.border}` }} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white">{shift.name}</div>
        <div className="text-xs mt-0.5" style={{ color: '#4b6a8a' }}>
          {formatTime12(shift.start_time)} → {formatTime12(shift.end_time)}
          {shift.crosses_midnight && (
            <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(139,92,246,0.2)', color: '#c4b5fd' }}>
              +1 day
            </span>
          )}
        </div>
        <div className="text-xs mt-0.5" style={{ color: '#4b6a8a' }}>
          {hours}h {mins > 0 ? `${mins}m` : ''} net · {shift.break_minutes}m break
        </div>
      </div>
      <div className="flex gap-1">
        <button
          onClick={() => onEdit(shift)}
          className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
          style={{ color: '#4b6a8a' }}
          title="Edit shift"
        >
          <Edit2 size={13} />
        </button>
        <button
          onClick={() => onDelete(shift.id)}
          className="p-1.5 rounded-lg hover:bg-red-900/20 transition-colors"
          style={{ color: '#4b6a8a' }}
          title="Delete shift"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Assign / Edit Cell Modal ────────────────
interface CellModalProps {
  employee: EmployeeProfileRow | { id: string; full_name: string; department: string };
  workDate: string;
  currentShiftId: string | null;
  currentStatus: 'scheduled' | 'off' | 'leave' | 'cancelled';
  shifts: ShiftRow[];
  organizationId: string;
  userId: string | null;
  onSaved: () => void;
  onClose: () => void;
}

function CellAssignModal({
  employee,
  workDate,
  currentShiftId,
  currentStatus,
  shifts,
  organizationId,
  userId,
  onSaved,
  onClose,
}: CellModalProps) {
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(currentShiftId);
  const [status, setStatus] = useState<'scheduled' | 'off' | 'leave' | 'cancelled'>(currentStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await shiftService.assignShift({
        organization_id: organizationId,
        employee_id: employee.id,
        shift_id: status === 'scheduled' ? selectedShiftId : null,
        work_date: workDate,
        status,
        created_by: userId,
        force: true,
      });
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save assignment.');
      setSaving(false);
    }
  };

  const empName = 'full_name' in employee ? employee.full_name : (employee as { full_name: string }).full_name;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(6,13,26,0.85)' }}>
      <div className="rounded-2xl w-80" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #1e3a5a' }}>
          <div>
            <div className="font-semibold text-sm text-white">Edit Assignment</div>
            <div className="text-xs mt-0.5" style={{ color: '#4b6a8a' }}>
              {empName} · {workDate}
            </div>
          </div>
        <button onClick={onClose} aria-label="Close shift assignment" style={{ color: '#4b6a8a' }}><X size={15} /></button>
        </div>
        <div className="p-5 space-y-4">
          {error && <ErrorBanner message={error} />}

          <div>
            <label className="text-xs block mb-2" style={{ color: '#4b6a8a' }}>Status</label>
            <div className="grid grid-cols-2 gap-2">
              {(['scheduled', 'off', 'leave', 'cancelled'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className="py-2 rounded-lg text-xs font-medium capitalize transition-all"
                  style={{
                    background: status === s ? '#2563eb' : '#122338',
                    color: status === s ? '#fff' : '#4b6a8a',
                    border: `1px solid ${status === s ? '#2563eb' : '#1e3a5a'}`,
                  }}
                >
                  {s === 'off' ? 'Day Off' : s}
                </button>
              ))}
            </div>
          </div>

          {status === 'scheduled' && (
            <div>
              <label className="text-xs block mb-2" style={{ color: '#4b6a8a' }}>Shift Template</label>
              <div className="space-y-2">
                {shifts.map(shift => {
                  const c = shiftBadgeColor(shift);
                  return (
                    <button
                      key={shift.id}
                      onClick={() => setSelectedShiftId(shift.id)}
                      className="w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-all"
                      style={{
                        background: selectedShiftId === shift.id ? `${c.border}22` : '#122338',
                        border: `1px solid ${selectedShiftId === shift.id ? c.border : '#1e3a5a'}`,
                      }}
                    >
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: c.border }} />
                      <div>
                        <div className="text-xs font-medium" style={{ color: '#f0f6ff' }}>{shift.name}</div>
                        <div className="text-xs" style={{ color: '#4b6a8a' }}>
                          {formatTime12(shift.start_time)} → {formatTime12(shift.end_time)}
                          {shift.crosses_midnight && ' (+1 day)'}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 py-2 rounded-lg text-sm" style={{ background: '#122338', color: '#4b6a8a', border: '1px solid #1e3a5a' }}>Cancel</button>
            <button
              onClick={() => void handleSave()}
              disabled={saving || (status === 'scheduled' && !selectedShiftId)}
              className="flex-1 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
              style={{ background: '#2563eb', color: '#fff', opacity: (saving || (status === 'scheduled' && !selectedShiftId)) ? 0.6 : 1 }}
            >
              {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Conflict Banner ─────────────────────────
function ConflictsBanner({ conflicts }: { conflicts: ConflictResult[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!conflicts.length) return null;
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.08)' }}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <AlertTriangle size={15} style={{ color: '#f59e0b' }} />
        <span className="text-sm font-semibold" style={{ color: '#fcd34d' }}>
          {conflicts.length} scheduling conflict{conflicts.length > 1 ? 's' : ''} detected
        </span>
        <ChevronRight
          size={14}
          style={{ color: '#f59e0b', marginLeft: 'auto', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}
        />
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {conflicts.map((c, i) => (
            <div key={i} className="text-xs" style={{ color: '#fcd34d' }}>
              · {c.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Weekly Off Sidebar ──────────────────────
function WeeklyOffBadge({ weekdays }: { weekdays: number[] }) {
  if (!weekdays.length) return <span style={{ color: '#4b6a8a', fontSize: 10 }}>None</span>;
  return (
    <div className="flex gap-0.5 flex-wrap">
      {weekdays.map(d => (
        <span
          key={d}
          className="text-xs px-1 py-0.5 rounded"
          style={{ background: 'rgba(30,58,90,0.6)', color: '#4b6a8a', fontSize: 10 }}
        >
          {WEEKDAY_LABELS[d]}
        </span>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Main ShiftScheduler Component
// ─────────────────────────────────────────────

type ViewMode = 'weekly' | 'daily' | 'monthly';
type RightPanel = 'templates' | 'rotating' | 'weekly-off' | 'conflicts' | null;

interface MockAssignments {
  [empName: string]: string[];
}

export default function ShiftScheduler() {
  const { activeMembership, user } = useAuth();
  const supabaseReady = isSupabaseConfigured();
  const organizationId = activeMembership?.organization_id ?? '';

  // ── View state ──────────────────────────────
  const [view, setView] = useState<ViewMode>('weekly');
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOfWeek(new Date()));
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);

  // ── Data ────────────────────────────────────
  const [shifts, setShifts] = useState<ShiftRow[]>(MOCK_SHIFTS);
  const [employees, setEmployees] = useState<EmployeeProfileRow[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignmentRow[]>([]);
  const [weeklyOffs, setWeeklyOffs] = useState<Record<string, number[]>>({});
  const [summaries, setSummaries] = useState<ShiftSummary[]>([]);
  const [conflicts, setConflicts] = useState<ConflictResult[]>([]);

  // ── UI state ────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [editingShift, setEditingShift] = useState<ShiftRow | null>(null);
  const [cellModal, setCellModal] = useState<{
    employee: EmployeeProfileRow;
    workDate: string;
    currentShiftId: string | null;
    currentStatus: 'scheduled' | 'off' | 'leave' | 'cancelled';
  } | null>(null);

  // Mock state (no Supabase)
  const [mockAssignments, setMockAssignments] = useState<MockAssignments>(scheduleData.assignments as MockAssignments);

  // ── Derived ─────────────────────────────────
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const weekLabel = useMemo(() => formatWeekLabel(weekStart), [weekStart]);

  const fromDate = weekDates[0];
  const toDate = weekDates[6];

  // ── Data loading ────────────────────────────
  const loadData = useCallback(async () => {
    if (!supabaseReady || !organizationId) return;
    setLoading(true);
    setError('');
    try {
      const [empResult, shiftList, rawAssignments, offs, summary] = await Promise.all([
        employeeService.list({ organizationId, pageSize: 100 }),
        shiftService.listShifts(organizationId),
        shiftService.listAssignments({ organization_id: organizationId, from_date: fromDate, to_date: toDate }),
        shiftService.listWeeklyOffs(organizationId),
        shiftService.getWeeklySummary({ organization_id: organizationId, from_date: fromDate, to_date: toDate }),
      ]);

      setEmployees(empResult.rows);
      setShifts(shiftList);
      setAssignments(rawAssignments);
      setSummaries(summary);

      // Build weeklyOffs map: employeeId → weekday[]
      const offMap: Record<string, number[]> = {};
      for (const off of offs) {
        (offMap[off.employee_id] ??= []).push(off.weekday);
      }
      setWeeklyOffs(offMap);

      // Conflict detection
      const detected = await shiftService.detectConflicts({
        organization_id: organizationId,
        from_date: fromDate,
        to_date: toDate,
      });
      setConflicts(detected);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load schedule data.');
    } finally {
      setLoading(false);
    }
  }, [supabaseReady, organizationId, fromDate, toDate]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // ── Helpers ──────────────────────────────────
  /** Find assignment for an employee on a specific work_date. */
  const getAssignment = useCallback(
    (employeeId: string, workDate: string): ShiftAssignmentRow | undefined => {
      return assignments.find(a => a.employee_id === employeeId && a.work_date === workDate);
    },
    [assignments],
  );

  /** Find ShiftRow by ID. */
  const getShift = useCallback(
    (shiftId: string | null): ShiftRow | undefined => {
      if (!shiftId) return undefined;
      return shifts.find(s => s.id === shiftId);
    },
    [shifts],
  );

  /** Returns a display badge for a given assignment. */
  const getCellDisplay = useCallback(
    (employeeId: string, workDate: string): { label: string; abbr: string; c: ReturnType<typeof shiftBadgeColor>; shiftId: string | null; status: 'scheduled' | 'off' | 'leave' | 'cancelled' } => {
      const a = getAssignment(employeeId, workDate);
      if (!a || a.status === 'off') return { label: 'OFF', abbr: '—', c: SHIFT_COLORS.OFF, shiftId: null, status: 'off' };
      if (a.status === 'leave') return { label: 'Leave', abbr: 'L', c: SHIFT_COLORS.Leave, shiftId: null, status: 'leave' };
      if (a.status === 'cancelled') return { label: 'Cancelled', abbr: '✕', c: SHIFT_COLORS.OFF, shiftId: null, status: 'cancelled' };
      const shift = getShift(a.shift_id);
      if (!shift) return { label: 'Scheduled', abbr: 'S', c: SHIFT_COLORS.Day, shiftId: a.shift_id, status: 'scheduled' };
      const c = shiftBadgeColor(shift);
      const abbr = shift.crosses_midnight ? 'N' : 'D';
      return { label: shift.name, abbr, c, shiftId: a.shift_id, status: 'scheduled' };
    },
    [getAssignment, getShift],
  );

  // ── Mock cycle (no Supabase) ─────────────────
  const cycleMockShift = (empName: string, dayIdx: number) => {
    const cycle: Record<string, string> = { Day: 'Night', Night: 'OFF', OFF: 'Leave', Leave: 'Day' };
    setMockAssignments(prev => {
      const days = [...(prev[empName] ?? [])];
      days[dayIdx] = cycle[days[dayIdx]] ?? 'Day';
      return { ...prev, [empName]: days };
    });
  };

  // ── Navigation ──────────────────────────────
  const prevWeek = () => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; });
  const nextWeek = () => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; });
  const goToday = () => setWeekStart(getMondayOfWeek(new Date()));

  // ── Monthly view helpers ─────────────────────
  const monthDates = useMemo(() => {
    const year = weekStart.getFullYear();
    const month = weekStart.getMonth();
    const days: Date[] = [];
    const d = new Date(year, month, 1);
    while (d.getMonth() === month) {
      days.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    return days;
  }, [weekStart]);

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  const dayCount = supabaseReady
    ? summaries.find(s => !s.shift.crosses_midnight)?.employeeCount ?? 0
    : Object.values(mockAssignments).flat().filter(v => v === 'Day').length;

  const nightCount = supabaseReady
    ? summaries.find(s => s.shift.crosses_midnight)?.employeeCount ?? 0
    : Object.values(mockAssignments).flat().filter(v => v === 'Night').length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Shift Scheduler</h1>
          <p className="text-sm mt-0.5" style={{ color: '#4b6a8a' }}>
            {supabaseReady
              ? 'Click a cell to edit — changes saved to Supabase'
              : 'Preview mode — click any cell to cycle: Day → Night → OFF → Leave'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: '#1e3a5a' }}>
            {(['daily', 'weekly', 'monthly'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="px-3 py-2 text-xs capitalize transition-all"
                style={{ background: view === v ? '#2563eb' : '#0d1b2e', color: view === v ? '#fff' : '#4b6a8a' }}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Panel toggles */}
          <button
            onClick={() => setRightPanel(p => p === 'templates' ? null : 'templates')}
            className="px-3 py-2 rounded-lg text-xs transition-all"
            style={{
              background: rightPanel === 'templates' ? 'rgba(37,99,235,0.2)' : '#0d1b2e',
              color: rightPanel === 'templates' ? '#93c5fd' : '#4b6a8a',
              border: '1px solid #1e3a5a',
            }}
          >
            Templates
          </button>
          <button
            onClick={() => setRightPanel(p => p === 'conflicts' ? null : 'conflicts')}
            className="px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 transition-all"
            style={{
              background: rightPanel === 'conflicts' ? 'rgba(245,158,11,0.1)' : '#0d1b2e',
              color: conflicts.length ? '#f59e0b' : '#4b6a8a',
              border: `1px solid ${conflicts.length ? 'rgba(245,158,11,0.4)' : '#1e3a5a'}`,
            }}
          >
            {conflicts.length > 0 && <AlertTriangle size={12} />}
            Conflicts {conflicts.length > 0 ? `(${conflicts.length})` : ''}
          </button>

          <button
            onClick={() => { setEditingShift(null); setShowShiftModal(true); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: '#2563eb', color: '#fff' }}
          >
            <Plus size={14} /> New Shift
          </button>
        </div>
      </div>

      {/* Error */}
      {error && <ErrorBanner message={error} onRetry={() => void loadData()} />}

      {/* Conflicts */}
      {supabaseReady && <ConflictsBanner conflicts={conflicts} />}

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap">
        {supabaseReady
          ? shifts.map(s => {
              const c = shiftBadgeColor(s);
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm" style={{ background: c.bg, border: `1px solid ${c.border}` }} />
                  <span className="text-xs" style={{ color: '#94a3b8' }}>
                    {s.name} {formatTime12(s.start_time)}–{formatTime12(s.end_time)}{s.crosses_midnight ? ' (+1d)' : ''}
                  </span>
                </div>
              );
            })
          : Object.entries(SHIFT_COLORS).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm" style={{ background: v.bg, border: `1px solid ${v.border}` }} />
                <span className="text-xs" style={{ color: '#94a3b8' }}>
                  {k === 'OFF' ? 'Day Off' : k === 'Day' ? 'Day 09:00–17:00' : k === 'Night' ? 'Night 21:00–05:00 (+1d)' : 'Leave'}
                </span>
              </div>
            ))}
      </div>

      {/* Week nav */}
      <div className="flex items-center gap-3">
        <button onClick={prevWeek} className="p-2 rounded-lg transition-colors hover:bg-white/5" style={{ border: '1px solid #1e3a5a' }}>
          <ChevronLeft size={14} style={{ color: '#94a3b8' }} />
        </button>
        <div className="text-sm font-semibold text-white">{weekLabel}</div>
        <button onClick={nextWeek} className="p-2 rounded-lg transition-colors hover:bg-white/5" style={{ border: '1px solid #1e3a5a' }}>
          <ChevronRight size={14} style={{ color: '#94a3b8' }} />
        </button>
        <button onClick={goToday} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: '#94a3b8' }}>
          Today
        </button>
        {supabaseReady && (
          <button onClick={() => void loadData()} disabled={loading} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" style={{ border: '1px solid #1e3a5a', color: '#4b6a8a' }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {/* Main content with optional right panel */}
      <div className={`flex gap-4 ${rightPanel ? 'items-start' : ''}`}>
        <div className="flex-1 min-w-0 space-y-4">
          {/* ────────────────────────── WEEKLY VIEW */}
          {view === 'weekly' && (
            <>
              {loading ? (
                <LoadingSpinner />
              ) : (
                <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3a5a' }}>
                  <table className="w-full">
                    <thead>
                      <tr style={{ background: '#122338' }}>
                        <th className="text-left px-4 py-3 text-xs font-semibold" style={{ color: '#4b6a8a', width: 160 }}>
                          Employee
                        </th>
                        {weekDates.map(iso => {
                          const { day, num, isToday } = formatDateHeader(iso);
                          return (
                            <th key={iso} className="text-center px-2 py-3 text-xs font-semibold" style={{ color: isToday ? '#3b82f6' : '#4b6a8a' }}>
                              <div>{day}</div>
                              <div style={{ color: isToday ? '#3b82f6' : '#94a3b8', fontWeight: isToday ? 700 : 400 }}>{num}</div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {supabaseReady
                        ? employees.map((emp, i) => (
                            <tr key={emp.id} className="border-t" style={{ borderColor: '#1e3a5a', background: i % 2 === 0 ? 'transparent' : 'rgba(18,35,56,0.3)' }}>
                              <td className="px-4 py-2">
                                <div className="text-xs font-medium text-white">{emp.full_name}</div>
                                <div className="text-xs" style={{ color: '#4b6a8a' }}>{emp.job_title ?? 'Employee'}</div>
                              </td>
                              {weekDates.map(iso => {
                                const cell = getCellDisplay(emp.id, iso);
                                return (
                                  <td key={iso} className="px-2 py-2 text-center">
                                    <button
                                      onClick={() => setCellModal({
                                        employee: emp,
                                        workDate: iso,
                                        currentShiftId: cell.shiftId,
                                        currentStatus: cell.status,
                                      })}
                                      className="rounded-md px-2 py-1.5 text-xs font-medium w-full transition-all hover:opacity-80 active:scale-95"
                                      title={`${cell.label} — click to edit`}
                                      style={{ background: cell.c.bg, color: cell.c.color, border: `1px solid ${cell.c.border}30`, cursor: 'pointer' }}
                                    >
                                      {cell.abbr}
                                    </button>
                                  </td>
                                );
                              })}
                            </tr>
                          ))
                        : Object.entries(mockAssignments).map(([name, days], i) => (
                            <tr key={name} className="border-t" style={{ borderColor: '#1e3a5a', background: i % 2 === 0 ? 'transparent' : 'rgba(18,35,56,0.3)' }}>
                              <td className="px-4 py-2">
                                <div className="text-xs font-medium text-white">{name}</div>
                                <div className="text-xs" style={{ color: '#4b6a8a' }}>
                                  {['Mailroom', 'Warehouse', 'Mailroom', 'Operations', 'Warehouse', 'Mailroom', 'Operations', 'Warehouse'][i]}
                                </div>
                              </td>
                              {days.map((shift, j) => {
                                const s = SHIFT_COLORS[shift] ?? SHIFT_COLORS.OFF;
                                return (
                                  <td key={j} className="px-2 py-2 text-center">
                                    <button
                                      onClick={() => cycleMockShift(name, j)}
                                      className="rounded-md px-2 py-1.5 text-xs font-medium w-full transition-all hover:opacity-80 active:scale-95"
                                      title="Click to cycle: Day → Night → OFF → Leave"
                                      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}30`, cursor: 'pointer' }}
                                    >
                                      {shift === 'Day' ? 'D' : shift === 'Night' ? 'N' : shift === 'Leave' ? 'L' : '—'}
                                    </button>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ────────────────────────── DAILY VIEW */}
          {view === 'daily' && (
            <div className="rounded-xl p-6" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
              <div className="font-semibold text-white mb-4">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} — Daily View
              </div>
              {loading ? (
                <LoadingSpinner />
              ) : (
                <div className="space-y-2">
                  {supabaseReady
                    ? employees.map(emp => {
                        const today = toISODate(new Date());
                        const cell = getCellDisplay(emp.id, today);
                        return (
                          <div key={emp.id} className="flex items-center gap-3 p-3 rounded-lg" style={{ background: '#122338' }}>
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg,#2563eb,#06b6d4)' }}>
                              {emp.full_name.slice(0, 1)}
                            </div>
                            <div className="text-xs font-medium text-white w-36 truncate">{emp.full_name}</div>
                            <button
                              onClick={() => setCellModal({ employee: emp, workDate: today, currentShiftId: cell.shiftId, currentStatus: cell.status })}
                              className="px-3 py-1 rounded text-xs font-medium transition-opacity hover:opacity-80"
                              style={{ background: cell.c.bg, color: cell.c.color, border: `1px solid ${cell.c.border}30` }}
                            >
                              {cell.label}
                            </button>
                            <div className="text-xs" style={{ color: '#4b6a8a' }}>
                              {cell.status === 'scheduled' && cell.shiftId
                                ? (() => { const s = getShift(cell.shiftId); return s ? `${formatTime12(s.start_time)} – ${formatTime12(s.end_time)}${s.crosses_midnight ? ' (+1d)' : ''}` : '—'; })()
                                : '—'}
                            </div>
                          </div>
                        );
                      })
                    : Object.entries(mockAssignments).map(([name, days]) => {
                        const shift = days[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1];
                        const s = SHIFT_COLORS[shift] ?? SHIFT_COLORS.OFF;
                        return (
                          <div key={name} className="flex items-center gap-3 p-3 rounded-lg" style={{ background: '#122338' }}>
                            <div className="text-xs font-medium text-white w-36">{name}</div>
                            <span className="px-3 py-1 rounded text-xs font-medium" style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}30` }}>{shift}</span>
                            <div className="text-xs" style={{ color: '#4b6a8a' }}>
                              {shift === 'Day' ? '09:00 – 17:00' : shift === 'Night' ? '21:00 – 05:00 (+1d)' : '—'}
                            </div>
                          </div>
                        );
                      })}
                </div>
              )}
            </div>
          )}

          {/* ────────────────────────── MONTHLY VIEW */}
          {view === 'monthly' && (
            <div className="rounded-xl p-5" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
              <div className="font-semibold text-white mb-4">
                {weekStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} — Monthly Summary
              </div>
              {loading ? (
                <LoadingSpinner />
              ) : (
                <div className="grid grid-cols-4 gap-3">
                  {supabaseReady
                    ? employees.map(emp => {
                        const empAssignments = assignments.filter(a => a.employee_id === emp.id);
                        const dc = empAssignments.filter(a => a.status === 'scheduled' && !getShift(a.shift_id)?.crosses_midnight).length;
                        const nc = empAssignments.filter(a => a.status === 'scheduled' && getShift(a.shift_id)?.crosses_midnight).length;
                        const oc = empAssignments.filter(a => a.status === 'off').length;
                        const lc = empAssignments.filter(a => a.status === 'leave').length;
                        return (
                          <div key={emp.id} className="p-3 rounded-lg" style={{ background: '#122338' }}>
                            <div className="text-xs font-semibold text-white mb-2 truncate">{emp.full_name}</div>
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs"><span style={{ color: '#3b82f6' }}>Day</span><span className="font-mono" style={{ color: '#f0f6ff' }}>{dc}d</span></div>
                              <div className="flex justify-between text-xs"><span style={{ color: '#8b5cf6' }}>Night</span><span className="font-mono" style={{ color: '#f0f6ff' }}>{nc}d</span></div>
                              <div className="flex justify-between text-xs"><span style={{ color: '#4b6a8a' }}>Off</span><span className="font-mono" style={{ color: '#f0f6ff' }}>{oc}d</span></div>
                              <div className="flex justify-between text-xs"><span style={{ color: '#f59e0b' }}>Leave</span><span className="font-mono" style={{ color: '#f0f6ff' }}>{lc}d</span></div>
                            </div>
                          </div>
                        );
                      })
                    : Object.entries(mockAssignments).map(([name, days]) => {
                        const dc = days.filter(d => d === 'Day').length;
                        const nc = days.filter(d => d === 'Night').length;
                        const oc = days.filter(d => d === 'OFF').length;
                        return (
                          <div key={name} className="p-3 rounded-lg" style={{ background: '#122338' }}>
                            <div className="text-xs font-semibold text-white mb-2 truncate">{name}</div>
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs"><span style={{ color: '#3b82f6' }}>Day</span><span className="font-mono" style={{ color: '#f0f6ff' }}>{dc * 4}d</span></div>
                              <div className="flex justify-between text-xs"><span style={{ color: '#8b5cf6' }}>Night</span><span className="font-mono" style={{ color: '#f0f6ff' }}>{nc * 4}d</span></div>
                              <div className="flex justify-between text-xs"><span style={{ color: '#4b6a8a' }}>Off</span><span className="font-mono" style={{ color: '#f0f6ff' }}>{oc * 4}d</span></div>
                            </div>
                          </div>
                        );
                      })}
                </div>
              )}
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
              <div className="flex items-center gap-2 mb-3">
                <Sun size={14} style={{ color: '#2563eb' }} />
                <div className="font-semibold text-sm text-white">Day Shift · 09:00 AM – 05:00 PM</div>
              </div>
              <div className="text-3xl font-bold font-mono" style={{ color: '#3b82f6' }}>{dayCount}</div>
              <div className="text-xs mt-1" style={{ color: '#4b6a8a' }}>employees scheduled this week</div>
            </div>
            <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
              <div className="flex items-center gap-2 mb-3">
                <Moon size={14} style={{ color: '#8b5cf6' }} />
                <div className="font-semibold text-sm text-white">Night Shift · 09:00 PM – 05:00 AM (+1 day)</div>
              </div>
              <div className="text-3xl font-bold font-mono" style={{ color: '#8b5cf6' }}>{nightCount}</div>
              <div className="text-xs mt-1" style={{ color: '#4b6a8a' }}>employees scheduled this week</div>
            </div>
          </div>
        </div>

        {/* ────── Right Panel ─────────────────────── */}
        {rightPanel && (
          <div className="w-72 flex-shrink-0 space-y-3">
            {/* Panel header */}
            <div
              className="flex items-center justify-between px-4 py-3 rounded-xl"
              style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}
            >
              <div className="text-sm font-semibold text-white capitalize">{rightPanel.replace('-', ' ')}</div>
              <button onClick={() => setRightPanel(null)} aria-label="Close shift details" style={{ color: '#4b6a8a' }}><X size={14} /></button>
            </div>

            {/* Templates Panel */}
            {rightPanel === 'templates' && (
              <div className="space-y-2">
                {shifts.map(s => (
                  <ShiftTemplateCard
                    key={s.id}
                    shift={s}
                    onEdit={sh => { setEditingShift(sh); setShowShiftModal(true); }}
                    onDelete={id => {
                      if (!supabaseReady) { setError('Supabase is not configured.'); return; }
                      void shiftService.deactivateShift(id).then(() => void loadData());
                    }}
                  />
                ))}
                <button
                  onClick={() => { setEditingShift(null); setShowShiftModal(true); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm transition-colors"
                  style={{ background: 'rgba(37,99,235,0.1)', color: '#93c5fd', border: '1px dashed #2563eb' }}
                >
                  <Plus size={14} /> Add Template
                </button>
              </div>
            )}

            {/* Conflicts Panel */}
            {rightPanel === 'conflicts' && (
              <div className="space-y-2">
                {conflicts.length === 0 ? (
                  <div className="flex flex-col items-center py-8 gap-2" style={{ color: '#4b6a8a' }}>
                    <CheckCircle size={24} style={{ color: '#10b981' }} />
                    <div className="text-sm text-center">No conflicts detected for this week</div>
                  </div>
                ) : (
                  conflicts.map((c, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-xl"
                      style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={13} style={{ color: '#f59e0b', marginTop: 1, flexShrink: 0 }} />
                        <div>
                          <div className="text-xs font-semibold" style={{ color: '#fcd34d' }}>{c.workDate}</div>
                          <div className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>{c.reason}</div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {showShiftModal && (
        <ShiftModal
          initial={editingShift}
          organizationId={organizationId || 'mock'}
          onSaved={saved => {
            setShifts(prev => {
              const idx = prev.findIndex(s => s.id === saved.id);
              return idx >= 0
                ? prev.map((s, i) => i === idx ? saved : s)
                : [...prev.filter(s => s.template_key !== saved.template_key), saved];
            });
          }}
          onClose={() => { setShowShiftModal(false); setEditingShift(null); }}
        />
      )}

      {cellModal && supabaseReady && (
        <CellAssignModal
          employee={cellModal.employee}
          workDate={cellModal.workDate}
          currentShiftId={cellModal.currentShiftId}
          currentStatus={cellModal.currentStatus}
          shifts={shifts}
          organizationId={organizationId}
          userId={user?.id ?? null}
          onSaved={() => void loadData()}
          onClose={() => setCellModal(null)}
        />
      )}
    </div>
  );
}
