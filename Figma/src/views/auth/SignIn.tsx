import { useState, type FormEvent } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2, LockKeyhole, Mail, MapPin } from 'lucide-react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { authService } from '../../services/auth.service';
import { getErrorMessage } from '../../lib/errors';
import AuthLoading from './AuthLoading';
import ConfigurationRequired from './ConfigurationRequired';

interface LocationState {
  from?: { pathname?: string };
}

const inputStyle = {
  width: '100%',
  padding: '11px 14px 11px 40px',
  borderRadius: 14,
  background: '#0d1b2e',
  border: '1px solid #1e3a5a',
  color: '#f0f6ff',
  fontSize: 14,
  outline: 'none',
} as const;

export default function SignIn() {
  const location = useLocation();
  const { configured, loading: authLoading, session } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!configured) return <ConfigurationRequired />;
  if (authLoading) return <AuthLoading />;

  if (session) {
    const state = location.state as LocationState | null;
    return <Navigate to={state?.from?.pathname || '/'} replace />;
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your work email and password.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await authService.signInWithPassword({ email: email.trim(), password });
    } catch (caught) {
      const message = getErrorMessage(caught);
      setError(/invalid login credentials/i.test(message) ? 'The email or password is incorrect.' : message);
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#060d1a' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div
            className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #2563eb, #06b6d4)' }}
          >
            <MapPin size={24} className="text-white" />
          </div>
          <div className="text-lg font-bold text-white tracking-tight">GEOTRACK</div>
          <div className="text-xs mt-0.5" style={{ color: '#4b6a8a' }}>Workforce Platform</div>
        </div>

        <form
          onSubmit={submit}
          className="rounded-3xl p-6 space-y-4"
          style={{ background: '#0a0f1a', border: '2px solid #1e3a5a', boxShadow: '0 0 40px rgba(37,99,235,0.15)' }}
        >
          <div>
            <div className="text-sm font-semibold text-white">Sign In</div>
            <div className="text-xs mt-1" style={{ color: '#4b6a8a' }}>Use your organization account to continue.</div>
          </div>

          <div>
            <label htmlFor="email" className="text-xs block mb-1.5" style={{ color: '#4b6a8a' }}>Work email</label>
            <div className="relative">
              <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: '#4b6a8a' }} />
              <input
                id="email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                onChange={event => { setEmail(event.target.value); setError(''); }}
                placeholder="name@company.com"
                style={{ ...inputStyle, borderColor: error ? '#ef4444' : '#1e3a5a' }}
                disabled={submitting}
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="text-xs block mb-1.5" style={{ color: '#4b6a8a' }}>Password</label>
            <div className="relative">
              <LockKeyhole size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: '#4b6a8a' }} />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={event => { setPassword(event.target.value); setError(''); }}
                style={{ ...inputStyle, paddingRight: 42, borderColor: error ? '#ef4444' : '#1e3a5a' }}
                disabled={submitting}
              />
              <button
                type="button"
                onClick={() => setShowPassword(value => !value)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2"
                style={{ color: '#4b6a8a' }}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {error && (
            <div
              className="rounded-xl p-3 flex gap-2 text-xs"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}
              role="alert"
            >
              <AlertCircle size={15} className="flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-opacity"
            style={{ background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: '#fff', opacity: submitting ? 0.65 : 1 }}
          >
            {submitting && <Loader2 size={16} className="animate-spin" />}
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
