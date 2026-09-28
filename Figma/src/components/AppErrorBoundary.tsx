import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getErrorMessage } from '../lib/errors';
import { logger } from '../lib/logger';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('Unhandled application error', error, { componentStack: info.componentStack });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#060d1a' }}>
        <div className="max-w-md rounded-xl p-6 text-center" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
          <div className="text-lg font-bold text-white">Something went wrong</div>
          <p className="text-sm mt-2" style={{ color: '#94a3b8' }}>{getErrorMessage(this.state.error)}</p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.href = '/'}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ background: '#1e3a5a', color: '#fff' }}
            >
              Go to Home
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ background: '#2563eb', color: '#fff' }}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
