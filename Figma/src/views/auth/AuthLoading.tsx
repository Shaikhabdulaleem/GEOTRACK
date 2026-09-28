import { MapPin } from 'lucide-react';

export default function AuthLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#060d1a' }}>
      <div className="text-center" role="status" aria-live="polite">
        <div
          className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #2563eb, #06b6d4)' }}
        >
          <MapPin size={24} className="text-white" />
        </div>
        <div className="text-sm font-semibold text-white">Loading your workspace</div>
        <div className="mt-3 flex justify-center gap-1.5" aria-hidden="true">
          {[0, 1, 2].map(index => (
            <span
              key={index}
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ background: '#3b82f6', animationDelay: `${index * 160}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
