/**
 * Small, pure display-formatting helpers shared by any page that renders a
 * transaction row (Dashboard, Transactions) - kept in one place so the date
 * badge / time pill / amount-number formatting never drifts between them.
 */

/** Stacked date-badge parts, e.g. { day: '08', month: 'SEP' } for '2026-09-08'. */
export function formatDateBadge(dateStr: string): { day: string; month: string } {
  const [, mo, day] = dateStr.split('-').map(Number);
  const month = new Date(2000, (mo || 1) - 1, 1).toLocaleDateString(undefined, { month: 'short' });
  return { day: String(day ?? '').padStart(2, '0'), month: month.toUpperCase() };
}

/** '13:05' -> '1:05 PM' for the pill time badge; null when there's no time to show. */
export function formatTimeBadge(time?: string): string | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Number part only (e.g. "1,234.50"), for the split-currency-symbol amount styling. */
export function formatAmountNumber(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 'YYYY-MM' for the given date (defaults to now) - the month-bucketing key
 * used for "this month" stats and CSV/month filters alike. */
export function monthKeyOf(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
