import type { AppRole } from '../types/database';

export const VIEW_IDS = [
  'dashboard',
  'live',
  'employees',
  'managers',
  'scheduler',
  'attendance',
  'corrections',
  'leave',
  'productivity',
  'overtime',
  'device',
  'device-approvals',
  'geofences',
  'reports',
  'notifications',
  'mobile',
  'settings',
] as const;

export type ViewId = (typeof VIEW_IDS)[number];

export const VIEW_ROLES: Readonly<Record<ViewId, readonly AppRole[]>> = Object.freeze({
  dashboard: ['administrator', 'manager'],
  live: ['administrator', 'manager'],
  employees: ['administrator', 'manager'],
  managers: ['administrator'],
  scheduler: ['administrator', 'manager'],
  attendance: ['administrator', 'manager'],
  corrections: ['administrator', 'manager'],
  leave: ['administrator'],
  productivity: ['administrator', 'manager'],
  overtime: ['administrator', 'manager'],
  device: ['administrator'],
  'device-approvals': ['administrator'],
  geofences: ['administrator', 'manager'],
  reports: ['administrator', 'manager'],
  notifications: ['administrator', 'manager', 'employee'],
  mobile: ['administrator', 'manager', 'employee'],
  settings: ['administrator'],
});

export function canAccessView(roles: readonly AppRole[], view: ViewId): boolean {
  return VIEW_ROLES[view].some(role => roles.includes(role));
}

export function getDefaultView(roles: readonly AppRole[]): ViewId {
  return roles.includes('employee') && !roles.some(role => role === 'administrator' || role === 'manager')
    ? 'mobile'
    : 'dashboard';
}

export function getAllowedViews(roles: readonly AppRole[]): ViewId[] {
  return VIEW_IDS.filter(view => canAccessView(roles, view));
}
