import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { formatMoney } from '../../core/currency.util';
import { CURRENCIES, Transaction, TransactionType } from '../../core/models';
import { formatAmountNumber, monthKeyOf } from '../../core/format.util';
import { IconComponent } from '../../shared/icon';

export type ReportMode = 'month' | 'year' | 'range';

interface CategorySlice {
  id: string;
  name: string;
  color: string;
  amount: number;
  percent: number;
}

interface DonutSegment extends CategorySlice {
  dashArray: string;
  offset: number;
}

interface AccountSpendingSlice extends CategorySlice {
  /** This card/wallet's own expenses broken down by category - "what did I
   * actually buy with this card" - using the same top-N-then-"Other" rule
   * as every other breakdown in this report. */
  categories: CategorySlice[];
}

interface MonthFlow {
  key: string;
  label: string;
  income: number;
  expense: number;
}

const CATEGORY_COLOR_FALLBACK = '#94A3B8';
const OTHER_SLICE_COLOR = '#78716C';
/** How many individual categories to break out in an analysis section
 * before lumping the rest into a single "Other" slice - same convention
 * as the Dashboard's Spending by Category widget. */
const TOP_CATEGORY_COUNT = 6;
/** Circumference of the donut's SVG circle when its radius is 15.9155 -
 * the standard "no-library donut chart" trick, so a percentage (0-100) can
 * be used directly as a stroke-dasharray/dashoffset value. */
const DONUT_CIRCUMFERENCE = 100;
/** Above this many months, the monthly cash-flow chart is hidden rather
 * than rendered as an unreadable wall of bars - the stats and analyses
 * above it still cover the full selected range regardless. */
const MAX_CHART_MONTHS = 36;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Number of whole calendar months between two 'YYYY-MM' keys, inclusive
 * of both ends when added to 1 (e.g. '2026-01' -> '2026-03' is 2, so the
 * range covers 3 months: Jan, Feb, Mar). */
function monthsBetween(fromKey: string, toKey: string): number {
  const [fy, fm] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** Shifts a 'YYYY-MM' key by `delta` whole months in either direction. */
function shiftMonthKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  return monthKeyOf(new Date(y, m - 1 + delta, 1));
}

/** Last calendar day of a 'YYYY-MM' key, as a full 'YYYY-MM-DD' string -
 * day 0 of "next month" is a plain, DST-safe way to get "last day of this
 * month" out of `Date`. */
function endOfMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${key}-${pad2(lastDay)}`;
}

function monthLabel(key: string, style: 'long' | 'short' = 'long'): string {
  return new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, {
    month: style,
    year: 'numeric',
  });
}

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
})
export class ReportsPage {
  constructor(readonly state: StateService) {}

  // ----- Filter state -------------------------------------------------------

  readonly mode = signal<ReportMode>('month');
  readonly month = signal<string>(monthKeyOf());
  readonly year = signal<number>(new Date().getFullYear());
  readonly rangeFrom = signal<string>(shiftMonthKey(monthKeyOf(), -5));
  readonly rangeTo = signal<string>(monthKeyOf());

  setMode(mode: ReportMode): void {
    this.mode.set(mode);
  }

  shiftMonthFilter(delta: number): void {
    this.month.update((key) => shiftMonthKey(key, delta));
  }

  shiftYearFilter(delta: number): void {
    this.year.update((y) => y + delta);
  }

  onRangeFromChange(key: string): void {
    this.rangeFrom.set(key);
  }

  onRangeToChange(key: string): void {
    this.rangeTo.set(key);
  }

  // ----- Resolved period -----------------------------------------------------

  /** The filter's `mode` and inputs resolved into a concrete `[start, end]`
   * date-string range (inclusive), a display label, and how many calendar
   * months it spans - everything downstream (totals, analyses, the monthly
   * chart) is derived from this one computed rather than re-reading the raw
   * filter signals. */
  readonly periodRange = computed<{ start: string; end: string; label: string; monthCount: number }>(
    () => {
      const mode = this.mode();
      if (mode === 'year') {
        const y = this.year();
        return { start: `${y}-01-01`, end: `${y}-12-31`, label: String(y), monthCount: 12 };
      }
      if (mode === 'range') {
        let from = this.rangeFrom();
        let to = this.rangeTo();
        // A "from" picked after "to" (or vice versa) still resolves to a
        // sensible forward-running range instead of an empty one.
        if (from > to) [from, to] = [to, from];
        return {
          start: `${from}-01`,
          end: endOfMonth(to),
          label: from === to ? monthLabel(from) : `${monthLabel(from, 'short')} – ${monthLabel(to, 'short')}`,
          monthCount: monthsBetween(from, to) + 1,
        };
      }
      const key = this.month();
      return { start: `${key}-01`, end: endOfMonth(key), label: monthLabel(key), monthCount: 1 };
    },
  );

  readonly hasMonthlyChart = computed(() => {
    const count = this.periodRange().monthCount;
    return count > 1 && count <= MAX_CHART_MONTHS;
  });

  readonly rangeTooWideForChart = computed(() => this.periodRange().monthCount > MAX_CHART_MONTHS);

  // ----- Filtered data ---------------------------------------------------------

  readonly filteredTransactions = computed<Transaction[]>(() => {
    const s = this.state.state();
    if (!s) return [];
    const { start, end } = this.periodRange();
    return s.transactions.filter((t) => t.date >= start && t.date <= end);
  });

  /** Core period totals. `othersIn`/`othersOut` (transfers, FD principal
   * movements, adjustments) are tracked separately from income/expense,
   * same distinction the Dashboard's cash-flow chart already draws - they
   * move money between your own accounts rather than earning or spending
   * it, so folding them into "income"/"expenses" would overstate both. */
  readonly totals = computed(() => {
    let income = 0;
    let expense = 0;
    let othersIn = 0;
    let othersOut = 0;
    let count = 0;
    for (const t of this.filteredTransactions()) {
      count++;
      if (t.type === 'income') income += t.amount;
      else if (t.type === 'expense') expense += t.amount;
      else if (t.type === 'others-in') othersIn += t.amount;
      else othersOut += t.amount;
    }
    return { income, expense, net: income - expense, othersIn, othersOut, count };
  });

  /** "Net Cash Flow" stat value - sign-then-symbol-then-magnitude, the same
   * pattern used on Dashboard/Transactions so a negative net never sandwiches
   * its minus sign after the currency symbol. */
  readonly netStatLabel = computed(() => {
    const net = this.totals().net;
    const sign = net < 0 ? '-' : '';
    return `${sign}${this.currencySymbol()}${formatAmountNumber(Math.abs(net))}`;
  });

  readonly currencySymbol = computed(() => {
    const currency = this.state.state()?.settings.currency;
    return CURRENCIES.find((c) => c.value === currency)?.symbol ?? '';
  });

  // ----- Income / Expense analysis --------------------------------------------

  /** Sorts a set of named/colored amount rows largest-first, collapses
   * everything past the first `TOP_CATEGORY_COUNT` into a single "Other"
   * slice, and turns raw amounts into percentages of the group's total -
   * the shared tail end of every per-category/per-account breakdown below,
   * so category and account analyses stay visually and numerically
   * consistent with each other. */
  private summarizeSlices(
    rows: { id: string; name: string; color: string; amount: number }[],
  ): { items: CategorySlice[]; total: number } {
    const sorted = [...rows].sort((a, b) => b.amount - a.amount);
    const total = sorted.reduce((sum, r) => sum + r.amount, 0);
    let items = sorted.slice(0, TOP_CATEGORY_COUNT);
    const rest = sorted.slice(TOP_CATEGORY_COUNT);
    if (rest.length > 0) {
      items = [
        ...items,
        {
          id: '__other__',
          name: 'Other',
          color: OTHER_SLICE_COLOR,
          amount: rest.reduce((s2, r) => s2 + r.amount, 0),
        },
      ];
    }
    return {
      items: items.map((r) => ({ ...r, percent: total > 0 ? (r.amount / total) * 100 : 0 })),
      total,
    };
  }

  private categoryBreakdownFor(type: TransactionType): { items: CategorySlice[]; total: number } {
    const s = this.state.state();
    if (!s) return { items: [], total: 0 };
    const totals = new Map<string, number>();
    for (const t of this.filteredTransactions()) {
      if (t.type !== type) continue;
      const key = t.categoryId ?? '__uncategorized__';
      totals.set(key, (totals.get(key) ?? 0) + t.amount);
    }

    const rows = [...totals.entries()].map(([id, amount]) => {
      if (id === '__uncategorized__') {
        return { id, name: 'Uncategorized', color: CATEGORY_COLOR_FALLBACK, amount };
      }
      const cat = s.categories.find((c) => c.id === id);
      return {
        id,
        name: cat?.name ?? 'Uncategorized',
        color: cat?.color ?? CATEGORY_COLOR_FALLBACK,
        amount,
      };
    });

    return this.summarizeSlices(rows);
  }

  readonly incomeAnalysis = computed(() => this.categoryBreakdownFor('income'));
  readonly expenseAnalysis = computed(() => this.categoryBreakdownFor('expense'));

  /** Groups an arbitrary set of already-filtered expense transactions by
   * category - the same shape `categoryBreakdownFor` produces for the whole
   * period, but reusable for a subset (a single card's transactions, say) so
   * the per-account breakdown below can show "which categories did this
   * card's spending actually go to" alongside the account totals. */
  private categorySlicesFor(txns: Transaction[]): CategorySlice[] {
    const s = this.state.state();
    if (!s) return [];
    const totals = new Map<string, number>();
    for (const t of txns) {
      const key = t.categoryId ?? '__uncategorized__';
      totals.set(key, (totals.get(key) ?? 0) + t.amount);
    }
    const rows = [...totals.entries()].map(([id, amount]) => {
      if (id === '__uncategorized__') {
        return { id, name: 'Uncategorized', color: CATEGORY_COLOR_FALLBACK, amount };
      }
      const cat = s.categories.find((c) => c.id === id);
      return { id, name: cat?.name ?? 'Uncategorized', color: cat?.color ?? CATEGORY_COLOR_FALLBACK, amount };
    });
    return this.summarizeSlices(rows).items;
  }

  /** Same idea as `categoryBreakdownFor`, but for "which specific card/wallet
   * is this expense money coming out of" rather than "what was it spent on" -
   * only expense transactions made through that account type are counted, so
   * a card's own spending analysis doesn't include incoming refunds/transfers
   * ('others-in'/'others-out') routed through the same card. Bank spending
   * isn't broken out the same way since Expenses Analysis above already
   * covers total spend by category regardless of which account paid for it,
   * and Cash/Others have no individually-named accounts to split by. Each
   * resulting slice also carries its own category breakdown (via
   * `categorySlicesFor`), so the report can show what a card was actually
   * spent on, not just how much. */
  private accountSpendingBreakdownFor(
    accountType: 'card' | 'wallet',
  ): { items: AccountSpendingSlice[]; total: number } {
    const s = this.state.state();
    if (!s) return { items: [], total: 0 };
    const list = accountType === 'card' ? s.cards : s.wallets;

    const byAccount = new Map<string, Transaction[]>();
    for (const t of this.filteredTransactions()) {
      if (t.type !== 'expense' || t.accountType !== accountType) continue;
      const key = t.accountId ?? '__unknown__';
      const bucket = byAccount.get(key);
      if (bucket) bucket.push(t);
      else byAccount.set(key, [t]);
    }

    const rows = [...byAccount.entries()].map(([id, txns]) => {
      const acc = id === '__unknown__' ? undefined : list.find((a) => a.id === id);
      return {
        id,
        name: acc?.name ?? 'Unknown',
        color: acc?.color ?? CATEGORY_COLOR_FALLBACK,
        amount: txns.reduce((sum, t) => sum + t.amount, 0),
        txns,
      };
    });

    const sorted = [...rows].sort((a, b) => b.amount - a.amount);
    const total = sorted.reduce((sum, r) => sum + r.amount, 0);
    const top = sorted.slice(0, TOP_CATEGORY_COUNT);
    const rest = sorted.slice(TOP_CATEGORY_COUNT);

    const items: AccountSpendingSlice[] = top.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      amount: r.amount,
      percent: total > 0 ? (r.amount / total) * 100 : 0,
      categories: this.categorySlicesFor(r.txns),
    }));

    if (rest.length > 0) {
      const restTxns = rest.flatMap((r) => r.txns);
      const restAmount = rest.reduce((sum, r) => sum + r.amount, 0);
      items.push({
        id: '__other__',
        name: 'Other',
        color: OTHER_SLICE_COLOR,
        amount: restAmount,
        percent: total > 0 ? (restAmount / total) * 100 : 0,
        categories: this.categorySlicesFor(restTxns),
      });
    }

    return { items, total };
  }

  readonly cardSpendingAnalysis = computed(() => this.accountSpendingBreakdownFor('card'));
  readonly walletSpendingAnalysis = computed(() => this.accountSpendingBreakdownFor('wallet'));

  private toDonutSegments(breakdown: { items: CategorySlice[] }): DonutSegment[] {
    let cumulative = 0;
    return breakdown.items.map((slice) => {
      const dash = slice.percent;
      const offset = DONUT_CIRCUMFERENCE / 4 - cumulative;
      cumulative += dash;
      return { ...slice, dashArray: `${dash} ${DONUT_CIRCUMFERENCE - dash}`, offset };
    });
  }

  readonly incomeDonutSegments = computed(() => this.toDonutSegments(this.incomeAnalysis()));
  readonly expenseDonutSegments = computed(() => this.toDonutSegments(this.expenseAnalysis()));
  readonly cardSpendingDonutSegments = computed(() => this.toDonutSegments(this.cardSpendingAnalysis()));
  readonly walletSpendingDonutSegments = computed(() => this.toDonutSegments(this.walletSpendingAnalysis()));

  // ----- Monthly cash flow (range/year views only) ----------------------------

  readonly monthlyBreakdown = computed<{ months: MonthFlow[]; max: number }>(() => {
    if (!this.hasMonthlyChart()) return { months: [], max: 0 };
    const s = this.state.state();
    const { start, end } = this.periodRange();
    const startKey = start.slice(0, 7);
    const endKey = end.slice(0, 7);

    const keys: string[] = [];
    let cursor = startKey;
    // monthCount is capped at MAX_CHART_MONTHS by `hasMonthlyChart`, so this
    // always terminates well short of anything pathological.
    while (cursor <= endKey) {
      keys.push(cursor);
      cursor = shiftMonthKey(cursor, 1);
    }

    const buckets = new Map<string, { income: number; expense: number }>(
      keys.map((k) => [k, { income: 0, expense: 0 }]),
    );
    for (const t of s?.transactions ?? []) {
      const bucket = buckets.get(t.date.slice(0, 7));
      if (!bucket) continue;
      if (t.type === 'income') bucket.income += t.amount;
      else if (t.type === 'expense') bucket.expense += t.amount;
    }

    const months = keys.map((key) => {
      const b = buckets.get(key)!;
      return { key, label: monthLabel(key, 'short'), income: b.income, expense: b.expense };
    });
    const max = Math.max(0, ...months.flatMap((m) => [m.income, m.expense]));
    return { months, max };
  });

  barHeightPercent(value: number, max: number): number {
    return max > 0 ? (value / max) * 100 : 0;
  }

  // ----- Current asset balances ------------------------------------------------
  // Deliberately today's live balances (via `state.accountBalances()`), not
  // recomputed as of the report period's end date - "current" means now,
  // same account snapshot the Dashboard and Accounts pages show, so this
  // section always answers "what do I actually have right now" alongside
  // the period-scoped analysis above it.

  readonly netWorthLabel = computed(() => this.money(this.state.netWorth()));

  // ----- Summary ---------------------------------------------------------------

  readonly summary = computed(() => {
    const t = this.totals();
    const income = this.incomeAnalysis();
    const expense = this.expenseAnalysis();
    const savingsRate = t.income > 0 ? (t.net / t.income) * 100 : 0;
    const avgTransaction = t.count > 0 ? (t.income + t.expense) / t.count : 0;
    return {
      count: t.count,
      avgTransaction,
      savingsRate,
      topIncome: income.items[0] ?? null,
      topExpense: expense.items[0] ?? null,
    };
  });

  // ----- Formatting helpers ----------------------------------------------------

  money(amount: number): string {
    return formatMoney(amount, this.state.state()!.settings.currency);
  }

  numberPart(amount: number): string {
    return formatAmountNumber(amount);
  }
}
