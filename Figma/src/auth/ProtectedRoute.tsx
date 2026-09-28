import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { AppRole } from '../types/database';
import { useAuth } from './AuthContext';

export interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: readonly AppRole[];
  signInPath?: string;
  unauthorizedPath?: string;
  loadingFallback?: ReactNode;
  configurationFallback?: ReactNode;
}

export function ProtectedRoute({
  children,
  allowedRoles,
  signInPath = '/sign-in',
  unauthorizedPath = '/unauthorized',
  loadingFallback = null,
  configurationFallback = null,
}: ProtectedRouteProps) {
  const location = useLocation();
  const { configured, loading, session, hasAnyRole } = useAuth();

  if (!configured) return <Navigate to={signInPath} replace state={{ from: location }} />;
  if (loading) return <>{loadingFallback}</>;
  if (!session) return <Navigate to={signInPath} replace state={{ from: location }} />;

  if (allowedRoles?.length && !hasAnyRole(allowedRoles)) {
    return <Navigate to={unauthorizedPath} replace />;
  }

  return <>{children}</>;
}

export function RoleGuard({
  children,
  allowedRoles,
  fallback = null,
}: {
  children: ReactNode;
  allowedRoles: readonly AppRole[];
  fallback?: ReactNode;
}) {
  const { hasAnyRole } = useAuth();
  return hasAnyRole(allowedRoles) ? <>{children}</> : <>{fallback}</>;
}
