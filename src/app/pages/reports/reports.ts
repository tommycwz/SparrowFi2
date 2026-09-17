import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { formatMoney } from '../../core/currency.util';
import { CURRENCIES, Transaction, TransactionType } from '../../core/models';
import { formatAmountNumber, monthKeyOf } from '../../core/format.util';
import { IconComponent } from '../../shared/icon';
import { InfoTipComponent } from '../../shared/info-tip';

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
  /** This account's own expenses broken down by category - "what did I
   * actually buy with this account" - using the same top-N-then-"Other"
   * rule as every other breakdown in this report. */
  categories: CategorySlice[];
}

interface MonthFlow {
  key: string;
  label: string;
  income: number;
  expense: number;
  commitment: number;
}

/** The three account types Spending by Channel tabs between - Bank now
 * included alongside Card and Wallet (previously the only two), so every
 * channel that can pay for an Expense/Commitment gets the same per-account
 * breakdown instead of Bank spend only showing up folded into the
 * category-level analyses above it. */
export const SPENDING_CHANNEL_OPTIONS = ['bank', 'wallet', 'card'] as const;
export type SpendingChannel = (typeof SPENDING_CHANNEL_OPTIONS)[number];
const SPENDING_CHANNEL_LABELS: Record<SpendingChannel, string> = { bank: 'Bank', wallet: 'Wallet', card: 'Card' };
const SPENDING_CHANNEL_ICONS: Record<SpendingChannel, string> = { bank: 'bank', wallet: 'wallet', card: 'card' };

interface VulnerabilityDot {
  x: number;
  y: number;
}

interface VulnerabilityTrend {
  width: number;
  height: number;
  commitmentPath: string;
  variablePath: string;
  commitmentDots: VulnerabilityDot[];
  variableDots: VulnerabilityDot[];
  guidelineY: number;
  maxPct: number;
  labels: { x: number; text: string; show: boolean }[];
}

interface ShockScenario {
  shockPct: number;
  hypotheticalIncome: number;
  ratio: number | null;
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
/** The classic "needs" guideline from the 50/30/20 budgeting rule - the
 * reference line the Structural Vulnerability trend is drawn against. */
const COMMITMENT_GUIDELINE_PCT = 50;
/** Income-shock percentages the stress-test scenario table checks a
 * period's Commitment Ratio against. */
const SHOCK_SCENARIOS = [10, 20, 30];

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
  imports: [FormsModule, IconComponent, InfoTipComponent],
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
    let commitment = 0;
    let othersIn = 0;
    let othersOut = 0;
    let count = 0;
    for (const t of this.filteredTransactions()) {
      count++;
      if (t.type === 'income') income += t.amount;
      else if (t.type === 'expense') expense += t.amount;
      else if (t.type === 'commitment') commitment += t.amount;
      else if (t.type === 'others-in') othersIn += t.amount;
      else othersOut += t.amount;
    }
    return { income, expense, commitment, net: income - expense - commitment, othersIn, othersOut, count };
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

  /** Savings Rate / Commitment Ratio / Variable Ratio for the selected
   * period - all `null` when there's no income to divide by, rather than
   * a fabricated 0% or a signed infinity. Together with `totals()` these
   * are what the Executive Summary and the Structural Vulnerability
   * section are built from - see the Formula & Filter section of the
   * redesign blueprint this implements. */
  readonly ratios = computed<{ savingsRate: number | null; commitmentRatio: number | null; variableRatio: number | null }>(
    () => {
      const { income, expense, commitment, net } = this.totals();
      if (income <= 0) return { savingsRate: null, commitmentRatio: null, variableRatio: null };
      return {
        savingsRate: (net / income) * 100,
        commitmentRatio: (commitment / income) * 100,
        variableRatio: (expense / income) * 100,
      };
    },
  );

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
  /** "Fixed Commitments Analysis" - the same category breakdown as Income/
   * Expenses Analysis, but for `type: 'commitment'` transactions (recurring
   * obligations - rent, loan installments, insurance, subscriptions - see
   * `TransactionType`), kept as its own section rather than folded into
   * Expenses Analysis since that's the whole point of the two being
   * separate types. */
  readonly commitmentAnalysis = computed(() => this.categoryBreakdownFor('commitment'));

