export interface TransferDurationCalculation {
  rawMinutes: number;
  breakMinutes: number;
  netMinutes: number;
  hours: number;
  display: string;
}

export function calculateTransferDuration(
  startTime: string | Date,
  endTime: string | Date | null | undefined,
  breakMinutes: number = 0,
): TransferDurationCalculation {
  const start = typeof startTime === 'string' ? new Date(startTime).getTime() : startTime.getTime();
  const end = endTime
    ? (typeof endTime === 'string' ? new Date(endTime).getTime() : endTime.getTime())
    : Date.now();

  const diffMs = Math.max(0, end - start);
  const rawMinutes = Math.floor(diffMs / 60000);
  const netMinutes = Math.max(0, rawMinutes - Math.max(0, breakMinutes));
  const hours = Math.round((netMinutes / 60) * 100) / 100;
  const h = Math.floor(netMinutes / 60);
  const m = netMinutes % 60;
  const display = `${h}h ${m}m`;

  return { rawMinutes, breakMinutes, netMinutes, hours, display };
}
