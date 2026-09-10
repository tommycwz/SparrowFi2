import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReportsPage } from './reports';
import { StateService } from '../../core/state.service';
import { createEmptyState } from '../../core/models';
import { monthKeyOf } from '../../core/format.util';

/** Today's date, and its 'YYYY-MM' key, reused across tests so "this
 * month"/"this year" transactions land in the right bucket regardless of
 * when the suite runs. */
const TODAY = new Date().toISOString().slice(0, 10);
const THIS_MONTH = monthKeyOf();
const THIS_YEAR = new Date().getFullYear();

describe('ReportsPage', () => {
  let state: StateService;
  let page: ReportsPage;
  let fixture: ComponentFixture<ReportsPage>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ReportsPage] });
    state = TestBed.inject(StateService);
    state.replaceState(createEmptyState());
    fixture = TestBed.createComponent(ReportsPage);
    page = fixture.componentInstance;
  });

  describe('periodRange', () => {
    it('Month mode resolves to the first/last day of the selected month', () => {
      page.month.set('2026-02');
      const range = page.periodRange();
      expect(range.start).toBe('2026-02-01');
      expect(range.end).toBe('2026-02-28'); // 2026 is not a leap year
      expect(range.monthCount).toBe(1);
    });

    it('Month mode handles a leap-year February correctly', () => {
      page.month.set('2028-02');
      expect(page.periodRange().end).toBe('2028-02-29');
    });

    it('Year mode resolves to Jan 1 - Dec 31 of the selected year', () => {
      page.setMode('year');
      page.year.set(2025);
      const range = page.periodRange();
      expect(range.start).toBe('2025-01-01');
      expect(range.end).toBe('2025-12-31');
      expect(range.label).toBe('2025');
      expect(range.monthCount).toBe(12);
    });

    it('Range mode spans from the first day of "from" to the last day of "to"', () => {
      page.setMode('range');
      page.rangeFrom.set('2026-01');
      page.rangeTo.set('2026-03');
      const range = page.periodRange();
      expect(range.start).toBe('2026-01-01');
      expect(range.end).toBe('2026-03-31');
      expect(range.monthCount).toBe(3);
    });

    it('Range mode swaps a backwards "from"/"to" pick instead of producing an empty range', () => {
      page.setMode('range');
      page.rangeFrom.set('2026-06');
      page.rangeTo.set('2026-01');
      const range = page.periodRange();
      expect(range.start).toBe('2026-01-01');
      expect(range.end).toBe('2026-06-30');
    });
  });

  describe('filter navigation', () => {
    it('shiftMonthFilter walks the Month filter one month at a time, rolling over the year', () => {
      page.month.set('2026-12');
      page.shiftMonthFilter(1);
      expect(page.month()).toBe('2027-01');
      page.shiftMonthFilter(-1);
      expect(page.month()).toBe('2026-12');
    });

    it('shiftYearFilter walks the Year filter one year at a time', () => {
      page.year.set(2026);
      page.shiftYearFilter(1);
      expect(page.year()).toBe(2027);
      page.shiftYearFilter(-2);
      expect(page.year()).toBe(2025);
    });
  });

  describe('totals and filteredTransactions', () => {
    beforeEach(() => {
      state.addTransaction({ date: TODAY, amount: 1000, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 400, type: 'expense', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 200, type: 'others-in', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 50, type: 'others-out', accountType: 'cash' });
      // Outside the default Month filter (assuming the suite doesn't run on
      // the 1st - if it does, this still lands in the same month bucket,
      // which is fine since the "excluded" assertions use an explicit
      // narrower month filter instead of relying on this row being outside).
      state.addTransaction({ date: '2020-01-15', amount: 9999, type: 'income', accountType: 'cash' });
    });

    it('sums income/expense/others separately and computes net from income-expense only', () => {
      page.month.set(THIS_MONTH);
      const t = page.totals();
      expect(t.income).toBe(1000);
      expect(t.expense).toBe(400);
      expect(t.net).toBe(600);
      expect(t.othersIn).toBe(200);
      expect(t.othersOut).toBe(50);
      expect(t.count).toBe(4);
    });

    it('excludes transactions outside the selected period', () => {
      page.month.set('2020-01');
      expect(page.totals().income).toBe(9999);
      expect(page.totals().count).toBe(1);
    });

    it('netStatLabel puts the minus sign before the currency symbol for a negative net', () => {
      page.month.set(THIS_MONTH);
      state.addTransaction({ date: TODAY, amount: 5000, type: 'expense', accountType: 'cash' });
      const label = page.netStatLabel();
      expect(label.startsWith('-')).toBe(true);
      expect(label.lastIndexOf('-')).toBe(0);
    });
  });

  describe('income/expense analysis', () => {
    beforeEach(() => {
      state.addCategory({ name: 'Salary', color: '#22C55E', type: 'income' });
      state.addCategory({ name: 'Freelance', color: '#3B82F6', type: 'income' });
      state.addCategory({ name: 'Groceries', color: '#EF4444', type: 'expense' });
      const [salary, freelance] = state.state()!.categories.filter((c) => c.type === 'income');
      const [groceries] = state.state()!.categories.filter((c) => c.type === 'expense');

      state.addTransaction({ date: TODAY, amount: 3000, type: 'income', accountType: 'cash', categoryId: salary.id });
      state.addTransaction({
        date: TODAY,
        amount: 1000,
        type: 'income',
        accountType: 'cash',
        categoryId: freelance.id,
      });
      state.addTransaction({
        date: TODAY,
        amount: 200,
        type: 'expense',
        accountType: 'cash',
        categoryId: groceries.id,
      });
      page.month.set(THIS_MONTH);
    });

    it('groups income by category, sorted largest first, summing to the period total', () => {
      const income = page.incomeAnalysis();
      expect(income.total).toBe(4000);
      expect(income.items.map((i) => i.name)).toEqual(['Salary', 'Freelance']);
      expect(income.items[0].percent).toBe(75);
    });

    it('groups expenses by category separately from income', () => {
      const expense = page.expenseAnalysis();
      expect(expense.total).toBe(200);
      expect(expense.items[0].name).toBe('Groceries');
    });

    it('turns each analysis into donut segments that sum to a full 100-unit ring', () => {
      const segments = page.incomeDonutSegments();
      const totalDash = segments.reduce((sum, s) => sum + Number(s.dashArray.split(' ')[0]), 0);
      expect(totalDash).toBe(100);
      expect(segments[0].offset).toBe(25);
    });
  });

  describe('card/wallet spending analysis', () => {
    beforeEach(() => {
      state.addCard({ name: 'Visa', color: '#3B82F6' });
      state.addCard({ name: 'Amex', color: '#F59E0B' });
      state.addWallet({ name: 'Touch n Go', color: '#22C55E', initialCapital: 0 });
      state.addCategory({ name: 'Groceries', color: '#EF4444', type: 'expense' });
      state.addCategory({ name: 'Dining', color: '#F97316', type: 'expense' });
      const [visa, amex] = state.state()!.cards;
      const [ttng] = state.state()!.wallets;
      const [groceries, dining] = state.state()!.categories;

      state.addTransaction({
        date: TODAY,
        amount: 200,
        type: 'expense',
        accountType: 'card',
        accountId: visa.id,
        categoryId: groceries.id,
      });
      state.addTransaction({
        date: TODAY,
        amount: 100,
        type: 'expense',
        accountType: 'card',
        accountId: visa.id,
        categoryId: dining.id,
      });
      state.addTransaction({
        date: TODAY,
        amount: 100,
        type: 'expense',
        accountType: 'card',
        accountId: amex.id,
        categoryId: dining.id,
      });
      // A card refund (others-in through the same card) shouldn't count as
      // spending.
      state.addTransaction({
        date: TODAY,
        amount: 50,
        type: 'others-in',
        accountType: 'card',
        accountId: visa.id,
      });
      state.addTransaction({
        date: TODAY,
        amount: 40,
        type: 'expense',
        accountType: 'wallet',
        accountId: ttng.id,
      });
      // Bank spending shouldn't leak into either card or wallet analysis.
      state.addTransaction({ date: TODAY, amount: 500, type: 'expense', accountType: 'bank' });
      page.month.set(THIS_MONTH);
    });

    it('groups card expenses by card, sorted largest first, excluding non-expense card activity', () => {
      const cards = page.cardSpendingAnalysis();
      expect(cards.total).toBe(400);
      expect(cards.items.map((c) => c.name)).toEqual(['Visa', 'Amex']);
      expect(cards.items[0].amount).toBe(300);
    });

    it('groups wallet expenses by wallet, separate from card and bank spending', () => {
      const wallets = page.walletSpendingAnalysis();
      expect(wallets.total).toBe(40);
      expect(wallets.items[0].name).toBe('Touch n Go');
    });

    it('turns card spending into donut segments summing to a full 100-unit ring', () => {
      const segments = page.cardSpendingDonutSegments();
      const totalDash = segments.reduce((sum, s) => sum + Number(s.dashArray.split(' ')[0]), 0);
      expect(totalDash).toBe(100);
    });

    it("breaks each card's own spending down by category", () => {
      const cards = page.cardSpendingAnalysis();
      const visa = cards.items.find((c) => c.name === 'Visa')!;
      expect(visa.categories.map((c) => c.name)).toEqual(['Groceries', 'Dining']);
      expect(visa.categories[0].amount).toBe(200);
      expect(visa.categories[0].percent).toBeCloseTo(66.667, 2); // 200 of Visa's 300 total

      const amex = cards.items.find((c) => c.name === 'Amex')!;
      expect(amex.categories.map((c) => c.name)).toEqual(['Dining']);
      expect(amex.categories[0].amount).toBe(100);
    });
  });

  describe('monthlyBreakdown', () => {
    it('is hidden for a single-month period', () => {
      page.setMode('month');
      expect(page.hasMonthlyChart()).toBe(false);
      expect(page.monthlyBreakdown().months).toEqual([]);
    });

    it('covers every month in a Year filter, buckets income/expense per month', () => {
      page.setMode('year');
      page.year.set(2026);
      state.addTransaction({ date: '2026-03-10', amount: 500, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: '2026-03-12', amount: 100, type: 'expense', accountType: 'cash' });

      expect(page.hasMonthlyChart()).toBe(true);
      const { months, max } = page.monthlyBreakdown();
      expect(months.length).toBe(12);
      expect(months[0].key).toBe('2026-01');
      expect(months[11].key).toBe('2026-12');
      const march = months.find((m) => m.key === '2026-03')!;
      expect(march.income).toBe(500);
      expect(march.expense).toBe(100);
      expect(max).toBe(500);
    });

    it('is suppressed for a period wider than the chart cap, without affecting totals', () => {
      page.setMode('range');
      page.rangeFrom.set('2000-01');
      page.rangeTo.set('2030-12');
      expect(page.periodRange().monthCount).toBeGreaterThan(36);
      expect(page.hasMonthlyChart()).toBe(false);
      expect(page.rangeTooWideForChart()).toBe(true);
    });
  });

  describe('summary', () => {
    it('computes a positive savings rate and identifies the top category on each side', () => {
      state.addCategory({ name: 'Salary', color: '#22C55E', type: 'income' });
      state.addCategory({ name: 'Rent', color: '#EF4444', type: 'expense' });
      const salary = state.state()!.categories.find((c) => c.type === 'income')!;
      const rent = state.state()!.categories.find((c) => c.type === 'expense')!;
      state.addTransaction({ date: TODAY, amount: 1000, type: 'income', accountType: 'cash', categoryId: salary.id });
      state.addTransaction({ date: TODAY, amount: 300, type: 'expense', accountType: 'cash', categoryId: rent.id });
      page.month.set(THIS_MONTH);

      const s = page.summary();
      expect(s.count).toBe(2);
      expect(s.savingsRate).toBe(70); // net 700 / income 1000
      expect(s.topIncome?.name).toBe('Salary');
      expect(s.topExpense?.name).toBe('Rent');
      expect(s.avgTransaction).toBe(650); // (1000 + 300) / 2
    });

    it('reports a 0% savings rate rather than NaN/Infinity when there is no income', () => {
      page.month.set(THIS_MONTH);
      expect(page.summary().savingsRate).toBe(0);
      expect(page.summary().topIncome).toBeNull();
    });
  });

  describe('rendered DOM', () => {
    it('shows the empty state when there are no transactions in the period', () => {
      page.month.set(THIS_MONTH);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('No transactions in this period');
    });

    it('switches between Month/Year/Range filter controls as the mode tab changes', () => {
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.period-stepper')).not.toBeNull();
      expect(el.querySelector('.range-inputs')).toBeNull();

      const tabs = Array.from(el.querySelectorAll<HTMLButtonElement>('.mode-tab'));
      tabs.find((t) => t.textContent?.trim() === 'Range')!.click();
      fixture.detectChanges();

      expect(page.mode()).toBe('range');
      expect(el.querySelector('.range-inputs')).not.toBeNull();
      expect(el.querySelector('.period-stepper')).toBeNull();
    });

    it('colors Net Cash Flow red when the period ran a deficit', () => {
      page.month.set(THIS_MONTH);
      state.addTransaction({ date: TODAY, amount: 100, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 900, type: 'expense', accountType: 'cash' });
      fixture.detectChanges();

      const stats = fixture.nativeElement.querySelectorAll('.stat .stat-value');
      const netEl = stats[2] as HTMLElement;
      expect(netEl.classList.contains('negative')).toBe(true);
    });

    it('renders the current account balances regardless of the selected report period', () => {
      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 500 });
      page.month.set('2020-01'); // a period with no transactions at all
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.account-card .acc-name')?.textContent).toContain('Maybank');
    });

    it('shows the Card/Wallet Spending Analysis empty states when neither has any expenses', () => {
      state.addTransaction({ date: TODAY, amount: 100, type: 'income', accountType: 'cash' });
      page.month.set(THIS_MONTH);
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const headings = Array.from(el.querySelectorAll('.section-head h2')).map((h) => h.textContent?.trim());
      expect(headings).toContain('Card Spending Analysis');
      expect(headings).toContain('Wallet Spending Analysis');
      expect(el.textContent).toContain('No card expenses recorded in this period.');
      expect(el.textContent).toContain('No wallet expenses recorded in this period.');
    });

    it('renders a breakdown row per card once card expenses exist', () => {
      state.addCard({ name: 'Visa', color: '#3B82F6' });
      const [visa] = state.state()!.cards;
      state.addTransaction({
        date: TODAY,
        amount: 250,
        type: 'expense',
        accountType: 'card',
        accountId: visa.id,
      });
      page.month.set(THIS_MONTH);
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Visa');
      expect(el.querySelector('.empty-state p')?.textContent).not.toContain('No card expenses');
    });

    it("shows a category chip under a card once that card's expenses are categorized", () => {
      state.addCard({ name: 'Visa', color: '#3B82F6' });
      state.addCategory({ name: 'Groceries', color: '#EF4444', type: 'expense' });
      const [visa] = state.state()!.cards;
      const [groceries] = state.state()!.categories;
      state.addTransaction({
        date: TODAY,
        amount: 250,
        type: 'expense',
        accountType: 'card',
        accountId: visa.id,
        categoryId: groceries.id,
      });
      page.month.set(THIS_MONTH);
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const chip = el.querySelector('.subcat-chip');
      expect(chip?.textContent).toContain('Groceries');
    });
  });
});