  /** Groups an arbitrary set of already-filtered expense transactions by
   * category - the same shape `categoryBreakdownFor` produces for the whole
   * period, but reusable for a subset (a single account's transactions, say)
   * so the per-channel breakdown below can show "which categories did this
   * account's spending actually go to" alongside the account totals. */
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

  /** Same idea as `categoryBreakdownFor`, but for "which specific bank/card/
   * wallet is this money coming out of" rather than "what was it spent on" -
   * both Expense and Commitment transactions count (a BNPL installment on a
   * card is still money leaving that card), so a channel's own spending
   * analysis doesn't include incoming refunds/transfers ('others-in'/
   * 'others-out') routed through the same account. Bank is included
   * alongside Card and Wallet (see `SPENDING_CHANNEL_OPTIONS`) so all three
   * channels a transaction can be paid from get the same per-account
   * breakdown, tabbed together in Spending by Channel. Each resulting slice
   * also carries its own category breakdown (via `categorySlicesFor`), so
   * the report can show what an account was actually spent on, not just how
   * much. */
  private accountSpendingBreakdownFor(
    accountType: SpendingChannel,
  ): { items: AccountSpendingSlice[]; total: number } {
    const s = this.state.state();
    if (!s) return { items: [], total: 0 };
    const list = accountType === 'card' ? s.cards : accountType === 'wallet' ? s.wallets : s.banks;

    const byAccount = new Map<string, Transaction[]>();
    for (const t of this.filteredTransactions()) {
      const isOutflow = t.type === 'expense' || t.type === 'commitment';
      if (!isOutflow || t.accountType !== accountType) continue;
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

  readonly bankSpendingAnalysis = computed(() => this.accountSpendingBreakdownFor('bank'));
  readonly walletSpendingAnalysis = computed(() => this.accountSpendingBreakdownFor('wallet'));
  readonly cardSpendingAnalysis = computed(() => this.accountSpendingBreakdownFor('card'));

  /** Which of the three Spending by Channel tabs is active - defaults to
   * Bank since it's usually where the most volume flows. */
  readonly spendingChannel = signal<SpendingChannel>('bank');
  readonly spendingChannelOptions = SPENDING_CHANNEL_OPTIONS;
  readonly spendingChannelLabels = SPENDING_CHANNEL_LABELS;
  readonly spendingChannelIcons = SPENDING_CHANNEL_ICONS;

  readonly activeChannelAnalysis = computed(() => {
    switch (this.spendingChannel()) {
      case 'bank':
        return this.bankSpendingAnalysis();
      case 'wallet':
        return this.walletSpendingAnalysis();
      case 'card':
        return this.cardSpendingAnalysis();
    }
  });

  readonly activeChannelDonutSegments = computed(() => this.toDonutSegments(this.activeChannelAnalysis()));

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
  readonly commitmentDonutSegments = computed(() => this.toDonutSegments(this.commitmentAnalysis()));

  // ----- Monthly cash flow + Structural Vulnerability (range/year only) ------
  // A three-series chart - Commitment now gets its own bar/color alongside
  // Income and Expense (previously two-series only), matching the totals
  // already shown above it and the trend `vulnerabilityTrend` is derived
  // from below.

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

    const buckets = new Map<string, { income: number; expense: number; commitment: number }>(
      keys.map((k) => [k, { income: 0, expense: 0, commitment: 0 }]),
    );
    for (const t of s?.transactions ?? []) {
      const bucket = buckets.get(t.date.slice(0, 7));
      if (!bucket) continue;
      if (t.type === 'income') bucket.income += t.amount;
      else if (t.type === 'expense') bucket.expense += t.amount;
      else if (t.type === 'commitment') bucket.commitment += t.amount;
    }

    const months = keys.map((key) => {
      const b = buckets.get(key)!;
      return { key, label: monthLabel(key, 'short'), income: b.income, expense: b.expense, commitment: b.commitment };
    });
    const max = Math.max(0, ...months.flatMap((m) => [m.income, m.expense, m.commitment]));
    return { months, max };
  });

