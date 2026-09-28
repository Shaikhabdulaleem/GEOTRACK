interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'w-6 h-6 text-[9px]',
  md: 'w-7 h-7 text-[10px]',
  lg: 'w-12 h-12 text-sm',
} as const;

/** A network-free avatar that does not disclose employee identifiers to third parties. */
export default function Avatar({ name, size = 'md', className = '' }: AvatarProps) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0] ?? '')
    .join('')
    .toUpperCase() || '?';

  return (
    <span
      className={`${sizeClasses[size]} ${className} flex-shrink-0 rounded-full inline-flex items-center justify-center font-bold text-white`}
      style={{ background: 'linear-gradient(135deg,#2563eb,#06b6d4)' }}
      role="img"
      aria-label={name}
    >
      {initials}
    </span>
  );
}
