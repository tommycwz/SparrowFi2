import { RecurringFrequency } from './models';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** The next occurrence date after `dateStr`, stepped forward by one
 * `frequency` unit - what `StateService.triggerRecurring`/
 * `triggerAllRecurring` advance a recurring item's `nextDate` to once it's
 * been added to Transactions, so it's ready for the following occurrence
 * without a manual date edit.
 *
 * Deliberately parses/builds the date from its Y/M/D parts with the
 * explicit-numeric-args `Date` constructor rather than `new Date(dateStr)`
 * (or a `T00:00:00`-suffixed string) plus `.toISOString()` - both of those
 * route the value through a UTC instant at some point, which can silently
 * shift the calendar day by one depending on the browser's local timezone
 * offset. Constructing and reading back through local getters only avoids
 * that class of bug entirely (the same technique `reports.ts`'s
 * `shiftMonthKey`/`endOfMonth` already use for month-key arithmetic).
 *
 * Like `fdMaturityDate`'s month-stepping, a monthly/yearly step off the
 * 29th-31st can land on a shorter month's overflow day (e.g. Jan 31 +
 * 1 month -> Mar 3 in a non-leap year) - the same simplification already
 * accepted there, rather than special-casing month-end clamping. */
export function nextOccurrenceDate(dateStr: string, frequency: RecurringFrequency): string {
  const [y, m, day] = dateStr.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1, day || 1);
  switch (frequency) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
