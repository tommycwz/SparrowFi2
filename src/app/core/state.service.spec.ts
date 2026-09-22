import { TestBed } from '@angular/core/testing';
import { StateService } from './state.service';
import { createEmptyState } from './models';
import { fdGainValue, fdMaturityValue } from './fixed-deposit.util';

describe('StateService fixed deposit <-> transaction linking', () => {
  let service: StateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StateService);
    service.replaceState(createEmptyState());
    service.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 0 });
    service.addBank({ name: 'Other Bank', color: '#3B82F6', initialCapital: 0 });
  });

  function bankId(name: string): string {
    return service.state()!.banks.find((b) => b.name === name)!.id;
  }

  it('records an others-out transaction against the bank when a fixed deposit is created', () => {
    service.addFixedDeposit({
      bankId: bankId('Main Bank'),
      startDate: '2026-01-01',
      amount: 1000,
      percentage: 3.5,
      months: 12,
      status: 'active',
    });

    const fd = service.state()!.fixedDeposits[0];
    const linked = service.state()!.transactions.filter((t) => t.fdId === fd.id);
    expect(linked.length).toBe(1);
    expect(linked[0].type).toBe('others-out');
    expect(linked[0].accountType).toBe('bank');
    expect(linked[0].accountId).toBe(bankId('Main Bank'));
    expect(linked[0].amount).toBe(1000);
    expect(linked[0].date).toBe('2026-01-01');
  });

  it('categorizes the placement/maturity/gain transactions using the shared "Investment (Out)", "Investment (In)", and "Investment Profit" locked categories when present', () => {
    service.addCategory({ name: 'Investment (Out)', color: '#4338CA', type: 'others-out', locked: true });
    service.addCategory({ name: 'Investment (In)', color: '#0369A1', type: 'others-in', locked: true });
    service.addCategory({ name: 'Investment Profit', color: '#10B981', type: 'income', locked: true });
    const [fdPlacement, fdMaturityWithdrawal, fdGain] = service.state()!.categories;

    service.addFixedDeposit({
      bankId: bankId('Main Bank'),
      startDate: '2026-01-01',
      amount: 1000,
      percentage: 12,
      months: 12,
      status: 'active',
    });
    const fd = service.state()!.fixedDeposits[0];
    const opening = service.state()!.transactions.find((t) => t.fdId === fd.id)!;
    expect(opening.categoryId).toBe(fdPlacement.id);

    service.updateFixedDeposit(fd.id, { status: 'matured' });
    const principalTx = service.state()!.transactions.find((t) => t.fdId === fd.id && t.type === 'others-in')!;
    const gainTx = service.state()!.transactions.find((t) => t.fdId === fd.id && t.type === 'income')!;
    expect(principalTx.categoryId).toBe(fdMaturityWithdrawal.id);
    expect(gainTx.categoryId).toBe(fdGain.id);
  });

  it('splits maturity into a principal (others-in) and a gains (income) transaction, to toBankId, exactly once when marked matured', () => {
    service.addFixedDeposit({
      bankId: bankId('Main Bank'),
      toBankId: bankId('Other Bank'),
      startDate: '2026-01-01',
      amount: 1000,
      percentage: 12,
      months: 12,
      status: 'active',
    });
    const fd = service.state()!.fixedDeposits[0];

    service.updateFixedDeposit(fd.id, { status: 'matured' });
    const matured = { ...fd, status: 'matured' as const };
    let principalTx = service.state()!.transactions.filter((t) => t.fdId === fd.id && t.type === 'others-in');
    let gainTx = service.state()!.transactions.filter((t) => t.fdId === fd.id && t.type === 'income');
    expect(principalTx.length).toBe(1);
    expect(gainTx.length).toBe(1);
    expect(principalTx[0].accountId).toBe(bankId('Other Bank'));
    expect(principalTx[0].amount).toBe(1000);
    expect(gainTx[0].accountId).toBe(bankId('Other Bank'));
    expect(gainTx[0].amount).toBeCloseTo(fdGainValue(matured));
    // The two together still add up to the full payout.
    expect(principalTx[0].amount + gainTx[0].amount).toBeCloseTo(fdMaturityValue(matured));

    // Marking matured again (e.g. a stray double-call) must not duplicate either.
    service.updateFixedDeposit(fd.id, { status: 'matured' });
    principalTx = service.state()!.transactions.filter((t) => t.fdId === fd.id && t.type === 'others-in');
    gainTx = service.state()!.transactions.filter((t) => t.fdId === fd.id && t.type === 'income');
    expect(principalTx.length).toBe(1);
    expect(gainTx.length).toBe(1);
  });

  it('omits (and later drops) the gains transaction for a 0% fixed deposit', () => {
    service.addFixedDeposit({
      bankId: bankId('Main Bank'),
      startDate: '2026-01-01',
      amount: 1000,
      percentage: 5,
      months: 12,
      status: 'active',
    });
    const fd = service.state()!.fixedDeposits[0];

    service.updateFixedDeposit(fd.id, { status: 'matured' });
    expect(
      service.state()!.transactions.some((t) => t.fdId === fd.id && t.type === 'income'),
    ).toBe(true);

    // Editing the rate down to 0% after maturity should drop the now-stale gains transaction.
    service.updateFixedDeposit(fd.id, { percentage: 0 });
    expect(
      service.state()!.transactions.some((t) => t.fdId === fd.id && t.type === 'income'),
    ).toBe(false);
    const principalTx = service.state()!.transactions.find((t) => t.fdId === fd.id && t.type === 'others-in')!;
    expect(principalTx.amount).toBe(1000);
  });

  it('keeps the opening transaction in sync when the fixed deposit is edited', () => {
    service.addFixedDeposit({
      bankId: bankId('Main Bank'),
      startDate: '2026-01-01',
      amount: 1000,
      percentage: 3.5,
      months: 12,
      status: 'active',
    });
    const fd = service.state()!.fixedDeposits[0];

    service.updateFixedDeposit(fd.id, { amount: 2000, bankId: bankId('Other Bank') });
    const opening = service.state()!.transactions.find((t) => t.fdId === fd.id && t.type === 'others-out')!;
    expect(opening.amount).toBe(2000);
    expect(opening.accountId).toBe(bankId('Other Bank'));
  });

  it('removes linked transactions when the fixed deposit is deleted', () => {
    service.addFixedDeposit({
      bankId: bankId('Main Bank'),
      startDate: '2026-01-01',
      amount: 1000,
      percentage: 3.5,
      months: 12,
      status: 'active',
    });
    const fd = service.state()!.fixedDeposits[0];
    service.updateFixedDeposit(fd.id, { status: 'matured' });
    // Opening (others-out) + principal returned (others-in) + gains (income).
    expect(service.state()!.transactions.filter((t) => t.fdId === fd.id).length).toBe(3);

    service.removeFixedDeposit(fd.id);
    expect(service.state()!.transactions.filter((t) => t.fdId === fd.id).length).toBe(0);
  });

  it('a bank-less FD books no transactions at all, even once matured, and gains one once a bank is added', () => {
    service.addFixedDeposit({
      startDate: '2026-01-01',
      amount: 1000,
      percentage: 5,
      months: 12,
      status: 'active',
    });
    const fd = service.state()!.fixedDeposits[0];
    expect(service.state()!.transactions.length).toBe(0);

    service.updateFixedDeposit(fd.id, { status: 'matured' });
    expect(service.state()!.transactions.filter((t) => t.fdId === fd.id).length).toBe(0);

    // Adding a bank retroactively books both the opening transaction and -
    // since this FD is already "matured" - the maturity payout too, all in
    // one go.
    service.updateFixedDeposit(fd.id, { bankId: bankId('Main Bank') });
    expect(service.state()!.transactions.filter((t) => t.fdId === fd.id).length).toBe(3);
  });
});

