import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StateService } from '../../core/state.service';
import { formatMoney } from '../../core/currency.util';
import { CURRENCIES, Transaction } from '../../core/models';
import { fdMaturityDate, fdMaturityValue } from '../../core/fixed-deposit.util';
import { formatAmountNumber, formatDateBadge, formatTimeBadge, monthKeyOf } from '../../core/format.util';
import { IconComponent } from '../../shared/icon';

const CATEGORY_COLOR_FALLBACK = '#94A3B8';
const OTHER_SLICE_COLOR = '#78716C';
/** How many individual categories to break out before lumping the rest into "Other". */
const TOP_CATEGORY_COUNT = 5;
/** How many transactions to show in the Recent Transactions list. */
const RECENT_COUNT = 6;

interface CategorySlice {
  id: string;
  name: string;
  color: string;
  amount: number;
  percent: number;
}

/** A `CategorySlice` plus the two SVG `stroke-dasharray`/`stroke-dashoffset`
 * values that draw its arc of the donut chart - see `categoryDonutSegments`. */
interface DonutSegment extends CategorySlice {
  dashArray: string;
  offset: number;
}

interface MonthFlow {
  key: string;
  label: string;
  income: number;
  expense: number;
}

/** How many months of history the Cash Flow chart shows. */
const CASH_FLOW_MONTHS = 6;
/** Circumference of the donut's SVG circle when its radius is 15.9155 -
 * chosen (the standard "no-library donut chart" trick) specifically so a
 * percentage (0-100) can be used directly as a stroke-dasharray/dashoffset
 * value instead of a real arc-length calculation. */
