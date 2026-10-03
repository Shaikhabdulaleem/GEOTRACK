import type { AppRole } from '../types/database';

export const ROLE_PRIORITY: Readonly<Record<AppRole, number>> = Object.freeze({
  employee: 1,
  manager: 2,
  administrator: 3,
});

export type Permission =
  | 'profile:read:self'
  | 'schedule:read:self'
  | 'attendance:read:self'
  | 'attendance:check:self'
  | 'attendance:request:self'
  | 'overtime:read:self'
  | 'productivity:read:self'
  | 'notifications:read:self'
  | 'leave:request:self'
  | 'workforce:read:scope'
  | 'attendance:manage:scope'
  | 'shifts:manage:scope'
  | 'productivity:read:scope'
  | 'reports:read:scope'
  | 'geofences:read:scope'
  | 'leave:manage:scope'
  | 'overtime:manage:scope'
  | 'organization:manage'
  | 'audit:read';

export const ROLE_PERMISSIONS: Readonly<Record<AppRole, readonly Permission[]>> = Object.freeze({
  employee: [
    'profile:read:self',
    'schedule:read:self',
    'attendance:read:self',
    'attendance:check:self',
    'attendance:request:self',
    'overtime:read:self',
    'productivity:read:self',
    'notifications:read:self',
    'leave:request:self',
  ],
  manager: [
    'profile:read:self',
    'schedule:read:self',
    'attendance:read:self',
    'attendance:check:self',
    'attendance:request:self',
    'overtime:read:self',
    'productivity:read:self',
    'notifications:read:self',
    'leave:request:self',
    'workforce:read:scope',
    'attendance:manage:scope',
    'shifts:manage:scope',
    'productivity:read:scope',
    'reports:read:scope',
    'geofences:read:scope',
    'leave:manage:scope',
    'overtime:manage:scope',
    'organization:manage',
  ],
  administrator: [
    'profile:read:self',
    'schedule:read:self',
    'attendance:read:self',
    'attendance:check:self',
    'attendance:request:self',
    'overtime:read:self',
    'productivity:read:self',
    'notifications:read:self',
    'leave:request:self',
    'workforce:read:scope',
    'attendance:manage:scope',
    'shifts:manage:scope',
    'productivity:read:scope',
    'reports:read:scope',
    'geofences:read:scope',
    'leave:manage:scope',
    'overtime:manage:scope',
    'organization:manage',
    'audit:read',
  ],
});

export function hasAnyRole(userRoles: readonly AppRole[], allowedRoles: readonly AppRole[]): boolean {
  return allowedRoles.some(role => userRoles.includes(role));
}

export function hasMinimumRole(userRoles: readonly AppRole[], minimumRole: AppRole): boolean {
  return userRoles.some(role => ROLE_PRIORITY[role] >= ROLE_PRIORITY[minimumRole]);
}

export function hasPermission(userRoles: readonly AppRole[], permission: Permission): boolean {
  return userRoles.some(role => ROLE_PERMISSIONS[role].includes(permission));
}