describe('StateService.netWorth with active fixed deposits', () => {
  let service: StateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StateService);
    service.replaceState(createEmptyState());
    service.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 5000 });
  });

  function bankId(name: string): string {
    return service.state()!.banks.find((b) => b.name === name)!.id;
  }

  it("counts an active FD's principal as part of Net Worth, so placing one doesn't make wealth disappear", () => {
    const before = service.netWorth();
    service.addFixedDeposit({
      bankId: bankId('Main Bank'),
      startDate: '2026-01-01',
      amount: 2000,
      percentage: 5,
      months: 12,
      status: 'active',
    });

    // The bank balance dropped by 2000 (opening "others-out"), but Net
    // Worth is unchanged - the money is still yours, just locked in an FD.
    expect(service.accountBalances().find((a) => a.id === bankId('Main Bank'))!.balance).toBe(3000);
    expect(service.activeFixedDepositTotal()).toBe(2000);
    expect(service.netWorth()).toBe(before);
  });

  it("excludes a matured FD's principal from activeFixedDepositTotal - it's already back in the account balance", () => {
    service.addFixedDeposit({
      bankId: bankId('Main Bank'),
      startDate: '2026-01-01',
      amount: 2000,
      percentage: 5,
      months: 12,
      status: 'active',
    });
    const fd = service.state()!.fixedDeposits[0];
    const before = service.netWorth();

    service.updateFixedDeposit(fd.id, { status: 'matured' });

    // No longer "active", so it drops out of activeFixedDepositTotal...
    expect(service.activeFixedDepositTotal()).toBe(0);
    // ...but Net Worth still only goes up by the interest earned (not
    // double-counted with the principal, which is now back in the bank).
    const gain = fdGainValue({ ...fd, status: 'matured' });
    expect(service.netWorth()).toBeCloseTo(before + gain);
  });

  it('excludes a withdrawn FD the same way', () => {
    service.addFixedDeposit({
      bankId: bankId('Main Bank'),
      startDate: '2026-01-01',
      amount: 2000,
      percentage: 0,
      months: 12,
      status: 'active',
    });
    const fd = service.state()!.fixedDeposits[0];
    service.updateFixedDeposit(fd.id, { status: 'matured' });
    service.updateFixedDeposit(fd.id, { status: 'withdrawn' });

    expect(service.activeFixedDepositTotal()).toBe(0);
  });

  it('a bank-less FD counts toward Net Worth too - it never touched a tracked account, so it\'s disclosure, not double-counting', () => {
    const before = service.netWorth();
    service.addFixedDeposit({
      startDate: '2026-01-01',
      amount: 3000,
      percentage: 5,
      months: 12,
      status: 'active',
    });

    expect(service.state()!.fixedDeposits.every((fd) => fd.bankId === undefined)).toBe(true);
    expect(service.activeFixedDepositTotal()).toBe(3000);
    expect(service.netWorth()).toBe(before + 3000);
  });
});

describe('StateService.activeFixedDepositTotalAsOf', () => {
  let service: StateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StateService);
    service.replaceState(createEmptyState());
    service.addFixedDeposit({
      startDate: '2026-01-01',
      amount: 2000,
      percentage: 5,
      months: 6, // matures 2026-07-01
      status: 'active',
    });
  });

  it("is 0 for a date before the FD's start date - it hadn't been placed yet", () => {
    expect(service.activeFixedDepositTotalAsOf('2025-12-31')).toBe(0);
  });

  it('counts the principal for a date the FD was locked for, regardless of what happened to it since', () => {
    expect(service.activeFixedDepositTotalAsOf('2026-03-01')).toBe(2000);
  });

  it("is 0 once past the FD's natural maturity date, even if today it's still marked active (not yet rolled over)", () => {
    expect(service.activeFixedDepositTotalAsOf('2026-07-01')).toBe(0);
  });

  it('excludes a withdrawn FD entirely, since an early withdrawal has no recorded date to reconstruct from', () => {
    const fd = service.state()!.fixedDeposits[0];
    service.updateFixedDeposit(fd.id, { status: 'withdrawn' });

    // Even for a date well within what would have been its locked window.
    expect(service.activeFixedDepositTotalAsOf('2026-03-01')).toBe(0);
  });
});

