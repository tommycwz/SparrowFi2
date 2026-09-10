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

    it('shows the empty state instead of a chart when there is no cash flow activity', () => {
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.cash-flow-chart')).toBeNull();
      expect(el.textContent).toContain('No income or expenses');
    });
  });
});
