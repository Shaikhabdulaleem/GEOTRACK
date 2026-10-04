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

export interface EmployeeInvitation {
  id: string;
  employee_id: string;
  organization_id: string;
  invited_at: string;
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

  /** Records an invitation request. Delivery and account creation happen in
   * the trusted Auth Admin worker; the browser never receives credentials. */
  async requestEmployeeInvitation(employeeId: string, email: string): Promise<EmployeeInvitation> {
    const { data, error } = await getSupabaseClient().functions.invoke('provision-employee', {
      body: { employee_id: employeeId, email: email.trim().toLowerCase() },
    });
    if (error) throw toAppError(error, 'Unable to send the account invitation.');
    return data as EmployeeInvitation;
  },
};