describe('StateService.accountBalancesAsOf', () => {
  let service: StateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StateService);
    service.replaceState(createEmptyState());
    service.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 1000 });
  });

  function bankId(name: string): string {
    return service.state()!.banks.find((b) => b.name === name)!.id;
  }

  it('reconstructs a past balance using only transactions dated on or before that date', () => {
    service.addTransaction({ date: '2026-03-01', amount: 200, type: 'income', accountType: 'bank', accountId: bankId('Main Bank') });
    service.addTransaction({ date: '2026-06-01', amount: 500, type: 'income', accountType: 'bank', accountId: bankId('Main Bank') });

    // Only the initial capital + the March transaction should count for a
    // cutoff before the June one.
    const balance = service.accountBalancesAsOf('2026-04-30').find((a) => a.id === bankId('Main Bank'));
    expect(balance!.balance).toBe(1000 + 200);
  });

  it('matches accountBalances() (today\'s live figures) when the cutoff is today', () => {
    service.addTransaction({ date: '2026-03-01', amount: 200, type: 'income', accountType: 'bank', accountId: bankId('Main Bank') });
    const today = new Date().toISOString().slice(0, 10);

    expect(service.accountBalancesAsOf(today)).toEqual(service.accountBalances());
  });
});

describe('StateService investment <-> transaction linking', () => {
  let service: StateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StateService);
    service.replaceState(createEmptyState());
    service.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 0 });
    service.addBank({ name: 'Other Bank', color: '#3B82F6', initialCapital: 0 });
  });

  function bankId(name: string): string {
    return service.state()!.banks.find((b) => b.name === name)!.id;
  }

  it('records an others-out transaction against the "from fund" when an investment is created', () => {
    service.addInvestment({
      name: 'Tech Stock',
      fromAccountId: bankId('Main Bank'),
      fromAccountType: 'bank',
      toAccountId: bankId('Main Bank'),
      toAccountType: 'bank',
      amount: 1000,
      date: '2026-01-01',
    });

    const inv = service.state()!.investments[0];
    const linked = service.state()!.transactions.filter((t) => t.investmentId === inv.id);
    expect(linked.length).toBe(1);
    expect(linked[0].type).toBe('others-out');
    expect(linked[0].accountType).toBe('bank');
    expect(linked[0].accountId).toBe(bankId('Main Bank'));
    expect(linked[0].amount).toBe(1000);
  });

  it('records no opening transaction at all when no "from fund" is chosen', () => {
    service.addInvestment({
      name: 'Cash Deal',
      toAccountId: bankId('Main Bank'),
      toAccountType: 'bank',
      amount: 1000,
      date: '2026-01-01',
    });

    const inv = service.state()!.investments[0];
    expect(service.state()!.transactions.filter((t) => t.investmentId === inv.id).length).toBe(0);
  });

  it('categorizes the opening/completion transactions using the locked Investment categories when present', () => {
    service.addCategory({ name: 'Investment (Out)', color: '#4338CA', type: 'others-out', locked: true });
    service.addCategory({ name: 'Investment (In)', color: '#0369A1', type: 'others-in', locked: true });
    service.addCategory({ name: 'Investment Profit', color: '#10B981', type: 'income', locked: true });
    const [invOut, invIn, invGain] = service.state()!.categories;

    service.addInvestment({
      name: 'Tech Stock',
      fromAccountId: bankId('Main Bank'),
      fromAccountType: 'bank',
      toAccountId: bankId('Main Bank'),
      toAccountType: 'bank',
      amount: 1000,
      date: '2026-01-01',
    });
    const inv = service.state()!.investments[0];
    const opening = service.state()!.transactions.find((t) => t.investmentId === inv.id)!;
    expect(opening.categoryId).toBe(invOut.id);

    service.completeInvestment(inv.id, '2026-06-01', 1300);
    const principalTx = service.state()!.transactions.find(
      (t) => t.investmentId === inv.id && t.type === 'others-in',
    )!;
    const gainTx = service.state()!.transactions.find(
      (t) => t.investmentId === inv.id && t.type === 'income',
    )!;
    expect(principalTx.categoryId).toBe(invIn.id);
    expect(gainTx.categoryId).toBe(invGain.id);

    // Completing a second, losing investment has nothing to categorize as a
    // loss - it just uses the same "Investment (In)" principal category for
    // the (smaller) amount that actually came back.
    service.addInvestment({
      name: 'Risky Bet',
      fromAccountId: bankId('Main Bank'),
      fromAccountType: 'bank',
      toAccountId: bankId('Main Bank'),
      toAccountType: 'bank',
      amount: 500,
      date: '2026-01-01',
    });
    const inv2 = service.state()!.investments.find((i) => i.name === 'Risky Bet')!;
    service.completeInvestment(inv2.id, '2026-06-01', 300);
    const principalTx2 = service.state()!.transactions.find(
      (t) => t.investmentId === inv2.id && t.type === 'others-in',
    )!;
    expect(principalTx2.categoryId).toBe(invIn.id);
    expect(principalTx2.amount).toBe(300);
    // Only the opening "others-out" exists for inv2 - no separate loss
    // transaction of any kind.
    expect(
      service.state()!.transactions.filter((t) => t.investmentId === inv2.id && t.type === 'others-out').length,
    ).toBe(1);
  });

  it('splits a completed gain into a fixed-principal others-in plus an income transaction, to toAccountId', () => {
    service.addInvestment({
      name: 'Tech Stock',
      fromAccountId: bankId('Main Bank'),
      fromAccountType: 'bank',
      toAccountId: bankId('Other Bank'),
      toAccountType: 'bank',
      amount: 1000,
      date: '2026-01-01',
    });
    const inv = service.state()!.investments[0];

    service.completeInvestment(inv.id, '2026-06-01', 1300);
    const principalTx = service.state()!.transactions.find(
      (t) => t.investmentId === inv.id && t.type === 'others-in',
    )!;
    const gainTx = service.state()!.transactions.find(
      (t) => t.investmentId === inv.id && t.type === 'income',
    )!;
    expect(principalTx.amount).toBe(1000);
    expect(principalTx.accountId).toBe(bankId('Other Bank'));
    expect(gainTx.amount).toBe(300);
    expect(gainTx.accountId).toBe(bankId('Other Bank'));
    // Other Bank actually received the full 1300 (principal + gain).
    expect(service.accountBalances().find((a) => a.id === bankId('Other Bank'))!.balance).toBe(1300);
  });

  it('books a loss as a smaller "Investment (In)" principal transaction, with no separate loss transaction or category', () => {
    service.addInvestment({
      name: 'Risky Bet',
      fromAccountId: bankId('Main Bank'),
      fromAccountType: 'bank',
      toAccountId: bankId('Other Bank'),
      toAccountType: 'bank',
      amount: 1000,
      date: '2026-01-01',
    });
    const inv = service.state()!.investments[0];

    service.completeInvestment(inv.id, '2026-06-01', 700);
    const principalTx = service.state()!.transactions.find(
      (t) => t.investmentId === inv.id && t.type === 'others-in',
    )!;
    // The principal transaction itself is just the smaller, real amount
    // that came back - min(invested, final) - rather than the full 1000
    // invested with a separate transaction for the 300 shortfall.
    expect(principalTx.amount).toBe(700);
    // Other Bank ends up with exactly the 700 that actually came back.
    expect(service.accountBalances().find((a) => a.id === bankId('Other Bank'))!.balance).toBe(700);
    // No income (gain) transaction should exist for a losing investment.
    expect(service.state()!.transactions.some((t) => t.investmentId === inv.id && t.type === 'income')).toBe(
      false,
    );
  });

  it('re-completing does not duplicate transactions, and flips gain<->loss cleanly when the final amount is corrected', () => {
    service.addInvestment({
      name: 'Tech Stock',
      fromAccountId: bankId('Main Bank'),
      fromAccountType: 'bank',
      toAccountId: bankId('Main Bank'),
      toAccountType: 'bank',
      amount: 1000,
      date: '2026-01-01',
    });
    const inv = service.state()!.investments[0];

    service.completeInvestment(inv.id, '2026-06-01', 1300);
    expect(service.state()!.transactions.filter((t) => t.investmentId === inv.id).length).toBe(3); // open + principal + gain

    // Correcting the final amount down into a loss should drop the stale
    // gain transaction and shrink the principal transaction, not duplicate
    // anything or add a new one.
    service.completeInvestment(inv.id, '2026-06-02', 800);
    const afterCorrection = service.state()!.transactions.filter((t) => t.investmentId === inv.id);
    expect(afterCorrection.length).toBe(2); // open + principal (no gain, no separate loss)
    expect(afterCorrection.some((t) => t.type === 'income')).toBe(false);
    expect(afterCorrection.find((t) => t.type === 'others-in')!.amount).toBe(800);

    // Breaking exactly even should leave just the opening and principal
    // transactions, with the principal back to the full invested amount.
    service.completeInvestment(inv.id, '2026-06-03', 1000);
    const afterBreakeven = service.state()!.transactions.filter((t) => t.investmentId === inv.id);
    expect(afterBreakeven.length).toBe(2); // open + principal
    expect(afterBreakeven.find((t) => t.type === 'others-in')!.amount).toBe(1000);
    expect(afterBreakeven.some((t) => t.type === 'income')).toBe(false);
  });

  it('keeps the opening transaction in sync when the investment is edited', () => {
    service.addInvestment({
      name: 'Tech Stock',
      fromAccountId: bankId('Main Bank'),
      fromAccountType: 'bank',
      toAccountId: bankId('Main Bank'),
      toAccountType: 'bank',
      amount: 1000,
      date: '2026-01-01',
    });
    const inv = service.state()!.investments[0];

    service.updateInvestment(inv.id, {
      amount: 2000,
      fromAccountId: bankId('Other Bank'),
      fromAccountType: 'bank',
    });
    const opening = service.state()!.transactions.find(
      (t) => t.investmentId === inv.id && t.type === 'others-out',
    )!;
    expect(opening.amount).toBe(2000);
    expect(opening.accountId).toBe(bankId('Other Bank'));
  });

  it('adds/removes the opening transaction when "from fund" is added or cleared after creation', () => {
    service.addInvestment({
      name: 'Cash Deal',
      toAccountId: bankId('Main Bank'),
      toAccountType: 'bank',
      amount: 1000,
      date: '2026-01-01',
    });
    const inv = service.state()!.investments[0];
    expect(service.state()!.transactions.filter((t) => t.investmentId === inv.id).length).toBe(0);

    service.updateInvestment(inv.id, { fromAccountId: bankId('Main Bank'), fromAccountType: 'bank' });
    expect(
      service.state()!.transactions.filter((t) => t.investmentId === inv.id && t.type === 'others-out')
        .length,
    ).toBe(1);

    service.updateInvestment(inv.id, { fromAccountId: undefined, fromAccountType: undefined });
    expect(service.state()!.transactions.filter((t) => t.investmentId === inv.id).length).toBe(0);
  });

  it('completing an investment with no "to fund" books no transactions at all, and clears stale ones if "to fund" is later removed', () => {
    service.addInvestment({
      name: 'Handshake Deal',
      fromAccountId: bankId('Main Bank'),
      fromAccountType: 'bank',
      amount: 1000,
      date: '2026-01-01',
    });
    const inv = service.state()!.investments[0];

    service.completeInvestment(inv.id, '2026-06-01', 1300);
    expect(service.state()!.investments[0].status).toBe('completed');
    // Only the opening "others-out" exists - no principal or gain booked,
    // since there's nowhere to book them to.
    expect(service.state()!.transactions.filter((t) => t.investmentId === inv.id).length).toBe(1);

    // Give it a "to fund" retroactively and re-complete - now it books.
    service.updateInvestment(inv.id, { toAccountId: bankId('Other Bank'), toAccountType: 'bank' });
    service.completeInvestment(inv.id, '2026-06-01', 1300);
    expect(service.state()!.transactions.filter((t) => t.investmentId === inv.id).length).toBe(3);

    // Clearing "to fund" again and re-completing drops the stale principal/gain.
    service.updateInvestment(inv.id, { toAccountId: undefined, toAccountType: undefined });
    service.completeInvestment(inv.id, '2026-06-01', 1300);
    expect(service.state()!.transactions.filter((t) => t.investmentId === inv.id).length).toBe(1);
  });

  it('removes all linked transactions when the investment is deleted', () => {
    service.addInvestment({
      name: 'Tech Stock',
      fromAccountId: bankId('Main Bank'),
      fromAccountType: 'bank',
      toAccountId: bankId('Main Bank'),
      toAccountType: 'bank',
      amount: 1000,
      date: '2026-01-01',
    });
    const inv = service.state()!.investments[0];
    service.completeInvestment(inv.id, '2026-06-01', 1300);
    expect(service.state()!.transactions.filter((t) => t.investmentId === inv.id).length).toBe(3); // open + principal + gain

    service.removeInvestment(inv.id);
    expect(service.state()!.transactions.filter((t) => t.investmentId === inv.id).length).toBe(0);
    expect(service.state()!.investments.length).toBe(0);
  });
});

