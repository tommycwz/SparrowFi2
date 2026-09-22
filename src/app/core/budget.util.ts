import { BudgetPeriod, Transaction } from './models';

/** 'YYYY-MM-DD' for the local `Date`'s year/month/day - built from local
 * date *parts* rather than a UTC-instant round-trip (`toISOString()` can
 * land on the wrong calendar day depending on the machine's timezone
 * offset), same discipline every other date helper in this app follows
 * (see `recurring.util.ts`). Shared by every function below. */
function dateToKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Monday-anchored start of the ISO week containing `d` (default: today),
 * as a 'YYYY-MM-DD' string. `Date.getDay()` returns 0 for Sunday, so
 * that's treated as 6 days after the preceding Monday rather than the
 * start of a new week. */
export function weekStartOf(d: Date = new Date()): string {
  const day = d.getDay(); // 0 (Sun) .. 6 (Sat)
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToMonday);
  return dateToKey(monday);
}

/** Shifts a 'YYYY-MM-DD' date string by `days` (positive or negative) via
 * local date-parts construction, same technique as `weekStartOf`. */
export function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return dateToKey(new Date(y, m - 1, d + days));
}

/** The inclusive `[startDate, endDate]` window (as 'YYYY-MM-DD' strings)
 * for one `period`, `offset` periods away from the one containing
 * `referenceDate` (default: today) - `offset: 0` is the current
 * day/week/month/year, `offset: -1` is the immediately preceding one, and
 * so on. The Budget page's page-level period tab picks `period`, and this
 * is what turns that choice into the two date ranges its "This ___"/
 * "Previous ___" columns each need (`expenseTotalForCategoryInRange`
 * below does the actual summing over whichever range comes out).
 *
 * `monthly`/`yearly` deliberately construct with a possibly out-of-range
 * month/day component (e.g. month `-1`) rather than pre-normalizing it -
 * `Date`'s constructor rolls that over into the correct adjacent
 * year/month on its own (`new Date(2026, -1, 1)` is December 2025), the
 * same normalization `nextOccurrenceDate` and this page's own
 * `shiftMonthKey` already lean on elsewhere in the app. */
export function periodRange(
  period: BudgetPeriod,
  offset: number,
  referenceDate: Date = new Date(),
): [start: string, end: string] {
  switch (period) {
    case 'daily': {
      const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate() + offset);
      const key = dateToKey(d);
      return [key, key];
    }
    case 'weekly': {
      const start = shiftDate(weekStartOf(referenceDate), offset * 7);
      return [start, shiftDate(start, 6)];
    }
    case 'monthly': {
      const y = referenceDate.getFullYear();
      const m = referenceDate.getMonth() + offset;
      const start = dateToKey(new Date(y, m, 1));
      // Day 0 of the *next* month is the last day of *this* one - same
      // "day 0" trick `nextOccurrenceDate` uses to find a month's length.
      const end = dateToKey(new Date(y, m + 1, 0));
      return [start, end];
    }
    case 'yearly': {
      const y = referenceDate.getFullYear() + offset;
      return [dateToKey(new Date(y, 0, 1)), dateToKey(new Date(y, 11, 31))];
    }
  }
}

/** Total amount of `type: 'expense'` transactions posted against one
 * category within an inclusive `[startDate, endDate]` range of
 * 'YYYY-MM-DD' dates - the "actual spend" half of the Budget page's
 * columns (the other half, the cap itself, is `Budget.amount` run through
 * `convertBudgetAmount`). Deliberately the same `type: 'expense'` scope
 * Dashboard's "Where It Went" donut uses (`dashboard.ts`'s
 * `categorySpend`) - commitments, income and transfers aren't the kind of
 * discretionary spend a budget caps. Plain lexicographic string comparison
 * is safe here since every `Transaction.date` is a zero-padded
 * 'YYYY-MM-DD'. */
export function expenseTotalForCategoryInRange(
  transactions: Transaction[],
  categoryId: string,
  startDate: string,
  endDate: string,
): number {
  let total = 0;
  for (const t of transactions) {
    if (t.type === 'expense' && t.categoryId === categoryId && t.date >= startDate && t.date <= endDate) {
      total += t.amount;
    }
  }
  return total;
}

/** Every write path for a `Budget` (`StateService.addBudget`/`updateBudget`,
 * and `migrateState`'s `normalizeBudget` for a legacy/pre-Weekly file) runs
 * `period` through this rather than trusting the caller - so a budget saved
 * before this field existed (`period: undefined`), or one with any other
 * invalid/unrecognized value, always ends up `'monthly'`, the cadence every
 * budget implicitly used before Weekly/Daily/Yearly support existed. Any
 * one of the four real periods otherwise passes through unchanged. */
export function normalizeBudgetPeriod(period: BudgetPeriod | undefined): BudgetPeriod {
  return period === 'daily' || period === 'weekly' || period === 'monthly' || period === 'yearly'
    ? period
    : 'monthly';
}

/** How many of one `period` make up a year - the shared conversion table
 * `convertBudgetAmount` is built from. Deliberately calendar-*average*
 * constants (365 days, 52 weeks) rather than a variable "days in this
 * particular month/year", so a Weekly or Daily cap converts to a stable
 * number that doesn't quietly drift depending on which real week/day it's
 * viewed from. `monthly`'s factor (12) is the one exact calendar fact here
 * - which is what keeps Monthly<->Yearly an exact x12 / /12 conversion (a
 * Monthly cap of 30 is always exactly a Yearly cap of 360, and vice versa
 * /12), matching how everyone actually thinks about months and years. */
const PERIODS_PER_YEAR: Record<BudgetPeriod, number> = {
  daily: 365,
  weekly: 52,
  monthly: 12,
  yearly: 1,
};

/** Converts a cap of `amount`, entered for one `fromPeriod`, into its
 * equivalent for any other `toPeriod` - what lets a single `Budget` be
 * entered in whichever period is most natural (a yearly insurance premium,
 * a monthly subscription, a weekly allowance, a daily coffee budget) and
 * still show up correctly no matter which period tab the Budget page is
 * currently viewing. Goes via an annualized total
 * (`amount * PERIODS_PER_YEAR[fromPeriod]`) rather than a direct
 * period-to-period ratio table, so there's exactly one conversion rule per
 * period instead of needing one for every *pair* of periods. Not rounded -
 * callers display the result through `formatMoney` (which already rounds
 * for display) or round it themselves first if it's headed into an
 * editable field (see `roundMoney`). */
export function convertBudgetAmount(amount: number, fromPeriod: BudgetPeriod, toPeriod: BudgetPeriod): number {
  if (fromPeriod === toPeriod) return amount;
  const annualized = amount * PERIODS_PER_YEAR[fromPeriod];
  return annualized / PERIODS_PER_YEAR[toPeriod];
}

/** Rounds to 2 decimal places - unlike `formatMoney` (which rounds only
 * for *display*, as part of turning a number into a currency-formatted
 * string), this is for a plain numeric value that's about to be dropped
 * back into an editable amount field - e.g. the Add/Edit modal
 * live-converting its amount when the period tab is switched - where an
 * unrounded `5.769230769...` would otherwise show up verbatim. */
export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}
