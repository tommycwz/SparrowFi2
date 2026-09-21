import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardPage } from './dashboard';
import { StateService } from '../../core/state.service';
import { createEmptyState } from '../../core/models';

/** Today's date, reused across tests so "this month" transactions always
 * land in `monthlyStats`/`savingsRate`/`categorySpend`'s current-month
 * bucket regardless of when the suite runs. */
const TODAY = new Date().toISOString().slice(0, 10);

/** The 1st of the month `monthsAgo` calendar months back - for building
 * transactions that land in `avgMonthlyBurn`'s trailing (completed-month)
 * window without ever landing in the current month.
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

  describe('categorySpend', () => {
    it('has no expense when there are no expense transactions at all', () => {
      expect(page.categorySpend().hasExpense).toBe(false);
      expect(page.categorySpend().segments).toEqual([]);
    });

    it('totals this month\'s expense transactions by category, ignoring other months and other types', () => {
      state.addCategory({ name: 'Groceries', color: '#EF4444', type: 'expense' });
      const catId = state.state()!.categories[0].id;
      state.addTransaction({ date: TODAY, amount: 60, type: 'expense', accountType: 'cash', categoryId: catId });
      state.addTransaction({ date: TODAY, amount: 40, type: 'expense', accountType: 'cash', categoryId: catId });
      // Not counted: a commitment this month, and an expense from a prior month.
      state.addTransaction({ date: TODAY, amount: 999, type: 'commitment', accountType: 'cash' });
      state.addTransaction({ date: monthsAgoDate(1), amount: 999, type: 'expense', accountType: 'cash' });

      const spend = page.categorySpend();
      expect(spend.hasExpense).toBe(true);
      expect(spend.total).toBe(100);
      expect(spend.segments.length).toBe(1);
      expect(spend.segments[0].name).toBe('Groceries');
      expect(spend.segments[0].amount).toBe(100);
      expect(spend.segments[0].pctLabel).toBe('100');
    });

    it('rolls categories past the top count into a single "Other" slice', () => {
      for (let i = 0; i < 6; i++) {
        state.addCategory({ name: `Cat ${i}`, color: '#111', type: 'expense' });
      }
      const cats = state.state()!.categories;
      // Amounts 10..60 - the top 5 (60,50,40,30,20) are kept individually,
      // the smallest (10) is rolled into "Other".
      cats.forEach((c, i) => {
        state.addTransaction({ date: TODAY, amount: (i + 1) * 10, type: 'expense', accountType: 'cash', categoryId: c.id });
      });

      const spend = page.categorySpend();
      expect(spend.segments.length).toBe(6);
      expect(spend.segments[5].name).toBe('Other');
      expect(spend.segments[5].amount).toBe(10);
    });
  });

  describe('investmentBreakdown', () => {
    beforeEach(() => {
      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 0 });
    });

    it('is empty with a zero max when there are no investments', () => {
      expect(page.investmentBreakdown()).toEqual({ bars: [], max: 0 });
    });

    it('shows only the base (invested) segment for a still-active investment', () => {
      const [bank] = state.state()!.banks;
      state.addInvestment({
        name: 'Tech Stock',
        toAccountId: bank.id,
        toAccountType: 'bank',
        amount: 1000,
        date: TODAY,
      });

      const [bar] = page.investmentBreakdown().bars;
      expect(bar.status).toBe('active');
      expect(bar.baseAmount).toBe(1000);
      expect(bar.gain).toBe(0);
      expect(bar.loss).toBe(0);
      expect(bar.total).toBe(1000);
    });

    it('splits a completed gain into a base segment plus a separate gain segment', () => {
      const [bank] = state.state()!.banks;
      state.addInvestment({
        name: 'Tech Stock',
        toAccountId: bank.id,
        toAccountType: 'bank',
        amount: 1000,
        date: TODAY,
      });
      const [inv] = state.state()!.investments;
      state.completeInvestment(inv.id, TODAY, 1300);

      const [bar] = page.investmentBreakdown().bars;
      expect(bar.status).toBe('completed');
      expect(bar.baseAmount).toBe(1000);
      expect(bar.gain).toBe(300);
      expect(bar.loss).toBe(0);
      expect(bar.total).toBe(1300); // base + gain
    });

    it('splits a completed loss into a shorter base segment plus a separate loss segment, total unchanged', () => {
      const [bank] = state.state()!.banks;
      state.addInvestment({
        name: 'Risky Bet',
        toAccountId: bank.id,
        toAccountType: 'bank',
        amount: 1000,
        date: TODAY,
      });
      const [inv] = state.state()!.investments;
      state.completeInvestment(inv.id, TODAY, 700);

      const [bar] = page.investmentBreakdown().bars;
      expect(bar.status).toBe('completed');
      expect(bar.baseAmount).toBe(700);
      expect(bar.gain).toBe(0);
      expect(bar.loss).toBe(300);
      expect(bar.total).toBe(1000); // base + loss, same as the original invested amount
    });

    it("isn't affected by the dashboard's own current-month scoping, same as Available Cash", () => {
      const [bank] = state.state()!.banks;
      state.addInvestment({
        name: 'Old Investment',
        toAccountId: bank.id,
        toAccountType: 'bank',
        amount: 500,
        date: '2020-01-01',
      });

      expect(page.investmentBreakdown().bars.length).toBe(1);
    });
  });

  describe('assetAllocation', () => {
    it('is empty when there are no assets at all', () => {
      expect(page.assetAllocation()).toEqual({ items: [], total: 0 });
    });

    it('splits Liquid Cash, Fixed Deposits and Investments principal into shares of the whole', () => {
      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 700 });
      // No bankId on the FD - a pure memo, so it doesn't deduct from the
      // bank balance above (see `addFixedDeposit`), keeping this test's
      // expected total a simple sum of the three independent pieces.
      state.addFixedDeposit({
        amount: 200,
        percentage: 3,
        months: 12,
        startDate: TODAY,
        status: 'active',
      });
      const [bank] = state.state()!.banks;
      state.addInvestment({ name: 'Tech Stock', toAccountId: bank.id, toAccountType: 'bank', amount: 100, date: TODAY });

      const allocation = page.assetAllocation();
      expect(allocation.total).toBe(700 + 200 + 100);
      expect(allocation.items.map((i) => i.name)).toEqual(['Liquid Cash', 'Fixed Deposits', 'Investments']);
    });

    it('produces donut segments (dashArray) summing to a full 100-unit ring', () => {
      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 500 });
      const items = page.assetAllocation().items;
      const totalDash = items.reduce((sum, s) => sum + Number(s.dashArray.split(' ')[0]), 0);
      expect(totalDash).toBe(100);
    });
  });

  describe('fixedDepositLedger', () => {
    it('is empty when there are no fixed deposits', () => {
      expect(page.fixedDepositLedger()).toEqual([]);
    });

    it('lists every fixed deposit regardless of status, soonest maturity first', () => {
      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 0 });
      const [bank] = state.state()!.banks;
      state.addFixedDeposit({
        bankId: bank.id,
        amount: 1000,
        percentage: 3,
        months: 12,
        startDate: '2026-01-01',
        status: 'active',
      });
      state.addFixedDeposit({
        bankId: bank.id,
        amount: 500,
        percentage: 2,
        months: 3,
        startDate: '2026-01-01',
        status: 'active',
      });

      const rows = page.fixedDepositLedger();
      expect(rows.length).toBe(2);
      expect(rows[0].months).toBe(3); // matures sooner than the 12-month deposit
      expect(rows[0].bankName).toBe('Maybank');
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
      const netEl = stats[4] as HTMLElement; // Income, Expense, Commitment, Pending Recurring, Net This Month
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
      // 1 background track + 3 segments (committed/variable/saved) - scoped
      // to the Savings Rate card specifically, since "Where It Went" below
      // it renders its own `.donut-svg` once there's any expense too.
      expect(el.querySelectorAll('.savings-rate-card .donut-svg circle').length).toBe(4);
      expect(el.querySelector('.chip-bad')).toBeNull();

      state.addTransaction({ date: TODAY, amount: 200, type: 'expense', accountType: 'cash' });
      fixture.detectChanges();
      el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.chip-bad')?.textContent).toContain('Overspent');
    });

    it('draws a "Where It Went" donut segment per category, using each category\'s own saved color', () => {
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
      // 1 background track + 1 segment (a single category, no "Other").
      expect(el.querySelectorAll('.category-spend-card .donut-svg circle').length).toBe(2);
      expect(el.querySelector('.category-spend-card .legend-row')?.textContent).toContain('Groceries');
      const segment = el.querySelector('.category-spend-card .donut-segment');
      expect(segment?.getAttribute('stroke')).toBe('#EF4444');
    });

    it('draws an Asset Allocation donut segment per asset class, with the amount (not a percentage) in the legend', () => {
      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 700 });
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      // 1 background track + 1 segment (Liquid Cash only, no FD/Investments yet).
      expect(el.querySelectorAll('.asset-allocation-card .donut-svg circle').length).toBe(2);
      expect(el.querySelector('.asset-allocation-card .legend-row')?.textContent).toContain('Liquid Cash');
      expect(el.querySelector('.asset-allocation-card .amt')?.textContent).toContain('700.00');
    });

    it('shows the Investments empty state when there are none, and a bar per investment once added', () => {
      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 0 });
      fixture.detectChanges();
      let el = fixture.nativeElement as HTMLElement;
      const headings = Array.from(el.querySelectorAll('.section-head h2')).map((h) => h.textContent?.trim());
      expect(headings).toContain('Investments');
      expect(el.textContent).toContain('No investments recorded yet.');

      const [bank] = state.state()!.banks;
      state.addInvestment({
        name: 'Tech Stock',
        toAccountId: bank.id,
        toAccountType: 'bank',
        amount: 1000,
        date: TODAY,
      });
      fixture.detectChanges();
      el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.investment-label')?.textContent).toContain('Tech Stock');
    });

    it('shows the Fixed Deposits empty state when there are none, and a row per deposit once added', () => {
      fixture.detectChanges();
      let el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('No fixed deposits recorded yet.');

      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 0 });
      const bankId = state.state()!.banks[0].id;
      state.addFixedDeposit({ bankId, startDate: TODAY, amount: 1000, percentage: 5, months: 12, status: 'active' });
      fixture.detectChanges();
      el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.fd-row .fd-bank')?.textContent).toContain('Maybank');
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