  barHeightPercent(value: number, max: number): number {
    return max > 0 ? (value / max) * 100 : 0;
  }

  /** Commitment Ratio and Variable Ratio for each month in
   * `monthlyBreakdown()`, drawn as a two-line chart against the classic
   * 50% "needs" guideline - the widget that answers "are fixed commitments
   * quietly creeping up," which a single month's snapshot can never show.
   * `null` (no chart, or no month has any income to divide by) rather than
   * an empty/misleading chart. A month with no income that period draws no
   * point on either line instead of a fabricated 0% or a division error. */
  readonly vulnerabilityTrend = computed<VulnerabilityTrend | null>(() => {
    const { months } = this.monthlyBreakdown();
    if (months.length < 2) return null;

    const rows = months.map((m) => ({
      label: m.label,
      commitmentPct: m.income > 0 ? (m.commitment / m.income) * 100 : null,
      variablePct: m.income > 0 ? (m.expense / m.income) * 100 : null,
    }));
    const values = rows.flatMap((r) => [r.commitmentPct, r.variablePct]).filter((v): v is number => v !== null);
    if (values.length === 0) return null;

    const maxPct = Math.max(COMMITMENT_GUIDELINE_PCT + 10, Math.ceil(Math.max(...values) / 10) * 10);
    const width = 600;
    const height = 170;
    const padX = 30;
    const padTop = 14;
    const padBottom = 26;
    const innerW = width - padX * 2;
    const innerH = height - padTop - padBottom;
    const stepX = rows.length > 1 ? innerW / (rows.length - 1) : 0;
    const xFor = (i: number) => padX + i * stepX;
    const yFor = (pct: number) => padTop + innerH - (pct / maxPct) * innerH;

    const toPath = (vals: (number | null)[]) => {
      let d = '';
      vals.forEach((v, i) => {
        if (v === null) return;
        d += `${d ? ' L' : 'M'}${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`;
      });
      return d;
    };
    const toDots = (vals: (number | null)[]) =>
      vals.flatMap((v, i) => (v === null ? [] : [{ x: xFor(i), y: yFor(v) }]));

    // Past a dozen months every label can't fit without overlapping - thin
    // them out to roughly 8 evenly-spaced labels (always including the
    // last month) rather than rendering an unreadable smear of text.
    const labelStep = rows.length <= 12 ? 1 : Math.ceil(rows.length / 8);

    return {
      width,
      height,
      commitmentPath: toPath(rows.map((r) => r.commitmentPct)),
      variablePath: toPath(rows.map((r) => r.variablePct)),
      commitmentDots: toDots(rows.map((r) => r.commitmentPct)),
      variableDots: toDots(rows.map((r) => r.variablePct)),
      guidelineY: yFor(COMMITMENT_GUIDELINE_PCT),
      maxPct,
      labels: rows.map((r, i) => ({
        x: xFor(i),
        text: r.label,
        show: i % labelStep === 0 || i === rows.length - 1,
      })),
    };
  });

  // ----- Structural Vulnerability / Stress Test ---------------------------------

