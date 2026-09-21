import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { StateService } from '../../core/state.service';
import { formatMoney } from '../../core/currency.util';
import { CURRENCIES, FixedDepositStatus, InvestmentStatus, Transaction } from '../../core/models';
import { fdMaturityDate, fdMaturityValue } from '../../core/fixed-deposit.util';
import { investmentGainValue, investmentLossValue } from '../../core/investment.util';
import { formatAmountNumber, formatDateBadge, formatTimeBadge, monthKeyOf } from '../../core/format.util';
import { IconComponent } from '../../shared/icon';
import { InfoTipComponent } from '../../shared/info-tip';

const CATEGORY_COLOR_FALLBACK = '#94A3B8';
/** How many transactions to show in the Recent Activity list - tightened
 * from the old 6 so the hero-to-fold distance on a fresh load stays short;
 * "See all" is one tap away on the Transactions page. */
const RECENT_COUNT = 5;
/** How many days of daily liquid-cash history the hero sparkline plots. */
const SPARKLINE_DAYS = 30;
/** How many trailing *completed* calendar months (this month excluded)
 * Average Monthly Burn is computed over - capped by however much history
 * the account actually has, via `earliestMonthOf`, so a 2-week-old file
 * doesn't get dragged toward zero by months before any data existed. */
const TRAILING_MONTHS = 3;
/** How many individual categories "Where It Went" breaks out before
 * rolling everything past that into a single "Other" slice - keeps the
 * donut legend to a glance-able length regardless of how many categories
 * an account has. */
const CATEGORY_DONUT_TOP_COUNT = 5;
/** Circumference of the donut's SVG circle when its radius is 15.9155 -
 * the standard "no-library donut chart" trick, so a percentage (0-100) can
 * be used directly as a stroke-dasharray/dashoffset value. Shared by the
 * Savings Rate ring and the "Where It Went" donut below. */
const DONUT_CIRCUMFERENCE = 100;

interface MonthlyStats {
  income: number;
  expense: number;
  commitment: number;
  net: number;
}

/** Same shape as `MonthlyStats`, but built from active Recurring templates
 * instead of recorded transactions - see `pendingRecurringTotals`. */
type RecurringMonthlyTotals = MonthlyStats;

interface SparklinePoint {
  x: number;
  y: number;
}

/** One plottable day on the hero sparkline, carrying its own pre-formatted
 * date/value labels so the hover tooltip never has to re-derive "which
 * calendar day is this point" from a bare x-coordinate. */
interface CashSparklinePoint extends SparklinePoint {
  dateLabel: string;
  valueLabel: string;
}

interface CashSparkline {
  linePath: string;
  areaPath: string;
  points: CashSparklinePoint[];
  endPoint: SparklinePoint | null;
  deltaLabel: string;
  deltaPositive: boolean;
}

type RunwayBand = 'critical' | 'caution' | 'safe' | 'unknown';

interface CashRunway {
  label: string;
  band: RunwayBand;
  pointerPercent: number;
  burnMonthsCounted: number;
}

interface CardDebtLine {
  id: string;
  name: string;
  color: string;
  amount: number;
}

interface CardDebtSummary {
  total: number;
  lines: CardDebtLine[];
}

interface RingSegment {
  key: 'committed' | 'variable' | 'saved';
  color: string;
  dashArray: string;
  offset: number;
}

interface SavingsRate {
  hasIncome: boolean;
  ratePct: number | null;
  overspent: boolean;
  committedAmt: number;
  variableAmt: number;
  savedAmt: number;
  segments: RingSegment[];
}

interface CategorySpendSegment {
  id: string;
  name: string;
  color: string;
  amount: number;
  /** Whole-number share of this month's total, e.g. "41" for 41% - kept
   * as a string since the legend only ever displays it, never does math
   * with it. */
  pctLabel: string;
  dashArray: string;
  offset: number;
}

interface CategorySpend {
  hasExpense: boolean;
  total: number;
  segments: CategorySpendSegment[];
}

interface AssetAllocationSlice {
  id: string;
  name: string;
  color: string;
  amount: number;
  dashArray: string;
  offset: number;
}

interface AssetAllocation {
  total: number;
  items: AssetAllocationSlice[];
}

