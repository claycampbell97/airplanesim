// Number and text formatting for the interface.

/** $1.24M, $350k, $12.3B — compact money with a sign for negatives. */
export function money(n: number, digits?: number): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(digits ?? 2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(digits ?? (a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2))}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(digits ?? (a >= 1e5 ? 0 : 1))}k`;
  return `${sign}$${a.toFixed(0)}`;
}

/** Money with an explicit + for gains. */
export function signedMoney(n: number): string {
  return n > 0 ? `+${money(n)}` : money(n);
}

/** Exact dollars with thousands separators: $1,234. */
export function dollars(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}

/** 1,284 / 12.9K / 4.2M */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${sign}${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return `${sign}${Math.round(a).toLocaleString('en-US')}`;
}

export function integer(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';
}

export function percent(fraction: number, digits = 0): string {
  return Number.isFinite(fraction) ? `${(fraction * 100).toFixed(digits)}%` : '—';
}

export function signedPercent(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return '—';
  const v = (fraction * 100).toFixed(digits);
  return fraction > 0 ? `+${v}%` : `${v.replace('-', '−')}%`;
}

export function km(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')} km`;
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${integer(n)} ${Math.round(n) === 1 ? word : pluralWord}`;
}

/** "2h 05m" from minutes. */
export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Sum of a triple. */
export function sum3(t: readonly number[]): number {
  return t[0] + t[1] + t[2];
}