describe('StateService.netWorth with active investments', () => {
  let service: StateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StateService);
    service.replaceState(createEmptyState());
    service.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 5000 });
  });

  function bankId(name: string): string {
    return service.state()!.banks.find((b) => b.name === name)!.id;
  }

  it("counts an active investment's principal as part of Net Worth when it has a \"from fund\", so opening one doesn't make wealth disappear", () => {
    const before = service.netWorth();
    service.addInvestment({
      name: 'Tech Stock',
      fromAccountId: bankId('Main Bank'),
      fromAccountType: 'bank',
      toAccountId: bankId('Main Bank'),
      toAccountType: 'bank',
      amount: 2000,
      date: '2026-01-01',
    });

    expect(service.accountBalances().find((a) => a.id === bankId('Main Bank'))!.balance).toBe(3000);
    expect(service.activeInvestmentTotal()).toBe(2000);
    expect(service.netWorth()).toBe(before);
  });

  it('DOES add an investment with no "from fund" to Net Worth - it\'s newly-disclosed wealth SparrowFi had no prior knowledge of, not double-counted', () => {
    const before = service.netWorth();
    service.addInvestment({
      name: 'Cash Deal',
      toAccountId: bankId('Main Bank'),
      toAccountType: 'bank',
      amount: 2000,
      date: '2026-01-01',
    });

    // Nothing was deducted from any tracked account (no "from fund"), so
    // counting the 2000 here is disclosure, not double-counting.
    expect(service.activeInvestmentTotal()).toBe(2000);
    expect(service.netWorth()).toBe(before + 2000);
  });

  it('excludes a completed investment from activeInvestmentTotal - its payout is already back in the account balance', () => {
    service.addInvestment({
      name: 'Tech Stock',
      fromAccountId: bankId('Main Bank'),
      fromAccountType: 'bank',
      toAccountId: bankId('Main Bank'),
      toAccountType: 'bank',
      amount: 2000,
      date: '2026-01-01',
    });
    const inv = service.state()!.investments[0];
    const before = service.netWorth();

    service.completeInvestment(inv.id, '2026-06-01', 2500);

    expect(service.activeInvestmentTotal()).toBe(0);
    // Net Worth only goes up by the actual gain (500), not double-counted
    // with the principal (which is now back in the bank).
    expect(service.netWorth()).toBeCloseTo(before + 500);
  });

  it('reduces Net Worth by the real loss once a losing investment completes', () => {
    service.addInvestment({
      name: 'Risky Bet',
      fromAccountId: bankId('Main Bank'),
      fromAccountType: 'bank',
      toAccountId: bankId('Main Bank'),
      toAccountType: 'bank',
      amount: 2000,
      date: '2026-01-01',
    });
    const inv = service.state()!.investments[0];
    const beforeOpening = service.netWorth();

    service.completeInvestment(inv.id, '2026-06-01', 1500);

    expect(service.netWorth()).toBeCloseTo(beforeOpening - 500);
  });
});