/** One stacked bar's worth of drawing data for the Investments chart - see
 * `investmentBreakdown` for how the three segments are derived. Moved here
 * from Reports: an investment's principal/gain/loss is today's live state,
 * not scoped to any reporting period, so it never changed when Reports'
 * period filter did - it belongs on the Dashboard instead. */
interface InvestmentBar {
  id: string;
  name: string;
  status: InvestmentStatus;
  amount: number;
  finalAmount?: number;
  /** Neutral base segment - the smaller of what went in and what (if
   * anything) has come back out so far. */
  baseAmount: number;
  /** Green segment stacked on top of the base, only when completed above
   * the invested amount. */
  gain: number;
  /** Red segment stacked on top of the base, only when completed below
   * the invested amount - visually "the part that didn't come back". */
  loss: number;
  /** Full bar height for scaling - `max(amount, finalAmount ?? amount)`. */
  total: number;
}

/** A row in the Fixed Deposit ledger - also moved here from Reports for the
 * same reason as `InvestmentBar`: every FD ever opened, active or not,
 * looks identical no matter which report period is selected. */
interface FdLedgerRow {
  id: string;
  bankName: string;
  principal: number;
  percentage: number;
  months: number;
  status: FixedDepositStatus;
  maturityDate: string;
  maturityValue: number;
}

/** Whole days between `dateStr` and `from` (positive = in the future,
 * negative = overdue) - calendar-day difference, not a raw 24h-multiple
 * diff, so "tomorrow" reads correctly regardless of time of day. */
