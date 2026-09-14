import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { StateService } from '../../core/state.service';
import { formatMoney } from '../../core/currency.util';
import { CURRENCIES, Transaction } from '../../core/models';
import { fdMaturityDate, fdMaturityValue } from '../../core/fixed-deposit.util';
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
 * Average Monthly Burn and each category's pace baseline are computed
 * over - capped by however much history the account actually has, via
 * `earliestMonthOf`, so a 2-week-old file doesn't get dragged toward zero
 * by months before any data existed. */
const TRAILING_MONTHS = 3;
/** How many categories Category Pace surfaces - deliberately smaller than
 * the old Spending by Category donut's top-5-then-Other, since this widget
 * is meant to be skimmed as a glance, not read as a breakdown. */
const PACE_TOP_COUNT = 4;
/** Fixed axis a Category Pace bar is drawn against: 0-160% of baseline,
 * with the "100% of baseline" tick always at the same spot (100/160 =
 * 62.5%, set once in `dashboard.scss` on `.pace-mark`) - a bar's *fill*
 * width still varies per row, but the tick never has to move, since it's
 * marking the same 100% point on the same scale every time. A pace over
 * the axis max still fills the full bar rather than overflowing it. */
const PACE_AXIS_MAX = 160;
/** Circumference of the donut's SVG circle when its radius is 15.9155 -
 * the standard "no-library donut chart" trick, so a percentage (0-100) can
 * be used directly as a stroke-dasharray/dashoffset value. Shared by the
 * Savings Rate ring below. */
const DONUT_CIRCUMFERENCE = 100;

interface MonthlyStats {
  income: number;
  expense: number;
  commitment: number;
  net: number;
}

interface SparklinePoint {
  x: number;
  y: number;
}

interface CashSparkline {
  linePath: string;
  areaPath: string;
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

type PaceBand = 'under' | 'on' | 'over' | 'new';

interface CategoryPaceRow {
  id: string;
  name: string;
  color: string;
  current: number;
  baseline: number | null;
  pct: number | null;
  band: PaceBand;
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
    const empty: CashSparkline = { linePath: '', areaPath: '', endPoint: null, deltaLabel: '', deltaPositive: true };
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
    const points = values.map((v, i) => ({
      x: pad + i * stepX,
      y: height - pad - ((v - min) / range) * (height - pad * 2),
    }));

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${height - pad} L${points[0].x.toFixed(1)},${height - pad} Z`;

    const delta = values[values.length - 1] - values[0];
    const sign = delta < 0 ? '-' : '+';
    return {
      linePath,
      areaPath,
      endPoint: points[points.length - 1],
      deltaLabel: `${sign}${this.currencySymbol()}${formatAmountNumber(Math.abs(delta))} · last ${SPARKLINE_DAYS} days`,
      deltaPositive: delta >= 0,
    };
  });

  // ----- Zone 2: Short-Term Liquidity -------------------------------------

  /** 'YYYY-MM' key of this account's very first transaction, or the current
   * month if there are no transactions yet - the floor that keeps
   * `avgMonthlyBurn` and `categoryPace` from averaging in months before any
   * data existed. */
  private readonly earliestMonth = computed(() => {
    const s = this.state.state();
    if (!s || s.transactions.length === 0) return monthKeyOf();
    return s.transactions.reduce((min, t) => (t.date.slice(0, 7) < min ? t.date.slice(0, 7) : min), s.transactions[0].date.slice(0, 7));
  });

  /** The last `TRAILING_MONTHS` *completed* calendar months (this month
   * excluded, floored at `earliestMonth`) as 'YYYY-MM' keys - the shared
   * trailing window both `avgMonthlyBurn` and `categoryPace` average over,
   * so the two widgets can never silently disagree on how many months of
   * history they're each basing themselves on. Exposed as
   * `trailingMonthsCounted` for the Category Pace caption. */
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

  readonly trailingMonthsCounted = computed(() => this.trailingMonthKeys().length);

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

  readonly netStatLabel = computed(() => {
    const net = this.monthlyStats().net;
    const sign = net < 0 ? '-' : '';
    return `${sign}${this.currencySymbol()}${formatAmountNumber(Math.abs(net))}`;
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

  /** Top `PACE_TOP_COUNT` expense categories by this month's spend, each
   * against its own baseline over `trailingMonthKeys()` (zero-filled for
   * quiet months within the account's history - the same shared trailing
   * window `avgMonthlyBurn` uses, so the Liquidity row and this widget
   * always agree on "how many months of history" they're each showing).
   * A category with no baseline history yet gets `band: 'new'` instead of
   * a fabricated ratio - deliberately `type: 'expense'` only, same
   * "discretionary/variable spend" scope as the widget it replaces. One
   * pass over transactions rather than one pass per category, to stay
   * linear in transaction count regardless of how many categories exist. */
  readonly categoryPace = computed<CategoryPaceRow[]>(() => {
    const s = this.state.state();
    const trailingKeys = this.trailingMonthKeys();
    if (!s || s.transactions.length === 0) return [];

    const currentMonthKey = monthKeyOf();
    const trailingSet = new Set(trailingKeys);

    const currentTotals = new Map<string, number>();
    const trailingTotals = new Map<string, number>();
    for (const t of s.transactions) {
      if (t.type !== 'expense') continue;
      const monthKey = t.date.slice(0, 7);
      const catKey = t.categoryId ?? '__uncategorized__';
      if (monthKey === currentMonthKey) {
        currentTotals.set(catKey, (currentTotals.get(catKey) ?? 0) + t.amount);
      } else if (trailingSet.has(monthKey)) {
        trailingTotals.set(catKey, (trailingTotals.get(catKey) ?? 0) + t.amount);
      }
    }

    const topIds = [...currentTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, PACE_TOP_COUNT)
      .map(([id]) => id);

    return topIds.map((id) => {
      const current = currentTotals.get(id) ?? 0;
      const baseline = trailingKeys.length > 0 ? (trailingTotals.get(id) ?? 0) / trailingKeys.length : null;
      const pct = baseline !== null && baseline > 0 ? (current / baseline) * 100 : null;
      const cat = id === '__uncategorized__' ? undefined : s.categories.find((c) => c.id === id);
      const band: PaceBand = pct === null ? 'new' : pct > 110 ? 'over' : pct < 80 ? 'under' : 'on';
      return {
        id,
        name: cat?.name ?? 'Uncategorized',
        color: cat?.color ?? CATEGORY_COLOR_FALLBACK,
        current,
        baseline,
        pct,
        band,
      };
    });
  });

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

  /** Whole-number percentage for a ring/pace label - `null` (no income, or
   * no baseline yet) renders as "0" rather than leaving the template to
   * juggle a nullable number. */
  pct0(value: number | null): string {
    return value === null ? '0' : Math.round(value).toString();
  }

  /** A Category Pace row's fill width against the fixed `PACE_AXIS_MAX`
   * scale (see its doc comment) - capped at 100% of the bar itself so a
   * category running well over its baseline still renders as a full bar
   * plus its (uncapped) percentage label, not an overflowing one. */
  paceFillPercent(row: CategoryPaceRow): number {
    if (row.pct === null) return 0;
    return Math.min(row.pct, PACE_AXIS_MAX) / PACE_AXIS_MAX * 100;
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
