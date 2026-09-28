import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { LayoutDashboard, Users, CalendarDays, Clock, TrendingUp, Timer, Smartphone, MapPin, FileText, Bell, Settings, Radio, LogOut, Shield, Plane, Menu, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import type { ViewId } from '../auth/view-access';
import type { AppRole } from '../types/database';

const nav: ReadonlyArray<{ id: ViewId; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Dashboard',      icon: LayoutDashboard },
  { id: 'live',      label: 'Live Attendance', icon: Radio },
  { id: 'employees', label: 'Employees',       icon: Users },
  { id: 'scheduler', label: 'Shift Scheduler', icon: CalendarDays },
  { id: 'attendance',label: 'Attendance',      icon: Clock },
  { id: 'leave',     label: 'Leave Requests',  icon: Plane },
  { id: 'productivity',label:'Productivity',   icon: TrendingUp },
  { id: 'overtime',  label: 'Overtime',        icon: Timer },
  { id: 'device',    label: 'Device Usage',    icon: Smartphone },
  { id: 'geofences', label: 'Geofences',       icon: MapPin },
  { id: 'reports',   label: 'Reports',         icon: FileText },
  { id: 'notifications',label:'Notifications', icon: Bell },
  { id: 'mobile',    label: 'Mobile App',      icon: Shield },
  { id: 'settings',  label: 'Settings',        icon: Settings },
];

const roleLabels: Readonly<Record<AppRole, string>> = {
  administrator: 'Administrator',
  manager: 'Manager',
  employee: 'Employee',
};

export default function Sidebar({ active, onNav, allowedViews }: { active: ViewId; onNav: (id: ViewId) => void; allowedViews: readonly ViewId[] }) {
  const { profile, user, roles, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const displayName = profile?.display_name || user?.email || 'Signed-in user';
  const initials = displayName.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
  const roleLabel = roles.map(role => roleLabels[role]).join(', ');

  if (roles.length === 0) {
    return <Navigate to="/unauthorized" replace />;
  }
  const logout = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      // AuthContext retains the user-facing error while the current session remains active.
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed left-4 top-4 z-40 p-2 rounded-lg"
        style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: '#f0f6ff' }}
        aria-label="Open navigation"
        aria-expanded={mobileOpen}
        aria-controls="primary-navigation"
      >
        <Menu size={18} />
      </button>
      {mobileOpen && (
        <button
          type="button"
          className="lg:hidden fixed inset-0 z-20"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <aside
        id="primary-navigation"
        className={`${mobileOpen ? 'flex' : 'hidden'} lg:flex fixed left-0 top-0 h-full w-56 flex-col z-30`}
        style={{ background: '#08111f', borderRight: '1px solid #1e3a5a' }}
      >
      <div className="px-4 py-5 border-b" style={{ borderColor: '#1e3a5a' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #2563eb, #06b6d4)' }}>
            <MapPin size={14} className="text-white" />
          </div>
          <div>
            <div className="text-xs font-bold tracking-wider text-white">GEOTRACK</div>
            <div className="text-xs" style={{ color: '#4b6a8a', fontSize: '10px' }}>Workforce Platform</div>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="lg:hidden ml-auto p-1.5 rounded-lg"
            style={{ color: '#94a3b8' }}
            aria-label="Close navigation"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <nav className="flex-1 py-3 overflow-y-auto">
        {nav.filter(item => allowedViews.includes(item.id)).map(item => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => { onNav(item.id); setMobileOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all group"
              style={{
                background: isActive ? 'rgba(37,99,235,0.15)' : 'transparent',
                borderRight: isActive ? '2px solid #2563eb' : '2px solid transparent',
                color: isActive ? '#f0f6ff' : '#4b6a8a',
              }}
            >
              <Icon size={15} style={{ color: isActive ? '#3b82f6' : '#4b6a8a' }} />
              <span className="text-sm font-medium" style={{ letterSpacing: '0.01em' }}>{item.label}</span>
              {item.id === 'live' && (
                <span className="ml-auto w-2 h-2 rounded-full animate-pulse-slow" style={{ background: '#10b981' }}></span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t" style={{ borderColor: '#1e3a5a' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: 'linear-gradient(135deg,#2563eb,#06b6d4)' }}>
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-white truncate">{displayName}</div>
            <div className="text-xs truncate" style={{ color: '#4b6a8a', fontSize: '10px' }}>{roleLabel}</div>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            disabled={signingOut}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: '#4b6a8a', background: 'transparent' }}
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={13} />
          </button>
        </div>
      </div>
      </aside>
    </>
  );
}
