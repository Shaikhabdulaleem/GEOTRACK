import { useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle, Eye, EyeOff, Loader2, LockKeyhole, MapPin } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { authService } from '../../services/auth.service';
import { getErrorMessage } from '../../lib/errors';
import AuthLoading from './AuthLoading';
import ConfigurationRequired from './ConfigurationRequired';

export default function ResetPassword() {
  const { configured, loading, session, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  if (!configured) return <ConfigurationRequired />;
  if (loading) return <AuthLoading />;

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
      await signOut();
      setDone(true);
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
            <MapPin size={24} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-white">Set a new password</h1>
          <p className="text-xs mt-1" style={{ color: '#4b6a8a' }}>Secure your GEOTRACK account.</p>
        </div>

        {done ? (
          <div className="text-center">
            <CheckCircle size={32} className="mx-auto mb-3" style={{ color: '#10b981' }} />
            <div className="text-sm font-semibold text-white">Password updated</div>
            <p className="text-xs mt-1 mb-5" style={{ color: '#94a3b8' }}>Sign in again with your new password.</p>
            <Link to="/sign-in" className="block w-full py-3 rounded-2xl text-sm font-bold" style={{ background: '#2563eb', color: '#fff' }}>Return to sign in</Link>
          </div>
        ) : !session ? (
          <div className="text-center">
            <AlertCircle size={30} className="mx-auto mb-3" style={{ color: '#f59e0b' }} />
            <div className="text-sm font-semibold text-white">Reset link required</div>
            <p className="text-xs mt-1 mb-5" style={{ color: '#94a3b8' }}>Open the latest password reset link sent to your email.</p>
            <Link to="/sign-in" className="block w-full py-3 rounded-2xl text-sm font-bold" style={{ background: '#122338', color: '#93c5fd' }}>Return to sign in</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="new-password" className="text-xs block mb-1.5" style={{ color: '#4b6a8a' }}>New password</label>
              <div className="relative">
                <LockKeyhole size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: '#4b6a8a' }} />
                <input id="new-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={event => { setPassword(event.target.value); setError(''); }} className="w-full rounded-xl py-3 pl-10 pr-10 text-sm" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: '#f0f6ff', outline: 'none' }} />
                <button type="button" onClick={() => setShowPassword(value => !value)} className="absolute right-3.5 top-1/2 -translate-y-1/2" style={{ color: '#4b6a8a' }} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              </div>
            </div>
            <div>
              <label htmlFor="confirm-password" className="text-xs block mb-1.5" style={{ color: '#4b6a8a' }}>Confirm password</label>
              <input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={event => { setConfirm(event.target.value); setError(''); }} className="w-full rounded-xl px-3.5 py-3 text-sm" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a', color: '#f0f6ff', outline: 'none' }} />
            </div>
            {error && <div className="rounded-xl p-3 flex gap-2 text-xs" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }} role="alert"><AlertCircle size={15} /> {error}</div>}
            <button type="submit" disabled={submitting} className="w-full py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2" style={{ background: '#2563eb', color: '#fff', opacity: submitting ? 0.65 : 1 }}>
              {submitting && <Loader2 size={16} className="animate-spin" />} Update password
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
