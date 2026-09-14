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

    it('sums income/expense/others separately and computes net from income-expense-commitment', () => {
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

    it('breaks Commitment out as its own total (not lumped into Others Out), and still subtracts it from net', () => {
      page.month.set(THIS_MONTH);
      state.addTransaction({ date: TODAY, amount: 300, type: 'commitment', accountType: 'cash' });
      const t = page.totals();
      expect(t.commitment).toBe(300);
      expect(t.othersOut).toBe(50); // unchanged - the others-out transaction from beforeEach only
      expect(t.net).toBe(1000 - 400 - 300);
    });
  });

  describe('ratios', () => {
    it('is all null when there is no income to divide by', () => {
      page.month.set(THIS_MONTH);
      const r = page.ratios();
      expect(r.savingsRate).toBeNull();
      expect(r.commitmentRatio).toBeNull();
      expect(r.variableRatio).toBeNull();
    });

    it('computes savings/commitment/variable ratios as percentages of income', () => {
      state.addTransaction({ date: TODAY, amount: 1000, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 300, type: 'commitment', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 200, type: 'expense', accountType: 'cash' });
      page.month.set(THIS_MONTH);

      const r = page.ratios();
      expect(r.commitmentRatio).toBe(30);
      expect(r.variableRatio).toBe(20);
      expect(r.savingsRate).toBe(50); // (1000-300-200)/1000
    });

    it('isSavingsRatePositive treats a missing income (null rate) as non-negative', () => {
      page.month.set(THIS_MONTH);
      expect(page.isSavingsRatePositive()).toBe(true);
    });

    it('isSavingsRatePositive is false once the period ran a deficit', () => {
      state.addTransaction({ date: TODAY, amount: 100, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 500, type: 'expense', accountType: 'cash' });
      page.month.set(THIS_MONTH);
      expect(page.isSavingsRatePositive()).toBe(false);
    });
  });

  describe('income/expense/commitment analysis', () => {
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

    it('groups Commitment transactions separately, in their own analysis', () => {
      state.addCategory({ name: 'Housing (Rent / Mortgage)', color: '#7C3AED', type: 'commitment' });
      const housing = state.state()!.categories.find((c) => c.type === 'commitment')!;
      state.addTransaction({
        date: TODAY,
        amount: 1500,
        type: 'commitment',
        accountType: 'cash',
        categoryId: housing.id,
      });

      const commitment = page.commitmentAnalysis();
      expect(commitment.total).toBe(1500);
      expect(commitment.items[0].name).toBe('Housing (Rent / Mortgage)');
      // Commitment transactions never show up in the plain Expenses analysis.
      expect(page.expenseAnalysis().total).toBe(200);
    });

    it('turns each analysis into donut segments that sum to a full 100-unit ring', () => {
      const segments = page.incomeDonutSegments();
      const totalDash = segments.reduce((sum, s) => sum + Number(s.dashArray.split(' ')[0]), 0);
      expect(totalDash).toBe(100);
      expect(segments[0].offset).toBe(25);
    });
  });

  describe('spending by channel', () => {
    beforeEach(() => {
      state.addCard({ name: 'Visa', color: '#3B82F6' });
      state.addCard({ name: 'Amex', color: '#F59E0B' });
      state.addWallet({ name: 'Touch n Go', color: '#22C55E', initialCapital: 0 });
      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 0 });
      state.addCategory({ name: 'Groceries', color: '#EF4444', type: 'expense' });
      state.addCategory({ name: 'Dining', color: '#F97316', type: 'expense' });
      const [visa, amex] = state.state()!.cards;
      const [ttng] = state.state()!.wallets;
      const [maybank] = state.state()!.banks;
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
      state.addTransaction({
        date: TODAY,
        amount: 500,
        type: 'expense',
        accountType: 'bank',
        accountId: maybank.id,
      });
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

    it('groups bank expenses by bank, separate from card and wallet spending', () => {
      const banks = page.bankSpendingAnalysis();
      expect(banks.total).toBe(500);
      expect(banks.items[0].name).toBe('Maybank');
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

    it('counts a Commitment transaction on a card as spending too (e.g. a BNPL installment)', () => {
      const [visa] = state.state()!.cards;
      state.addTransaction({
        date: TODAY,
        amount: 250,
        type: 'commitment',
        accountType: 'card',
        accountId: visa.id,
      });

      const cards = page.cardSpendingAnalysis();
      const visaSlice = cards.items.find((c) => c.name === 'Visa')!;
      expect(visaSlice.amount).toBe(300 + 250);
      expect(cards.total).toBe(400 + 250);
    });

    it('defaults spendingChannel to Bank, and activeChannelAnalysis follows the selected tab', () => {
      expect(page.spendingChannel()).toBe('bank');
      expect(page.activeChannelAnalysis().total).toBe(500);

      page.spendingChannel.set('card');
      expect(page.activeChannelAnalysis().total).toBe(400);

      page.spendingChannel.set('wallet');
      expect(page.activeChannelAnalysis().total).toBe(40);
    });

    it('turns the active channel spending into donut segments summing to a full 100-unit ring', () => {
      page.spendingChannel.set('card');
      const segments = page.activeChannelDonutSegments();
      const totalDash = segments.reduce((sum, s) => sum + Number(s.dashArray.split(' ')[0]), 0);
      expect(totalDash).toBe(100);
    });
  });

  describe('monthlyBreakdown', () => {
    it('is hidden for a single-month period', () => {
      page.setMode('month');
      expect(page.hasMonthlyChart()).toBe(false);
      expect(page.monthlyBreakdown().months).toEqual([]);
    });

    it('covers every month in a Year filter, buckets income/expense/commitment per month', () => {
      page.setMode('year');
      page.year.set(2026);
      state.addTransaction({ date: '2026-03-10', amount: 500, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: '2026-03-12', amount: 100, type: 'expense', accountType: 'cash' });
      state.addTransaction({ date: '2026-03-14', amount: 50, type: 'commitment', accountType: 'cash' });

      expect(page.hasMonthlyChart()).toBe(true);
      const { months, max } = page.monthlyBreakdown();
      expect(months.length).toBe(12);
      expect(months[0].key).toBe('2026-01');
      expect(months[11].key).toBe('2026-12');
      const march = months.find((m) => m.key === '2026-03')!;
      expect(march.income).toBe(500);
      expect(march.expense).toBe(100);
      expect(march.commitment).toBe(50);
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

    it('barHeightPercent scales a value against the series max, and is 0 when max is 0', () => {
      expect(page.barHeightPercent(50, 200)).toBe(25);
      expect(page.barHeightPercent(50, 0)).toBe(0);
    });
  });

  describe('vulnerabilityTrend', () => {
    it('is null for a single-month period (nothing to trend)', () => {
      page.setMode('month');
      expect(page.vulnerabilityTrend()).toBeNull();
    });

    it('plots a commitment-ratio and variable-ratio line across the months in the period', () => {
      page.setMode('year');
      page.year.set(2026);
      state.addTransaction({ date: '2026-01-10', amount: 1000, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: '2026-01-12', amount: 300, type: 'commitment', accountType: 'cash' });
      state.addTransaction({ date: '2026-01-14', amount: 200, type: 'expense', accountType: 'cash' });
      state.addTransaction({ date: '2026-02-10', amount: 1000, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: '2026-02-12', amount: 600, type: 'commitment', accountType: 'cash' });

      const vt = page.vulnerabilityTrend();
      expect(vt).not.toBeNull();
      expect(vt!.commitmentDots.length).toBe(2);
      // January: 300/1000 = 30%. February: 600/1000 = 60%.
      expect(vt!.maxPct).toBeGreaterThanOrEqual(60);
    });

    it('is null when no month in the period has any income to divide by', () => {
      page.setMode('year');
      page.year.set(2026);
      state.addTransaction({ date: '2026-01-10', amount: 100, type: 'expense', accountType: 'cash' });
      state.addTransaction({ date: '2026-02-10', amount: 100, type: 'expense', accountType: 'cash' });
      expect(page.vulnerabilityTrend()).toBeNull();
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

    it("isn't affected by the report's period filter, same as Current Asset Balances", () => {
      const [bank] = state.state()!.banks;
      state.addInvestment({
        name: 'Old Investment',
        toAccountId: bank.id,
        toAccountType: 'bank',
        amount: 500,
        date: '2020-01-01',
      });
      page.month.set(THIS_MONTH); // a period that doesn't include 2020-01-01

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

    it('turns the allocation into donut segments summing to a full 100-unit ring', () => {
      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 500 });
      const segments = page.assetAllocationDonutSegments();
      const totalDash = segments.reduce((sum, s) => sum + Number(s.dashArray.split(' ')[0]), 0);
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

  describe('stressTest / coverageRatioLabel', () => {
    it('coverageRatio is null (rendered as "∞") when there are no commitments', () => {
      state.addTransaction({ date: TODAY, amount: 1000, type: 'income', accountType: 'cash' });
      page.month.set(THIS_MONTH);
      expect(page.stressTest().coverageRatio).toBeNull();
      expect(page.coverageRatioLabel()).toBe('∞');
    });

    it('computes Fixed Cost Coverage and Discretionary Buffer from income vs. commitment', () => {
      state.addTransaction({ date: TODAY, amount: 1000, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 250, type: 'commitment', accountType: 'cash' });
      page.month.set(THIS_MONTH);

      const st = page.stressTest();
      expect(st.coverageRatio).toBe(4); // 1000 / 250
      expect(st.buffer).toBe(750);
      expect(page.coverageRatioLabel()).toBe('4.00×');
    });

    it('projects the Commitment Ratio under each income-shock scenario, null once income drops to zero', () => {
      state.addTransaction({ date: TODAY, amount: 100, type: 'income', accountType: 'cash' });
      state.addTransaction({ date: TODAY, amount: 100, type: 'commitment', accountType: 'cash' });
      page.month.set(THIS_MONTH);

      const scenarios = page.stressTest().scenarios;
      expect(scenarios.map((s) => s.shockPct)).toEqual([10, 20, 30]);
      // A 100% commitment ratio at full income only gets worse under any income shock.
      expect(scenarios[0].ratio).toBeGreaterThan(100);
    });
  });

  describe('balanceSheet / netWorthLabel', () => {
    it('splits positive balances/FDs/investments as assets and card debt/overdrafts as liabilities', () => {
      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 1000 });
      state.addCard({ name: 'Visa', color: '#3B82F6' });
      const [visa] = state.state()!.cards;
      state.addTransaction({ date: TODAY, amount: 300, type: 'expense', accountType: 'card', accountId: visa.id });

      const sheet = page.balanceSheet();
      expect(sheet.assets.find((a) => a.label === 'Liquid Cash')?.amount).toBe(1000);
      expect(sheet.liabilities.find((l) => l.label === 'Card Debt')?.amount).toBe(300);
      expect(sheet.netWorth).toBe(1000 - 300);
    });

    it('netWorthLabel is arithmetically identical to state.netWorth(), never a second computed figure', () => {
      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 500 });
      expect(page.netWorthLabel()).toBe(page.money(state.netWorth()));
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
      const netEl = stats[3] as HTMLElement; // Total Income, Total Commitments, Total Expenses, Net Cash Flow
      expect(netEl.classList.contains('negative')).toBe(true);
    });

    it('renders a Fixed Commitments by Category column, separate from Variable Expenses by Category', () => {
      page.month.set(THIS_MONTH);
      state.addTransaction({ date: TODAY, amount: 100, type: 'income', accountType: 'cash' });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const subheads = Array.from(el.querySelectorAll('.pl-subhead')).map((h) => h.textContent?.trim());
      expect(subheads).toContain('Fixed Commitments by Category');
      expect(subheads).toContain('Variable Expenses by Category');
      expect(el.textContent).toContain('No fixed commitments recorded in this period.');
    });

    it('renders the current account balances regardless of the selected report period', () => {
      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 500 });
      // The whole report body (including the account grid) is hidden behind
      // the top-level empty state whenever the *selected period* has zero
      // transactions, so an unrelated cash transaction keeps the period
      // non-empty - the point being tested is that Maybank's balance isn't
      // scoped to the period filter, not that the report renders with none.
      state.addTransaction({ date: TODAY, amount: 50, type: 'income', accountType: 'cash' });
      page.month.set(THIS_MONTH);
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.account-card .acc-name')?.textContent).toContain('Maybank');
    });

    it('shows the Investments empty state when there are none, and a bar per investment once added', () => {
      // See the comment above - at least one transaction in the selected
      // period is needed for the report body to render at all.
      state.addTransaction({ date: TODAY, amount: 100, type: 'income', accountType: 'cash' });
      page.month.set(THIS_MONTH);
      fixture.detectChanges();
      let el = fixture.nativeElement as HTMLElement;
      const headings = Array.from(el.querySelectorAll('.section-head h2')).map((h) => h.textContent?.trim());
      expect(headings).toContain('Investments');
      expect(el.textContent).toContain('No investments recorded yet.');

      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 0 });
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

    it('switches Spending by Channel tabs between Bank/Wallet/Card, showing each channel\'s own empty state', () => {
      state.addTransaction({ date: TODAY, amount: 100, type: 'income', accountType: 'cash' });
      page.month.set(THIS_MONTH);
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const headings = Array.from(el.querySelectorAll('.section-head h2')).map((h) => h.textContent?.trim());
      expect(headings).toContain('Spending by Channel');
      expect(el.textContent).toContain('No bank expenses recorded in this period.');

      const channelTabs = Array.from(el.querySelectorAll<HTMLButtonElement>('.channel-tab'));
      channelTabs.find((t) => t.textContent?.includes('Card'))!.click();
      fixture.detectChanges();
      expect(page.spendingChannel()).toBe('card');
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('No card expenses recorded in this period.');
    });

    it('renders a breakdown row per card once card expenses exist, with a category chip once categorized', () => {
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
      page.spendingChannel.set('card');
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Visa');
      const chip = el.querySelector('.subcat-chip');
      expect(chip?.textContent).toContain('Groceries');
    });

    it('renders the Closing Position balance sheet and Net Worth row once accounts exist', () => {
      state.addBank({ name: 'Maybank', color: '#2563EB', initialCapital: 500 });
      page.month.set(THIS_MONTH);
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.net-worth-row')).not.toBeNull();
      expect(el.textContent).toContain('Total Assets');
    });
  });
});
