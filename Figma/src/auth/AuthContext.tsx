import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { authService } from '../services/auth.service';
import { identityService } from '../services/identity.service';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';
import { toAppError, type AppError } from '../lib/errors';
import type { AppRole, EmployeeProfileRow, OrganizationMembershipRow, UserRow } from '../types/database';
import { hasAnyRole as userHasAnyRole, hasPermission, type Permission } from './access-control';

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: UserRow | null;
  employeeProfile: EmployeeProfileRow | null;
  memberships: OrganizationMembershipRow[];
  activeMembership: OrganizationMembershipRow | null;
  roles: AppRole[];
  error: AppError | null;
  setActiveOrganization: (organizationId: string) => void;
  refreshAuthorization: () => Promise<void>;
  signOut: () => Promise<void>;
  hasAnyRole: (allowedRoles: readonly AppRole[]) => boolean;
  hasPermission: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const [loading, setLoading] = useState(configured);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserRow | null>(null);
  const [employeeProfile, setEmployeeProfile] = useState<EmployeeProfileRow | null>(null);
  const [memberships, setMemberships] = useState<OrganizationMembershipRow[]>([]);
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  // Tracks whose authorization is currently loaded, so a redundant SIGNED_IN
  // event (Supabase fires one each time the tab regains focus) doesn't trigger
  // a reload that would flip `loading` back on and unmount the app shell.
  const loadedUserIdRef = useRef<string | null>(null);

  const clearAuthorization = useCallback(() => {
    loadedUserIdRef.current = null;
    setProfile(null);
    setEmployeeProfile(null);
    setMemberships([]);
    setActiveOrganizationId(null);
  }, []);

  const loadAuthorization = useCallback(async (userId: string) => {
    loadedUserIdRef.current = userId;
    const [nextProfile, nextMemberships] = await Promise.all([
      identityService.getProfile(userId),
      identityService.getMemberships(userId),
    ]);

    const selectedOrganizationId = nextMemberships[0]?.organization_id ?? null;
    const nextEmployeeProfile = selectedOrganizationId
      ? await identityService.getEmployeeProfile(userId, selectedOrganizationId)
      : null;

    setProfile(nextProfile);
    setEmployeeProfile(nextEmployeeProfile);
    setMemberships(nextMemberships);
    setActiveOrganizationId(selectedOrganizationId);
  }, []);

  const refreshAuthorization = useCallback(async () => {
    if (!session?.user.id) return;
    setError(null);
    try {
      await loadAuthorization(session.user.id);
    } catch (caught) {
      const nextError = toAppError(caught, 'Unable to load authorization data.');
      setError(nextError);
      throw nextError;
    }
  }, [loadAuthorization, session?.user.id]);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }

    let mounted = true;
    const client = getSupabaseClient();

    void authService
      .getVerifiedSession()
      .then(async nextSession => {
        if (!mounted) return;
        setSession(nextSession);
        if (nextSession) await loadAuthorization(nextSession.user.id);
        else clearAuthorization();
      })
      .catch(caught => {
        if (mounted) setError(toAppError(caught, 'Unable to restore the session.'));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      if (event === 'INITIAL_SESSION') return;

      setSession(nextSession);
      setError(null);
      if (!nextSession) {
        clearAuthorization();
        setLoading(false);
        return;
      }

      if (event === 'TOKEN_REFRESHED') return;

      // Supabase re-emits SIGNED_IN whenever the tab regains focus/visibility.
      // If it's the same user we've already loaded, skip the reload — flipping
      // `loading` on here unmounts the app shell and discards in-progress form
      // state (e.g. a half-typed employee record).
      if (nextSession.user.id === loadedUserIdRef.current) return;

      setLoading(true);
      queueMicrotask(() => {
        void loadAuthorization(nextSession.user.id)
          .catch(caught => {
            if (mounted) setError(toAppError(caught, 'Unable to load authorization data.'));
          })
          .finally(() => {
            if (mounted) setLoading(false);
          });
      });
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [clearAuthorization, configured, loadAuthorization]);

  const activeMembership = useMemo(
    () => memberships.find(item => item.organization_id === activeOrganizationId) ?? null,
    [activeOrganizationId, memberships],
  );

  const roles = useMemo<AppRole[]>(() => {
    if (!activeOrganizationId) return [];
    return memberships
      .filter(item => item.organization_id === activeOrganizationId)
      .map(item => item.role_code);
  }, [activeOrganizationId, memberships]);

  const signOut = useCallback(async () => {
    setError(null);
    try {
      await authService.signOut();
    } catch (caught) {
      const nextError = toAppError(caught, 'Unable to sign out.');
      setError(nextError);
      throw nextError;
    }
  }, []);

  const setActiveOrganization = useCallback((organizationId: string) => {
    if (!session?.user.id || !memberships.some(item => item.organization_id === organizationId)) return;

    setActiveOrganizationId(organizationId);
    setEmployeeProfile(null);
    void identityService
      .getEmployeeProfile(session.user.id, organizationId)
      .then(setEmployeeProfile)
      .catch(caught => setError(toAppError(caught, 'Unable to load the employee profile.')));
  }, [memberships, session?.user.id]);

  const value = useMemo<AuthContextValue>(() => {
    const fallbackRoles: AppRole[] = [];
    const activeRoles = configured ? roles : fallbackRoles;
    
    return {
      configured,
      loading,
      session,
      user: session?.user ?? null,
      profile,
      employeeProfile,
      memberships,
      activeMembership,
      roles: activeRoles,
      error,
      setActiveOrganization,
      refreshAuthorization,
      signOut,
      hasAnyRole: allowedRoles => userHasAnyRole(activeRoles, allowedRoles),
      hasPermission: permission => hasPermission(activeRoles, permission),
    };
  }, [
    activeMembership,
    configured,
    employeeProfile,
    error,
    loading,
    memberships,
    profile,
    refreshAuthorization,
    roles,
    session,
    setActiveOrganization,
    signOut,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider.');
  return context;
}
