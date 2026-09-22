import { RecurringFrequency, RECURRING_FREQUENCY_LABELS, RECURRING_FREQUENCY_UNIT_LABELS } from './models';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Coerces a possibly-missing/garbage `RecurringTransaction.interval` into a
 * definite positive integer, defaulting to 1 (plain "every day/week/month/
 * year") - run on every write path (`StateService.addRecurring`/
 * `updateRecurring`, and legacy-file migration) so nothing downstream ever
 * has to re-check it. */
export function normalizeInterval(interval: number | undefined): number {
  const n = Math.floor(Number(interval));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** The day-of-month component of a `YYYY-MM-DD` string, used to seed/refresh
 * `RecurringTransaction.anchorDay` whenever `nextDate` is explicitly set by
 * a person (see `anchorDay`'s doc comment on the interface). Falls back to
 * 1 for a missing/malformed date rather than `NaN`. */
export function anchorDayOf(dateStr: string | undefined): number {
  const day = Number(dateStr?.split('-')[2]);
  return Number.isFinite(day) && day >= 1 && day <= 31 ? day : 1;
}

/** The next occurrence date after `dateStr`, stepped forward by `interval`
 * `frequency` units - what `StateService.triggerRecurring`/
 * `triggerAllRecurring` advance a recurring item's `nextDate` to once it's
 * been added to Transactions, so it's ready for the following occurrence
 * without a manual date edit. `interval` defaults to 1 (a plain "every
 * day/week/month/year") and is otherwise normalized the same way
 * `normalizeInterval` does, so an already-invalid stored value can't step
 * backwards or by zero.
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
 * `monthly`/`yearly` land on `anchorDay` (falling back to `dateStr`'s own
 * day when omitted), clamped to the target month's actual last day rather
 * than left to `Date`'s own month-end rollover (which would otherwise
 * silently spill into the following month - e.g. Jan 31 + 1 month would
 * become Mar 3 in a non-leap year, by way of an invalid "Feb 31"). Clamping
 * against `anchorDay` specifically - not just the day the previous step
 * happened to land on - is what lets an item anchored to the 31st keep
 * aiming for the 31st every time: Jan 31 -> Feb 28/29 (clamped) -> Mar 31
 * (back to the real anchor, not stuck at 28), same idea for a Feb 29 yearly
 * anchor landing on Feb 28 only in non-leap years. `reports.ts`'s
 * `endOfMonth` uses the same "day 0 of next month" trick to find a month's
 * last day. */
export function nextOccurrenceDate(
  dateStr: string,
  frequency: RecurringFrequency,
  interval?: number,
  anchorDay?: number,
): string {
  const [y, m, day] = dateStr.split('-').map(Number);
  const n = normalizeInterval(interval);
  const targetDay = anchorDay ?? day;
  const d = new Date(y, (m || 1) - 1, day || 1);

  switch (frequency) {
    case 'daily':
      d.setDate(d.getDate() + n);
      return toDateStr(d);
    case 'weekly':
      d.setDate(d.getDate() + 7 * n);
      return toDateStr(d);
    case 'monthly':
    case 'yearly': {
      const monthsAhead = frequency === 'monthly' ? n : n * 12;
      // Step to the 1st of the target month first, so the step itself can
      // never spill into a different month than intended (see doc comment).
      const stepped = new Date(y, (m || 1) - 1 + monthsAhead, 1);
      const lastDayOfTargetMonth = new Date(stepped.getFullYear(), stepped.getMonth() + 1, 0).getDate();
      stepped.setDate(Math.min(targetDay, lastDayOfTargetMonth));
      return toDateStr(stepped);
    }
  }
}

/** Singular/plural unit label for `frequency` matching `interval` - "Day"
 * for 1, "Days" for anything else - what the Add/Edit form's frequency
 * buttons show (e.g. "Every 2 [Weeks]"). */
export function frequencyUnitLabel(frequency: RecurringFrequency, interval: number): string {
  const [singular, plural] = RECURRING_FREQUENCY_UNIT_LABELS[frequency];
  return normalizeInterval(interval) === 1 ? singular : plural;
}

/** Human sentence for a recurrence - `RECURRING_FREQUENCY_LABELS[frequency]`
 * ("Weekly") when `interval` is 1, or "Every N ___" ("Every 2 Weeks", "Every
 * 3 Months") otherwise. Single source of truth for the Recurring page's
 * card captions and the Add/Edit form's live preview line. */
export function recurrenceLabel(frequency: RecurringFrequency, interval: number | undefined): string {
  const n = normalizeInterval(interval);
  if (n === 1) return RECURRING_FREQUENCY_LABELS[frequency];
  return `Every ${n} ${frequencyUnitLabel(frequency, n).toLowerCase()}`;
}
