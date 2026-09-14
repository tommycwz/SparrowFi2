import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardPage } from './dashboard';
import { StateService } from '../../core/state.service';
import { createEmptyState } from '../../core/models';

/** Today's date, reused across tests so "this month" transactions always
 * land in `monthlyStats`/`savingsRate`/`categoryPace`'s current-month bucket
 * regardless of when the suite runs. */
const TODAY = new Date().toISOString().slice(0, 10);

/** The 1st of the month `monthsAgo` calendar months back - for building
 * transactions that land in `avgMonthlyBurn`/`categoryPace`'s trailing
 * (completed-month) window without ever landing in the current month.
 * Anchored to day 1 to sidestep month-length overflow (e.g. Mar 31 minus one
 * month isn't Feb 31). */
function monthsAgoDate(monthsAgo: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toISOString().slice(0, 10);
}

describe('DashboardPage', () => {
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

  describe('monthlyStats commitment handling', () => {
    it('breaks Commitment out from Expense, but still subtracts it from Net This Month', () => {
      state.addTransaction({ date: TODAY, amount: 5000, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 800, type: 'expense', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 1200, type: 'commitment', accountType: 'cash' });

      const stats = page.monthlyStats();
      expect(stats.expense).toBe(800);
      expect(stats.commitment).toBe(1200);
      expect(stats.net).toBe(5000 - 800 - 1200);
    });
  });

  describe('monthlyStats Fixed Deposit neutrality', () => {
    it('does not move Net This Month when a new FD is placed - it is now counted in Net Worth instead', () => {
      state.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 0 });
      const bankId = state.state()!.banks[0].id;
      state.addTransaction({ date: TODAY, amount: 5000, type: 'income', accountType: 'cash' });
      // Placing a new FD - StateService books this as an fdId-linked "others-out".
      state.addTransaction({
        date: TODAY,
        amount: 2000,
        type: 'others-out',
        accountType: 'bank',
        accountId: bankId,
        fdId: 'fd-1',
      });

      expect(page.monthlyStats().net).toBe(5000);
    });

    it('does not move Net This Month when an FD matures - only its interest (income) does', () => {
      state.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 0 });
      const bankId = state.state()!.banks[0].id;
      state.addTransaction({ date: TODAY, amount: 5000, type: 'income', accountType: 'cash' });
      // An FD maturing this month - StateService books its principal back
      // as an fdId-linked "others-in" (neutral) and its interest as a
      // plain "income" transaction (which should count as normal).
      state.addTransaction({
        date: TODAY,
        amount: 1000,
        type: 'others-in',
        accountType: 'bank',
        accountId: bankId,
        fdId: 'fd-2',
      });
      state.addTransaction({ date: TODAY, amount: 50, type: 'income', accountType: 'bank', accountId: bankId });

      expect(page.monthlyStats().net).toBe(5000 + 50);
    });

    it('does not fold a plain (non-FD) others-in/others-out transfer into Net This Month either', () => {
      state.addTransaction({ date: TODAY, amount: 5000, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 800, type: 'others-out', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 300, type: 'others-in', accountType: 'cash' });

      expect(page.monthlyStats().net).toBe(5000);
    });
  });

  describe('liquidCash / liquidAccounts / cardAccounts', () => {
    it('excludes card balances from liquidCash and keeps them out of liquidAccounts', () => {
      state.addBank({ name: 'Main Bank', color: '#111111', initialCapital: 500 });
      state.addCard({ name: 'Visa', color: '#222222' });
      const cardId = state.state()!.cards[0].id;
      state.addTransaction({ date: TODAY, amount: 100, type: 'expense', accountType: 'card', accountId: cardId });
      state.addTransaction({ date: TODAY, amount: 50, type: 'expense', accountType: 'cash' });

      expect(page.liquidCash()).toBe(500 - 50);
      expect(page.liquidAccounts().some((a) => a.kind === 'card')).toBe(false);
      expect(page.cardAccounts().length).toBe(1);
      expect(page.cardAccounts()[0].balance).toBe(-100);
    });
  });

  describe('cashSparkline', () => {
    it('reflects a positive net change over the window and ends with a plottable point', () => {
      // A nonzero `initialCapital` books its own "Initial balance" `others-in`
      // transaction dated today (see `StateService.addBank`) - that would
      // land inside this 30-day window right alongside whatever the test
      // adds and swamp the signal being tested, so the bank starts at 0 here
      // and the explicit transaction below is the only thing moving the
      // window's balance.
      state.addBank({ name: 'Main Bank', color: '#111', initialCapital: 0 });
      const bankId = state.state()!.banks[0].id;
      state.addTransaction({ date: TODAY, amount: 200, type: 'income', accountType: 'bank', accountId: bankId });

      const spark = page.cashSparkline();
      expect(spark.endPoint).not.toBeNull();
      expect(spark.deltaPositive).toBe(true);
      expect(spark.deltaLabel).toContain('200.00');
      expect(spark.linePath.startsWith('M')).toBe(true);
    });

    it('flags a negative delta when liquid cash fell over the window', () => {
      // See the comment above - `initialCapital: 0` keeps the opening
      // balance from creating its own same-day transaction inside the
      // window.
      state.addBank({ name: 'Main Bank', color: '#111', initialCapital: 0 });
      const bankId = state.state()!.banks[0].id;
      state.addTransaction({ date: TODAY, amount: 300, type: 'expense', accountType: 'bank', accountId: bankId });

      const spark = page.cashSparkline();
      expect(spark.deltaPositive).toBe(false);
      expect(spark.deltaLabel.startsWith('-')).toBe(true);
    });

    it('ignores card transactions - they never affect liquid cash history', () => {
      state.addCard({ name: 'Visa', color: '#222' });
      const cardId = state.state()!.cards[0].id;
      state.addTransaction({ date: TODAY, amount: 500, type: 'expense', accountType: 'card', accountId: cardId });

      expect(page.cashSparkline().deltaLabel).toContain('0.00');
    });
  });

  describe('avgMonthlyBurn / cashRunway', () => {
    it('reports unknown runway when there is no burn history yet', () => {
      expect(page.avgMonthlyBurn().monthsCounted).toBe(0);
      const runway = page.cashRunway();
      expect(runway.label).toBe('—');
      expect(runway.band).toBe('unknown');
    });

    it('averages Expense + Commitment over the last 3 completed months, excluding this month', () => {
      state.addTransaction({ date: monthsAgoDate(1), amount: 300, type: 'expense', accountType: 'cash' });
      state.addTransaction({ date: monthsAgoDate(2), amount: 200, type: 'commitment', accountType: 'cash' });
      state.addTransaction({ date: monthsAgoDate(3), amount: 100, type: 'expense', accountType: 'cash' });
      // This month's own spending must NOT count toward the trailing average.
      state.addTransaction({ date: TODAY, amount: 999, type: 'expense', accountType: 'cash' });

      const burn = page.avgMonthlyBurn();
      expect(burn.monthsCounted).toBe(3);
      expect(burn.amount).toBeCloseTo((300 + 200 + 100) / 3, 5);
    });

    it('reports "∞" (safe) when average burn is zero but there is trailing history', () => {
      state.addTransaction({ date: monthsAgoDate(1), amount: 100, type: 'income', accountType: 'cash' });
      expect(page.avgMonthlyBurn().monthsCounted).toBe(1);
      expect(page.avgMonthlyBurn().amount).toBe(0);
      const runway = page.cashRunway();
      expect(runway.label).toBe('∞');
      expect(runway.band).toBe('safe');
    });

    it('reports "0.0" (critical) when liquid cash is already at or below zero', () => {
      state.addTransaction({ date: monthsAgoDate(1), amount: 500, type: 'expense', accountType: 'cash' });
      expect(page.liquidCash()).toBeLessThanOrEqual(0);
      const runway = page.cashRunway();
      expect(runway.label).toBe('0.0');
      expect(runway.band).toBe('critical');
    });

    it('computes months of runway and bands it caution between 1 and 3 months', () => {
      state.addBank({ name: 'Main Bank', color: '#111', initialCapital: 1000 });
      const bankId = state.state()!.banks[0].id;
      state.addTransaction({
        date: monthsAgoDate(1),
        amount: 500,
        type: 'expense',
        accountType: 'bank',
        accountId: bankId,
      });
      // liquidCash = 1000 - 500 = 500; avg burn = 500 / 1 month = 500 -> 1.0 month of runway.
      const runway = page.cashRunway();
      expect(runway.label).toBe('1.0');
      expect(runway.band).toBe('caution');
    });
  });

  describe('cardDebt', () => {
    it('is zero when no card is in debt (a card in credit does not count)', () => {
      state.addCard({ name: 'Visa', color: '#111' });
      const cardId = state.state()!.cards[0].id;
      state.addTransaction({ date: TODAY, amount: 100, type: 'others-in', accountType: 'card', accountId: cardId });

      expect(page.cardDebt().total).toBe(0);
      expect(page.cardDebt().lines.length).toBe(0);
    });

    it('sums every card in debt and shows the worst offenders first, capped at 3 lines', () => {
      const debts = [50, 300, 100, 10];
      debts.forEach((_, i) => state.addCard({ name: `Card ${i}`, color: '#111' }));
      const cards = state.state()!.cards;
      cards.forEach((c, i) => {
        state.addTransaction({ date: TODAY, amount: debts[i], type: 'expense', accountType: 'card', accountId: c.id });
      });

      const debt = page.cardDebt();
      expect(debt.total).toBe(50 + 300 + 100 + 10);
      expect(debt.lines.length).toBe(3);
      expect(debt.lines.map((l) => l.amount)).toEqual([300, 100, 50]);
    });
  });

  describe('fixedDepositSummary', () => {
    it('is null when there are no active fixed deposits', () => {
      expect(page.fixedDepositSummary()).toBeNull();
    });

    it('surfaces the soonest-maturing active deposit and totals every active principal', () => {
      state.addBank({ name: 'Main Bank', color: '#111', initialCapital: 0 });
      const bankId = state.state()!.banks[0].id;
      state.addFixedDeposit({ bankId, startDate: TODAY, amount: 1000, percentage: 5, months: 12, status: 'active' });
      state.addFixedDeposit({ bankId, startDate: TODAY, amount: 500, percentage: 3, months: 1, status: 'active' });
      // A matured deposit shouldn't count toward the active total or be
      // eligible as "next maturity".
      state.addFixedDeposit({ bankId, startDate: TODAY, amount: 2000, percentage: 2, months: 1, status: 'matured' });

      const summary = page.fixedDepositSummary()!;
      expect(summary).not.toBeNull();
      expect(summary.count).toBe(2);
      expect(summary.totalPrincipal).toBe(1500);
      expect(summary.nextBankName).toBe('Main Bank');
    });
  });

  describe('savingsRate', () => {
    it('has no income this month', () => {
      const rate = page.savingsRate();
      expect(rate.hasIncome).toBe(false);
      expect(rate.segments).toEqual([]);
    });

    it('splits income into committed/variable/saved shares that sum to a full ring', () => {
      state.addTransaction({ date: TODAY, amount: 1000, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 300, type: 'commitment', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 200, type: 'expense', accountType: 'cash' });

      const rate = page.savingsRate();
      expect(rate.hasIncome).toBe(true);
      expect(rate.overspent).toBe(false);
      expect(rate.ratePct).toBeCloseTo(50, 5);
      const totalDash = rate.segments.reduce((sum, s) => sum + Number(s.dashArray.split(' ')[0]), 0);
      expect(totalDash).toBeCloseTo(100, 5);
    });

    it('scales the drawn ring down to a full turn (but keeps the real negative rate) when overspent', () => {
      state.addTransaction({ date: TODAY, amount: 100, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 80, type: 'commitment', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 60, type: 'expense', accountType: 'cash' });

      const rate = page.savingsRate();
      expect(rate.overspent).toBe(true);
      expect(rate.ratePct).toBeCloseTo(-40, 5);
      const totalDash = rate.segments.reduce((sum, s) => sum + Number(s.dashArray.split(' ')[0]), 0);
      expect(totalDash).toBeCloseTo(100, 5);
    });
  });

  describe('categoryPace', () => {
    it('is empty when there are no expense transactions at all', () => {
      expect(page.categoryPace()).toEqual([]);
    });

    it('flags a category "new" when it has no trailing baseline yet', () => {
      state.addCategory({ name: 'Groceries', color: '#EF4444', type: 'expense' });
      const catId = state.state()!.categories[0].id;
      state.addTransaction({ date: TODAY, amount: 60, type: 'expense', accountType: 'cash', categoryId: catId });

      const pace = page.categoryPace();
      expect(pace.length).toBe(1);
      expect(pace[0].band).toBe('new');
      expect(pace[0].baseline).toBeNull();
    });

    it('bands a category "over" once this month clears 110% of its trailing average', () => {
      state.addCategory({ name: 'Groceries', color: '#EF4444', type: 'expense' });
      const catId = state.state()!.categories[0].id;
      // Baseline: 100/month over the last 3 completed months.
      state.addTransaction({ date: monthsAgoDate(1), amount: 100, type: 'expense', accountType: 'cash', categoryId: catId });
      state.addTransaction({ date: monthsAgoDate(2), amount: 100, type: 'expense', accountType: 'cash', categoryId: catId });
      state.addTransaction({ date: monthsAgoDate(3), amount: 100, type: 'expense', accountType: 'cash', categoryId: catId });
      // This month so far: well over baseline.
      state.addTransaction({ date: TODAY, amount: 150, type: 'expense', accountType: 'cash', categoryId: catId });

      const row = page.categoryPace()[0];
      expect(row.baseline).toBeCloseTo(100, 5);
      expect(row.pct).toBeCloseTo(150, 5);
      expect(row.band).toBe('over');
    });

    it('keeps only the top 4 categories by this month’s spend', () => {
      for (let i = 0; i < 5; i++) {
        state.addCategory({ name: `Cat ${i}`, color: '#111', type: 'expense' });
      }
      const cats = state.state()!.categories;
      cats.forEach((c, i) => {
        state.addTransaction({ date: TODAY, amount: (i + 1) * 10, type: 'expense', accountType: 'cash', categoryId: c.id });
      });

      expect(page.categoryPace().length).toBe(4);
      expect(page.categoryPace()[0].current).toBe(50);
    });
  });

  describe('recentTransactions / typeAccent', () => {
    it('keeps only the 5 most recent transactions', () => {
      for (let i = 0; i < 7; i++) {
        state.addTransaction({ date: TODAY, amount: i + 1, type: 'expense', accountType: 'cash' });
      }
      expect(page.recentTransactions().length).toBe(5);
    });

    it('colors each transaction type distinctly, with transfers and expense-like types sharing a look', () => {
      expect(page.typeAccent({ type: 'income' } as any)).toBe('var(--success)');
      expect(page.typeAccent({ type: 'commitment' } as any)).toBe('var(--commitment)');
      expect(page.typeAccent({ type: 'others-in' } as any)).toBe('var(--accent)');
      expect(page.typeAccent({ type: 'others-out' } as any)).toBe('var(--accent)');
      expect(page.typeAccent({ type: 'expense' } as any)).toBe('var(--danger)');
    });
  });

  describe('rendered DOM', () => {
    it('shows Available Cash in the hero and colors Net This Month green/red', () => {
      state.addBank({ name: 'Main Bank', color: '#111', initialCapital: 1000 });
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.hero-num')?.textContent).toContain('1,000.00');

      state.addTransaction({ date: TODAY, amount: 500, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 900, type: 'expense', accountType: 'cash' });
      fixture.detectChanges();

      const stats = el.querySelectorAll('.stat .stat-value');
      const netEl = stats[3] as HTMLElement; // Income, Expense, Commitment, Net This Month
      expect(netEl.classList.contains('negative')).toBe(true);
      expect(netEl.classList.contains('positive')).toBe(false);

      state.addTransaction({ date: TODAY, amount: 1000, type: 'income', accountType: 'cash' });
      fixture.detectChanges();
      expect(netEl.classList.contains('positive')).toBe(true);
      expect(netEl.classList.contains('negative')).toBe(false);
    });

    it('only draws the runway meter pointer once there is burn history', () => {
      fixture.detectChanges();
      let el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.meter-pointer')).toBeNull();
      expect(el.textContent).toContain('Not enough history yet');

      state.addTransaction({ date: monthsAgoDate(1), amount: 100, type: 'expense', accountType: 'cash' });
      fixture.detectChanges();
      el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.meter-pointer')).not.toBeNull();
    });

    it('shows card debt lines only once a card is actually in debt', () => {
      fixture.detectChanges();
      let el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('No card debt outstanding');
      expect(el.querySelectorAll('.debt-line').length).toBe(0);

      state.addCard({ name: 'Visa', color: '#2563EB' });
      const cardId = state.state()!.cards[0].id;
      state.addTransaction({ date: TODAY, amount: 250, type: 'expense', accountType: 'card', accountId: cardId });
      fixture.detectChanges();
      el = fixture.nativeElement as HTMLElement;
      expect(el.querySelectorAll('.debt-line').length).toBe(1);
      expect(el.querySelector('.debt-line')?.textContent).toContain('Visa');
    });

    it('shows an "Add a Fixed Deposit" link when there are none, and the countdown chip once one is active', () => {
      fixture.detectChanges();
      let el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('No active deposits');

      state.addBank({ name: 'Main Bank', color: '#111', initialCapital: 0 });
      const bankId = state.state()!.banks[0].id;
      state.addFixedDeposit({ bankId, startDate: TODAY, amount: 1000, percentage: 5, months: 12, status: 'active' });
      fixture.detectChanges();
      el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Main Bank');
      expect(el.querySelector('.chip-warn')).not.toBeNull();
    });

    it('draws one donut segment per savings-rate slice and shows the Overspent chip only when overspent', () => {
      state.addTransaction({ date: TODAY, amount: 100, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 30, type: 'commitment', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 20, type: 'expense', accountType: 'cash' });
      fixture.detectChanges();
      let el = fixture.nativeElement as HTMLElement;
      // 1 background track + 3 segments (committed/variable/saved).
      expect(el.querySelectorAll('.donut-svg circle').length).toBe(4);
      expect(el.querySelector('.chip-bad')).toBeNull();

      state.addTransaction({ date: TODAY, amount: 200, type: 'expense', accountType: 'cash' });
      fixture.detectChanges();
      el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.chip-bad')?.textContent).toContain('Overspent');
    });

    it('shows a "New" chip for a category pace row with no trailing baseline', () => {
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
      expect(el.querySelector('.chip-info')?.textContent).toContain('New');
    });

    it('shows the empty state instead of a list when there are no transactions', () => {
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.tx-list')).toBeNull();
      expect(el.textContent).toContain('No transactions recorded yet.');
    });

    it("shows the specific bank's own color next to its name in Recent Activity", () => {
      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 1000 });
      state.addTransaction({ date: TODAY, amount: 50, type: 'expense', accountType: 'bank', accountId: state.state()!.banks[0].id });
      fixture.detectChanges();

      const row = fixture.nativeElement.querySelector('.tx-row') as HTMLElement;
      const dots = row.querySelectorAll('.tx-dot');
      // First dot is the category's, second is the account's.
      expect((dots[1] as HTMLElement).style.background).toBe('rgb(37, 99, 235)');
      expect(row.querySelector('.tx-account')?.textContent).toContain('Maybank');
    });
  });
});
