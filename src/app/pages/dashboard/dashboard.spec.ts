import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardPage } from './dashboard';
import { StateService } from '../../core/state.service';
import { createEmptyState } from '../../core/models';
import { monthKeyOf } from '../../core/format.util';

/** Today's date, reused across tests so "this month" transactions always
 * land in `cashFlowTrend`'s most recent (current-month) bucket regardless
 * of when the suite runs. */
const TODAY = new Date().toISOString().slice(0, 10);

/** A date in the middle of last month, and one in the middle of last year -
 * for exercising the `categoryPeriod` filter's "Last Month"/"This Year" vs.
 * "everything else" boundaries regardless of when the suite runs. */
function daysAgoDate(monthsAgo: number): string {
  const d = new Date();
  d.setDate(1); // avoid month-length overflow (e.g. Mar 31 - 1 month != Feb 31)
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toISOString().slice(0, 10);
}
const LAST_MONTH = daysAgoDate(1);
const LAST_YEAR = `${new Date().getFullYear() - 1}-06-15`;

describe('DashboardPage charts', () => {
  let state: StateService;
  let page: DashboardPage;
  let fixture: ComponentFixture<DashboardPage>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [provideRouter([])],
    });
    state = TestBed.inject(StateService);
    state.replaceState(createEmptyState());
    fixture = TestBed.createComponent(DashboardPage);
    page = fixture.componentInstance;
  });

  describe('netStatLabel', () => {
    it('puts the minus sign before the currency symbol for a negative net (not sandwiched after it)', () => {
      state.addTransaction({ date: TODAY, amount: 200, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 500, type: 'expense', accountType: 'cash' });

      expect(page.monthlyStats().net).toBe(-300);
      const label = page.netStatLabel();
      expect(label.startsWith('-')).toBe(true);
      expect(label.lastIndexOf('-')).toBe(0);
      expect(label).toContain('300.00');
    });

    it('has no minus sign for a positive or zero net', () => {
      state.addTransaction({ date: TODAY, amount: 500, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 200, type: 'expense', accountType: 'cash' });
      expect(page.netStatLabel()).not.toContain('-');

      state.replaceState(createEmptyState());
      expect(page.netStatLabel()).not.toContain('-');
    });
  });

  describe('categoryDonutSegments', () => {
    it('turns this month’s category breakdown into stacked donut arcs summing to a full ring', () => {
      state.addCategory({ name: 'Groceries', color: '#EF4444', type: 'expense' });
      state.addCategory({ name: 'Transport', color: '#3B82F6', type: 'expense' });
      const [groceries, transport] = state.state()!.categories;

      state.addTransaction({
        date: TODAY,
        amount: 60,
        type: 'expense',
        accountType: 'cash',
        categoryId: groceries.id,
      });
      state.addTransaction({
        date: TODAY,
        amount: 40,
        type: 'expense',
        accountType: 'cash',
        categoryId: transport.id,
      });

      const segments = page.categoryDonutSegments();
      expect(segments.length).toBe(2);

      // Largest slice first (categoryBreakdown sorts descending), starting
      // at the donut's 12-o'clock offset (25).
      expect(segments[0].amount).toBe(60);
      expect(segments[0].dashArray).toBe('60 40');
      expect(segments[0].offset).toBe(25);

      // Second slice picks up exactly where the first left off.
      expect(segments[1].amount).toBe(40);
      expect(segments[1].dashArray).toBe('40 60');
      expect(segments[1].offset).toBe(25 - 60);

      // The two dash shares always add up to the full 100-unit ring.
      const totalDash = segments.reduce((sum, s) => sum + Number(s.dashArray.split(' ')[0]), 0);
      expect(totalDash).toBe(100);
    });

    it('is empty when there are no expenses this month', () => {
      expect(page.categoryDonutSegments()).toEqual([]);
    });
  });

  describe('categoryPeriod filtering', () => {
    beforeEach(() => {
      state.addCategory({ name: 'Groceries', color: '#EF4444', type: 'expense' });
      const groceries = state.state()!.categories[0].id;
      state.addTransaction({ date: TODAY, amount: 60, type: 'expense', accountType: 'cash', categoryId: groceries });
      state.addTransaction({
        date: LAST_MONTH,
        amount: 40,
        type: 'expense',
        accountType: 'cash',
        categoryId: groceries,
      });
      state.addTransaction({
        date: LAST_YEAR,
        amount: 25,
        type: 'expense',
        accountType: 'cash',
        categoryId: groceries,
      });
    });

    it('defaults to This Month and counts only this month’s expenses', () => {
      expect(page.categoryPeriod()).toBe('this-month');
      expect(page.categoryBreakdown().total).toBe(60);
    });

    it('Last Month counts only last month’s expenses, not this month’s', () => {
      page.categoryPeriod.set('last-month');
      expect(page.categoryBreakdown().total).toBe(40);
    });

    it('This Year counts everything since Jan 1 but excludes last year', () => {
      page.categoryPeriod.set('this-year');
      // LAST_MONTH only counts toward "this year" if the suite doesn't
      // happen to run in January (where "last month" is December of last
      // year) - compute the expectation rather than hardcoding it, so the
      // test doesn't flake once a year.
      const lastMonthIsThisYear = LAST_MONTH.slice(0, 4) === String(new Date().getFullYear());
      expect(page.categoryBreakdown().total).toBe(lastMonthIsThisYear ? 100 : 60);
    });

    it('All Time counts every expense regardless of date', () => {
      page.categoryPeriod.set('all-time');
      expect(page.categoryBreakdown().total).toBe(125);
    });
  });

  describe('cashFlowTrend', () => {
    it('always returns exactly 6 months, oldest first, ending on the current month', () => {
      const trend = page.cashFlowTrend();
      expect(trend.months.length).toBe(6);
      expect(trend.months[5].key).toBe(monthKeyOf());
    });

    it('buckets income and expense transactions into the current month and sets max', () => {
      state.addTransaction({ date: TODAY, amount: 500, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 200, type: 'expense', accountType: 'cash' });
      // others-in/others-out (e.g. fixed deposit transactions) shouldn't
      // count as cash flow - only real income/expense should.
      state.addTransaction({ date: TODAY, amount: 9000, type: 'others-in', accountType: 'cash' });

      const trend = page.cashFlowTrend();
      const current = trend.months[5];
      expect(current.income).toBe(500);
      expect(current.expense).toBe(200);
      expect(trend.max).toBe(500);
      expect(page.hasCashFlowActivity()).toBe(true);
    });

    it('reports no activity when the last 6 months are empty', () => {
      expect(page.hasCashFlowActivity()).toBe(false);
      expect(page.cashFlowTrend().max).toBe(0);
    });

    it('marks the year on the first bar and on every January, but not other months', () => {
      page.cashFlowRange.set(12);
      const months = page.cashFlowTrend().months;
      months.forEach((m, i) => {
        const isJanuary = new Date(`${m.key}-01T00:00:00`).getMonth() === 0;
        if (i === 0 || isJanuary) {
          expect(m.label).toContain("'");
        } else {
          expect(m.label).not.toContain("'");
        }
      });
    });

    it('widens or narrows to exactly cashFlowRange() months, still ending on the current month', () => {
      page.cashFlowRange.set(3);
      expect(page.cashFlowTrend().months.length).toBe(3);
      expect(page.cashFlowTrend().months[2].key).toBe(monthKeyOf());

      page.cashFlowRange.set(12);
      expect(page.cashFlowTrend().months.length).toBe(12);
      expect(page.cashFlowTrend().months[11].key).toBe(monthKeyOf());
    });
  });

  describe('barHeightPercent', () => {
    it('scales a value against the chart max', () => {
      expect(page.barHeightPercent(50, 100)).toBe(50);
      expect(page.barHeightPercent(100, 100)).toBe(100);
    });

    it('returns 0 rather than NaN when max is 0 (no activity at all)', () => {
      expect(page.barHeightPercent(0, 0)).toBe(0);
    });
  });

  describe('rendered DOM', () => {
    it('draws one donut <circle> per category plus the background track', () => {
      state.addCategory({ name: 'Groceries', color: '#EF4444', type: 'expense' });
      state.addTransaction({
        date: TODAY,
        amount: 60,
        type: 'expense',
        accountType: 'cash',
        categoryId: state.state()!.categories[0].id,
      });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const circles = el.querySelectorAll('.donut-svg circle');
      // 1 background track + 1 category segment.
      expect(circles.length).toBe(2);
      const segment = el.querySelector('.donut-segment')!;
      expect(segment.getAttribute('stroke')).toBe('#EF4444');
      expect(segment.getAttribute('stroke-dasharray')).toBe('100 0');
    });

    it('renders 6 cash-flow columns with bars scaled by inline height', () => {
      state.addTransaction({ date: TODAY, amount: 500, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 250, type: 'expense', accountType: 'cash' });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const cols = el.querySelectorAll('.cash-flow-col');
      expect(cols.length).toBe(6);

      const lastCol = cols[5];
      const incomeBar = lastCol.querySelector('.cash-flow-bar.income') as HTMLElement;
      const expenseBar = lastCol.querySelector('.cash-flow-bar.expense') as HTMLElement;
      expect(incomeBar.style.height).toBe('100%');
      expect(expenseBar.style.height).toBe('50%');
    });

    it('colors the Net This Month stat green when positive and red when negative', () => {
      state.addTransaction({ date: TODAY, amount: 500, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 900, type: 'expense', accountType: 'cash' });
      fixture.detectChanges();

      const stats = fixture.nativeElement.querySelectorAll('.stat .stat-value');
      const netEl = stats[2] as HTMLElement; // Monthly Income, Monthly Expense, Net This Month
      expect(netEl.classList.contains('negative')).toBe(true);
      expect(netEl.classList.contains('positive')).toBe(false);

      state.addTransaction({ date: TODAY, amount: 1000, type: 'income', accountType: 'cash' });
      fixture.detectChanges();
      expect(netEl.classList.contains('positive')).toBe(true);
      expect(netEl.classList.contains('negative')).toBe(false);
    });

    it('shows the empty state instead of a chart when there is no cash flow activity', () => {
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.cash-flow-chart')).toBeNull();
      expect(el.textContent).toContain('No income or expenses');
    });

    it("shows the specific bank's own color next to its name in Recent Transactions", () => {
      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 1000 });
      fixture.detectChanges();

      const row = fixture.nativeElement.querySelector('.tx-row') as HTMLElement;
      const dots = row.querySelectorAll('.tx-dot');
      // First dot is the category's, second is the account's.
      expect((dots[1] as HTMLElement).style.background).toBe('rgb(37, 99, 235)');
      expect(row.querySelector('.tx-account')?.textContent).toContain('Maybank');
    });

    it('clicking a Cash Flow range tab switches the chart to that many months', () => {
      // Some activity is needed, or the chart renders the empty state
      // instead of `.cash-flow-col` bars regardless of the selected range.
      state.addTransaction({ date: TODAY, amount: 100, type: 'income', accountType: 'cash' });
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;

      const tabs = Array.from(el.querySelectorAll<HTMLButtonElement>('.range-tab'));
      expect(tabs.map((t) => t.textContent?.trim())).toEqual(['3M', '6M', '12M']);
      // 6M is the default.
      expect(tabs[1].classList.contains('active')).toBe(true);

      tabs[2].click();
      fixture.detectChanges();
      expect(page.cashFlowRange()).toBe(12);
      expect(tabs[2].classList.contains('active')).toBe(true);
      expect(el.querySelectorAll('.cash-flow-col').length).toBe(12);
    });

    it('changing the Spending by Category period select re-filters the breakdown', () => {
      state.addCategory({ name: 'Groceries', color: '#EF4444', type: 'expense' });
      state.addTransaction({
        date: LAST_MONTH,
        amount: 40,
        type: 'expense',
        accountType: 'cash',
        categoryId: state.state()!.categories[0].id,
      });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      // Nothing this month, so the empty state shows initially.
      expect(el.querySelector('.breakdown-card')).toBeNull();

      const select = el.querySelector('select.period-select') as HTMLSelectElement;
      select.value = 'last-month';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(page.categoryPeriod()).toBe('last-month');
      expect(el.querySelector('.breakdown-card')).not.toBeNull();
      expect(el.querySelector('.breakdown-amount')?.textContent).toContain('40.00');
    });
  });
});