describe('StateService.activeInvestmentTotalAsOf', () => {
  let service: StateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StateService);
    service.replaceState(createEmptyState());
    service.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 5000 });
  });

  function bankId(name: string): string {
    return service.state()!.banks.find((b) => b.name === name)!.id;
  }

  it("is 0 for a date before the investment's own start date - it hadn't been made yet", () => {
    service.addInvestment({
      name: 'Tech Stock',
      toAccountId: bankId('Main Bank'),
      toAccountType: 'bank',
      amount: 2000,
      date: '2026-03-01',
    });

    expect(service.activeInvestmentTotalAsOf('2026-02-01')).toBe(0);
  });

  it('counts a still-active investment for any date on or after it started', () => {
    service.addInvestment({
      name: 'Tech Stock',
      toAccountId: bankId('Main Bank'),
      toAccountType: 'bank',
      amount: 2000,
      date: '2026-03-01',
    });

    expect(service.activeInvestmentTotalAsOf('2026-06-01')).toBe(2000);
  });

  it('counts a since-completed investment for a date before its completion, unlike activeInvestmentTotal (today-only)', () => {
    service.addInvestment({
      name: 'Tech Stock',
      toAccountId: bankId('Main Bank'),
      toAccountType: 'bank',
      amount: 2000,
      date: '2026-01-01',
    });
    const inv = service.state()!.investments[0];
    service.completeInvestment(inv.id, '2026-06-01', 2500);

    // Today's live total excludes it (it's completed)...
    expect(service.activeInvestmentTotal()).toBe(0);
    // ...but as of a date before it completed, it was still active.
    expect(service.activeInvestmentTotalAsOf('2026-03-01')).toBe(2000);
  });

  it('excludes a completed investment for a date on or after its completion date', () => {
    service.addInvestment({
      name: 'Tech Stock',
      toAccountId: bankId('Main Bank'),
      toAccountType: 'bank',
      amount: 2000,
      date: '2026-01-01',
    });
    const inv = service.state()!.investments[0];
    service.completeInvestment(inv.id, '2026-06-01', 2500);

    expect(service.activeInvestmentTotalAsOf('2026-06-01')).toBe(0);
  });
});

