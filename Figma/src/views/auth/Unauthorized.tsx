import { AlertTriangle, LogOut, MapPin, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { getErrorMessage } from '../../lib/errors';

export default function Unauthorized() {
  const navigate = useNavigate();
  const { profile, memberships, error: authorizationError, refreshAuthorization, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    setBusy(true);
    setError('');
    try {
      await refreshAuthorization();
      navigate('/', { replace: true });
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    setError('');
    try {
      await signOut();
    } catch (caught) {
      setError(getErrorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#060d1a' }}>
      <div className="w-full max-w-md rounded-3xl p-7 text-center" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(245,158,11,0.12)' }}>
            <AlertTriangle size={26} style={{ color: '#f59e0b' }} />
          </div>
        </div>
        <div className="flex items-center justify-center gap-2 mb-2">
          <MapPin size={15} style={{ color: '#3b82f6' }} />
          <h1 className="font-bold text-white">Access not available</h1>
        </div>
        <p className="text-xs leading-5" style={{ color: '#94a3b8' }}>
          {memberships.length === 0
            ? 'Your account is authenticated, but it has no active organization role. Ask an administrator to assign your account.'
            : 'Your assigned role does not permit access to this area.'}
        </p>
        {profile?.email && <div className="text-xs font-mono mt-3" style={{ color: '#4b6a8a' }}>{profile.email}</div>}
        {(error || authorizationError) && (
          <div className="mt-4 text-xs rounded-xl p-3 text-left" style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.08)' }} role="alert">
            {error || authorizationError?.message}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 mt-6">
          <button onClick={refresh} disabled={busy} className="py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2" style={{ background: '#122338', color: '#93c5fd' }}>
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Retry access
          </button>
          <button onClick={logout} disabled={busy} className="py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
