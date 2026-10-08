import { useState, type FormEvent } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { authService } from '../../services/auth.service';
import { getErrorMessage } from '../../lib/errors';

/**
 * Blocking screen shown when the signed-in employee still holds a temporary
 * password (employee_profiles.must_change_password). They cannot reach the app
 * until they set their own password. After updating it we clear the flag via
 * complete_password_change and refresh authorization so the gate releases.
 */
export default function ForcePasswordChange() {
  const { refreshAuthorization, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (password.length < 12) {
      setError('Use at least 12 characters for your new password.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await authService.updatePassword(password);
      await authService.completePasswordChange();
      // Releases this gate by reloading the employee profile (flag now false).
      await refreshAuthorization();
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#060d1a' }}>
      <div className="w-full max-w-sm rounded-3xl p-6" style={{ background: '#0a0f1a', border: '2px solid #1e3a5a', boxShadow: '0 0 40px rgba(37,99,235,0.15)' }}>
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #2563eb, #06b6d4)' }}>
            <ShieldCheck size={24} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-white">Create your password</h1>
          <p className="text-xs mt-1" style={{ color: '#4b6a8a' }}>
            You signed in with a temporary password. Set your own to continue.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="new-password" className="text-xs block mb-1.5" style={{ color: '#4b6a8a' }}>New password</label>
            <div className="relative">
              <LockKeyhole size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: '#4b6a8a' }} />
              <input id="new-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={event => { setPassword(event.target.value); setError(''); }} className="w-full rounded-xl py-3 pl-10 pr-10 text-sm" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: '#f0f6ff', outline: 'none' }} />
              <button type="button" onClick={() => setShowPassword(value => !value)} className="absolute right-3.5 top-1/2 -translate-y-1/2" style={{ color: '#4b6a8a' }} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            </div>
            <p className="text-[11px] mt-1.5" style={{ color: '#4b6a8a' }}>At least 12 characters.</p>
          </div>
          <div>
            <label htmlFor="confirm-password" className="text-xs block mb-1.5" style={{ color: '#4b6a8a' }}>Confirm password</label>
            <input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={event => { setConfirm(event.target.value); setError(''); }} className="w-full rounded-xl px-3.5 py-3 text-sm" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: '#f0f6ff', outline: 'none' }} />
          </div>
          {error && <div className="rounded-xl p-3 flex gap-2 text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }} role="alert"><AlertCircle size={15} /> {error}</div>}
          <button type="submit" disabled={submitting} className="w-full py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2" style={{ background: '#2563eb', color: '#fff', opacity: submitting ? 0.65 : 1 }}>
            {submitting && <Loader2 size={16} className="animate-spin" />} Save and continue
          </button>
          <button type="button" onClick={() => void signOut()} className="w-full py-2 text-xs" style={{ color: '#4b6a8a' }}>
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