describe('StateService bank/wallet initial capital', () => {
  let service: StateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StateService);
    service.replaceState(createEmptyState());
  });

  it('records a non-zero initial capital as an opening transaction, not on the bank record', () => {
    service.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 1500 });
    const bank = service.state()!.banks[0];

    // Not double-counted: the stored field is zeroed...
    expect(bank.initialCapital).toBe(0);
    // ...because the balance instead comes from an opening transaction.
    const opening = service.state()!.transactions.filter((t) => t.accountId === bank.id);
    expect(opening.length).toBe(1);
    expect(opening[0].type).toBe('others-in');
    expect(opening[0].accountType).toBe('bank');
    expect(opening[0].amount).toBe(1500);
    expect(opening[0].notes).toBe('Initial balance');

    const balance = service.accountBalances().find((a) => a.id === bank.id)!;
    expect(balance.balance).toBe(1500);
  });

  it('records a wallet initial capital the same way', () => {
    service.addWallet({ name: 'Cash Wallet', color: '#F97316', initialCapital: 200 });
    const wallet = service.state()!.wallets[0];

    expect(wallet.initialCapital).toBe(0);
    const opening = service.state()!.transactions.filter((t) => t.accountId === wallet.id);
    expect(opening.length).toBe(1);
    expect(opening[0].accountType).toBe('wallet');
    expect(opening[0].amount).toBe(200);
  });

  it('creates no opening transaction when initial capital is zero', () => {
    service.addBank({ name: 'Empty Bank', color: '#22C55E', initialCapital: 0 });
    expect(service.state()!.transactions.length).toBe(0);
  });

  it('categorizes a new opening transaction as "Adjustment (In)" when that locked category exists', () => {
    service.addCategory({ name: 'Adjustment (In)', color: '#06B6D4', type: 'others-in', locked: true });
    service.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 1500 });
    const adjustmentIn = service.state()!.categories[0];

    const opening = service.state()!.transactions[0];
    expect(opening.categoryId).toBe(adjustmentIn.id);
  });

  it('leaves the opening transaction uncategorized when no "Adjustment (In)" category exists', () => {
    service.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 1500 });
    expect(service.state()!.transactions[0].categoryId).toBeUndefined();
  });

  it('updateBank only ever changes name/color, never initialCapital', () => {
    service.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 1000 });
    const bank = service.state()!.banks[0];

    service.updateBank(bank.id, { name: 'Renamed Bank', color: '#3B82F6' });
    const updated = service.state()!.banks[0];
    expect(updated.name).toBe('Renamed Bank');
    expect(updated.color).toBe('#3B82F6');
    expect(updated.initialCapital).toBe(0);
    // The opening transaction (and thus the balance) is untouched by the rename.
    const balance = service.accountBalances().find((a) => a.id === bank.id)!;
    expect(balance.balance).toBe(1000);
  });
});

describe('StateService account deletion guard', () => {
  let service: StateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StateService);
    service.replaceState(createEmptyState());
  });

  it('deletes a bank with no transactions', () => {
    service.addBank({ name: 'Empty Bank', color: '#22C55E', initialCapital: 0 });
    const bank = service.state()!.banks[0];
    service.removeBank(bank.id);
    expect(service.state()!.banks.length).toBe(0);
  });

  it('refuses to delete a bank with its own opening-balance transaction', () => {
    service.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 500 });
    const bank = service.state()!.banks[0];
    expect(service.accountHasTransactions('bank', bank.id)).toBe(true);
    expect(() => service.removeBank(bank.id)).toThrowError(/can’t be deleted/);
    // Nothing was removed.
    expect(service.state()!.banks.length).toBe(1);
    expect(service.state()!.transactions.length).toBe(1);
  });

  it('refuses to delete a bank that only has a fixed-deposit-generated transaction', () => {
    service.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 0 });
    const bank = service.state()!.banks[0];
    service.addFixedDeposit({
      bankId: bank.id,
      startDate: '2026-01-01',
      amount: 1000,
      percentage: 3.5,
      months: 12,
      status: 'active',
    });
    expect(() => service.removeBank(bank.id)).toThrowError(/can’t be deleted/);
  });

  it('refuses to delete a wallet with transactions, but allows it once they are gone', () => {
    service.addWallet({ name: 'Cash Wallet', color: '#F97316', initialCapital: 100 });
    const wallet = service.state()!.wallets[0];
    expect(() => service.removeWallet(wallet.id)).toThrowError(/can’t be deleted/);

    const tx = service.state()!.transactions[0];
    service.removeTransaction(tx.id);
    expect(service.accountHasTransactions('wallet', wallet.id)).toBe(false);
    service.removeWallet(wallet.id);
    expect(service.state()!.wallets.length).toBe(0);
  });

  it('refuses to delete a card with transactions', () => {
    service.addCard({ name: 'Visa', color: '#3B82F6' });
    const card = service.state()!.cards[0];
    service.addTransaction({
      date: '2026-01-01',
      amount: 50,
      type: 'expense',
      accountType: 'card',
      accountId: card.id,
    });
    expect(() => service.removeCard(card.id)).toThrowError(/can’t be deleted/);
    service.removeTransaction(service.state()!.transactions[0].id);
    service.removeCard(card.id);
    expect(service.state()!.cards.length).toBe(0);
  });
});

