import React, { Suspense, useEffect, useMemo } from 'react';
import { Navigate, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import SignIn from './views/auth/SignIn';
import Unauthorized from './views/auth/Unauthorized';
import ResetPassword from './views/auth/ResetPassword';
import AuthLoading from './views/auth/AuthLoading';
import ConfigurationRequired from './views/auth/ConfigurationRequired';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { useAuth } from './auth/AuthContext';
import { canAccessView, getAllowedViews, getDefaultView, VIEW_IDS, type ViewId } from './auth/view-access';
import type { AppRole } from './types/database';

const Dashboard = React.lazy(() => import('./views/Dashboard'));
const LiveAttendance = React.lazy(() => import('./views/LiveAttendance'));
const Employees = React.lazy(() => import('./views/Employees'));
const ShiftScheduler = React.lazy(() => import('./views/ShiftScheduler'));
const Attendance = React.lazy(() => import('./views/Attendance'));
const Productivity = React.lazy(() => import('./views/Productivity'));
const Overtime = React.lazy(() => import('./views/Overtime'));
const DeviceUsage = React.lazy(() => import('./views/DeviceUsage'));
const Geofences = React.lazy(() => import('./views/Geofences'));
const Reports = React.lazy(() => import('./views/Reports'));
const Notifications = React.lazy(() => import('./views/Notifications'));
const MyNotifications = React.lazy(() => import('./views/MyNotifications'));
const EmployeeSelfService = React.lazy(() => import('./views/EmployeeSelfService'));
const Settings = React.lazy(() => import('./views/Settings'));
const LeaveManagement = React.lazy(() => import('./views/LeaveManagement'));

type ViewComponent = React.ElementType;

const VIEWS: Record<ViewId, ViewComponent> = {
  dashboard: Dashboard,
  live: LiveAttendance,
  employees: Employees,
  scheduler: ShiftScheduler,
  attendance: Attendance,
  productivity: Productivity,
  overtime: Overtime,
  device: DeviceUsage,
  geofences: Geofences,
  reports: Reports,
  notifications: RoleAwareNotifications,
  leave: LeaveManagement,
  mobile: EmployeeSelfService,
  settings: Settings,
};

const APP_ROLES: readonly AppRole[] = ['administrator', 'manager', 'employee'];

function RoleAwareNotifications() {
  const { roles } = useAuth();
  const isEmployeeOnly = roles.includes('employee') && !roles.some(role => role === 'administrator' || role === 'manager');
  return isEmployeeOnly ? <MyNotifications /> : <Notifications />;
}

function ApplicationShell() {
  const { roles } = useAuth();
  const allowedViews = useMemo(() => getAllowedViews(roles), [roles]);
  const nav = useNavigate();
  const loc = useLocation();

  const pathSegments = loc.pathname.split('/').filter(Boolean);
  const pathView = pathSegments.length > 0 ? pathSegments[0] : '';
  const activeView: ViewId = (VIEW_IDS as readonly string[]).includes(pathView) 
    ? (pathView as ViewId) 
    : getDefaultView(roles);

  const navigateToView = (view: string) => {
    if ((VIEW_IDS as readonly string[]).includes(view)) nav(`/${view}`);
  };

  useEffect(() => {
    if (!canAccessView(roles, activeView) || loc.pathname === '/') {
      nav(`/${getDefaultView(roles)}`, { replace: true });
    }
  }, [activeView, roles, loc.pathname, nav]);

  const visibleView = canAccessView(roles, activeView) ? activeView : getDefaultView(roles);
  const View = VIEWS[visibleView];

  return (
    <div className="min-h-screen flex" style={{ background: '#060d1a' }}>
      <Sidebar active={visibleView} onNav={navigateToView} allowedViews={allowedViews} />
      <main className="flex-1 min-w-0 lg:ml-56 px-4 pb-4 pt-16 lg:p-6 overflow-y-auto min-h-screen">
        <Suspense fallback={<AuthLoading />}>
          <View onNav={navigateToView} />
        </Suspense>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/unauthorized"
        element={(
          <ProtectedRoute loadingFallback={<AuthLoading />} configurationFallback={<ConfigurationRequired />}>
            <Unauthorized />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/*"
        element={(
          <ProtectedRoute
            allowedRoles={APP_ROLES}
            loadingFallback={<AuthLoading />}
            configurationFallback={<ConfigurationRequired />}
          >
            <ApplicationShell />
          </ProtectedRoute>
        )}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
