// Game clock. Time is measured in minutes since the epoch below (UTC).

export const EPOCH_MS = Date.UTC(2027, 0, 1, 0, 0, 0);
export const MIN_PER_DAY = 1440;
export const START_YEAR = 2027;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function toDate(time: number): Date {
  return new Date(EPOCH_MS + time * 60000);
}

export function dayIndex(time: number): number {
  return Math.floor(time / MIN_PER_DAY);
}

/** Months elapsed since the epoch. */
export function monthIndex(time: number): number {
  const d = toDate(time);
  return (d.getUTCFullYear() - START_YEAR) * 12 + d.getUTCMonth();
}

/** Game time at the start of the given month index. */
export function monthStart(month: number): number {
  return (Date.UTC(START_YEAR + Math.floor(month / 12), ((month % 12) + 12) % 12, 1) - EPOCH_MS) / 60000;
}

/** 0..11 */
export function monthOfYear(time: number): number {
  return toDate(time).getUTCMonth();
}

/** Fraction of the year elapsed, 0..1 (for seasonality and the sun's declination). */
export function yearFraction(time: number): number {
  const d = toDate(time);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const end = Date.UTC(d.getUTCFullYear() + 1, 0, 1);
  return (d.getTime() - start) / (end - start);
}

/** Years elapsed since the epoch (fractional). */
export function yearsElapsed(time: number): number {
  return time / (365.25 * MIN_PER_DAY);
}

export function daysInMonth(month: number): number {
  return (monthStart(month + 1) - monthStart(month)) / MIN_PER_DAY;
}

export function formatDate(time: number): string {
  const d = toDate(time);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatDateLong(time: number): string {
  const d = toDate(time);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatClock(time: number): string {
  const d = toDate(time);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function formatMonth(month: number): string {
  return `${MONTHS[((month % 12) + 12) % 12]} ${START_YEAR + Math.floor(month / 12)}`;
}

export function formatMonthShort(month: number): string {
  return `${MONTHS[((month % 12) + 12) % 12]} ’${String((START_YEAR + Math.floor(month / 12)) % 100).padStart(2, '0')}`;
}

export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}