function daysUntil(dateStr: string, from: Date = new Date()): number {
  const target = new Date(`${dateStr}T00:00:00`);
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** "in 12 days" / "tomorrow" / "today" / "3 days overdue" for a maturity
 * countdown chip - a date alone takes a beat of mental math to place on a
 * timeline, a countdown doesn't. */
function maturityCountdownLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, IconComponent, FormsModule, InfoTipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class DashboardPage {
  constructor(readonly state: StateService) {}

  readonly currencySymbol = computed(() => {
    const currency = this.state.state()?.settings.currency;
    return CURRENCIES.find((c) => c.value === currency)?.symbol ?? '';
  });

  // ----- Zone 1: Cash Position -------------------------------------------

  /** Liquid = spendable now - Banks, Wallets, the Cash bucket and the
   * Others bucket. Deliberately excludes Cards: a card's balance is what
   * you owe (see `StateService.accountBalances`'s sign convention), not
   * money you have, so folding it in here would overstate what's actually
   * available to spend. This is the Dashboard's hero figure. */
  readonly liquidAccounts = computed(() => this.state.accountBalances().filter((a) => a.kind !== 'card'));
  readonly cardAccounts = computed(() => this.state.accountBalances().filter((a) => a.kind === 'card'));

  readonly liquidCash = computed(() => this.liquidAccounts().reduce((sum, a) => sum + a.balance, 0));

  readonly liquidCashLabel = computed(() => this.money(this.liquidCash()));
  readonly netWorthLabel = computed(() => this.money(this.state.netWorth()));

  /** Daily liquid-cash history for the last `SPARKLINE_DAYS` days, walked
   * forward from a reconstructed starting balance (today's liquid cash
   * minus every liquid-affecting transaction inside the window) rather
   * than recomputed from scratch per day - one pass over transactions
   * either way, but this keeps the "today" endpoint exactly equal to
   * `liquidCash()` by construction instead of by coincidence. */
  readonly cashSparkline = computed<CashSparkline>(() => {
    const empty: CashSparkline = {
      linePath: '',
      areaPath: '',
      points: [],
      endPoint: null,
      deltaLabel: '',
      deltaPositive: true,
    };
    const s = this.state.state();
    if (!s) return empty;

    const today = new Date();
    const dateKeys: string[] = [];
    for (let i = SPARKLINE_DAYS - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      dateKeys.push(monthKeyOf(d) + '-' + String(d.getDate()).padStart(2, '0'));
    }
    const windowStart = dateKeys[0];
    const todayKey = dateKeys[dateKeys.length - 1];

    const deltaByDate = new Map<string, number>(dateKeys.map((k) => [k, 0]));
    let windowSum = 0;
    for (const t of s.transactions) {
      if (t.accountType === 'card') continue;
      if (t.date < windowStart || t.date > todayKey) continue;
      const signed = t.type === 'income' || t.type === 'others-in' ? t.amount : -t.amount;
      windowSum += signed;
      deltaByDate.set(t.date, (deltaByDate.get(t.date) ?? 0) + signed);
    }

    const current = this.liquidCash();
    let running = current - windowSum;
    const values = dateKeys.map((k) => {
      running += deltaByDate.get(k) ?? 0;
      return running;
    });

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const width = 300;
    const height = 60;
    const pad = 6;
    const stepX = (width - pad * 2) / (values.length - 1);
    const points: CashSparklinePoint[] = values.map((v, i) => {
      const [yr, mo, da] = dateKeys[i].split('-').map(Number);
      return {
        x: pad + i * stepX,
        y: height - pad - ((v - min) / range) * (height - pad * 2),
        // e.g. "16 Aug 2026" - the hover tooltip's whole reason for
        // existing is to answer "which month/year is this point", so the
        // label is spelled out in full rather than abbreviated further.
        dateLabel: new Date(yr, mo - 1, da).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }),
        valueLabel: this.money(v),
      };
    });

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${height - pad} L${points[0].x.toFixed(1)},${height - pad} Z`;

    const delta = values[values.length - 1] - values[0];
    const sign = delta < 0 ? '-' : '+';
    return {
      linePath,
      areaPath,
      points,
      endPoint: points[points.length - 1],
      deltaLabel: `${sign}${this.currencySymbol()}${formatAmountNumber(Math.abs(delta))} · last ${SPARKLINE_DAYS} days`,
      deltaPositive: delta >= 0,
    };
  });

  /** Index into `cashSparkline().points` currently under the pointer, or
   * `null` when the pointer isn't over the chart - drives the hover dot/
   * guide line and the date+value tooltip so a viewer can see exactly
   * which day (month and year included) a point on the line belongs to. */
  readonly sparklineHoverIndex = signal<number | null>(null);

  readonly sparklineHoverPoint = computed<CashSparklinePoint | null>(() => {
    const i = this.sparklineHoverIndex();
    if (i === null) return null;
    return this.cashSparkline().points[i] ?? null;
  });

  onSparklineHover(event: MouseEvent, svg: Element): void {
    this.updateSparklineHover(event.clientX, svg);
  }

  /** Mobile has no hover, so a tap shows the nearest point's tooltip for a
   * couple seconds instead - long enough to read a date and value without
   * needing to hold a finger in place, short enough to get out of the way
   * on its own. Deliberately doesn't call `preventDefault()`: this is a
   * plain tap (`touchstart`, not `touchmove`), so it never fights the
   * page's normal vertical scroll. */
  onSparklineTouch(event: TouchEvent, svg: Element): void {
    const touch = event.touches[0];
    if (!touch) return;
    this.updateSparklineHover(touch.clientX, svg);
    clearTimeout(this.sparklineTouchTimer);
    this.sparklineTouchTimer = setTimeout(() => this.onSparklineLeave(), 2000);
  }

  onSparklineLeave(): void {
    this.sparklineHoverIndex.set(null);
  }

  private sparklineTouchTimer?: ReturnType<typeof setTimeout>;

  /** Maps a pointer/touch's `clientX` to the nearest plotted day. The SVG
   * is stretched to fill its container with `preserveAspectRatio="none"`,
   * so a position's fraction across the element's rendered box
   * (`clientX` vs `getBoundingClientRect()`) maps directly onto the same
   * fraction of the 0-300 viewBox width - no need to account for
   * letterboxing the way a preserved-aspect SVG would. Typed as the plain
   * `Element` base (not `SVGSVGElement`) because Angular's template type
   * checker resolves a `#ref` on a bare `<svg>` via `HTMLElementTagNameMap`
   * and infers `HTMLElement` for it in some binding positions - only
   * `getBoundingClientRect()` is needed here, which both share. */
  private updateSparklineHover(clientX: number, svg: Element): void {
    const points = this.cashSparkline().points;
    if (points.length === 0) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const fraction = (clientX - rect.left) / rect.width;
    const targetX = fraction * 300;
    let nearest = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(points[i].x - targetX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    }
    this.sparklineHoverIndex.set(nearest);
  }

  // ----- Zone 2: Short-Term Liquidity -------------------------------------

  /** 'YYYY-MM' key of this account's very first transaction, or the current
   * month if there are no transactions yet - the floor that keeps
   * `avgMonthlyBurn` from averaging in months before any data existed. */
  private readonly earliestMonth = computed(() => {
    const s = this.state.state();
    if (!s || s.transactions.length === 0) return monthKeyOf();
    return s.transactions.reduce((min, t) => (t.date.slice(0, 7) < min ? t.date.slice(0, 7) : min), s.transactions[0].date.slice(0, 7));
  });

  /** The last `TRAILING_MONTHS` *completed* calendar months (this month
   * excluded, floored at `earliestMonth`) as 'YYYY-MM' keys - the window
   * `avgMonthlyBurn` averages over. */
  private readonly trailingMonthKeys = computed<string[]>(() => {
    const earliest = this.earliestMonth();
    const now = new Date();
    const keys: string[] = [];
    for (let i = 1; i <= TRAILING_MONTHS; i++) {
      const key = monthKeyOf(new Date(now.getFullYear(), now.getMonth() - i, 1));
      if (key >= earliest) keys.push(key);
    }
    return keys;
  });

  /** Mean of (Expense + Commitment) over `trailingMonthKeys()` - this month
   * itself is deliberately excluded, since a partial month would
   * understate burn early on and overstate it once spending catches up.
   * `monthsCounted` may be less than `TRAILING_MONTHS` for a newer
   * account; callers show their work ("based on N months") instead of
   * silently padding with zeros. */
  readonly avgMonthlyBurn = computed<{ amount: number; monthsCounted: number }>(() => {
    const s = this.state.state();
    const keys = this.trailingMonthKeys();
    if (!s || keys.length === 0) return { amount: 0, monthsCounted: 0 };
    const keySet = new Set(keys);
    let total = 0;
    for (const t of s.transactions) {
      if (!keySet.has(t.date.slice(0, 7))) continue;
      if (t.type === 'expense' || t.type === 'commitment') total += t.amount;
    }
    return { amount: total / keys.length, monthsCounted: keys.length };
  });

  /** Available Cash ÷ Average Monthly Burn, in months. Three guarded
   * outcomes besides the plain number: no burn history at all yet ("—",
   * unknown), zero burn ("∞", safe), and cash already at or below zero
   * ("0.0", critical) - see the Formula & Filter section of the design
   * blueprint this implements. `pointerPercent` positions the meter's
   * pointer on a 0-6-month band scale, capped at 6+. */
  readonly cashRunway = computed<CashRunway>(() => {
    const burn = this.avgMonthlyBurn();
    if (burn.monthsCounted === 0) {
      return { label: '—', band: 'unknown', pointerPercent: 0, burnMonthsCounted: 0 };
    }
    if (burn.amount <= 0) {
      return { label: '∞', band: 'safe', pointerPercent: 100, burnMonthsCounted: burn.monthsCounted };
    }
    const liquid = this.liquidCash();
    if (liquid <= 0) {
      return { label: '0.0', band: 'critical', pointerPercent: 0, burnMonthsCounted: burn.monthsCounted };
    }
    const months = liquid / burn.amount;
    const label = months >= 99.95 ? '99+' : months.toFixed(1);
    const band: RunwayBand = months < 1 ? 'critical' : months < 3 ? 'caution' : 'safe';
    return { label, band, pointerPercent: (Math.min(months, 6) / 6) * 100, burnMonthsCounted: burn.monthsCounted };
  });

  /** Cards currently in debt (a negative balance), worst first - a card
   * sitting in credit contributes nothing here (it's not owed money) and
   * is left to show its plain positive balance in the Accounts grid. */
  readonly cardDebt = computed<CardDebtSummary>(() => {
    const inDebt = this.cardAccounts().filter((a) => a.balance < 0);
    const sorted = [...inDebt].sort((a, b) => a.balance - b.balance);
    return {
      total: sorted.reduce((sum, a) => sum + -a.balance, 0),
      lines: sorted.slice(0, 3).map((a) => ({ id: a.id, name: a.name, color: a.color, amount: -a.balance })),
    };
  });

  /** Active fixed deposits: total principal locked away, plus whichever
   * one matures soonest, so the dashboard surfaces "when do I get money
   * back" without a trip to the Fixed Deposits page. */
  readonly fixedDepositSummary = computed(() => {
    const s = this.state.state();
    const active = (s?.fixedDeposits ?? []).filter((fd) => fd.status === 'active');
    if (active.length === 0) return null;

    const totalPrincipal = active.reduce((sum, fd) => sum + fd.amount, 0);
    const withMaturity = active
      .map((fd) => ({ fd, maturity: fdMaturityDate(fd) }))
      .sort((a, b) => a.maturity.localeCompare(b.maturity));
    const next = withMaturity[0];

    return {
      count: active.length,
      totalPrincipal,
      nextBankName: s?.banks.find((b) => b.id === next.fd.bankId)?.name ?? '—',
      nextMaturityDate: next.maturity,
      nextMaturityValue: fdMaturityValue(next.fd),
      nextMaturityCountdown: maturityCountdownLabel(daysUntil(next.maturity)),
    };
  });

  // ----- Zone 3: Spending Pulse -------------------------------------------

  /** Income/expense/commitment/net for the real current calendar month - a
   * fixed, glanceable "how am I doing right now". Deliberately does NOT
   * fold in Fixed Deposit/Investment principal movement (booked as
   * `others-in`/`others-out`): those just move money between "in an
   * account" and "locked away", they don't earn or spend it. */
  readonly monthlyStats = computed<MonthlyStats>(() => {
    const s = this.state.state();
    if (!s) return { income: 0, expense: 0, commitment: 0, net: 0 };
    const monthKey = monthKeyOf();
    let income = 0;
    let expense = 0;
    let commitment = 0;
    for (const t of s.transactions) {
      if (t.date.slice(0, 7) !== monthKey) continue;
      if (t.type === 'income') income += t.amount;
      else if (t.type === 'expense') expense += t.amount;
      else if (t.type === 'commitment') commitment += t.amount;
    }
    return { income, expense, commitment, net: income - expense - commitment };
  });

  /** "Net This Month" folded together with what's still Pending Recurring
   * this month - not just what's already been recorded, but what the
   * month nets out to once the outstanding Recurring templates get added
   * too. Reads `pendingRecurringTotals` (declared further down) purely by
   * call order at read time - both are plain `computed()` signals, so
   * declaration order within the class doesn't matter, only that both
   * exist by the time either is actually read, which is always true. */
  readonly netThisMonthTotal = computed(() => this.monthlyStats().net + this.pendingRecurringTotals().net);

  readonly netStatLabel = computed(() => {
    const net = this.netThisMonthTotal();
    const sign = net < 0 ? '-' : '';
    return `${sign}${this.currencySymbol()}${formatAmountNumber(Math.abs(net))}`;
  });

  /** Income/expense/commitment/net/count for every active (non-paused)
   * Recurring template still due to happen *this calendar month*
   * (`nextDate` falls in the current month, whether that's overdue from
   * earlier this month or still upcoming) and hasn't been booked yet -
   * "what's left on my plate before the month is out". Nothing needs to
   * track "already added" separately: triggering a
   * template (`StateService.triggerRecurring`) advances its `nextDate` to
   * the following occurrence, which is exactly what drops it out of this
   * total on its own - a monthly template moves straight to next month,
   * while a daily/weekly one may still have another occurrence left this
   * month and correctly stays counted for that one. */
  readonly pendingRecurringTotals = computed<RecurringMonthlyTotals & { count: number }>(() => {
    const s = this.state.state();
    if (!s) return { income: 0, expense: 0, commitment: 0, net: 0, count: 0 };
    const monthKey = monthKeyOf();
    let income = 0;
    let expense = 0;
    let commitment = 0;
    let count = 0;
    for (const r of s.recurringTransactions) {
      if (r.paused || r.nextDate.slice(0, 7) !== monthKey) continue;
      count++;
      for (const line of r.lines) {
        if (line.type === 'income') income += line.amount;
        else if (line.type === 'expense') expense += line.amount;
        else if (line.type === 'commitment') commitment += line.amount;
      }
    }
    return { income, expense, commitment, net: income - expense - commitment, count };
  });

  readonly pendingRecurringStatLabel = computed(() => {
    const net = this.pendingRecurringTotals().net;
    const sign = net < 0 ? '-' : '';
    return `${sign}${this.currencySymbol()}${formatAmountNumber(Math.abs(net))}`;
  });

  /** How much of this month's still-pending Recurring templates would
   * post to a card account once triggered - same "due this month, not
   * yet added to Transactions" scope as `pendingRecurringTotals`, just
   * narrowed to lines whose `accountType` is `'card'`, since the balance
   * shown in Card Debt Outstanding doesn't yet reflect a subscription or
   * bill that hasn't been triggered. Nets out the rare case of an
   * income-type line against a card (e.g. a refund). Drops to 0 the same
   * way `pendingRecurringTotals` does: triggering a template advances its
   * `nextDate` past this month (or to its next occurrence), which is what
   * removes it here too - no separate "already added" flag needed. */
  readonly pendingCardRecurringTotal = computed(() => {
    const s = this.state.state();
    if (!s) return 0;
    const monthKey = monthKeyOf();
    let total = 0;
    for (const r of s.recurringTransactions) {
      if (r.paused || r.nextDate.slice(0, 7) !== monthKey) continue;
      for (const line of r.lines) {
        if (line.accountType !== 'card') continue;
        if (line.type === 'income' || line.type === 'others-in') total -= line.amount;
        else total += line.amount;
      }
    }
    return total;
  });

  /** Savings Rate ring: Committed / Variable / Saved as shares of this
   * month's Income. When Committed+Variable together exceed Income, the
   * three segments are scaled down proportionally so the ring still draws
   * a clean 100% instead of silently overflowing past a full turn -
   * `overspent` flags this case so the template can show a distinct
   * "Overspent" state instead of a ring that quietly wraps on itself.
   * `ratePct` (the center label) is the *unscaled* real savings rate and
   * can go negative - only the drawn segments are ever capped. */
  readonly savingsRate = computed<SavingsRate>(() => {
    const { income, expense, commitment, net } = this.monthlyStats();
    if (income <= 0) {
      return {
        hasIncome: false,
        ratePct: null,
        overspent: false,
        committedAmt: commitment,
        variableAmt: expense,
        savedAmt: net,
        segments: [],
      };
    }

    const committedRaw = (commitment / income) * 100;
    const variableRaw = (expense / income) * 100;
    const usedRaw = committedRaw + variableRaw;
    const overspent = usedRaw > 100;
    const scale = overspent ? 100 / usedRaw : 1;
    const committedPct = committedRaw * scale;
    const variablePct = variableRaw * scale;
    const savedPct = overspent ? 0 : Math.max(0, 100 - committedRaw - variableRaw);

    let cumulative = 0;
    const drawSegment = (key: RingSegment['key'], color: string, pct: number): RingSegment => {
      const offset = DONUT_CIRCUMFERENCE / 4 - cumulative;
      cumulative += pct;
      return { key, color, dashArray: `${pct} ${DONUT_CIRCUMFERENCE - pct}`, offset };
    };

    return {
      hasIncome: true,
      ratePct: (net / income) * 100,
      overspent,
      committedAmt: commitment,
      variableAmt: expense,
      savedAmt: net,
      segments: [
        drawSegment('committed', 'var(--commitment)', committedPct),
        drawSegment('variable', 'var(--danger)', variablePct),
        drawSegment('saved', 'var(--success)', savedPct),
      ],
    };
  });

  /** This month's Expense transactions, split by category, as a donut -
   * "where did my money go" rather than "is this normal" (the Cash Runway/
   * Average Burn widgets already cover the latter). Deliberately
   * `type: 'expense'` only, same "discretionary/variable spend" scope the
   * old Category Pace widget used - commitments, income, transfers and
   * Fixed Deposit/Investment principal movement aren't spend you can
   * redirect, so they'd only dilute "where did today's choices go".
   * Categories past `CATEGORY_DONUT_TOP_COUNT` are rolled into a single
   * "Other" slice so the legend stays glance-able regardless of how many
   * categories an account has. One pass over transactions rather than one
   * pass per category, to stay linear in transaction count. */
  readonly categorySpend = computed<CategorySpend>(() => {
    const empty: CategorySpend = { hasExpense: false, total: 0, segments: [] };
    const s = this.state.state();
    if (!s) return empty;

    const monthKey = monthKeyOf();
    const totals = new Map<string, number>();
    for (const t of s.transactions) {
      if (t.type !== 'expense' || t.date.slice(0, 7) !== monthKey) continue;
      const catKey = t.categoryId ?? '__uncategorized__';
      totals.set(catKey, (totals.get(catKey) ?? 0) + t.amount);
    }

    const total = [...totals.values()].reduce((sum, v) => sum + v, 0);
    if (total <= 0) return empty;

    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, CATEGORY_DONUT_TOP_COUNT);
    const restTotal = sorted.slice(CATEGORY_DONUT_TOP_COUNT).reduce((sum, [, amt]) => sum + amt, 0);

    const rows = top.map(([id, amount]) => {
      if (id === '__uncategorized__') {
        return { id, name: 'Uncategorized', color: CATEGORY_COLOR_FALLBACK, amount };
      }
      const cat = s.categories.find((c) => c.id === id);
      return { id, name: cat?.name ?? 'Uncategorized', color: cat?.color ?? CATEGORY_COLOR_FALLBACK, amount };
    });
    if (restTotal > 0) {
      rows.push({ id: '__other__', name: 'Other', color: CATEGORY_COLOR_FALLBACK, amount: restTotal });
    }

    let cumulative = 0;
    const segments: CategorySpendSegment[] = rows.map((r) => {
      const pct = (r.amount / total) * 100;
      const offset = DONUT_CIRCUMFERENCE / 4 - cumulative;
      cumulative += pct;
      return {
        id: r.id,
        name: r.name,
        color: r.color,
        amount: r.amount,
        pctLabel: Math.round(pct).toString(),
        dashArray: `${pct} ${DONUT_CIRCUMFERENCE - pct}`,
        offset,
      };
    });

    return { hasExpense: true, total, segments };
  });

  // ----- Zone 4: Portfolio -------------------------------------------------
  // Everything here is today's live state, not scoped to any reporting
  // period - moved over from Reports, where these looked identical no
  // matter which month/year/range was selected in the period filter.

  /** Gross assets - Liquid Cash (every non-card account balance, floored at
   * 0 so an overdrawn total doesn't draw as a negative pie slice), Fixed
   * Deposits and Investments principal - split into shares of the whole. */
  readonly assetAllocation = computed<AssetAllocation>(() => {
    const liquid = Math.max(0, this.liquidCash());
    const fd = this.state.activeFixedDepositTotal();
    const investments = this.state.activeInvestmentTotal();
    const rows = [
      { id: 'liquid', name: 'Liquid Cash', color: 'var(--accent)', amount: liquid },
      { id: 'fd', name: 'Fixed Deposits', color: 'var(--warning)', amount: fd },
      { id: 'investments', name: 'Investments', color: 'var(--investment)', amount: investments },
    ].filter((r) => r.amount > 0);
    const total = rows.reduce((sum, r) => sum + r.amount, 0);

    let cumulative = 0;
    const items: AssetAllocationSlice[] = rows.map((r) => {
      const pct = total > 0 ? (r.amount / total) * 100 : 0;
      const offset = DONUT_CIRCUMFERENCE / 4 - cumulative;
      cumulative += pct;
      return { ...r, dashArray: `${pct} ${DONUT_CIRCUMFERENCE - pct}`, offset };
    });
    return { total, items };
  });

  /** Every investment, principal as the neutral base segment plus whatever
   * it gained (green, stacked on top) or lost (red, stacked on top) once
   * completed. A still-active investment is just the base segment, since
   * there's nothing to show yet. */
  readonly investmentBreakdown = computed<{ bars: InvestmentBar[]; max: number }>(() => {
    const investments = [...(this.state.state()?.investments ?? [])].sort((a, b) => b.date.localeCompare(a.date));
    const bars: InvestmentBar[] = investments.map((inv) => {
      const gain = investmentGainValue(inv);
      const loss = investmentLossValue(inv);
      const finalOrAmount = inv.finalAmount ?? inv.amount;
      return {
        id: inv.id,
        name: inv.name,
        status: inv.status,
        amount: inv.amount,
        finalAmount: inv.finalAmount,
        baseAmount: Math.min(inv.amount, finalOrAmount),
        gain,
        loss,
        total: Math.max(inv.amount, finalOrAmount),
      };
    });
    const max = Math.max(0, ...bars.map((b) => b.total));
    return { bars, max };
  });

  /** Every Fixed Deposit on record (not just active ones - matured and
   * withdrawn deposits stay visible as a record of what happened), soonest
   * maturity first. */
  readonly fixedDepositLedger = computed<FdLedgerRow[]>(() => {
    const s = this.state.state();
    if (!s) return [];
    return [...s.fixedDeposits]
      .sort((a, b) => fdMaturityDate(a).localeCompare(fdMaturityDate(b)))
      .map((fd) => ({
        id: fd.id,
        bankName: s.banks.find((b) => b.id === fd.bankId)?.name ?? '—',
        principal: fd.amount,
        percentage: fd.percentage,
        months: fd.months,
        status: fd.status,
        maturityDate: fdMaturityDate(fd),
        maturityValue: fdMaturityValue(fd),
      }));
  });

  /** A bar's height against its series max, as a percentage - 0 when the
   * series has no data at all (`max` is 0) rather than a NaN/Infinity
   * height. */
  barHeightPercent(value: number, max: number): number {
    return max > 0 ? (value / max) * 100 : 0;
  }

  // ----- Zone 5: Recent Activity -------------------------------------------

  readonly recentTransactions = computed(() =>
    [...(this.state.state()?.transactions ?? [])]
      .sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')))
      .reverse()
      .slice(0, RECENT_COUNT),
  );

  /** Left-edge accent color per transaction *type* (not category) so a
   * transaction's kind reads at a glance even when it's Uncategorized -
   * today only the amount's sign hints at this, and expense/commitment/
   * others-out are visually indistinguishable from each other. */
  typeAccent(t: Transaction): string {
    switch (t.type) {
      case 'income':
        return 'var(--success)';
      case 'commitment':
        return 'var(--commitment)';
      case 'others-in':
      case 'others-out':
        return 'var(--accent)';
      default:
        return 'var(--danger)';
    }
  }

  money(amount: number): string {
    return formatMoney(amount, this.state.state()!.settings.currency);
  }

  numberPart(amount: number): string {
    return formatAmountNumber(amount);
  }

  /** Whole-number percentage for a ring label - `null` (no income this
   * month) renders as "0" rather than leaving the template to juggle a
   * nullable number. */
  pct0(value: number | null): string {
    return value === null ? '0' : Math.round(value).toString();
  }

  dateBadge(dateStr: string): { day: string; month: string } {
    return formatDateBadge(dateStr);
  }

  timeBadge(time?: string): string | null {
    return formatTimeBadge(time);
  }

  categoryName(id?: string): string {
    if (!id) return 'Uncategorized';
    return this.state.state()?.categories.find((c) => c.id === id)?.name ?? 'Uncategorized';
  }

  categoryColor(id?: string): string {
    return this.state.state()?.categories.find((c) => c.id === id)?.color ?? CATEGORY_COLOR_FALLBACK;
  }

  accountLabel(t: Transaction): string {
    const s = this.state.state();
    if (!s) return '';
    if (t.accountType === 'cash') return 'Cash';
    if (t.accountType === 'others') return 'Others';
    const list = t.accountType === 'bank' ? s.banks : t.accountType === 'wallet' ? s.wallets : s.cards;
    return list.find((a) => a.id === t.accountId)?.name ?? '—';
  }

  /** The specific bank/wallet/card's own color (set in Accounts), so the
   * account name next to a transaction gets a dot just like the category
   * name does - Cash/Others fall back to a neutral gray since they have no
   * color of their own in the data model. */
  accountColor(t: Transaction): string {
    const s = this.state.state();
    if (!s) return CATEGORY_COLOR_FALLBACK;
    if (t.accountType === 'cash' || t.accountType === 'others') return CATEGORY_COLOR_FALLBACK;
    const list = t.accountType === 'bank' ? s.banks : t.accountType === 'wallet' ? s.wallets : s.cards;
    return list.find((a) => a.id === t.accountId)?.color ?? CATEGORY_COLOR_FALLBACK;
  }
}
