import { useState } from 'react';
import {
  CalendarDays, CheckCircle, XCircle, ImageIcon, X,
  FileText, Eye, Clock, Users, Filter, ChevronDown, ChevronUp,
  AlertTriangle
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

export default function LeaveManagement() {
  const { activeMembership } = useAuth();
  
  return (
    <div className="space-y-5">
      {/* ── Page header ── */}
      <div>
        <h1 className="text-xl font-bold text-white">Leave Management</h1>
        <p className="text-sm mt-0.5" style={{ color: '#4b6a8a' }}>
          Review and action employee leave requests — approve, reject, and view supporting documents
        </p>
      </div>

      <div className="rounded-xl p-6 border flex gap-3 items-start" style={{ background: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.3)', color: '#f59e0b' }}>
        <AlertTriangle size={24} className="flex-shrink-0" />
        <div>
          <h3 className="font-semibold text-lg mb-1">Module Temporarily Disabled</h3>
          <p className="text-sm" style={{ color: '#fbbf24' }}>
            The Leave Management module is currently undergoing backend integration and has been disconnected from the mock data store. 
            Real data integration is planned for the next release phase.
          </p>
        </div>
      </div>
      
      {/* ── Empty state placeholder ── */}
      <div className="rounded-xl p-12 flex flex-col items-center gap-3"
        style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
        <FileText size={28} style={{ color: '#1e3a5a' }} />
        <div className="text-sm text-white">No requests available</div>
        <div className="text-xs text-center px-4" style={{ color: '#4b6a8a' }}>
          Leave requests will appear here once the backend service is fully connected.
        </div>
      </div>
    </div>
  );
}
