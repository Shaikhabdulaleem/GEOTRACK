import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseClient } from '../lib/supabase';
import { toAppError } from '../lib/errors';
import { getAuthRedirectUrl } from '../lib/env';

export interface PasswordSignInInput {
  email: string;
  password: string;
}

export interface PasswordResetInput {
  email: string;
  redirectTo?: string;
}

/** Result of provisioning a field-staff login. The temporary password is
 * returned exactly once and must be handed to the employee; it is never stored
 * and cannot be retrieved again. */
export interface EmployeeAccountCredentials {
  identifier: string;
  email?: string;
  temporary_password: string;
  status: string;
}

export const authService = {
  async signInWithPassword(input: PasswordSignInInput): Promise<Session> {
    const { data, error } = await getSupabaseClient().auth.signInWithPassword(input);
    if (error) throw toAppError(error, 'Unable to sign in.');
    if (!data.session) throw toAppError(null, 'Authentication completed without a session.');
    return data.session;
  },

  async signOut(): Promise<void> {
    const { error } = await getSupabaseClient().auth.signOut({ scope: 'local' });
    if (error) throw toAppError(error, 'Unable to sign out.');
  },

  async getSession(): Promise<Session | null> {
    const { data, error } = await getSupabaseClient().auth.getSession();
    if (error) throw toAppError(error, 'Unable to restore the session.');
    return data.session;
  },

  /**
   * Restores the cached session only after Supabase Auth has validated the
   * access token server-side. UI authorization must not trust local storage.
   */
  async getVerifiedSession(): Promise<Session | null> {
    const session = await this.getSession();
    if (!session) return null;

    const user = await this.getVerifiedUser();
    if (!user || user.id !== session.user.id) {
      await getSupabaseClient().auth.signOut({ scope: 'local' });
      return null;
    }

    return { ...session, user };
  },

  async getVerifiedUser(): Promise<User | null> {
    const { data, error } = await getSupabaseClient().auth.getUser();
    if (error) throw toAppError(error, 'Unable to validate the current user.');
    return data.user;
  },

  async requestPasswordReset(input: PasswordResetInput): Promise<void> {
    const { error } = await getSupabaseClient().auth.resetPasswordForEmail(input.email, {
      redirectTo: input.redirectTo ?? getAuthRedirectUrl(),
    });
    if (error) throw toAppError(error, 'Unable to request a password reset.');
  },

  async updatePassword(password: string): Promise<void> {
    const { error } = await getSupabaseClient().auth.updateUser({ password });
    if (error) throw toAppError(error, 'Unable to update the password.');
  },

  /** Creates a login account for a field employee who has no mailbox. The
   * trusted Auth Admin worker mints a synthetic email and a one-time temporary
   * password, which is returned here so the administrator can hand it to the
   * employee. The password is not stored anywhere. */
  async provisionEmployeeAccount(employeeId: string): Promise<EmployeeAccountCredentials> {
    const { data, error } = await getSupabaseClient().functions.invoke('provision-employee', {
      body: { employee_id: employeeId },
    });
    if (error) throw toAppError(error, 'Unable to create the login account.');
    return data as EmployeeAccountCredentials;
  },

  /** Issues a NEW one-time temporary password for an employee who forgot theirs.
   * The old password is never revealed; the employee must change the new one on
   * next sign-in. Callable by scoped managers and administrators. */
  async resetEmployeeAccount(employeeId: string): Promise<EmployeeAccountCredentials> {
    const { data, error } = await getSupabaseClient().functions.invoke('reset-employee-login', {
      body: { employee_id: employeeId },
    });
    if (error) throw toAppError(error, 'Unable to reset the login password.');
    return data as EmployeeAccountCredentials;
  },

  /** Clears the forced-change flag after the employee sets their own password. */
  async completePasswordChange(): Promise<void> {
    const { error } = await getSupabaseClient().rpc('complete_password_change');
    if (error) throw toAppError(error, 'Unable to finalize the password change.');
  },
};
