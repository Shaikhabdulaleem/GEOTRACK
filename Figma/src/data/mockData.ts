export const employees: any[] = [];
export const employeePasswords: Record<string, string> = {};
export interface MockGeofence {
  id: string;
  name: string;
  color: string;
  polygon: Array<[number, number]>;
  present: number;
  employees: number;
}

export const geofences: MockGeofence[] = [];
export const shifts: any[] = [];
export const alerts: any[] = [];
export const overtimeRecords: any[] = [];
export const attendanceTrend: any[] = [];
export const productivityTrend: any[] = [];
export const otTrend: any[] = [];
export const phoneUsageByDay: any[] = [];
export const productivityRanking: any[] = [];
export const correctionRequests: any[] = [];
export const scheduleData: any = { employees: [], days: [], assignments: {} };
export const sessionStore: Record<string, Array<{ sessionId: string; device: string; os: string; loginAt: string; logoutAt: string | null; active: boolean }>> = {};
export const leaveStore: Record<string, Array<{ id: string; status: string; submittedAt: string; typeColor: string; typeLabel: string; from: string; to: string; days: number; photoUrl?: string }>> = {};
export function getSessions(employeeId: string) {
  return sessionStore[employeeId] ?? [];
}