const DONUT_CIRCUMFERENCE = 100;

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class DashboardPage {
  constructor(readonly state: StateService) {}

  readonly netWorthLabel = computed(() =>
    formatMoney(this.state.netWorth(), this.state.state()!.settings.currency),
  );

  readonly currencySymbol = computed(() => {
    const currency = this.state.state()?.settings.currency;
    return CURRENCIES.find((c) => c.value === currency)?.symbol ?? '';
  });

  /** Income/expense/net for the real current calendar month - a fixed,
   * glanceable "how am I doing right now", separate from the Transactions
   * page's own navigable month filter. */
  readonly monthlyStats = computed(() => {
    const s = this.state.state();
    if (!s) return { income: 0, expense: 0, net: 0 };
    const monthKey = monthKeyOf();
    let income = 0;
    let expense = 0;
    for (const t of s.transactions) {
      if (t.date.slice(0, 7) !== monthKey) continue;
      if (t.type === 'income') income += t.amount;
      else if (t.type === 'expense') expense += t.amount;
    }
    return { income, expense, net: income - expense };
  });

  readonly netWorthDeltaPositive = computed(() => this.monthlyStats().net >= 0);

  readonly netWorthDeltaLabel = computed(() => {
    const net = this.monthlyStats().net;
    const sign = net >= 0 ? '+' : '-';
    return `${sign}${this.currencySymbol()}${formatAmountNumber(Math.abs(net))} this month`;
  });

  /** "Net This Month" stat value - sign-then-symbol-then-magnitude, same
   * pattern as `netWorthDeltaLabel` (and the fix in `formatMoney`): the
   * symbol always comes before the digits, and any minus sign always comes
   * before the symbol, rather than a `currencySymbol() + numberPart(net)`
   * concatenation that (for a negative `net`) would sandwich the minus
   * sign that `formatAmountNumber` itself produces between the two,
   * e.g. "RM-500.00" instead of "-RM500.00". */
  readonly netStatLabel = computed(() => {
    const net = this.monthlyStats().net;
    const sign = net < 0 ? '-' : '';
    return `${sign}${this.currencySymbol()}${formatAmountNumber(Math.abs(net))}`;
  });

  /** This month's expenses grouped by category, sorted largest first, with
   * anything past the top few folded into a single "Other" slice - the
   * classic "where did my money go" dashboard widget. */
  readonly categoryBreakdown = computed<{ items: CategorySlice[]; total: number }>(() => {
    const s = this.state.state();
    if (!s) return { items: [], total: 0 };
    const monthKey = monthKeyOf();
    const totals = new Map<string, number>();
    for (const t of s.transactions) {
      if (t.type !== 'expense' || t.date.slice(0, 7) !== monthKey) continue;
      const key = t.categoryId ?? '__uncategorized__';
      totals.set(key, (totals.get(key) ?? 0) + t.amount);
    }

    const rows = [...totals.entries()]
      .map(([id, amount]) => {
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
      })
      .sort((a, b) => b.amount - a.amount);

    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    let items = rows.slice(0, TOP_CATEGORY_COUNT);
    const rest = rows.slice(TOP_CATEGORY_COUNT);
    if (rest.length > 0) {
      items = [
        ...items,
        { id: '__other__', name: 'Other', color: OTHER_SLICE_COLOR, amount: rest.reduce((s2, r) => s2 + r.amount, 0) },
      ];
    }

    return {
      items: items.map((r) => ({ ...r, percent: total > 0 ? (r.amount / total) * 100 : 0 })),
      total,
    };
  });

  /** `categoryBreakdown`'s slices, redrawn as donut-chart arcs. Each
   * `<circle>` in the template is stroked with `stroke-dasharray="dash
   * (100-dash)"` and `stroke-dashoffset="offset"` - offset starts at 25 (a
   * quarter-turn, since the browser draws circles starting at 3 o'clock)
   * and decreases by each prior slice's share, so consecutive slices chain
   * around the ring clockwise from 12 o'clock with no gaps. */
  readonly categoryDonutSegments = computed<DonutSegment[]>(() => {
    let cumulative = 0;
    return this.categoryBreakdown().items.map((slice) => {
      const dash = slice.percent;
      const offset = DONUT_CIRCUMFERENCE / 4 - cumulative;
      cumulative += dash;
      return {
        ...slice,
        dashArray: `${dash} ${DONUT_CIRCUMFERENCE - dash}`,
        offset,
      };
    });
  });

  /** Income vs. expense for each of the last `CASH_FLOW_MONTHS` months
   * (this one included), oldest first, plus the largest single bar value
   * so the template can scale every bar to the same axis. Always returns
   * exactly `CASH_FLOW_MONTHS` entries, even for months with no activity,
   * so the chart's x-axis is stable rather than shrinking when recent
   * months are quiet. */
  readonly cashFlowTrend = computed<{ months: MonthFlow[]; max: number }>(() => {
    const s = this.state.state();
    const now = new Date();
    const buckets = new Map<string, { income: number; expense: number }>();
    const keys: string[] = [];
    for (let i = CASH_FLOW_MONTHS - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKeyOf(d);
      keys.push(key);
      buckets.set(key, { income: 0, expense: 0 });
    }
    for (const t of s?.transactions ?? []) {
      const bucket = buckets.get(t.date.slice(0, 7));
      if (!bucket) continue;
      if (t.type === 'income') bucket.income += t.amount;
      else if (t.type === 'expense') bucket.expense += t.amount;
    }
    const months = keys.map((key) => {
      const b = buckets.get(key)!;
      const label = new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, {
        month: 'short',
      });
      return { key, label, income: b.income, expense: b.expense };
    });
    const max = Math.max(0, ...months.flatMap((m) => [m.income, m.expense]));
    return { months, max };
  });

  readonly hasCashFlowActivity = computed(() =>
    this.cashFlowTrend().months.some((m) => m.income > 0 || m.expense > 0),
  );

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
    };
  });

  readonly recentTransactions = computed(() =>
    [...(this.state.state()?.transactions ?? [])]
      .sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')))
      .reverse()
      .slice(0, RECENT_COUNT),
  );

  money(amount: number): string {
    return formatMoney(amount, this.state.state()!.settings.currency);
  }

  /** A bar's height as a percentage of the chart's tallest bar (`max`), for
   * the Cash Flow chart. Guards the `max === 0` case (no activity at all
   * in any of the charted months) so bars come out at 0% instead of NaN%. */
  barHeightPercent(value: number, max: number): number {
    return max > 0 ? (value / max) * 100 : 0;
  }

  numberPart(amount: number): string {
    return formatAmountNumber(amount);
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