describe('StateService recurring transactions - lines', () => {
  let service: StateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StateService);
    service.replaceState(createEmptyState());
    service.addBank({ name: 'Main Bank', color: '#22C55E', initialCapital: 0 });
    service.addBank({ name: 'Savings', color: '#3B82F6', initialCapital: 0 });
  });

  function bankId(name: string): string {
    return service.state()!.banks.find((b) => b.name === name)!.id;
  }

  it('addRecurring assigns an id to the template and to each of its lines', () => {
    service.addRecurring({
      name: 'Salary',
      frequency: 'monthly',
      nextDate: '2026-01-01',
      lines: [
        { amount: 5000, type: 'income', accountType: 'bank', accountId: bankId('Main Bank') },
        { amount: 500, type: 'others-out', accountType: 'bank', accountId: bankId('Savings') },
      ],
    });
    const r = service.state()!.recurringTransactions[0];
    expect(r.id).toBeTruthy();
    expect(r.lines.length).toBe(2);
    expect(r.lines[0].id).toBeTruthy();
    expect(r.lines[1].id).toBeTruthy();
    expect(r.lines[0].id).not.toBe(r.lines[1].id);
  });

  it('triggerRecurring books one transaction per line, all dated nextDate and all linked back to the template', () => {
    service.addRecurring({
      name: 'Salary',
      frequency: 'monthly',
      nextDate: '2026-01-01',
      lines: [
        { amount: 5000, type: 'income', accountType: 'bank', accountId: bankId('Main Bank') },
        { amount: 500, type: 'others-out', accountType: 'bank', accountId: bankId('Savings') },
      ],
    });
    const r = service.state()!.recurringTransactions[0];

    service.triggerRecurring(r.id);

    const transactions = service.state()!.transactions;
    expect(transactions.length).toBe(2);
    expect(transactions.every((t) => t.date === '2026-01-01')).toBe(true);
    expect(transactions.every((t) => t.recurringId === r.id)).toBe(true);
    expect(transactions.find((t) => t.type === 'income')?.amount).toBe(5000);
    expect(transactions.find((t) => t.type === 'others-out')?.amount).toBe(500);
    // The template only advances once per trigger, not once per line.
    expect(service.state()!.recurringTransactions[0].nextDate).toBe('2026-02-01');
  });

  it('updateRecurring replacing lines assigns fresh ids and drops the old lines entirely', () => {
    service.addRecurring({
      name: 'Salary',
      frequency: 'monthly',
      nextDate: '2026-01-01',
      lines: [{ amount: 5000, type: 'income', accountType: 'bank', accountId: bankId('Main Bank') }],
    });
    const original = service.state()!.recurringTransactions[0];

    service.updateRecurring(original.id, {
      lines: [{ amount: 200, type: 'expense', accountType: 'cash' }],
    });

    const updated = service.state()!.recurringTransactions[0];
    expect(updated.lines.length).toBe(1);
    expect(updated.lines[0].amount).toBe(200);
    expect(updated.lines[0].id).not.toBe(original.lines[0].id);
  });

  it('updateRecurring without a lines patch leaves the existing lines untouched', () => {
    service.addRecurring({
      name: 'Salary',
      frequency: 'monthly',
      nextDate: '2026-01-01',
      lines: [{ amount: 5000, type: 'income', accountType: 'bank', accountId: bankId('Main Bank') }],
    });
    const original = service.state()!.recurringTransactions[0];

    service.updateRecurring(original.id, { name: 'Salary (renamed)' });

    const updated = service.state()!.recurringTransactions[0];
    expect(updated.name).toBe('Salary (renamed)');
    expect(updated.lines).toEqual(original.lines);
  });
});

describe('StateService recurring transactions - pausing', () => {
  let service: StateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StateService);
    service.replaceState(createEmptyState());
    service.addRecurring({
      name: 'Netflix',
      frequency: 'monthly',
      nextDate: '2026-01-01',
      lines: [{ amount: 45, type: 'expense', accountType: 'cash' }],
    });
  });

  function recurring() {
    return service.state()!.recurringTransactions[0];
  }

  it('is not paused by default', () => {
    expect(recurring().paused).toBeFalsy();
  });

  it('togglePauseRecurring flips paused on and off, touching only the targeted item', () => {
    service.addRecurring({
      name: 'Gym',
      frequency: 'monthly',
      nextDate: '2026-01-05',
      lines: [{ amount: 60, type: 'expense', accountType: 'cash' }],
    });
    const [netflix, gym] = service.state()!.recurringTransactions;

    service.togglePauseRecurring(netflix.id);
    expect(service.state()!.recurringTransactions.find((r) => r.id === netflix.id)!.paused).toBe(true);
    expect(service.state()!.recurringTransactions.find((r) => r.id === gym.id)!.paused).toBeFalsy();

    service.togglePauseRecurring(netflix.id);
    expect(service.state()!.recurringTransactions.find((r) => r.id === netflix.id)!.paused).toBe(false);
  });

  it('triggerAllRecurring skips booking a transaction for a paused item, but still advances its nextDate', () => {
    service.togglePauseRecurring(recurring().id);
    expect(recurring().paused).toBe(true);

    service.triggerAllRecurring();

    expect(service.state()!.transactions.length).toBe(0);
    expect(recurring().nextDate).toBe('2026-02-01');
  });

  it('triggerAllRecurring still books an unpaused item normally alongside a skipped paused one', () => {
    service.addRecurring({
      name: 'Gym',
      frequency: 'monthly',
      nextDate: '2026-01-05',
      lines: [{ amount: 60, type: 'expense', accountType: 'cash' }],
    });
    const [netflix, gym] = service.state()!.recurringTransactions;
    service.togglePauseRecurring(netflix.id);

    service.triggerAllRecurring();

    const transactions = service.state()!.transactions;
    expect(transactions.length).toBe(1);
    expect(transactions[0].recurringId).toBe(gym.id);
    expect(transactions[0].amount).toBe(60);
    // Both items' nextDate move forward, paused or not.
    expect(service.state()!.recurringTransactions.find((r) => r.id === netflix.id)!.nextDate).toBe('2026-02-01');
    expect(service.state()!.recurringTransactions.find((r) => r.id === gym.id)!.nextDate).toBe('2026-02-05');
  });

  it('triggerRecurring (single item) still books a paused item - pausing only affects "Add All"', () => {
    service.togglePauseRecurring(recurring().id);
    service.triggerRecurring(recurring().id);

    expect(service.state()!.transactions.length).toBe(1);
    expect(service.state()!.transactions[0].recurringId).toBe(recurring().id);
    expect(recurring().nextDate).toBe('2026-02-01');
  });
});

