import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import AppErrorBoundary from '../components/AppErrorBoundary';

export default function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <AuthProvider>{children}</AuthProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
