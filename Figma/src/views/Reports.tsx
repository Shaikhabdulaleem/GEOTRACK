import { useState, useEffect } from 'react';
import { FileText, FileSpreadsheet, FileType, CheckCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { todayInTimezone } from '../lib/dates';
import { isSupabaseConfigured } from '../lib/supabase';
import { reportService, type ReportFormat } from '../services/report.service';
import { employeeService } from '../services/employee.service';
import { getErrorMessage } from '../lib/errors';

const reports = [
  { id: 'attendance_report', name: 'Attendance Report', desc: 'Detailed check-in/out and status records', category: 'Attendance', lastGen: 'Dynamic' },
  { id: 'employee_attendance_history', name: 'Employee Attendance History', desc: 'Full history of employee attendance events', category: 'Attendance', lastGen: 'Dynamic' },
  { id: 'late_attendance', name: 'Late Attendance Report', desc: 'Records flagged as late arrivals', category: 'Attendance', lastGen: 'Dynamic' },
  { id: 'absence', name: 'Absence Report', desc: 'Employees marked as absent', category: 'Attendance', lastGen: 'Dynamic' },
  { id: 'missing_attendance', name: 'Missing Attendance Report', desc: 'Missing check-ins or check-outs', category: 'Compliance', lastGen: 'Dynamic' },
  { id: 'shift_report', name: 'Shift Report', desc: 'Scheduled shifts and coverage details', category: 'Scheduling', lastGen: 'Dynamic' },
  { id: 'overtime_report', name: 'Overtime Report', desc: 'Approved and pending overtime hours', category: 'Hours', lastGen: 'Dynamic' },
  { id: 'productivity_report', name: 'Productivity Report', desc: 'Output vs targets and rankings', category: 'Productivity', lastGen: 'Dynamic' },
  { id: 'geofence_exceptions', name: 'Geofence Exceptions Report', desc: 'Location spoofing or out-of-bounds checks', category: 'Compliance', lastGen: 'Dynamic' },
  { id: 'employee_working_hours', name: 'Employee Working Hours', desc: 'Total worked hours per employee', category: 'Hours', lastGen: 'Dynamic' }
];

const CATEGORY_COLORS: Record<string, string> = {
  Attendance: '#3b82f6', Hours: '#8b5cf6', Scheduling: '#06b6d4',
  Productivity: '#10b981', Compliance: '#ef4444',
};

export default function Reports() {
  const { activeMembership } = useAuth();
  const organizationId = activeMembership?.organization_id ?? '';
  const supabaseReady = isSupabaseConfigured();

  // Filters
  const today = todayInTimezone('Asia/Riyadh');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [filterBranchId, setFilterBranchId] = useState('');
  const [filterDeptId, setFilterDeptId] = useState('');
  const [filterShiftId, setFilterShiftId] = useState('');
  const [filterManagerId, setFilterManagerId] = useState('');
  const [filterEmployeeId, setFilterEmployeeId] = useState('');

  // Dropdown Options
  const [branches, setBranches] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [employeeProfiles, setEmployeeProfiles] = useState<any[]>([]);

  const [downloading, setDownloading] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState('All');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabaseReady || !organizationId) return;
    const initLookups = async () => {
      const { getSupabaseClient } = await import('../lib/supabase');
      const client = getSupabaseClient();
      const [br, dep, sh, empData] = await Promise.all([
        client.from('branches').select('id, name').eq('organization_id', organizationId),
        client.from('departments').select('id, name').eq('organization_id', organizationId),
        client.from('shifts').select('id, name').eq('organization_id', organizationId),
        employeeService.listAll({ organizationId })
      ]);
      setBranches(br.data || []);
      setDepartments(dep.data || []);
      setShifts(sh.data || []);
      
      const emps = empData || [];
      setEmployeeProfiles(emps);
      
      const mgrIds = [...new Set(emps.map(e => e.manager_user_id).filter(Boolean))] as string[];
      setManagers(mgrIds.map(id => {
        const e = emps.find(x => x.user_id === id);
        return { id, name: e ? e.full_name : `Manager ${id.substring(0,6)}` };
      }));
    };
    initLookups();
  }, [supabaseReady, organizationId]);

  const categories = ['All', ...Array.from(new Set(reports.map(r => r.category)))];
  const filtered = reports.filter(r => catFilter === 'All' || r.category === catFilter);

  const handleDownload = async (reportId: string, format: string) => {
    if (!supabaseReady) {
      setError('Supabase is not configured. Configure the production environment before generating reports.');
      return;
    }
    const key = `${reportId}|${format}`;
    setDownloading(key);
    setError(null);
    
    try {
      await reportService.generateReport(organizationId, reportId, {
        fromDate,
        toDate,
        branchId: filterBranchId || undefined,
        departmentId: filterDeptId || undefined,
        shiftId: filterShiftId || undefined,
        managerId: filterManagerId || undefined,
        employeeId: filterEmployeeId || undefined
      }, format as ReportFormat);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to generate the report.'));
    } finally {
      setTimeout(() => setDownloading(null), 500); // Visual delay for success state
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Reports</h1>
          <p className="text-sm mt-0.5" style={{ color: '#4b6a8a' }}>Generate and download workforce reports</p>
        </div>
      </div>

      {error && <div className="rounded-xl px-4 py-3 text-sm" role="alert" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>{error}</div>}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap p-4 rounded-xl" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
        <div className="flex items-center gap-2">
          <label className="text-xs" style={{ color: '#4b6a8a' }}>From:</label>
          <input type="date" className="px-3 py-1.5 rounded text-xs outline-none" style={{ background: '#122338', border: '1px solid #1e3a5a', color: '#f0f6ff' }}
            value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs" style={{ color: '#4b6a8a' }}>To:</label>
          <input type="date" className="px-3 py-1.5 rounded text-xs outline-none" style={{ background: '#122338', border: '1px solid #1e3a5a', color: '#f0f6ff' }}
            value={toDate} onChange={e => setToDate(e.target.value)} />
        </div>
        <select className="px-3 py-1.5 rounded text-xs outline-none cursor-pointer flex-shrink-0"
          style={{ background: '#122338', border: '1px solid #1e3a5a', color: filterBranchId ? '#3b82f6' : '#f0f6ff' }}
          value={filterBranchId} onChange={e => setFilterBranchId(e.target.value)}>
          <option value="">All Sites</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="px-3 py-1.5 rounded text-xs outline-none cursor-pointer flex-shrink-0"
          style={{ background: '#122338', border: '1px solid #1e3a5a', color: filterDeptId ? '#8b5cf6' : '#f0f6ff' }}
          value={filterDeptId} onChange={e => setFilterDeptId(e.target.value)}>
          <option value="">All Departments</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="px-3 py-1.5 rounded text-xs outline-none cursor-pointer flex-shrink-0"
          style={{ background: '#122338', border: '1px solid #1e3a5a', color: filterShiftId ? '#10b981' : '#f0f6ff' }}
          value={filterShiftId} onChange={e => setFilterShiftId(e.target.value)}>
          <option value="">All Shifts</option>
          {shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="px-3 py-1.5 rounded text-xs outline-none cursor-pointer flex-shrink-0"
          style={{ background: '#122338', border: '1px solid #1e3a5a', color: filterManagerId ? '#f59e0b' : '#f0f6ff' }}
          value={filterManagerId} onChange={e => setFilterManagerId(e.target.value)}>
          <option value="">All Managers</option>
          {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select className="px-3 py-1.5 rounded text-xs outline-none cursor-pointer flex-shrink-0"
          style={{ background: '#122338', border: '1px solid #1e3a5a', color: filterEmployeeId ? '#ef4444' : '#f0f6ff' }}
          value={filterEmployeeId} onChange={e => setFilterEmployeeId(e.target.value)}>
          <option value="">All Employees</option>
          {employeeProfiles.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
      </div>

      {/* Category filter */}
      <div className="flex gap-1 flex-wrap">
        {categories.map(c => {
          const color = CATEGORY_COLORS[c] ?? '#4b6a8a';
          return (
            <button key={c} onClick={() => setCatFilter(c)} className="text-xs px-3 py-1.5 rounded-lg transition-all"
              style={{ background: catFilter === c ? `${color}20` : '#0d1b2e', color: catFilter === c ? color : '#4b6a8a', border: `1px solid ${catFilter === c ? color : '#1e3a5a'}` }}>
              {c}
            </button>
          );
        })}
      </div>

      {/* Report cards */}
      <div className="grid grid-cols-2 gap-3">
        {filtered.map((rep, i) => {
          const catColor = CATEGORY_COLORS[rep.category] ?? '#4b6a8a';
          const excelKey = `${rep.id}|Excel`;
          const pdfKey = `${rep.id}|PDF`;
          return (
            <div key={i} className="rounded-xl p-4 transition-all hover:border-blue-800 card-glow" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg mt-0.5" style={{ background: `${catColor}18` }}>
                    <FileText size={14} style={{ color: catColor }} />
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-white">{rep.name}</div>
                    <div className="text-xs mt-0.5" style={{ color: '#4b6a8a' }}>{rep.desc}</div>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs px-2 py-0.5 rounded-md" style={{ background: `${catColor}18`, color: catColor }}>{rep.category}</span>
                      <span className="text-xs" style={{ color: '#4b6a8a' }}>Last: {rep.lastGen}</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-1.5 flex-shrink-0 ml-2">
                  <button
                    onClick={() => handleDownload(rep.id, 'Excel')}
                    disabled={downloading !== null}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium transition-all hover:opacity-80"
                    style={{ background: downloading === excelKey ? 'rgba(16,185,129,0.3)' : 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}
                  >
                    {downloading === excelKey ? <CheckCircle size={11} /> : downloading !== null ? <Loader2 size={11} className="animate-spin" /> : <FileSpreadsheet size={11} />}
                    {downloading === excelKey ? 'Done' : 'Excel'}
                  </button>
                  <button
                    onClick={() => handleDownload(rep.id, 'PDF')}
                    disabled={downloading !== null}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium transition-all hover:opacity-80"
                    style={{ background: downloading === pdfKey ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}
                  >
                    {downloading === pdfKey ? <CheckCircle size={11} /> : downloading !== null ? <Loader2 size={11} className="animate-spin" /> : <FileType size={11} />}
                    {downloading === pdfKey ? 'Done' : 'PDF'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