describe('StateService budgets', () => {
  let service: StateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StateService);
    service.replaceState(createEmptyState());
    service.addCategory({ name: 'Food', color: '#EF4444', type: 'expense' });
    service.addCategory({ name: 'Transport', color: '#3B82F6', type: 'expense' });
  });

  function categoryId(name: string): string {
    return service.state()!.categories.find((c) => c.name === name)!.id;
  }

  it('addBudget assigns an id and stores the category/amount as given', () => {
    service.addBudget({ categoryId: categoryId('Food'), amount: 500 });

    const budgets = service.state()!.budgets;
    expect(budgets.length).toBe(1);
    expect(budgets[0].id).toBeTruthy();
    expect(budgets[0].categoryId).toBe(categoryId('Food'));
    expect(budgets[0].amount).toBe(500);
  });

  it('addBudget can add more than one budget, one per category', () => {
    service.addBudget({ categoryId: categoryId('Food'), amount: 500 });
    service.addBudget({ categoryId: categoryId('Transport'), amount: 200 });

    expect(service.state()!.budgets.length).toBe(2);
  });

  it('updateBudget changes the amount without touching the id or other budgets', () => {
    service.addBudget({ categoryId: categoryId('Food'), amount: 500 });
    service.addBudget({ categoryId: categoryId('Transport'), amount: 200 });
    const food = service.state()!.budgets.find((b) => b.categoryId === categoryId('Food'))!;

    service.updateBudget(food.id, { amount: 650 });

    const updated = service.state()!.budgets.find((b) => b.id === food.id)!;
    expect(updated.amount).toBe(650);
    expect(updated.id).toBe(food.id);
    expect(service.state()!.budgets.find((b) => b.categoryId === categoryId('Transport'))!.amount).toBe(200);
  });

  it('removeBudget removes only the targeted budget and leaves transactions untouched', () => {
    service.addBudget({ categoryId: categoryId('Food'), amount: 500 });
    service.addBudget({ categoryId: categoryId('Transport'), amount: 200 });
    service.addTransaction({
      date: '2026-02-01',
      amount: 50,
      type: 'expense',
      accountType: 'cash',
      categoryId: categoryId('Food'),
    });
    const food = service.state()!.budgets.find((b) => b.categoryId === categoryId('Food'))!;

    service.removeBudget(food.id);

    expect(service.state()!.budgets.length).toBe(1);
    expect(service.state()!.budgets[0].categoryId).toBe(categoryId('Transport'));
    expect(service.state()!.transactions.length).toBe(1);
  });

  it('addBudget defaults an omitted period to monthly', () => {
    service.addBudget({ categoryId: categoryId('Food'), amount: 500 });
    expect(service.state()!.budgets[0].period).toBe('monthly');
  });

  it('addBudget accepts any of the four real periods, and normalizes anything else back to monthly', () => {
    service.addBudget({ categoryId: categoryId('Food'), amount: 5, period: 'daily' });
    expect(service.state()!.budgets[0].period).toBe('daily');

    service.addBudget({ categoryId: categoryId('Transport'), amount: 500, period: 'fortnightly' as any });
    expect(service.state()!.budgets.find((b) => b.categoryId === categoryId('Transport'))!.period).toBe('monthly');
  });

  it('updateBudget normalizes a period patch (including to/from the newer daily/yearly periods), and leaves period untouched when the patch omits it', () => {
    service.addBudget({ categoryId: categoryId('Food'), amount: 500, period: 'weekly' });
    const food = service.state()!.budgets[0];

    service.updateBudget(food.id, { amount: 600 });
    expect(service.state()!.budgets.find((b) => b.id === food.id)!.period).toBe('weekly');

    service.updateBudget(food.id, { period: 'yearly' });
    expect(service.state()!.budgets.find((b) => b.id === food.id)!.period).toBe('yearly');

    service.updateBudget(food.id, { period: 'daily' });
    expect(service.state()!.budgets.find((b) => b.id === food.id)!.period).toBe('daily');
  });
});

describe('StateService.moveCategory', () => {
  let service: StateService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StateService);
    service.replaceState(createEmptyState());
  });

  function categoryId(name: string): string {
    return service.state()!.categories.find((c) => c.name === name)!.id;
  }

  function names(): string[] {
    return service.state()!.categories.map((c) => c.name);
  }

  it('swaps a category with the previous/next one of the same type', () => {
    service.addCategory({ name: 'Groceries', color: '#F97316', type: 'expense' });
    service.addCategory({ name: 'Transport', color: '#D97706', type: 'expense' });
    service.addCategory({ name: 'Shopping', color: '#EC4899', type: 'expense' });

    service.moveCategory(categoryId('Transport'), 'up');
    expect(names()).toEqual(['Transport', 'Groceries', 'Shopping']);

    service.moveCategory(categoryId('Transport'), 'down');
    expect(names()).toEqual(['Groceries', 'Transport', 'Shopping']);
  });

  it('is a no-op when moving the first category of its type up, or the last one down', () => {
    service.addCategory({ name: 'Groceries', color: '#F97316', type: 'expense' });
    service.addCategory({ name: 'Transport', color: '#D97706', type: 'expense' });

    service.moveCategory(categoryId('Groceries'), 'up');
    expect(names()).toEqual(['Groceries', 'Transport']);

    service.moveCategory(categoryId('Transport'), 'down');
    expect(names()).toEqual(['Groceries', 'Transport']);
  });

  it('skips over categories of a different type to find the real same-type neighbor', () => {
    // Interleaved types, as they'd end up after edits/imports rather than
    // grouped together - `moveCategory` must walk past 'income' to find
    // Transport's actual same-type ('expense') neighbor, not just swap
    // with the physically adjacent array element.
    service.addCategory({ name: 'Groceries', color: '#F97316', type: 'expense' });
    service.addCategory({ name: 'Salary', color: '#16A34A', type: 'income' });
    service.addCategory({ name: 'Transport', color: '#D97706', type: 'expense' });

    service.moveCategory(categoryId('Transport'), 'up');

    expect(names()).toEqual(['Transport', 'Salary', 'Groceries']);
    // The unrelated 'income' category was never touched.
    expect(service.state()!.categories.find((c) => c.name === 'Salary')!.type).toBe('income');
  });

  it('is a no-op for an id that no longer exists', () => {
    service.addCategory({ name: 'Groceries', color: '#F97316', type: 'expense' });
    service.moveCategory('nonexistent-id', 'up');
    expect(names()).toEqual(['Groceries']);
  });
});
