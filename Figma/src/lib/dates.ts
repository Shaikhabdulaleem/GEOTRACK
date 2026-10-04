/** Calendar date in the organization's IANA timezone. Database timestamps
 * remain UTC; only operational date labels/windows use this helper. */
export function todayInTimezone(timeZone = 'Asia/Riyadh', now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