  /** Fixed Cost Coverage (Income ÷ Commitment, "how many times over does
   * income cover what's already spoken for") and Discretionary Buffer
   * (Income − Commitment, the cash left before variable spending even
   * starts) for the selected period, plus a table of what the Commitment
   * Ratio would look like under a hypothetical income shock with spending
   * unchanged - the explicit "structural vulnerability testing" this
   * report is meant to support. `coverageRatio: null` reads as "∞" (fully
   * uncommitted) rather than a division by zero. */
  readonly stressTest = computed<{ coverageRatio: number | null; buffer: number; scenarios: ShockScenario[] }>(() => {
    const { income, commitment } = this.totals();
    const coverageRatio = commitment > 0 ? income / commitment : null;
    const buffer = income - commitment;
    const scenarios: ShockScenario[] = SHOCK_SCENARIOS.map((shockPct) => {
      const hypotheticalIncome = income * (1 - shockPct / 100);
      const ratio = hypotheticalIncome > 0 ? (commitment / hypotheticalIncome) * 100 : null;
      return { shockPct, hypotheticalIncome, ratio };
    });
    return { coverageRatio, buffer, scenarios };
  });

  // ----- Closing Position: Balance Sheet ----------------------------------------
  // A regrouping of the exact same signed figures `state.netWorth()` sums,
  // split into Assets and Liabilities for audit-style presentation - the
  // total below is arithmetically identical to `netWorthLabel()`, never a
  // second, independently-computed Net Worth.

  readonly balanceSheet = computed<{
    assets: { label: string; amount: number }[];
    liabilities: { label: string; amount: number }[];
    totalAssets: number;
    totalLiabilities: number;
    netWorth: number;
  }>(() => {
    const balances = this.state.accountBalances();
    const liquidPositive = balances
      .filter((a) => a.kind !== 'card' && a.balance > 0)
      .reduce((sum, a) => sum + a.balance, 0);
    const overdrawn = balances
      .filter((a) => a.kind !== 'card' && a.balance < 0)
      .reduce((sum, a) => sum + -a.balance, 0);
    const cardCredit = balances.filter((a) => a.kind === 'card' && a.balance > 0).reduce((sum, a) => sum + a.balance, 0);
    const cardDebt = balances.filter((a) => a.kind === 'card' && a.balance < 0).reduce((sum, a) => sum + -a.balance, 0);
    const fd = this.state.activeFixedDepositTotal();
    const investments = this.state.activeInvestmentTotal();

    const assets = [
      { label: 'Liquid Cash', amount: liquidPositive + cardCredit },
      { label: 'Fixed Deposits', amount: fd },
      { label: 'Investments', amount: investments },
    ].filter((r) => r.amount > 0);
    const liabilities = [
      { label: 'Card Debt', amount: cardDebt },
      { label: 'Overdrawn Accounts', amount: overdrawn },
    ].filter((r) => r.amount > 0);

    const totalAssets = assets.reduce((sum, r) => sum + r.amount, 0);
    const totalLiabilities = liabilities.reduce((sum, r) => sum + r.amount, 0);
    return { assets, liabilities, totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities };
  });

  readonly netWorthLabel = computed(() => this.money(this.state.netWorth()));

  // ----- Formatting helpers ----------------------------------------------------

  money(amount: number): string {
    return formatMoney(amount, this.state.state()!.settings.currency);
  }

  numberPart(amount: number): string {
    return formatAmountNumber(amount);
  }

  /** Whole-number percentage for a ratio/pace label - `null` (no income to
   * divide by) renders as "—" so the template never has to juggle a
   * nullable number itself. */
  pct(value: number | null): string {
    return value === null ? '—' : `${Math.round(value)}%`;
  }

  /** Savings Rate rendered as positive/negative for the stat tile's color -
   * treated as non-negative when there's no income to divide by (nothing to
   * flag red about), matching how `pct()` renders that case as "—" rather
   * than an alarming default. */
  isSavingsRatePositive(): boolean {
    const rate = this.ratios().savingsRate;
    return rate === null || rate >= 0;
  }

  /** "Fixed Cost Coverage" label - "∞" when there are no commitments to
   * divide by (fully uncommitted, not a division error), otherwise the
   * ratio to two decimal places with a "×" suffix. Kept out of the template
   * so it never has to juggle the nullable value itself. */
  coverageRatioLabel(): string {
    const ratio = this.stressTest().coverageRatio;
    return ratio === null ? '∞' : `${ratio.toFixed(2)}×`;
  }
}
